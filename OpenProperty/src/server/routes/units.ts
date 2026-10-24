import { z } from "zod";
import type { Hono } from "hono";
import { collectCascadeKeys, deleteR2Keys } from "../documents/storage";
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
import { parseJson } from "../validation";
import { manualUnitStatusError } from "../../shared/lease-unit";
import {
  UNIT_TYPE_KINDS_KEY,
  acceptUnitType,
  normalizeUnitTypeKinds,
  parseUnitTypeKinds,
  serializeUnitTypeKinds,
} from "../../shared/unit-types";

export function mountUnitsRoutes(app: Hono<AppEnv>) {
  const UnitInput = z.object({
    property_id: z.string().uuid(),
    name: z.string().min(1),
    bedrooms: z.number().min(0).optional(),
    bathrooms: z.number().min(0).optional(),
    sqft: z.number().int().optional().nullable(),
    market_rent: z.number().min(0).optional(),
    status: z.enum(["vacant", "occupied", "turnover", "unavailable"]).optional(),
    floor: z.number().int().min(-5).max(200).nullable().optional(),
    unit_type: z.string().min(1).max(40).optional(),
    furnished: z.boolean().optional(),
    aliquot_price: z.number().min(0).optional(),
    notes: z.string().optional().nullable(),
  });

  const UnitTypeKindsInput = z
    .object({
      kinds: z.array(z.string()).max(12),
    })
    .strict();

  async function extraUnitTypes(c: Parameters<typeof get>[0]): Promise<string[]> {
    const row = await get<{ value: string }>(
      c,
      `SELECT value FROM settings WHERE organization_id = $1 AND key = $2`,
      [orgId(c), UNIT_TYPE_KINDS_KEY],
    );
    return parseUnitTypeKinds(row?.value);
  }

  app.get("/api/units/type-kinds", async (c) => {
    return c.json({ kinds: await extraUnitTypes(c) });
  });

  app.put("/api/units/type-kinds", async (c) => {
    const parsed = await parseJson(c, UnitTypeKindsInput);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const normalized = normalizeUnitTypeKinds(parsed.data.kinds);
    if (!normalized.ok) return c.json({ error: normalized.error }, 400);
    await run(
      c,
      `INSERT INTO settings (organization_id, key, value, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [orgId(c), UNIT_TYPE_KINDS_KEY, serializeUnitTypeKinds(normalized.kinds)],
    );
    return c.json({ kinds: normalized.kinds });
  });

  function unitSelectSql(extraWhere: string): string {
    return `
  SELECT u.*,
    p.name as property_name,
    p.color as property_color,
    p.address as property_address,
    p.city as property_city,
    (SELECT l.id FROM leases l WHERE l.unit_id = u.id AND l.organization_id = u.organization_id AND l.status = 'active' ORDER BY l.start_date DESC LIMIT 1) as active_lease_id,
    (SELECT t.first_name || ' ' || t.last_name FROM leases l LEFT JOIN tenants t ON t.id = l.primary_tenant_id AND t.organization_id = l.organization_id WHERE l.unit_id = u.id AND l.organization_id = u.organization_id AND l.status = 'active' ORDER BY l.start_date DESC LIMIT 1) as active_tenant_name
  FROM units u
  LEFT JOIN properties p ON p.id = u.property_id AND p.organization_id = u.organization_id
  WHERE u.organization_id = $1 ${extraWhere}`;
  }

  app.get("/api/units", async (c) => {
    const o = orgId(c);
    const propertyId = uuidParam(c.req.query("property_id"));
    const status = c.req.query("status");
    const where: string[] = [];
    const params: SqlParam[] = [o];
    let n = 2;
    if (propertyId) {
      where.push(`u.property_id = $${n++}`);
      params.push(propertyId);
    }
    if (status) {
      where.push(`u.status = $${n++}`);
      params.push(status);
    }
    const extra = where.length ? `AND ${where.join(" AND ")}` : "";
    const rows = await query(c, `${unitSelectSql(extra)} ORDER BY p.name, u.name`, params);
    return c.json({ units: normalizeRows(rows) });
  });

  app.get("/api/units/:id", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const o = orgId(c);
    const row = await get(c, `${unitSelectSql("AND u.id = $2")}`, [o, id]);
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({ unit: normalizeRow(row as Record<string, unknown>) });
  });

  app.post("/api/units", async (c) => {
    const parsed = await parseJson(c, UnitInput);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const d = parsed.data;
    const o = orgId(c);
    const status = d.status ?? "vacant";
    const statusError = manualUnitStatusError(status, "create");
    if (statusError) return c.json({ error: statusError }, 400);
    const accepted = acceptUnitType(d.unit_type ?? "departamento", await extraUnitTypes(c));
    if (!accepted.ok) return c.json({ error: accepted.error }, 400);
    const inserted = await get<{ id: string }>(
      c,
      `INSERT INTO units (organization_id, property_id, name, bedrooms, bathrooms, sqft, market_rent, status, floor, unit_type, furnished, aliquot_price, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [
        o,
        d.property_id,
        d.name,
        String(d.bedrooms ?? 1),
        String(d.bathrooms ?? 1),
        d.sqft ?? null,
        String(d.market_rent ?? 0),
        status,
        d.floor ?? null,
        accepted.unitType,
        d.furnished ?? false,
        String(d.aliquot_price ?? 0),
        d.notes ?? null,
      ],
    );
    if (!inserted?.id) return c.json({ error: "Insert failed" }, 500);
    const row = await get(c, `${unitSelectSql("AND u.id = $2")}`, [o, inserted.id]);
    return c.json({ unit: normalizeRow(row as Record<string, unknown>) }, 201);
  });

  app.put("/api/units/:id", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const parsed = await parseJson(c, UnitInput.partial());
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const patch = { ...parsed.data };
    const o = orgId(c);
    if (patch.status !== undefined) {
      const statusError = manualUnitStatusError(patch.status, "edit");
      if (statusError) return c.json({ error: statusError }, 400);
      const activeLease = await get<{ id: string }>(
        c,
        `SELECT id FROM leases
         WHERE organization_id = $1 AND unit_id = $2 AND status = 'active'
         LIMIT 1`,
        [o, id],
      );
      if (activeLease?.id) {
        return c.json(
          { error: "Esta unidad tiene un contrato activo; el estado lo actualiza el contrato." },
          409,
        );
      }
    }
    if (patch.unit_type !== undefined) {
      const existing = await get<{ unit_type: string }>(
        c,
        `SELECT unit_type FROM units WHERE id = $1 AND organization_id = $2`,
        [id, o],
      );
      if (!existing) return c.json({ error: "Not found" }, 404);
      const accepted = acceptUnitType(patch.unit_type, await extraUnitTypes(c), existing.unit_type);
      if (!accepted.ok) return c.json({ error: accepted.error }, 400);
      patch.unit_type = accepted.unitType;
    }
    if (patch.bedrooms !== undefined) patch.bedrooms = String(patch.bedrooms) as unknown as number;
    if (patch.bathrooms !== undefined)
      patch.bathrooms = String(patch.bathrooms) as unknown as number;
    if (patch.market_rent !== undefined)
      patch.market_rent = String(patch.market_rent) as unknown as number;
    if (patch.aliquot_price !== undefined)
      patch.aliquot_price = String(patch.aliquot_price) as unknown as number;
    const { sets, params, next } = buildUpdate(patch as Record<string, unknown>);
    if (!sets.length) return c.json({ error: "No fields" }, 400);
    params.push(id, o);
    const r = await run(
      c,
      `UPDATE units SET ${sets.join(", ")} WHERE id = $${next} AND organization_id = $${next + 1}`,
      params,
    );
    if (!r.changes) return c.json({ error: "Not found" }, 404);
    const row = await get(c, `${unitSelectSql("AND u.id = $2")}`, [o, id]);
    return c.json({ unit: normalizeRow(row as Record<string, unknown>) });
  });

  app.delete("/api/units/:id", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const o = orgId(c);
    const keys = await collectCascadeKeys(c, "unit", id);
    const r = await run(c, "DELETE FROM units WHERE id = $1 AND organization_id = $2", [id, o]);
    if (!r.changes) return c.json({ error: "Not found" }, 404);
    await deleteR2Keys(c.env, keys);
    return c.json({ ok: true });
  });
}
