import { z } from "zod";
import type { Context, Hono } from "hono";
import { messageSendRateLimit } from "../auth/rate-limit";
import {
  buildObjectKey,
  contentDisposition,
  orgQuotaAllows,
  validateUpload,
} from "../documents/policy";
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_LOCATIONS,
  maintenanceTitle,
  problemsFor,
} from "../../shared/maintenance-request";
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
const PORTAL_SETTING_KEYS = [
  "currency",
  "timezone",
  "language",
  "date_format",
  "area_unit",
  "bank_holder",
  "bank_name",
  "bank_account",
  "bank_clabe",
];

function plainText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/<[a-z!/?]/i.test(value), "Plain text only");
}

const ReplyBody = z.object({ body: plainText(10_000) });

const CONTACT_REASONS = ["Mantenimiento", "Pagos", "Contrato", "Acceso", "Otro"] as const;
const RESPONSE_PREFERENCES = ["Correo del portal", "Teléfono", "Correo electrónico"] as const;

const ComposeBody = z.object({
  lease_id: z.string().uuid(),
  reason: z.enum(CONTACT_REASONS),
  subject: z.string().trim().min(1).max(200),
  body: plainText(1000),
  response_preference: z.enum(RESPONSE_PREFERENCES),
});

const MessageStateBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
  action: z.enum(["read", "unread", "hide"]),
});

const WorkOrderBody = z
  .object({
    lease_id: z.string().uuid(),
    location: z.enum(MAINTENANCE_LOCATIONS),
    category: z.enum(MAINTENANCE_CATEGORIES),
    problem: z.string().trim().min(1).max(80),
    description: plainText(4000),
    has_pet: z.boolean(),
    entry_allowed: z.literal(true),
    entry_comment: z.string().trim().max(200).optional().default(""),
  })
  .superRefine((value, ctx) => {
    if (!problemsFor(value.category).includes(value.problem)) {
      ctx.addIssue({
        code: "custom",
        path: ["problem"],
        message: "Elige un problema de la categoría",
      });
    }
    if (value.entry_comment && /<[a-z!/?]/i.test(value.entry_comment)) {
      ctx.addIssue({ code: "custom", path: ["entry_comment"], message: "Plain text only" });
    }
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
      `SELECT c.id, c.period, c.due_date, c.amount, c.amount_paid, c.status, c.kind,
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

  app.get("/api/portal/alerts", async (c) => {
    const tenantId = portalTenant(c);
    if (!tenantId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const rows = await query(
      c,
      `/* portal_late_notices */
       SELECT id, title, body, read_at, created_at
       FROM notifications
       WHERE organization_id = $1
         AND kind = 'rent_late_notice'
         AND entity_type = 'tenant'
         AND entity_id = $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [orgId(c), tenantId],
    );
    return c.json({ alerts: normalizeRows(rows) });
  });

  app.post("/api/portal/alerts/:id/read", async (c) => {
    const tenantId = portalTenant(c);
    const id = uuidParam(c.req.param("id"));
    if (!tenantId || !id) return c.json({ error: "Not found" }, 404);
    const row = await get(
      c,
      `UPDATE notifications
       SET read_at = COALESCE(read_at, now())
       WHERE id = $1
         AND organization_id = $2
         AND kind = 'rent_late_notice'
         AND entity_type = 'tenant'
         AND entity_id = $3
       RETURNING id, read_at`,
      [id, orgId(c), tenantId],
    );
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({ alert: normalizeRow(row as Record<string, unknown>) });
  });

  app.get("/api/portal/messages", async (c) => {
    const tenantId = portalTenant(c);
    const userId = c.get("userId");
    if (!tenantId || !userId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const o = orgId(c);
    const rows = await query(
      c,
      `/* portal_inbox */
       SELECT m.id, m.body, m.created_at, t.subject,
              CASE WHEN m.sender_user_id = $3::uuid THEN 'Tú' ELSE org.name END AS sender_name,
              (m.sender_user_id = $3::uuid) AS mine,
              (m.sender_user_id = $3::uuid OR r.message_id IS NOT NULL) AS read
       FROM messages m
       JOIN message_threads t ON t.id = m.thread_id AND t.organization_id = m.organization_id
       JOIN organizations org ON org.id = m.organization_id
       LEFT JOIN message_reads r ON r.message_id = m.id AND r.user_id = $3::uuid
       WHERE m.organization_id = $1 AND ${THREAD_VISIBLE}
         AND m.sender_user_id IS DISTINCT FROM $3::uuid
         AND NOT EXISTS (
           SELECT 1 FROM portal_message_hides h
           WHERE h.message_id = m.id AND h.user_id = $3::uuid
         )
       ORDER BY m.created_at DESC
       LIMIT 100`,
      [o, tenantId, userId],
    );
    const messages = normalizeRows(rows);
    const unread = messages.filter((row) => row.read !== true).length;
    return c.json({ messages, unread_count: unread });
  });

  app.post("/api/portal/messages", messageSendRateLimit, async (c) => {
    const tenantId = portalTenant(c);
    const userId = c.get("userId");
    if (!tenantId || !userId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const parsed = await parseJson(c, ComposeBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const o = orgId(c);
    const tenant = await get<{ email: string | null; organization_name: string }>(
      c,
      `SELECT t.email, org.name AS organization_name
       FROM tenants t
       JOIN organizations org ON org.id = t.organization_id
       WHERE t.id = $1 AND t.organization_id = $2`,
      [tenantId, o],
    );
    if (!tenant) return c.json({ error: "No tienes acceso al portal" }, 403);
    const owner = await get<{ user_id: string; email: string }>(
      c,
      `SELECT m.user_id, lower(u.email) AS email
       FROM memberships m
       JOIN auth.users u ON u.id = m.user_id
       WHERE m.organization_id = $1 AND m.role = 'owner' AND u.email IS NOT NULL
       ORDER BY m.created_at
       LIMIT 1`,
      [o],
    );
    if (!owner) return c.json({ error: "La propiedad no tiene un contacto" }, 400);
    const fromEmail = (c.get("userEmail") ?? tenant.email ?? "").trim().toLowerCase();
    if (!fromEmail) return c.json({ error: "Tu ficha no tiene correo" }, 400);
    const d = parsed.data;
    const lease = await get<{ id: string; unit_name: string | null }>(
      c,
      `SELECT l.id, u.name AS unit_name
       FROM leases l
       JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
       WHERE l.id = $1 AND l.organization_id = $2
         AND l.primary_tenant_id = $3 AND l.status = 'active'`,
      [d.lease_id, o, tenantId],
    );
    if (!lease) return c.json({ error: "Elige uno de tus contratos vigentes" }, 400);
    const unitLabel = lease.unit_name ?? "Unidad";
    const body = `Unidad: ${unitLabel}\nRazón de contacto: ${d.reason}\nPreferencia de respuesta: ${d.response_preference}\n\n${d.body}`;
    const threadId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    await c.get("sql").begin(async (raw) => {
      const tx = raw as unknown as Tx;
      await tx.unsafe(
        `INSERT INTO message_threads (
           id, organization_id, subject, entity_type, entity_id, lease_id, created_by
         ) VALUES ($1, $2, $3, 'lease', $4, $4, $5)`,
        [threadId, o, d.subject, lease.id, userId],
      );
      await tx.unsafe(
        `INSERT INTO message_thread_participants (
           organization_id, thread_id, participant_kind, user_id, tenant_id, email, role
         ) VALUES
           ($1, $2, 'tenant', $3, $4, $5, 'from'),
           ($1, $2, 'membership', $6, NULL, $7, 'to')`,
        [o, threadId, userId, tenantId, fromEmail, owner.user_id, owner.email],
      );
      await tx.unsafe(
        `INSERT INTO messages (id, thread_id, organization_id, sender_user_id, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [messageId, threadId, o, userId, body],
      );
    });
    return c.json({ message: { id: messageId } }, 201);
  });

  app.post("/api/portal/messages/state", async (c) => {
    const tenantId = portalTenant(c);
    const userId = c.get("userId");
    if (!tenantId || !userId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const parsed = await parseJson(c, MessageStateBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const o = orgId(c);
    const ids = parsed.data.ids;
    const visible = `m.organization_id = $1 AND m.id = ANY($4::uuid[]) AND ${THREAD_VISIBLE}`;
    if (parsed.data.action === "read") {
      await run(
        c,
        `INSERT INTO message_reads (message_id, user_id, organization_id, read_at)
         SELECT m.id, $3::uuid, m.organization_id, now()
         FROM messages m
         JOIN message_threads t ON t.id = m.thread_id AND t.organization_id = m.organization_id
         WHERE ${visible}
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [o, tenantId, userId, ids],
      );
    } else if (parsed.data.action === "unread") {
      await run(
        c,
        `DELETE FROM message_reads r
         USING messages m
         JOIN message_threads t ON t.id = m.thread_id AND t.organization_id = m.organization_id
         WHERE r.message_id = m.id AND r.user_id = $3::uuid AND ${visible}`,
        [o, tenantId, userId, ids],
      );
    } else {
      await run(
        c,
        `INSERT INTO portal_message_hides (message_id, user_id, organization_id)
         SELECT m.id, $3::uuid, m.organization_id
         FROM messages m
         JOIN message_threads t ON t.id = m.thread_id AND t.organization_id = m.organization_id
         WHERE ${visible}
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [o, tenantId, userId, ids],
      );
    }
    return c.json({ ok: true });
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
    const notes = [
      `Dónde: ${d.location}`,
      `Categoría: ${d.category}`,
      `Mascota: ${d.has_pet ? "Sí" : "No"}`,
      "Permiso de ingreso: Sí",
      d.entry_comment ? `Comentario de entrada: ${d.entry_comment}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const metadata = JSON.stringify({
      source: "portal",
      location: d.location,
      category: d.category,
      problem: d.problem,
      has_pet: d.has_pet,
      entry_allowed: true,
      entry_comment: d.entry_comment || null,
    });
    const inserted = await get<{ id: string }>(
      c,
      `INSERT INTO work_orders (
         organization_id, property_id, unit_id, tenant_id,
         title, description, priority, status, notes, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, 'normal', 'open', $7, $8::jsonb)
       RETURNING id`,
      [
        o,
        lease.property_id,
        lease.unit_id,
        tenantId,
        maintenanceTitle(d.category, d.problem),
        d.description,
        notes,
        metadata,
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

  app.post("/api/portal/work-orders/:id/photo", messageSendRateLimit, async (c) => {
    const tenantId = portalTenant(c);
    const id = uuidParam(c.req.param("id"));
    if (!tenantId || !id) return c.json({ error: "Not found" }, 404);
    const bucket = c.env.FILES;
    if (!bucket) return c.json({ error: "File storage is not configured" }, 503);

    const owned = await get<{ id: string }>(
      c,
      `SELECT id FROM work_orders WHERE id = $1 AND organization_id = $2 AND tenant_id = $3`,
      [id, orgId(c), tenantId],
    );
    if (!owned) return c.json({ error: "Not found" }, 404);

    const existing = await get<{ n: number }>(
      c,
      `SELECT COUNT(*)::int AS n FROM documents
       WHERE organization_id = $1 AND work_order_id = $2 AND deleted_at IS NULL`,
      [orgId(c), id],
    );
    if (Number(existing?.n ?? 0) >= 3) {
      return c.json({ error: "Esta solicitud admite como máximo 3 fotografías" }, 409);
    }

    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "Elige una fotografía" }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = validateUpload({
      filename: file.name,
      declaredType: file.type,
      bytes,
      size: file.size,
      kind: "image",
      isCover: false,
      maxBytes: 8 * 1024 * 1024,
      oversizeError: "La fotografía puede pesar como máximo 8 MB",
      imagesOnly: true,
      imagesOnlyError: "Solo se admiten fotografías JPG o PNG",
    });
    if (!checked.ok) return c.json({ error: checked.error }, 400);
    if (checked.mime !== "image/jpeg" && checked.mime !== "image/png") {
      return c.json({ error: "Solo se admiten fotografías JPG o PNG" }, 400);
    }

    const quota = await get<{ file_count: number; total_bytes: number }>(
      c,
      `SELECT COUNT(*)::int AS file_count, COALESCE(SUM(size_bytes), 0)::bigint AS total_bytes
       FROM documents WHERE organization_id = $1 AND deleted_at IS NULL`,
      [orgId(c)],
    );
    const allowed = orgQuotaAllows({
      fileCount: Number(quota?.file_count ?? 0),
      totalBytes: Number(quota?.total_bytes ?? 0),
      nextSize: file.size,
    });
    if (!allowed.ok) return c.json({ error: allowed.error }, 409);

    const documentId = crypto.randomUUID();
    const r2Key = buildObjectKey({
      organizationId: orgId(c),
      entityType: "work_order",
      entityId: id,
      filename: checked.filename,
    });
    await bucket.put(r2Key, bytes, { httpMetadata: { contentType: checked.mime } });
    const row = await get(
      c,
      `INSERT INTO documents (
         id, organization_id, entity_type, entity_id, work_order_id,
         kind, r2_key, filename, mime, size_bytes, uploaded_by, is_cover
       ) VALUES ($1, $2, 'work_order', $3, $3, 'image', $4, $5, $6, $7, $8, false)
       RETURNING id`,
      [documentId, orgId(c), id, r2Key, checked.filename, checked.mime, file.size, c.get("userId")],
    );
    if (!row) {
      await bucket.delete(r2Key);
      return c.json({ error: "No se pudo guardar la fotografía" }, 500);
    }
    return c.json({ document: normalizeRow(row as Record<string, unknown>) }, 201);
  });
}
