import { z } from "zod";
import type { Hono } from "hono";
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
import { MARK_OVERDUE_FOR_ORG_SQL } from "../notifications/alerts";
import {
  ACTIVE_PAYMENT_SUM_SQL,
  APPLY_CHARGE_BALANCE_SQL,
  centsToAmount,
  hasAtMostTwoDecimals,
  toCents,
} from "../rent/payment-balance";
import { recordPayment } from "../rent/record-payment";
import { periodSchema, rentChargeStatusSchema } from "../schemas/common";
import { parseJson, parseQuery } from "../validation";

export function mountRentRoutes(app: Hono<AppEnv>) {
  const ChargeInput = z.object({
    lease_id: z.string().uuid(),
    period: periodSchema,
    due_date: z.string(),
    amount: z.number().min(0).optional(),
    notes: z.string().optional().nullable(),
  });

  function chargeSelect(where: string): string {
    return `
  SELECT c.*,
    l.unit_id, l.monthly_rent as lease_rent, l.rent_due_day,
    u.name as unit_name,
    p.id as property_id, p.name as property_name, p.color as property_color,
    t.id as tenant_id, t.first_name as tenant_first_name, t.last_name as tenant_last_name
  FROM rent_charges c
  LEFT JOIN leases l ON l.id = c.lease_id AND l.organization_id = c.organization_id
  LEFT JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
  LEFT JOIN properties p ON p.id = u.property_id AND p.organization_id = u.organization_id
  LEFT JOIN tenants t ON t.id = l.primary_tenant_id AND t.organization_id = l.organization_id
  WHERE c.organization_id = $1 ${where}`;
  }

  const ListChargesQuery = z.object({
    period: periodSchema.optional(),
    status: rentChargeStatusSchema.optional(),
    property_id: z.string().uuid().optional(),
  });

  app.get("/api/rent-charges", async (c) => {
    const q = parseQuery(c, ListChargesQuery);
    if (!q.ok) return c.json({ error: q.error }, 400);
    const o = orgId(c);
    const { period, status, property_id: propertyId } = q.data;
    const filters: string[] = [];
    const params: SqlParam[] = [o];
    let n = 2;
    if (period) {
      filters.push(`c.period = $${n++}`);
      params.push(period);
    }
    if (status) {
      filters.push(`c.status = $${n++}`);
      params.push(status);
    }
    if (propertyId) {
      filters.push(`p.id = $${n++}`);
      params.push(propertyId);
    }
    const extra = filters.length ? `AND ${filters.join(" AND ")}` : "";
    const rows = await query(
      c,
      `${chargeSelect(extra)} ORDER BY c.due_date, p.name, u.name`,
      params,
    ).catch(() => []);
    return c.json({ charges: normalizeRows(rows) });
  });

  app.post("/api/rent-charges", async (c) => {
    const parsed = await parseJson(c, ChargeInput);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const d = parsed.data;
    const o = orgId(c);
    const inserted = await get<{ id: string }>(
      c,
      `INSERT INTO rent_charges (organization_id, lease_id, period, due_date, amount, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (lease_id, period) DO NOTHING
     RETURNING id`,
      [o, d.lease_id, d.period, d.due_date, String(d.amount ?? 0), d.notes ?? null],
    );
    if (!inserted) {
      const existing = await get(c, `${chargeSelect("AND c.lease_id = $2 AND c.period = $3")}`, [
        o,
        d.lease_id,
        d.period,
      ]);
      return c.json({ charge: normalizeRow(existing as Record<string, unknown>) });
    }
    const row = await get(c, `${chargeSelect("AND c.id = $2")}`, [o, inserted.id]);
    return c.json({ charge: normalizeRow(row as Record<string, unknown>) }, 201);
  });

  app.post("/api/rent-charges/generate", async (c) => {
    const parsed = await parseJson(c, z.object({ period: periodSchema }));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const period = parsed.data.period;
    const o = orgId(c);
    const [year, month] = period.split("-").map(Number);
    const periodEnd = `${period}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
    const leases = await query<{
      id: string;
      monthly_rent: string;
      rent_due_day: number;
      start_date: string;
      end_date: string;
    }>(
      c,
      "SELECT id, monthly_rent, rent_due_day, start_date::text, end_date::text FROM leases WHERE organization_id = $1 AND status = 'active'",
      [o],
    );
    let created = 0;
    for (const l of leases) {
      const periodStart = `${period}-01`;
      if (l.end_date < periodStart || l.start_date > periodEnd) continue;
      const day = String(Math.min(28, Math.max(1, l.rent_due_day))).padStart(2, "0");
      const dueDate = `${period}-${day}`;
      const r = await run(
        c,
        `INSERT INTO rent_charges (organization_id, lease_id, period, due_date, amount)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (lease_id, period) DO NOTHING`,
        [o, l.id, period, dueDate, l.monthly_rent],
      );
      if (r.changes) created++;
    }
    await run(c, MARK_OVERDUE_FOR_ORG_SQL, [o]);
    return c.json({ created, period });
  });

  app.put("/api/rent-charges/:id", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const Patch = z.object({
      amount: z.number().min(0).optional(),
      due_date: z.string().optional(),
      status: z.enum(["open", "partial", "paid", "overdue", "waived"]).optional(),
      notes: z.string().optional().nullable(),
    });
    const parsed = await parseJson(c, Patch);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const data = { ...parsed.data };
    if (data.amount !== undefined) data.amount = String(data.amount) as unknown as number;
    const { sets, params, next } = buildUpdate(data as Record<string, unknown>);
    if (!sets.length) return c.json({ error: "No fields" }, 400);
    const o = orgId(c);
    params.push(id, o);
    const r = await run(
      c,
      `UPDATE rent_charges SET ${sets.join(", ")} WHERE id = $${next} AND organization_id = $${next + 1}`,
      params,
    );
    if (!r.changes) return c.json({ error: "Not found" }, 404);
    const row = await get(c, `${chargeSelect("AND c.id = $2")}`, [o, id]);
    return c.json({ charge: normalizeRow(row as Record<string, unknown>) });
  });

  app.delete("/api/rent-charges/:id", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const o = orgId(c);
    const r = await run(c, "DELETE FROM rent_charges WHERE id = $1 AND organization_id = $2", [
      id,
      o,
    ]);
    if (!r.changes) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  });

  const PaymentInput = z.object({
    charge_id: z.string().uuid(),
    paid_at: z.string().optional(),
    amount: z
      .number()
      .positive()
      .refine(hasAtMostTwoDecimals, "El importe debe tener como máximo 2 decimales."),
    method: z.enum(["cash", "check", "ach", "credit", "other"]).optional(),
    reference: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  });

  const VoidInput = z.object({
    reason: z.string().trim().min(1).max(200),
  });

  app.get("/api/rent-charges/:id/payments", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const o = orgId(c);
    const rows = await query(
      c,
      "SELECT * FROM payments WHERE charge_id = $1 AND organization_id = $2 ORDER BY paid_at DESC",
      [id, o],
    );
    return c.json({ payments: normalizeRows(rows) });
  });

  app.post("/api/payments", async (c) => {
    const parsed = await parseJson(c, PaymentInput);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const d = parsed.data;
    const o = orgId(c);
    const outcome = await c.get("sql").begin((tx) =>
      recordPayment(tx as unknown as Parameters<typeof recordPayment>[0], {
        organizationId: o,
        chargeId: d.charge_id,
        amountCents: toCents(d.amount),
        paidAt: d.paid_at ?? null,
        method: d.method ?? "cash",
        reference: d.reference ?? null,
        notes: d.notes ?? null,
        source: "staff",
      }),
    );
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);
    const updated = await get(c, `${chargeSelect("AND c.id = $2")}`, [o, d.charge_id]);
    return c.json({ charge: normalizeRow(updated as Record<string, unknown>) }, 201);
  });

  app.post("/api/payments/:id/void", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const parsed = await parseJson(c, VoidInput);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const o = orgId(c);
    const outcome = await c.get("sql").begin(async (tx) => {
      const rows = await tx.unsafe<{ charge_id: string; voided_at: string | null }[]>(
        "SELECT charge_id, voided_at FROM payments WHERE id = $1 AND organization_id = $2 FOR UPDATE",
        [id, o],
      );
      const payment = rows[0];
      if (!payment) return { error: "Pago no encontrado", status: 404 as const };
      if (payment.voided_at) return { error: "Este pago ya está anulado.", status: 409 as const };
      await tx.unsafe(
        `UPDATE payments
         SET voided_at = now(), void_reason = $3, voided_by = $4
         WHERE id = $1 AND organization_id = $2 AND voided_at IS NULL`,
        [id, o, parsed.data.reason, c.get("userId")],
      );
      const sums = await tx.unsafe<{ total: string }[]>(ACTIVE_PAYMENT_SUM_SQL, [
        payment.charge_id,
        o,
      ]);
      await tx.unsafe(APPLY_CHARGE_BALANCE_SQL, [
        centsToAmount(toCents(sums[0]?.total ?? "0")),
        payment.charge_id,
        o,
      ]);
      return { ok: true as const, chargeId: payment.charge_id };
    });
    if ("error" in outcome) return c.json({ error: outcome.error }, outcome.status);
    const updated = await get(c, `${chargeSelect("AND c.id = $2")}`, [o, outcome.chargeId]);
    const payments = await query(
      c,
      "SELECT * FROM payments WHERE charge_id = $1 AND organization_id = $2 ORDER BY paid_at DESC",
      [outcome.chargeId, o],
    );
    return c.json({
      charge: normalizeRow(updated as Record<string, unknown>),
      payments: normalizeRows(payments),
    });
  });
}
