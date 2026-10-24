import { describe, expect, it, vi } from "vitest";
import type { AppDb, Sql } from "../db";
import type { WorkerBindings } from "../env";
import { factory } from "../factory";
import { mountAuthRoutes } from "../routes/auth";
import { mountTenantPortalAccessRoutes } from "../routes/tenant-portal-access";
import type { MembershipRole } from "./roles";
import { authMiddleware } from "./middleware";

const ORG = "10000000-0000-4000-8000-000000000001";
const OTHER_ORG = "10000000-0000-4000-8000-000000000002";
const TENANT_A = "20000000-0000-4000-8000-00000000000a";
const TENANT_USER = "30000000-0000-4000-8000-00000000000a";
const STAFF_USER = "30000000-0000-4000-8000-0000000000ff";
const NEW_USER = "30000000-0000-4000-8000-0000000000b0";

vi.mock("./jwt", () => ({
  bearerToken: (header: string | undefined) => header?.replace(/^Bearer\s+/i, "") || null,
  verifySupabaseAccessToken: async (token: string) => ({ sub: token, email: "ana@example.com" }),
}));

vi.mock("./tenant", () => ({
  resolveTenant: async (_db: unknown, userId: string) =>
    userId === STAFF_USER ? { organizationId: ORG, role: "owner" } : null,
  listMemberships: async (_db: unknown, userId: string) =>
    userId === STAFF_USER
      ? [{ organizationId: ORG, organizationName: "Org", organizationSlug: "org", role: "owner" }]
      : [],
  slugifyOrganizationName: (name: string) => name.toLowerCase(),
}));

vi.mock("./accept-invitations", () => ({ acceptPendingInvitations: async () => undefined }));
vi.mock("./reconcile-memberships", () => ({ reconcileMembershipsByEmail: async () => 0 }));
vi.mock("../seed", () => ({ ensureSeeded: async () => undefined }));

/** Rough model of the portal SQL: enough to follow who gets linked to which tenant. */
function createPortalSql(input: { invitedEmail?: string; linked?: Record<string, string> }) {
  const linked = new Map(Object.entries(input.linked ?? {}));
  let pendingEmail = input.invitedEmail ?? null;
  const unsafe = async (text: string, params: unknown[] = []) => {
    if (text.includes("WITH pending AS")) {
      const [userId, email] = params as string[];
      const alreadyLinked = [...linked.values()].includes(TENANT_A) || linked.has(userId);
      if (pendingEmail === email && !alreadyLinked) {
        linked.set(userId, TENANT_A);
        pendingEmail = null;
      }
      return [];
    }
    if (text.includes("WITH previous AS")) return [];
    if (text.includes("JOIN organizations o") && text.includes("t.user_id = $1")) {
      const tenantId = linked.get(params[0] as string);
      return tenantId
        ? [
            {
              tenant_id: tenantId,
              organization_id: ORG,
              organization_name: "Org",
              first_name: "Ana",
              last_name: "Ruiz",
            },
          ]
        : [];
    }
    if (text.includes("FROM tenant_invitations") && text.includes("WHERE EXISTS")) {
      const [userId, email] = params as string[];
      return linked.has(userId) || pendingEmail === email ? [{ ok: 1 }] : [];
    }
    return [];
  };
  const sql = {
    unsafe,
    begin: async (fn: (tx: { unsafe: typeof unsafe }) => Promise<unknown>) => fn({ unsafe }),
  };
  return { sql: sql as unknown as Sql, linked };
}

const failingDb = {
  select: () => {
    throw new Error("organization creation should not start");
  },
  insert: () => {
    throw new Error("organization creation should not start");
  },
} as unknown as AppDb;

describe("auth middleware for the portal", () => {
  function guardedApp(sql: Sql) {
    const app = factory.createApp();
    app.use("*", async (c, next) => {
      c.set("sql", sql);
      c.set("db", {} as AppDb);
      await next();
    });
    app.use("*", authMiddleware);
    app.get("/api/properties", (c) => c.json({ ok: true }));
    app.post("/api/properties", (c) => c.json({ ok: true }));
    app.get("/api/portal/home", (c) =>
      c.json({ tenant: c.get("portalTenantId"), org: c.get("orgId"), role: c.get("role") }),
    );
    const env = { SUPABASE_JWT_SECRET: "test-secret" } as WorkerBindings;
    return (path: string, user: string, init: RequestInit = {}) =>
      app.request(
        path,
        { ...init, headers: { Authorization: `Bearer ${user}`, "X-Organization-Id": OTHER_ORG } },
        env,
      );
  }

  it("keeps a tenant out of the staff API", async () => {
    const { sql } = createPortalSql({ linked: { [TENANT_USER]: TENANT_A } });
    const request = guardedApp(sql);
    expect((await request("/api/properties", TENANT_USER)).status).toBe(403);
    expect((await request("/api/properties", TENANT_USER, { method: "POST" })).status).toBe(403);
  });

  it("resolves the tenant and organization from the account, never from headers", async () => {
    const { sql } = createPortalSql({ linked: { [TENANT_USER]: TENANT_A } });
    const res = await guardedApp(sql)("/api/portal/home", TENANT_USER);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenant: TENANT_A, org: ORG, role: "viewer" });
  });

  it("refuses the portal to an account with no tenant record", async () => {
    const { sql } = createPortalSql({});
    expect((await guardedApp(sql)("/api/portal/home", STAFF_USER)).status).toBe(403);
  });
});

describe("accepting a portal invitation", () => {
  function authApp(sql: Sql, userId: string, email: string) {
    const app = factory.createApp();
    app.use("*", async (c, next) => {
      c.set("sql", sql);
      c.set("db", failingDb);
      c.set("userId", userId);
      c.set("userEmail", email);
      c.set("portalTenantId", null);
      await next();
    });
    mountAuthRoutes(app);
    return app;
  }

  it("links the tenant on the first /api/me after sign-up, and only once", async () => {
    const { sql, linked } = createPortalSql({ invitedEmail: "ana@example.com" });
    const app = authApp(sql, NEW_USER, "Ana@Example.com");
    for (let i = 0; i < 2; i += 1) {
      const res = await app.request("/api/me");
      const body = (await res.json()) as { portal: { tenant_id: string } | null };
      expect(body.portal?.tenant_id).toBe(TENANT_A);
    }
    expect([...linked.entries()]).toEqual([[NEW_USER, TENANT_A]]);
  });

  it("does not accept the invitation for another email", async () => {
    const { sql, linked } = createPortalSql({ invitedEmail: "ana@example.com" });
    const res = await authApp(sql, NEW_USER, "otra@example.com").request("/api/me");
    const body = (await res.json()) as { portal: unknown };
    expect(body.portal).toBeNull();
    expect(linked.size).toBe(0);
  });

  it("does not let an invited or linked tenant create an organization", async () => {
    const pending = createPortalSql({ invitedEmail: "ana@example.com" });
    const linkedSql = createPortalSql({ linked: { [NEW_USER]: TENANT_A } });
    for (const { sql } of [pending, linkedSql]) {
      const res = await authApp(sql, NEW_USER, "ana@example.com").request("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Mi organización" }),
      });
      expect(res.status).toBe(409);
    }
  });
});

describe("inviting a tenant to the portal", () => {
  type Calls = { text: string; params: unknown[] }[];

  function inviteSql(input: { email: string | null; staff?: boolean; account?: string }) {
    const calls: Calls = [];
    const unsafe = async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (text.includes("FOR UPDATE")) return [{ email: input.email, user_id: null }];
      if (text.includes("FROM memberships m")) return input.staff ? [{ ok: 1 }] : [];
      if (text.includes("FROM auth.users")) return input.account ? [{ id: input.account }] : [];
      if (text.includes("INSERT INTO tenant_invitations")) {
        return [{ expires_at: new Date("2026-11-07T00:00:00Z") }];
      }
      return [];
    };
    const sql = {
      unsafe,
      begin: async (fn: (tx: { unsafe: typeof unsafe }) => Promise<unknown>) => fn({ unsafe }),
    };
    return { sql: sql as unknown as Sql, calls };
  }

  function inviteApp(sql: Sql, role: MembershipRole = "owner") {
    const app = factory.createApp();
    app.use("*", async (c, next) => {
      c.set("sql", sql);
      c.set("db", {} as AppDb);
      c.set("orgId", ORG);
      c.set("userId", STAFF_USER);
      c.set("userEmail", "owner@example.com");
      c.set("role", role);
      c.set("portalTenantId", null);
      await next();
    });
    mountTenantPortalAccessRoutes(app);
    return (path = `/api/tenants/${TENANT_A}/portal-invite`) => app.request(path, { method: "POST" });
  }

  const inserted = (calls: Calls) =>
    calls.filter((call) => call.text.includes("INSERT INTO tenant_invitations"));

  it("does not turn a team member's email into a portal account", async () => {
    const { sql, calls } = inviteSql({ email: "socio@example.com", staff: true });
    expect((await inviteApp(sql)()).status).toBe(409);
    expect(inserted(calls)).toHaveLength(0);
  });

  it("leaves a pending invitation with the normalized email when there is no account", async () => {
    const { sql, calls } = inviteSql({ email: " Ana@Example.com " });
    const res = await inviteApp(sql)();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "pending", email: "ana@example.com" });
    expect(inserted(calls)[0]?.params).toEqual([ORG, TENANT_A, "ana@example.com", STAFF_USER, 14]);
  });

  it("links an existing account at once and copies it to the tenant's mail threads", async () => {
    const { sql, calls } = inviteSql({ email: "ana@example.com", account: NEW_USER });
    const res = await inviteApp(sql)();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "active" });
    const link = calls.find((call) => call.text.includes("UPDATE tenants SET user_id"));
    expect(link?.params).toEqual([TENANT_A, ORG, NEW_USER]);
    const mail = calls.find((call) => call.text.includes("UPDATE message_thread_participants"));
    expect(mail?.params).toEqual([TENANT_A, ORG, NEW_USER]);
  });

  it("asks for an email first and stays closed to staff and viewers", async () => {
    const { sql } = inviteSql({ email: null });
    expect((await inviteApp(sql)()).status).toBe(400);
    expect((await inviteApp(sql, "staff")()).status).toBe(403);
    expect((await inviteApp(sql, "viewer")()).status).toBe(403);
  });
});
