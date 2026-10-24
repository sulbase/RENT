import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { memberships, organizations } from "../../db/schema";
import type { AppEnv } from "../env";
import { acceptPendingInvitations } from "../auth/accept-invitations";
import { reconcileMembershipsByEmail } from "../auth/reconcile-memberships";
import { listMemberships, resolveTenant, slugifyOrganizationName } from "../auth/tenant";
import {
  acceptTenantInvitations,
  isPortalAccount,
  reconcileTenantLinkByEmail,
  resolvePortalTenant,
} from "../auth/tenant-portal";
import { parseJson } from "../validation";
import { uuidSchema } from "../schemas/common";
import type { Context } from "hono";

async function syncIdentity(c: Context<AppEnv>): Promise<void> {
  const userId = c.get("userId");
  const email = c.get("userEmail");
  if (!userId || !email) return;
  const db = c.get("db");
  const current = await listMemberships(db, userId);
  const sql = c.get("sql");
  if (current.length === 0) {
    await reconcileMembershipsByEmail(sql, userId, email);
    await reconcileTenantLinkByEmail(sql, userId, email);
  }
  await acceptPendingInvitations(sql, userId, email);
  await acceptTenantInvitations(sql, userId, email);
}

const BootstrapBody = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
      "slug must be lowercase alphanumeric with hyphens",
    )
    .optional(),
});

export function mountAuthRoutes(app: Hono<AppEnv>) {
  app.get("/api/me", async (c) => {
    const userId = c.get("userId");
    if (!userId) {
      return c.json({
        mode: "dev_bypass",
        user: null,
        memberships: [],
        organization_id: c.get("orgId"),
        role: c.get("role"),
        portal: null,
      });
    }

    const db = c.get("db");
    await syncIdentity(c);
    const membershipsList = await listMemberships(db, userId);
    const portal = await resolvePortalTenant(c.get("sql"), userId);
    const requestedOrg = c.req.header("X-Organization-Id");
    const tenant = await resolveTenant(
      db,
      userId,
      requestedOrg && uuidSchema.safeParse(requestedOrg).success ? requestedOrg : null,
    );

    return c.json({
      mode: "authenticated",
      user: { id: userId },
      memberships: membershipsList.map((m) => ({
        organization_id: m.organizationId,
        name: m.organizationName,
        slug: m.organizationSlug,
        role: m.role,
      })),
      organization_id: tenant?.organizationId ?? null,
      role: tenant?.role ?? null,
      portal: portal
        ? {
            tenant_id: portal.tenantId,
            organization_id: portal.organizationId,
            organization_name: portal.organizationName,
            display_name: portal.displayName,
          }
        : null,
    });
  });

  app.post("/api/auth/bootstrap", async (c) => {
    const userId = c.get("userId");
    if (!userId) {
      return c.json({ error: "Sign in required" }, 401);
    }

    const parsed = await parseJson(c, BootstrapBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    await syncIdentity(c);
    const existing = await listMemberships(db, userId);
    if (existing.length > 0) {
      const first = existing[0];
      return c.json({
        organization: {
          id: first.organizationId,
          name: first.organizationName,
          slug: first.organizationSlug,
        },
        role: first.role,
        already_member: true,
      });
    }

    if (await isPortalAccount(c.get("sql"), userId, c.get("userEmail") ?? "")) {
      return c.json({ error: "Esta cuenta es de inquilino. Entra al portal." }, 409);
    }

    const name = parsed.data.name.trim();
    let slug = parsed.data.slug ?? slugifyOrganizationName(name);
    const baseSlug = slug;
    let attempt = 0;
    while (attempt < 5) {
      const clash = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1);
      if (!clash[0]) break;
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
    }

    const [org] = await db
      .insert(organizations)
      .values({ name, slug })
      .returning({ id: organizations.id, name: organizations.name, slug: organizations.slug });

    await db.insert(memberships).values({
      organizationId: org.id,
      userId,
      role: "owner",
    });

    return c.json({
      organization: org,
      role: "owner",
    });
  });

  app.put("/api/auth/active-organization", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);

    const parsed = await parseJson(c, z.object({ organization_id: uuidSchema }));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const db = c.get("db");
    const tenant = await resolveTenant(db, userId, parsed.data.organization_id);
    if (!tenant) return c.json({ error: "Organization not found" }, 403);

    return c.json({
      organization_id: tenant.organizationId,
      role: tenant.role,
    });
  });
}
