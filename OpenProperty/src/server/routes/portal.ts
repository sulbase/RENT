import { z } from "zod";
import type { Context, Hono } from "hono";
import { messageSendRateLimit } from "../auth/rate-limit";
import { contentDisposition } from "../documents/policy";
import type { AppEnv } from "../env";
import {
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

/** Organization preferences the portal needs to format money and dates. */
const PORTAL_SETTING_KEYS = ["currency", "timezone", "language", "date_format", "area_unit"];

const plainText = z
  .string()
  .trim()
  .min(1)
  .max(10_000)
  .refine((value) => !/<[a-z!/?]/i.test(value), "Plain text only");

const ReplyBody = z.object({ body: plainText });

const WorkOrderBody = z.object({
  lease_id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

const WORK_ORDER_COLUMNS = `w.id, w.title, w.description, w.priority, w.status,
       w.created_at, w.scheduled_at, w.completed_at,
       p.name AS property_name, u.name AS unit_name`;

type Tx = {
  unsafe: (text: string, params?: SqlParam[]) => Promise<unknown>;
};

/** The middleware sets this from `tenants.user_id`; never read it from the request. */
function portalTenant(c: Context<AppEnv>): string | null {
  return c.get("portalTenantId") ?? null;
}

const THREAD_VISIBLE = `EXISTS (
  SELECT 1 FROM message_thread_participants p
  WHERE p.thread_id = t.id AND p.organization_id = t.organization_id
    AND p.participant_kind = 'tenant' AND p.tenant_id = $2
)`;

export function mountPortalRoutes(app: Hono<AppEnv>) {
  app.get("/api/portal/home", async (c) => {
    const tenantId = portalTenant(c);
    if (!tenantId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const o = orgId(c);
    const tenant = await get(
      c,
      `SELECT t.first_name, t.last_name, t.email, t.phone, o.name AS organization_name
       FROM tenants t
       JOIN organizations o ON o.id = t.organization_id
       WHERE t.id = $1 AND t.organization_id = $2`,
      [tenantId, o],
    );
    if (!tenant) return c.json({ error: "No tienes acceso al portal" }, 403);
    const settings = await query<{ key: string; value: string }>(
      c,
      `SELECT key, value FROM settings WHERE organization_id = $1 AND key = ANY($2::text[])`,
      [o, PORTAL_SETTING_KEYS],
    );
    const leases = await query(
      c,
      `SELECT l.id, l.start_date, l.end_date, l.monthly_rent, l.deposit, l.rent_due_day, l.status,
              u.name AS unit_name, pr.name AS property_name, pr.address, pr.city
       FROM leases l
       JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
       JOIN properties pr ON pr.id = u.property_id AND pr.organization_id = u.organization_id
       WHERE l.organization_id = $1 AND l.primary_tenant_id = $2 AND l.status = 'active'
       ORDER BY l.start_date DESC`,
      [o, tenantId],
    );
    const charges = await query(
      c,
      `SELECT c.id, c.period, c.due_date, c.amount, c.status,
              l.id AS lease_id, u.name AS unit_name, pr.name AS property_name
       FROM rent_charges c
       JOIN leases l ON l.id = c.lease_id AND l.organization_id = c.organization_id
       JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
       JOIN properties pr ON pr.id = u.property_id AND pr.organization_id = u.organization_id
       WHERE c.organization_id = $1 AND l.primary_tenant_id = $2
       ORDER BY c.due_date`,
      [o, tenantId],
    );
    const payments = await query(
      c,
      `SELECT p.id, p.paid_at, p.amount, p.method, p.voided_at, p.void_reason,
              l.id AS lease_id, u.name AS unit_name, pr.name AS property_name
       FROM payments p
       JOIN rent_charges c ON c.id = p.charge_id AND c.organization_id = p.organization_id
       JOIN leases l ON l.id = c.lease_id AND l.organization_id = c.organization_id
       JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
       JOIN properties pr ON pr.id = u.property_id AND pr.organization_id = u.organization_id
       WHERE p.organization_id = $1 AND l.primary_tenant_id = $2
       ORDER BY p.paid_at DESC`,
      [o, tenantId],
    );
    const documents = await query(
      c,
      `SELECT d.id, d.lease_id, d.filename, d.size_bytes, d.created_at,
              u.name AS unit_name, pr.name AS property_name
       FROM documents d
       JOIN leases l ON l.id = d.lease_id AND l.organization_id = d.organization_id
       JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
       JOIN properties pr ON pr.id = u.property_id AND pr.organization_id = u.organization_id
       WHERE d.organization_id = $1 AND l.primary_tenant_id = $2
         AND d.entity_type = 'lease' AND d.kind = 'signed_lease' AND d.deleted_at IS NULL
       ORDER BY d.created_at DESC`,
      [o, tenantId],
    );
    return c.json({
      tenant: normalizeRow(tenant as Record<string, unknown>),
      settings: Object.fromEntries(settings.map((row) => [row.key, row.value])),
      leases: normalizeRows(leases),
      charges: normalizeRows(charges),
      payments: normalizeRows(payments),
      documents: normalizeRows(documents),
    });
  });

  app.get("/api/portal/documents/:id", async (c) => {
    const tenantId = portalTenant(c);
    const id = uuidParam(c.req.param("id"));
    if (!tenantId || !id) return c.json({ error: "Not found" }, 404);
    const row = await get<{ r2_key: string; filename: string; mime: string; size_bytes: number }>(
      c,
      `SELECT d.r2_key, d.filename, d.mime, d.size_bytes
       FROM documents d
       JOIN leases l ON l.id = d.lease_id AND l.organization_id = d.organization_id
       WHERE d.id = $1 AND d.organization_id = $2 AND l.primary_tenant_id = $3
         AND d.entity_type = 'lease' AND d.kind = 'signed_lease' AND d.deleted_at IS NULL`,
      [id, orgId(c), tenantId],
    );
    if (!row) return c.json({ error: "Not found" }, 404);
    const bucket = c.env.FILES;
    if (!bucket) return c.json({ error: "File storage is not configured" }, 503);
    const object = await bucket.get(row.r2_key);
    if (!object) return c.json({ error: "Not found" }, 404);
    const download = c.req.query("download") === "1";
    return new Response(object.body as unknown as BodyInit, {
      headers: {
        "Content-Type": row.mime,
        "Content-Length": String(row.size_bytes),
        "Content-Disposition": contentDisposition(row.filename, !download),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  app.get("/api/portal/messages", async (c) => {
    const tenantId = portalTenant(c);
    const userId = c.get("userId");
    if (!tenantId || !userId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const o = orgId(c);
    const threads = await query(
      c,
      `SELECT t.id, t.subject, t.last_message_at,
              (
                SELECT COUNT(*)::int FROM messages m
                WHERE m.thread_id = t.id AND m.organization_id = t.organization_id
                  AND m.sender_user_id IS DISTINCT FROM $3::uuid
                  AND NOT EXISTS (
                    SELECT 1 FROM message_reads r
                    WHERE r.message_id = m.id AND r.user_id = $3::uuid
                  )
              ) AS unread_count
       FROM message_threads t
       WHERE t.organization_id = $1 AND ${THREAD_VISIBLE}
       ORDER BY t.last_message_at DESC
       LIMIT 50`,
      [o, tenantId, userId],
    );
    const ids = threads.map((row) => String((row as { id: string }).id));
    const participants = ids.length
      ? await query(
          c,
          `SELECT thread_id, participant_kind, email, role
           FROM message_thread_participants
           WHERE organization_id = $1 AND thread_id = ANY($2::uuid[])
           ORDER BY role, email`,
          [o, ids],
        )
      : [];
    const rows = normalizeRows(threads).map((thread) => ({
      ...thread,
      participants: normalizeRows(
        participants.filter((row) => (row as { thread_id: string }).thread_id === thread.id),
      ).map(({ thread_id: _thread, ...rest }) => rest),
    }));
    const unread = threads.reduce<number>(
      (sum, row) => sum + Number((row as { unread_count?: number }).unread_count ?? 0),
      0,
    );
    return c.json({ threads: rows, unread_count: unread });
  });

  app.get("/api/portal/messages/:id", async (c) => {
    const tenantId = portalTenant(c);
    const userId = c.get("userId");
    const id = uuidParam(c.req.param("id"));
    if (!tenantId || !userId || !id) return c.json({ error: "Not found" }, 404);
    const o = orgId(c);
    const thread = await get(
      c,
      `SELECT t.id, t.subject, t.created_at, t.last_message_at
       FROM message_threads t
       WHERE t.id = $3 AND t.organization_id = $1 AND ${THREAD_VISIBLE}`,
      [o, tenantId, id],
    );
    if (!thread) return c.json({ error: "Not found" }, 404);
    const participants = await query(
      c,
      `SELECT participant_kind, email, role
       FROM message_thread_participants
       WHERE thread_id = $1 AND organization_id = $2
       ORDER BY role, email`,
      [id, o],
    );
    const messages = await query(
      c,
      `SELECT m.id, m.body, m.created_at,
              (m.sender_user_id = $3::uuid) AS mine,
              (
                SELECT sp.email FROM message_thread_participants sp
                WHERE sp.thread_id = m.thread_id AND sp.organization_id = m.organization_id
                  AND sp.user_id = m.sender_user_id
                LIMIT 1
              ) AS sender_email,
              r.read_at
       FROM messages m
       LEFT JOIN message_reads r ON r.message_id = m.id AND r.user_id = $3::uuid
       WHERE m.thread_id = $1 AND m.organization_id = $2
       ORDER BY m.created_at ASC`,
      [id, o, userId],
    );
    return c.json({
      thread: normalizeRow(thread as Record<string, unknown>),
      participants: normalizeRows(participants),
      messages: normalizeRows(messages),
    });
  });

  app.post("/api/portal/messages/:id/replies", messageSendRateLimit, async (c) => {
    const tenantId = portalTenant(c);
    const userId = c.get("userId");
    const id = uuidParam(c.req.param("id"));
    if (!tenantId || !userId || !id) return c.json({ error: "Not found" }, 404);
    const parsed = await parseJson(c, ReplyBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const o = orgId(c);
    const messageId = crypto.randomUUID();
    const inserted = await c.get("sql").begin(async (raw) => {
      const tx = raw as unknown as Tx;
      const visible = (await tx.unsafe(
        `SELECT 1 AS ok FROM message_threads t
         WHERE t.id = $3 AND t.organization_id = $1 AND ${THREAD_VISIBLE}`,
        [o, tenantId, id],
      )) as unknown[];
      if (!visible[0]) return false;
      await tx.unsafe(
        `INSERT INTO messages (id, thread_id, organization_id, sender_user_id, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [messageId, id, o, userId, parsed.data.body],
      );
      await tx.unsafe(
        `UPDATE message_threads SET last_message_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [id, o],
      );
      return true;
    });
    if (!inserted) return c.json({ error: "Not found" }, 404);
    return c.json({ message: { id: messageId } }, 201);
  });

  app.post("/api/portal/messages/:id/read", async (c) => {
    const tenantId = portalTenant(c);
    const userId = c.get("userId");
    const id = uuidParam(c.req.param("id"));
    if (!tenantId || !userId || !id) return c.json({ error: "Not found" }, 404);
    const o = orgId(c);
    const visible = await get(
      c,
      `SELECT 1 AS ok FROM message_threads t
       WHERE t.id = $3 AND t.organization_id = $1 AND ${THREAD_VISIBLE}`,
      [o, tenantId, id],
    );
    if (!visible) return c.json({ error: "Not found" }, 404);
    const result = await run(
      c,
      `INSERT INTO message_reads (message_id, user_id, organization_id, read_at)
       SELECT m.id, $3::uuid, m.organization_id, now()
       FROM messages m
       WHERE m.thread_id = $1 AND m.organization_id = $2
         AND m.sender_user_id IS DISTINCT FROM $3::uuid
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      [id, o, userId],
    );
    return c.json({ updated: result.changes });
  });

  app.get("/api/portal/work-orders", async (c) => {
    const tenantId = portalTenant(c);
    if (!tenantId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const rows = await query(
      c,
      `SELECT ${WORK_ORDER_COLUMNS}
       FROM work_orders w
       LEFT JOIN properties p ON p.id = w.property_id AND p.organization_id = w.organization_id
       LEFT JOIN units u ON u.id = w.unit_id AND u.organization_id = w.organization_id
       WHERE w.organization_id = $1 AND w.tenant_id = $2
       ORDER BY w.created_at DESC
       LIMIT 100`,
      [orgId(c), tenantId],
    );
    return c.json({ work_orders: normalizeRows(rows) });
  });

  app.post("/api/portal/work-orders", messageSendRateLimit, async (c) => {
    const tenantId = portalTenant(c);
    if (!tenantId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const parsed = await parseJson(c, WorkOrderBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const d = parsed.data;
    const o = orgId(c);
    const lease = await get<{ unit_id: string; property_id: string }>(
      c,
      `SELECT l.unit_id, u.property_id
       FROM leases l
       JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
       WHERE l.id = $1 AND l.organization_id = $2
         AND l.primary_tenant_id = $3 AND l.status = 'active'`,
      [d.lease_id, o, tenantId],
    );
    if (!lease) return c.json({ error: "Elige uno de tus contratos vigentes" }, 400);
    const inserted = await get<{ id: string }>(
      c,
      `INSERT INTO work_orders (
         organization_id, property_id, unit_id, tenant_id,
         title, description, priority, status, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', '{"source":"portal"}'::jsonb)
       RETURNING id`,
      [
        o,
        lease.property_id,
        lease.unit_id,
        tenantId,
        d.title,
        d.description?.trim() || null,
        d.priority ?? "normal",
      ],
    );
    if (!inserted) return c.json({ error: "Insert failed" }, 500);
    const row = await get(
      c,
      `SELECT ${WORK_ORDER_COLUMNS}
       FROM work_orders w
       LEFT JOIN properties p ON p.id = w.property_id AND p.organization_id = w.organization_id
       LEFT JOIN units u ON u.id = w.unit_id AND u.organization_id = w.organization_id
       WHERE w.id = $1 AND w.organization_id = $2`,
      [inserted.id, o],
    );
    return c.json({ work_order: normalizeRow(row as Record<string, unknown>) }, 201);
  });
}
