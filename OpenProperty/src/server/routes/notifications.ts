import { z } from "zod";
import type { Hono } from "hono";
import type { AppEnv } from "../env";
import { NOTIFICATION_KINDS } from "../notifications/types";
import { get, normalizeRow, normalizeRows, orgId, query, run, uuidParam } from "../pg";
import { parseQuery } from "../validation";

const Kind = z.enum(NOTIFICATION_KINDS);

const ListQuery = z.object({
  kind: Kind.optional(),
  read: z.enum(["unread", "read", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Late notices belong to the tenant portal. The staff mailbox keeps the shorter rent alerts. */
const VISIBLE = `organization_id = $1
  AND kind <> 'rent_late_notice'
  AND ($2::uuid IS NULL OR user_id IS NULL OR user_id = $2::uuid)`;

const VISIBLE_ON_N = `n.organization_id = $1
  AND n.kind <> 'rent_late_notice'
  AND ($2::uuid IS NULL OR n.user_id IS NULL OR n.user_id = $2::uuid)`;

export function mountNotificationRoutes(app: Hono<AppEnv>) {
  app.get("/api/notifications", async (c) => {
    const parsed = parseQuery(c, ListQuery);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const userId = c.get("userId");
    const kind = parsed.data.kind ?? null;
    const read = parsed.data.read ?? "all";
    const limit = parsed.data.limit ?? 50;
    const rows = await query(
      c,
      `SELECT n.id, n.kind, n.title, n.body, n.severity, n.entity_type, n.entity_id, n.period,
              n.read_at, n.created_at,
              ls.lease_id AS signature_lease_id
       FROM notifications n
       LEFT JOIN lease_signatures ls
         ON n.entity_type = 'lease_signature'
        AND ls.id = n.entity_id
        AND ls.organization_id = n.organization_id
       WHERE ${VISIBLE_ON_N}
         AND ($3::text IS NULL OR n.kind::text = $3)
         AND (
           $4 = 'all'
           OR ($4 = 'unread' AND n.read_at IS NULL)
           OR ($4 = 'read' AND n.read_at IS NOT NULL)
         )
       ORDER BY n.created_at DESC
       LIMIT $5`,
      [orgId(c), userId, kind ?? null, read, limit],
    );
    const unread = await get<{ n: number }>(
      c,
      `SELECT COUNT(*)::int AS n FROM notifications
       WHERE ${VISIBLE} AND read_at IS NULL`,
      [orgId(c), userId],
    );
    return c.json({
      notifications: normalizeRows(rows),
      unread_count: Number(unread?.n ?? 0),
    });
  });

  app.post("/api/notifications/read-all", async (c) => {
    const userId = c.get("userId");
    const result = await run(
      c,
      `UPDATE notifications
       SET read_at = COALESCE(read_at, now())
       WHERE ${VISIBLE} AND read_at IS NULL`,
      [orgId(c), userId],
    );
    return c.json({ updated: result.changes });
  });

  app.post("/api/notifications/:id/read", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const userId = c.get("userId");
    const row = await get(
      c,
      `UPDATE notifications
       SET read_at = COALESCE(read_at, now())
       WHERE id = $1
         AND organization_id = $2
         AND kind <> 'rent_late_notice'
         AND ($3::uuid IS NULL OR user_id IS NULL OR user_id = $3::uuid)
       RETURNING id, kind, title, body, severity, entity_type, entity_id, period, read_at, created_at`,
      [id, orgId(c), userId],
    );
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({ notification: normalizeRow(row as Record<string, unknown>) });
  });
}
