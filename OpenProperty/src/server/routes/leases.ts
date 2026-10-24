import { z } from "zod";
import type { Hono } from "hono";
import { collectCascadeKeys, deleteR2Keys, retireLeaseFiles } from "../documents/storage";
import type { AppEnv } from "../env";
import {
  buildUpdate,
  get,
  normalizeRow,
  normalizeRows,
  orgId,
  query,
  run,
  uuidParam,
  type SqlParam,
} from "../pg";
import { leaseClosePlan, leaseHoldsUnit, unitStatusAfterLeaseChange } from "../../shared/lease-unit";
import {
  LEASE_ATTACHMENT_KINDS_KEY,
  normalizeLeaseAttachmentKinds,
  parseLeaseAttachmentKinds,
  serializeLeaseAttachmentKinds,
} from "../documents/lease-attachments";
import { parseJson } from "../validation";

export function mountLeasesRoutes(app: Hono<AppEnv>) {
  const LeaseInput = z.object({
    unit_id: z.string().uuid(),
    primary_tenant_id: z.string().uuid().nullable().optional(),
    start_date: z.string(),
    end_date: z.string(),
    monthly_rent: z.number().min(0).optional(),
    deposit: z.number().min(0).optional(),
    rent_due_day: z.number().int().min(1).max(31).optional(),
    late_fee: z.number().min(0).optional(),
    status: z.enum(["upcoming", "active", "ended", "cancelled"]).optional(),
    notes: z.string().optional().nullable(),
  });

  const LEASE_FROM = `
  FROM leases l
  LEFT JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
  LEFT JOIN properties p ON p.id = u.property_id AND p.organization_id = u.organization_id
  LEFT JOIN tenants t ON t.id = l.primary_tenant_id AND t.organization_id = l.organization_id`;

  function leaseSelect(where: string): string {
    return `
  SELECT l.*,
    u.name as unit_name,
    p.id as property_id, p.name as property_name, p.color as property_color,
    t.first_name as tenant_first_name, t.last_name as tenant_last_name,
    t.email as tenant_email, t.phone as tenant_phone,
    t.government_id as tenant_government_id
  ${LEASE_FROM}
  WHERE l.organization_id = $1 ${where}`;
  }

  const UNIT_TAKEN = "Esa unidad ya tiene un contrato vigente o próximo.";

  async function unitHeldByAnotherLease(
    c: Parameters<typeof get>[0],
    organizationId: string,
    unitId: string,
    exceptLeaseId?: string,
  ): Promise<boolean> {
    const params: SqlParam[] = [organizationId, unitId];
    let except = "";
    if (exceptLeaseId) {
      params.push(exceptLeaseId);
      except = "AND id <> $3";
    }
    const row = await get<{ id: string }>(
      c,
      `SELECT id FROM leases
       WHERE organization_id = $1 AND unit_id = $2
         AND status IN ('upcoming', 'active')
         ${except}
       LIMIT 1`,
      params,
    );
    return Boolean(row?.id);
  }

  async function applyLeaseUnitStatus(
    c: Parameters<typeof run>[0],
    organizationId: string,
    unitId: string,
    status: "occupied" | "turnover",
  ) {
    await run(c, "UPDATE units SET status = $1 WHERE id = $2 AND organization_id = $3", [
      status,
      unitId,
      organizationId,
    ]);
  }

  async function syncUnitsAfterLease(
    c: Parameters<typeof run>[0],
    organizationId: string,
    change: {
      previousUnitId?: string | null;
      previousStatus?: string | null;
      nextUnitId?: string | null;
      nextStatus?: string | null;
    },
  ) {
    const unitChanged = Boolean(
      change.previousUnitId && change.nextUnitId && change.previousUnitId !== change.nextUnitId,
    );
    const effect = unitStatusAfterLeaseChange({
      previousStatus: change.previousStatus,
      nextStatus: change.nextStatus,
      unitChanged,
    });
    if (effect.previousUnit && change.previousUnitId) {
      await applyLeaseUnitStatus(c, organizationId, change.previousUnitId, effect.previousUnit);
    }
    const targetId = unitChanged ? change.nextUnitId : (change.nextUnitId ?? change.previousUnitId);
    if (effect.nextUnit && targetId) {
      await applyLeaseUnitStatus(c, organizationId, targetId, effect.nextUnit);
    }
  }

  function isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    );
  }

  const AttachmentKindsInput = z
    .object({
      kinds: z.array(z.string()).max(12),
    })
    .strict();

  app.get("/api/leases/attachment-kinds", async (c) => {
    const row = await get<{ value: string }>(
      c,
      `SELECT value FROM settings WHERE organization_id = $1 AND key = $2`,
      [orgId(c), LEASE_ATTACHMENT_KINDS_KEY],
    );
    return c.json({ kinds: parseLeaseAttachmentKinds(row?.value) });
  });

  app.put("/api/leases/attachment-kinds", async (c) => {
    const parsed = await parseJson(c, AttachmentKindsInput);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const normalized = normalizeLeaseAttachmentKinds(parsed.data.kinds);
    if (!normalized.ok) return c.json({ error: normalized.error }, 400);
    await run(
      c,
      `INSERT INTO settings (organization_id, key, value, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [orgId(c), LEASE_ATTACHMENT_KINDS_KEY, serializeLeaseAttachmentKinds(normalized.kinds)],
    );
    return c.json({ kinds: normalized.kinds });
  });

  app.get("/api/leases", async (c) => {
    const o = orgId(c);
    const status = c.req.query("status");
    const tenantId = uuidParam(c.req.query("tenant_id"));
    const unitId = uuidParam(c.req.query("unit_id"));
    const filters: string[] = [];
    const params: SqlParam[] = [o];
    let n = 2;
    if (status) {
      filters.push(`l.status = $${n++}`);
      params.push(status);
    }
    if (tenantId) {
      filters.push(`l.primary_tenant_id = $${n++}`);
      params.push(tenantId);
    }
    if (unitId) {
      filters.push(`l.unit_id = $${n++}`);
      params.push(unitId);
    }
    const extra = filters.length ? `AND ${filters.join(" AND ")}` : "";
    const rows = await query(c, `${leaseSelect(extra)} ORDER BY l.start_date DESC`, params);
    return c.json({ leases: normalizeRows(rows) });
  });

  app.get("/api/leases/:id", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const o = orgId(c);
    const row = await get(c, `${leaseSelect("AND l.id = $2")}`, [o, id]);
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({ lease: normalizeRow(row as Record<string, unknown>) });
  });

  app.post("/api/leases", async (c) => {
    const parsed = await parseJson(c, LeaseInput);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const d = parsed.data;
    const o = orgId(c);
    const status = d.status ?? "upcoming";
    if (status !== "upcoming" && status !== "active") {
      return c.json({ error: "Un contrato nuevo solo puede ser borrador o activo." }, 400);
    }
    if (leaseHoldsUnit(status) && (await unitHeldByAnotherLease(c, o, d.unit_id))) {
      return c.json({ error: UNIT_TAKEN }, 409);
    }
    let inserted: { id: string } | undefined;
    try {
      inserted = await get<{ id: string }>(
        c,
        `INSERT INTO leases (organization_id, unit_id, primary_tenant_id, start_date, end_date, monthly_rent, deposit, rent_due_day, late_fee, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          o,
          d.unit_id,
          d.primary_tenant_id ?? null,
          d.start_date,
          d.end_date,
          String(d.monthly_rent ?? 0),
          String(d.deposit ?? 0),
          d.rent_due_day ?? 1,
          String(d.late_fee ?? 0),
          status,
          d.notes ?? null,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) return c.json({ error: UNIT_TAKEN }, 409);
      throw err;
    }
    if (!inserted?.id) return c.json({ error: "Insert failed" }, 500);
    await syncUnitsAfterLease(c, o, {
      nextUnitId: d.unit_id,
      nextStatus: status,
    });
    const row = await get(c, `${leaseSelect("AND l.id = $2")}`, [o, inserted.id]);
    return c.json({ lease: normalizeRow(row as Record<string, unknown>) }, 201);
  });

  app.put("/api/leases/:id", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const parsed = await parseJson(c, LeaseInput.partial());
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const o = orgId(c);
    const existing = await get<{ unit_id: string; status: string }>(
      c,
      "SELECT unit_id, status FROM leases WHERE id = $1 AND organization_id = $2",
      [id, o],
    );
    if (!existing) return c.json({ error: "Not found" }, 404);
    const nextUnit = parsed.data.unit_id ?? existing.unit_id;
    const nextStatus = parsed.data.status ?? existing.status;
    const closingByHand = nextStatus === "ended" || nextStatus === "cancelled";
    if (closingByHand && nextStatus !== existing.status) {
      return c.json({ error: "Para cerrar un contrato activo usa Terminar." }, 400);
    }
    if (leaseHoldsUnit(nextStatus) && (await unitHeldByAnotherLease(c, o, nextUnit, id))) {
      return c.json({ error: UNIT_TAKEN }, 409);
    }
    const data = { ...parsed.data };
    if (data.monthly_rent !== undefined)
      data.monthly_rent = String(data.monthly_rent) as unknown as number;
    if (data.deposit !== undefined) data.deposit = String(data.deposit) as unknown as number;
    if (data.late_fee !== undefined) data.late_fee = String(data.late_fee) as unknown as number;
    const { sets, params, next } = buildUpdate(data as Record<string, unknown>);
    if (!sets.length) return c.json({ error: "No fields" }, 400);
    params.push(id, o);
    let r: { changes: number };
    try {
      r = await run(
        c,
        `UPDATE leases SET ${sets.join(", ")} WHERE id = $${next} AND organization_id = $${next + 1}`,
        params,
      );
    } catch (err) {
      if (isUniqueViolation(err)) return c.json({ error: UNIT_TAKEN }, 409);
      throw err;
    }
    if (!r.changes) return c.json({ error: "Not found" }, 404);
    await syncUnitsAfterLease(c, o, {
      previousUnitId: existing.unit_id,
      previousStatus: existing.status,
      nextUnitId: nextUnit,
      nextStatus,
    });
    const row = await get(c, `${leaseSelect("AND l.id = $2")}`, [o, id]);
    return c.json({ lease: normalizeRow(row as Record<string, unknown>) });
  });

  app.delete("/api/leases/:id", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const o = orgId(c);
    const existing = await get<{ unit_id: string; status: string }>(
      c,
      "SELECT unit_id, status FROM leases WHERE id = $1 AND organization_id = $2",
      [id, o],
    );
    if (!existing) return c.json({ error: "Not found" }, 404);
    const plan = leaseClosePlan(existing.status);
    if (!plan) return c.json({ error: "Este contrato ya está cerrado." }, 409);

    if (plan.action === "remove") {
      const keys = await collectCascadeKeys(c, "lease", id);
      const removed = await run(c, "DELETE FROM leases WHERE id = $1 AND organization_id = $2", [id, o]);
      if (!removed.changes) return c.json({ error: "Not found" }, 404);
      await syncUnitsAfterLease(c, o, {
        previousUnitId: existing.unit_id,
        previousStatus: existing.status,
        nextStatus: null,
      });
      await deleteR2Keys(c.env, keys);
      return c.json({ ok: true, removed: true });
    }

    if (plan.nextStatus) {
      const closed = await run(
        c,
        "UPDATE leases SET status = $1 WHERE id = $2 AND organization_id = $3",
        [plan.nextStatus, id, o],
      );
      if (!closed.changes) return c.json({ error: "Not found" }, 404);
      await syncUnitsAfterLease(c, o, {
        previousUnitId: existing.unit_id,
        previousStatus: existing.status,
        nextUnitId: existing.unit_id,
        nextStatus: plan.nextStatus,
      });
    }

    const keys = await retireLeaseFiles(c, id);
    await deleteR2Keys(c.env, keys);
    return c.json({ ok: true, removed: false });
  });
}
