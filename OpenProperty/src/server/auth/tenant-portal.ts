import type { Sql } from "../db";

export type PortalTenant = {
  tenantId: string;
  organizationId: string;
  organizationName: string;
  displayName: string;
};

/**
 * Links this account to the tenant record it was invited to, in one statement.
 * Safe to run on every `/api/me`: a second concurrent call finds `user_id` already
 * set (or the account already linked) and changes nothing.
 */
export async function acceptTenantInvitations(
  sql: Sql,
  userId: string,
  email: string,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;

  await sql.unsafe(
    `
    WITH pending AS (
      SELECT i.id, i.organization_id, i.tenant_id
      FROM tenant_invitations i
      WHERE i.email = $2
        AND i.accepted_at IS NULL
        AND i.expires_at > now()
        AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.user_id = $1::uuid)
      ORDER BY i.created_at
      LIMIT 1
    ),
    linked AS (
      UPDATE tenants t
      SET user_id = $1::uuid
      FROM pending p
      WHERE t.id = p.tenant_id
        AND t.organization_id = p.organization_id
        AND t.user_id IS NULL
      RETURNING t.id, t.organization_id
    ),
    accepted AS (
      UPDATE tenant_invitations i
      SET accepted_at = now()
      FROM pending p
      JOIN linked l ON l.id = p.tenant_id AND l.organization_id = p.organization_id
      WHERE i.id = p.id
      RETURNING i.id
    )
    UPDATE message_thread_participants mp
    SET user_id = $1::uuid
    FROM linked l
    WHERE mp.tenant_id = l.id
      AND mp.organization_id = l.organization_id
      AND mp.participant_kind = 'tenant'
      AND mp.user_id IS NULL
    `,
    [userId, normalized],
  );
}

/**
 * After email confirm, Supabase may issue a new auth.users id for the same email.
 * Moves the portal link from the older row, as `reconcileMembershipsByEmail` does.
 */
export async function reconcileTenantLinkByEmail(
  sql: Sql,
  userId: string,
  email: string,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;

  await sql.unsafe(
    `
    WITH previous AS (
      SELECT t.id, t.organization_id, t.user_id AS old_user_id
      FROM tenants t
      JOIN auth.users u ON u.id = t.user_id
      WHERE lower(u.email) = $2
        AND t.user_id <> $1::uuid
        AND NOT EXISTS (SELECT 1 FROM tenants mine WHERE mine.user_id = $1::uuid)
      LIMIT 1
    ),
    moved AS (
      UPDATE tenants t
      SET user_id = $1::uuid
      FROM previous p
      WHERE t.id = p.id AND t.organization_id = p.organization_id
      RETURNING t.id, t.organization_id
    )
    UPDATE message_thread_participants mp
    SET user_id = $1::uuid
    FROM moved m
    WHERE mp.tenant_id = m.id
      AND mp.organization_id = m.organization_id
      AND mp.participant_kind = 'tenant'
    `,
    [userId, normalized],
  );
}

export async function resolvePortalTenant(sql: Sql, userId: string): Promise<PortalTenant | null> {
  const rows = await sql.unsafe<
    {
      tenant_id: string;
      organization_id: string;
      organization_name: string;
      first_name: string;
      last_name: string;
    }[]
  >(
    `SELECT t.id AS tenant_id, t.organization_id, o.name AS organization_name,
            t.first_name, t.last_name
     FROM tenants t
     JOIN organizations o ON o.id = t.organization_id
     WHERE t.user_id = $1::uuid
     LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    displayName: `${row.first_name} ${row.last_name}`.trim(),
  };
}

/** True when this account is (or is about to be) a tenant: no organization for it. */
export async function isPortalAccount(sql: Sql, userId: string, email: string): Promise<boolean> {
  const rows = await sql.unsafe<{ ok: number }[]>(
    `SELECT 1 AS ok
     WHERE EXISTS (SELECT 1 FROM tenants WHERE user_id = $1::uuid)
        OR EXISTS (
          SELECT 1 FROM tenant_invitations
          WHERE email = $2 AND accepted_at IS NULL AND expires_at > now()
        )`,
    [userId, email.trim().toLowerCase()],
  );
  return rows.length > 0;
}
