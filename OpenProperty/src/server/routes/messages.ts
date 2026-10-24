import { z } from "zod";
import type { Context, Hono } from "hono";
import { messageSendRateLimit } from "../auth/rate-limit";
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
import { parseJson, parseQuery } from "../validation";

const MAX_BODY = 10_000;
const ENTITY_TABLE = {
  property: "properties",
  lease: "leases",
  tenant: "tenants",
  work_order: "work_orders",
} as const;

const plainText = z
  .string()
  .trim()
  .min(1)
  .max(MAX_BODY)
  .refine((value) => !/<[a-z!/?]/i.test(value), "Plain text only");

const Recipient = z.object({
  kind: z.enum(["membership", "tenant"]),
  id: z.string().uuid(),
  role: z.enum(["to", "cc"]),
});

const CreateBody = z
  .object({
    subject: z.string().trim().min(1).max(200),
    body: plainText,
    recipients: z.array(Recipient).min(1).max(20),
    entity_type: z.enum(["property", "lease", "tenant", "work_order"]).optional(),
    entity_id: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.entity_type == null) !== (value.entity_id == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "entity_type and entity_id are both required",
        path: ["entity_type"],
      });
    }
    if (!value.recipients.some((recipient) => recipient.role === "to")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one To recipient is required",
        path: ["recipients"],
      });
    }
  });

const ReplyBody = z.object({ body: plainText });

const ListQuery = z.object({
  box: z.enum(["inbox", "sent"]).default("inbox"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

type Tx = {
  unsafe: (text: string, params?: SqlParam[]) => Promise<unknown>;
};

type ResolvedRecipient = {
  kind: "membership" | "tenant";
  id: string;
  email: string;
  role: "to" | "cc";
  /** Portal account of a tenant recipient, when linked. */
  portalUserId?: string | null;
};

function senderId(c: Context<AppEnv>): string | null {
  return c.get("userId");
}

async function txQuery<T>(tx: Tx, text: string, params: SqlParam[] = []): Promise<T[]> {
  const rows = await tx.unsafe(text, params);
  return rows as T[];
}

export function mountMessageRoutes(app: Hono<AppEnv>) {
  app.get("/api/messages/recipients", async (c) => {
    const org = orgId(c);
    const members = await query(
      c,
      `SELECT m.user_id, u.email, m.role
       FROM memberships m
       JOIN auth.users u ON u.id = m.user_id
       WHERE m.organization_id = $1 AND u.email IS NOT NULL
       ORDER BY u.email ASC`,
      [org],
    );
    const tenants = await query(
      c,
      `SELECT id, first_name, last_name, email
       FROM tenants
       WHERE organization_id = $1 AND email IS NOT NULL AND btrim(email) <> ''
       ORDER BY last_name ASC, first_name ASC`,
      [org],
    );
    return c.json({
      members: normalizeRows(members),
      tenants: normalizeRows(tenants),
    });
  });

  app.get("/api/messages", async (c) => {
    const parsed = parseQuery(c, ListQuery);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const userId = senderId(c);
    if (!userId) return c.json({ threads: [], unread_count: 0 });
    const org = orgId(c);
    const box = parsed.data.box ?? "inbox";
    const limit = parsed.data.limit ?? 50;
    const threads = await query(
      c,
      `SELECT t.id, t.subject, t.entity_type::text AS entity_type, t.entity_id,
              t.created_at, t.last_message_at,
              (
                SELECT COUNT(*)::int FROM messages m
                WHERE m.thread_id = t.id AND m.organization_id = t.organization_id
                  AND m.sender_user_id IS DISTINCT FROM $2::uuid
                  AND NOT EXISTS (
                    SELECT 1 FROM message_reads r
                    WHERE r.message_id = m.id AND r.user_id = $2::uuid
                  )
              ) AS unread_count
       FROM message_threads t
       WHERE t.organization_id = $1
         AND (
           ($3 = 'inbox' AND EXISTS (
             SELECT 1 FROM message_thread_participants p
             WHERE p.thread_id = t.id AND p.organization_id = t.organization_id
               AND p.user_id = $2::uuid AND p.role IN ('to', 'cc')
           ))
           OR ($3 = 'sent' AND EXISTS (
             SELECT 1 FROM messages m
             WHERE m.thread_id = t.id AND m.organization_id = t.organization_id
               AND m.sender_user_id = $2::uuid
           ))
         )
       ORDER BY t.last_message_at DESC
       LIMIT $4`,
      [org, userId, box, limit],
    );
    const ids = threads.map((row) => String((row as { id: string }).id));
    const participants = ids.length
      ? await query(
          c,
          `SELECT thread_id, participant_kind, user_id, tenant_id, email, role
           FROM message_thread_participants
           WHERE organization_id = $1 AND thread_id = ANY($2::uuid[])
           ORDER BY role, email`,
          [org, ids],
        )
      : [];
    const unread = await get<{ n: number }>(
      c,
      `SELECT COUNT(*)::int AS n
       FROM messages m
       JOIN message_thread_participants p
         ON p.thread_id = m.thread_id AND p.organization_id = m.organization_id
        AND p.user_id = $2::uuid AND p.role IN ('to', 'cc')
       WHERE m.organization_id = $1
         AND m.sender_user_id IS DISTINCT FROM $2::uuid
         AND NOT EXISTS (
           SELECT 1 FROM message_reads r
           WHERE r.message_id = m.id AND r.user_id = $2::uuid
         )`,
      [org, userId],
    );
    return c.json({
      threads: normalizeRows(threads).map((thread) => ({
        ...thread,
        participants: normalizeRows(
          participants.filter((row) => (row as { thread_id: string }).thread_id === thread.id),
        ),
      })),
      unread_count: Number(unread?.n ?? 0),
    });
  });

  app.get("/api/messages/:id", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const userId = senderId(c);
    if (!userId) return c.json({ error: "Not found" }, 404);
    const org = orgId(c);
    const thread = await get(
      c,
      `SELECT t.id, t.subject, t.entity_type::text AS entity_type, t.entity_id,
              t.created_by, t.created_at, t.last_message_at
       FROM message_threads t
       WHERE t.id = $1 AND t.organization_id = $2
         AND EXISTS (
           SELECT 1 FROM message_thread_participants p
           WHERE p.thread_id = t.id AND p.organization_id = t.organization_id
             AND p.user_id = $3::uuid
         )`,
      [id, org, userId],
    );
    if (!thread) return c.json({ error: "Not found" }, 404);
    const participants = await query(
      c,
      `SELECT participant_kind, user_id, tenant_id, email, role
       FROM message_thread_participants
       WHERE thread_id = $1 AND organization_id = $2
       ORDER BY role, email`,
      [id, org],
    );
    const messages = await query(
      c,
      `SELECT m.id, m.sender_user_id, m.body, m.created_at, r.read_at
       FROM messages m
       LEFT JOIN message_reads r ON r.message_id = m.id AND r.user_id = $3::uuid
       WHERE m.thread_id = $1 AND m.organization_id = $2
       ORDER BY m.created_at ASC`,
      [id, org, userId],
    );
    const messageIds = messages.map((row) => String((row as { id: string }).id));
    const attachments = messageIds.length
      ? await query(
          c,
          `SELECT id, entity_id, filename, mime, size_bytes
           FROM documents
           WHERE organization_id = $1 AND entity_type = 'message' AND deleted_at IS NULL
             AND entity_id = ANY($2::uuid[])
           ORDER BY created_at ASC`,
          [org, messageIds],
        )
      : [];
    return c.json({
      thread: normalizeRow(thread as Record<string, unknown>),
      participants: normalizeRows(participants),
      messages: normalizeRows(messages).map((message) => ({
        ...message,
        attachments: normalizeRows(
          attachments.filter((row) => (row as { entity_id: string }).entity_id === message.id),
        ),
      })),
    });
  });

  app.post("/api/messages", messageSendRateLimit, async (c) => {
    const userId = senderId(c);
    if (!userId) return c.json({ error: "Sign in to send mail" }, 401);
    const parsed = await parseJson(c, CreateBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const org = orgId(c);
    const email = (c.get("userEmail") ?? "").trim().toLowerCase();
    if (!email) return c.json({ error: "Your account has no email" }, 400);

    const unique = new Map<string, ResolvedRecipient>();
    for (const recipient of parsed.data.recipients) {
      if (recipient.kind === "membership" && recipient.id === userId) {
        return c.json({ error: "You are already the sender" }, 400);
      }
      unique.set(`${recipient.kind}:${recipient.id}`, {
        kind: recipient.kind,
        id: recipient.id,
        email: "",
        role: recipient.role,
      });
    }
    const requested = [...unique.values()];

    try {
      const created = await c.get("sql").begin(async (tx) => {
        const resolved = await resolveRecipients(tx as unknown as Tx, org, requested);
        if (!resolved.ok) return resolved;
        if (parsed.data.entity_type && parsed.data.entity_id) {
          const table = ENTITY_TABLE[parsed.data.entity_type];
          const found = await txQuery<{ id: string }>(
            tx as unknown as Tx,
            `SELECT id FROM ${table} WHERE id = $1::uuid AND organization_id = $2::uuid`,
            [parsed.data.entity_id, org],
          );
          if (!found[0]) return { ok: false as const, status: 404 as const, error: "Not found" };
        }

        const threadId = crypto.randomUUID();
        const messageId = crypto.randomUUID();
        const targets = entityColumns(
          parsed.data.entity_type ?? null,
          parsed.data.entity_id ?? null,
        );
        await txQuery(
          tx as unknown as Tx,
          `INSERT INTO message_threads (
             id, organization_id, subject, entity_type, entity_id,
             property_id, lease_id, tenant_id, work_order_id, created_by
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10
           )`,
          [
            threadId,
            org,
            parsed.data.subject,
            parsed.data.entity_type ?? null,
            parsed.data.entity_id ?? null,
            targets.property_id,
            targets.lease_id,
            targets.tenant_id,
            targets.work_order_id,
            userId,
          ],
        );
        await insertParticipant(tx as unknown as Tx, {
          organizationId: org,
          threadId,
          kind: "membership",
          userId,
          tenantId: null,
          email,
          role: "from",
        });
        for (const recipient of resolved.recipients) {
          await insertParticipant(tx as unknown as Tx, {
            organizationId: org,
            threadId,
            kind: recipient.kind,
            userId:
              recipient.kind === "membership" ? recipient.id : (recipient.portalUserId ?? null),
            tenantId: recipient.kind === "tenant" ? recipient.id : null,
            email: recipient.email,
            role: recipient.role,
          });
        }
        await txQuery(
          tx as unknown as Tx,
          `INSERT INTO messages (id, thread_id, organization_id, sender_user_id, body)
           VALUES ($1, $2, $3, $4, $5)`,
          [messageId, threadId, org, userId, parsed.data.body],
        );
        return { ok: true as const, threadId, messageId };
      });
      if (!created.ok) return c.json({ error: created.error }, created.status);
      return c.json({ thread: { id: created.threadId }, message: { id: created.messageId } }, 201);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23503" || code === "23514") return c.json({ error: "Not found" }, 404);
      throw err;
    }
  });

  app.post("/api/messages/:id/replies", messageSendRateLimit, async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const userId = senderId(c);
    if (!userId) return c.json({ error: "Sign in to send mail" }, 401);
    const parsed = await parseJson(c, ReplyBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const org = orgId(c);
    const messageId = crypto.randomUUID();
    const inserted = await c.get("sql").begin(async (tx) => {
      const visible = await txQuery(
        tx as unknown as Tx,
        `SELECT 1 AS ok FROM message_thread_participants
         WHERE thread_id = $1 AND organization_id = $2 AND user_id = $3::uuid`,
        [id, org, userId],
      );
      if (!visible[0]) return false;
      await txQuery(
        tx as unknown as Tx,
        `INSERT INTO messages (id, thread_id, organization_id, sender_user_id, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [messageId, id, org, userId, parsed.data.body],
      );
      await txQuery(
        tx as unknown as Tx,
        `UPDATE message_threads SET last_message_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [id, org],
      );
      return true;
    });
    if (!inserted) return c.json({ error: "Not found" }, 404);
    return c.json({ message: { id: messageId } }, 201);
  });

  app.post("/api/messages/:id/read", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const userId = senderId(c);
    if (!userId) return c.json({ error: "Not found" }, 404);
    const org = orgId(c);
    const visible = await get(
      c,
      `SELECT 1 AS ok FROM message_thread_participants
       WHERE thread_id = $1 AND organization_id = $2 AND user_id = $3::uuid`,
      [id, org, userId],
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
      [id, org, userId],
    );
    return c.json({ updated: result.changes });
  });
}

function entityColumns(entityType: string | null, entityId: string | null) {
  return {
    property_id: entityType === "property" ? entityId : null,
    lease_id: entityType === "lease" ? entityId : null,
    tenant_id: entityType === "tenant" ? entityId : null,
    work_order_id: entityType === "work_order" ? entityId : null,
  };
}

async function resolveRecipients(
  tx: Tx,
  org: string,
  requested: ResolvedRecipient[],
): Promise<
  { ok: true; recipients: ResolvedRecipient[] } | { ok: false; status: 400; error: string }
> {
  const memberIds = requested.filter((row) => row.kind === "membership").map((row) => row.id);
  const tenantIds = requested.filter((row) => row.kind === "tenant").map((row) => row.id);
  const members = memberIds.length
    ? await txQuery<{ user_id: string; email: string }>(
        tx,
        `SELECT u.id AS user_id, lower(u.email) AS email
         FROM memberships m
         JOIN auth.users u ON u.id = m.user_id
         WHERE m.organization_id = $1::uuid AND u.id = ANY($2::uuid[])`,
        [org, memberIds],
      )
    : [];
  const tenants = tenantIds.length
    ? await txQuery<{ id: string; email: string; user_id?: string | null }>(
        tx,
        `SELECT id, lower(email) AS email, user_id
         FROM tenants
         WHERE organization_id = $1::uuid
           AND id = ANY($2::uuid[])
           AND email IS NOT NULL AND btrim(email) <> ''`,
        [org, tenantIds],
      )
    : [];
  const memberById = new Map(members.map((row) => [row.user_id, row.email]));
  const tenantById = new Map(tenants.map((row) => [row.id, row]));
  const recipients: ResolvedRecipient[] = [];
  for (const recipient of requested) {
    const tenant = recipient.kind === "tenant" ? tenantById.get(recipient.id) : undefined;
    const email = recipient.kind === "membership" ? memberById.get(recipient.id) : tenant?.email;
    if (!email) {
      return { ok: false, status: 400, error: "Recipient is not in this organization" };
    }
    recipients.push({ ...recipient, email, portalUserId: tenant?.user_id ?? null });
  }
  return { ok: true, recipients };
}

async function insertParticipant(
  tx: Tx,
  row: {
    organizationId: string;
    threadId: string;
    kind: "membership" | "tenant";
    userId: string | null;
    tenantId: string | null;
    email: string;
    role: "from" | "to" | "cc";
  },
) {
  await txQuery(
    tx,
    `INSERT INTO message_thread_participants (
       organization_id, thread_id, participant_kind, user_id, tenant_id, email, role
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.organizationId, row.threadId, row.kind, row.userId, row.tenantId, row.email, row.role],
  );
}
