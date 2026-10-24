import type { Hono } from "hono";
import { assertCanManage } from "../auth/guards";
import type { AppEnv } from "../env";
import { get, orgId, uuidParam, type SqlParam } from "../pg";

const INVITE_DAYS = 14;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Tx = {
  unsafe: (text: string, params?: SqlParam[]) => Promise<unknown>;
};

type Outcome =
  | { ok: true; status: 200 | 201; body: Record<string, unknown> }
  | { ok: false; status: 400 | 404 | 409; error: string };

async function txRows<T>(tx: Tx, text: string, params: SqlParam[] = []): Promise<T[]> {
  return (await tx.unsafe(text, params)) as T[];
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

export function mountTenantPortalAccessRoutes(app: Hono<AppEnv>) {
  app.get("/api/tenants/:id/portal", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const o = orgId(c);
    const tenant = await get<{ email: string | null; user_id: string | null }>(
      c,
      `SELECT email, user_id FROM tenants WHERE id = $1 AND organization_id = $2`,
      [id, o],
    );
    if (!tenant) return c.json({ error: "Not found" }, 404);
    if (tenant.user_id) return c.json({ status: "active" });
    const pending = await get<{ email: string; expires_at: Date | string }>(
      c,
      `SELECT email, expires_at FROM tenant_invitations
       WHERE tenant_id = $1 AND organization_id = $2
         AND accepted_at IS NULL AND expires_at > now()`,
      [id, o],
    );
    if (pending) {
      const expires =
        pending.expires_at instanceof Date ? pending.expires_at.toISOString() : pending.expires_at;
      return c.json({ status: "pending", email: pending.email, expires_at: expires });
    }
    if (!tenant.email?.trim()) return c.json({ status: "no_email" });
    return c.json({ status: "none" });
  });

  app.post("/api/tenants/:id/portal-invite", async (c) => {
    const denied = assertCanManage(c);
    if (denied) return denied;
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const o = orgId(c);
    const actor = c.get("userId");

    let outcome: Outcome;
    try {
      outcome = await c.get("sql").begin(async (raw) => {
        const tx = raw as unknown as Tx;
        const [tenant] = await txRows<{ email: string | null; user_id: string | null }>(
          tx,
          `SELECT email, user_id FROM tenants
           WHERE id = $1 AND organization_id = $2
           FOR UPDATE`,
          [id, o],
        );
        if (!tenant) return { ok: false, status: 404, error: "Not found" } as const;
        const email = tenant.email?.trim().toLowerCase() ?? "";
        if (!EMAIL_RE.test(email)) {
          return {
            ok: false,
            status: 400,
            error: "Agrega un correo válido en la ficha del inquilino",
          } as const;
        }
        if (tenant.user_id) {
          return {
            ok: false,
            status: 409,
            error: "El inquilino ya tiene acceso al portal",
          } as const;
        }

        const [staff] = await txRows<{ ok: number }>(
          tx,
          `SELECT 1 AS ok
           WHERE EXISTS (
             SELECT 1 FROM memberships m
             JOIN auth.users u ON u.id = m.user_id
             WHERE lower(u.email) = $1
           )
           OR EXISTS (
             SELECT 1 FROM organization_invitations
             WHERE lower(email) = $1 AND accepted_at IS NULL AND expires_at > now()
           )`,
          [email],
        );
        if (staff) {
          return {
            ok: false,
            status: 409,
            error: "Ese correo pertenece a un equipo de RENT. Usa otro correo para el portal",
          } as const;
        }

        await tx.unsafe(
          `DELETE FROM tenant_invitations
           WHERE accepted_at IS NULL
             AND ((tenant_id = $1 AND organization_id = $2) OR (email = $3 AND expires_at <= now()))`,
          [id, o, email],
        );
        const [otherInvite] = await txRows<{ ok: number }>(
          tx,
          `SELECT 1 AS ok FROM tenant_invitations WHERE email = $1 AND accepted_at IS NULL`,
          [email],
        );
        if (otherInvite) {
          return {
            ok: false,
            status: 409,
            error: "Ese correo ya tiene una invitación al portal de otro inquilino",
          } as const;
        }

        const [account] = await txRows<{ id: string }>(
          tx,
          `SELECT id FROM auth.users WHERE lower(email) = $1 ORDER BY created_at DESC LIMIT 1`,
          [email],
        );
        if (!account) {
          const [invitation] = await txRows<{ expires_at: Date | string }>(
            tx,
            `INSERT INTO tenant_invitations (organization_id, tenant_id, email, invited_by, expires_at)
             VALUES ($1::uuid, $2::uuid, $3, $4::uuid, now() + ($5::int * interval '1 day'))
             RETURNING expires_at`,
            [o, id, email, actor, INVITE_DAYS],
          );
          const expires =
            invitation.expires_at instanceof Date
              ? invitation.expires_at.toISOString()
              : invitation.expires_at;
          return {
            ok: true,
            status: 201,
            body: { status: "pending", email, expires_at: expires },
          } as const;
        }

        const [linkedElsewhere] = await txRows<{ ok: number }>(
          tx,
          `SELECT 1 AS ok FROM tenants WHERE user_id = $1::uuid`,
          [account.id],
        );
        if (linkedElsewhere) {
          return {
            ok: false,
            status: 409,
            error: "Esa cuenta ya tiene acceso al portal de otro inquilino",
          } as const;
        }
        await tx.unsafe(
          `UPDATE tenants SET user_id = $3::uuid
           WHERE id = $1 AND organization_id = $2 AND user_id IS NULL`,
          [id, o, account.id],
        );
        await tx.unsafe(
          `INSERT INTO tenant_invitations
             (organization_id, tenant_id, email, invited_by, expires_at, accepted_at)
           VALUES ($1::uuid, $2::uuid, $3, $4::uuid, now() + ($5::int * interval '1 day'), now())`,
          [o, id, email, actor, INVITE_DAYS],
        );
        await tx.unsafe(
          `UPDATE message_thread_participants SET user_id = $3::uuid
           WHERE tenant_id = $1 AND organization_id = $2
             AND participant_kind = 'tenant' AND user_id IS NULL`,
          [id, o, account.id],
        );
        return { ok: true, status: 200, body: { status: "active" } } as const;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return c.json({ error: "Ese correo ya está ligado a otro acceso al portal" }, 409);
      }
      throw err;
    }
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);
    return c.json(outcome.body, outcome.status);
  });

  app.delete("/api/tenants/:id/portal", async (c) => {
    const denied = assertCanManage(c);
    if (denied) return denied;
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const o = orgId(c);
    const found = await c.get("sql").begin(async (raw) => {
      const tx = raw as unknown as Tx;
      const [tenant] = await txRows<{ id: string }>(
        tx,
        `UPDATE tenants SET user_id = NULL
         WHERE id = $1 AND organization_id = $2
         RETURNING id`,
        [id, o],
      );
      if (!tenant) return false;
      await tx.unsafe(
        `DELETE FROM tenant_invitations
         WHERE tenant_id = $1 AND organization_id = $2 AND accepted_at IS NULL`,
        [id, o],
      );
      await tx.unsafe(
        `UPDATE message_thread_participants SET user_id = NULL
         WHERE tenant_id = $1 AND organization_id = $2 AND participant_kind = 'tenant'`,
        [id, o],
      );
      return true;
    });
    if (!found) return c.json({ error: "Not found" }, 404);
    return c.json({ status: "none" });
  });
}
