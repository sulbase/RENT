import { describe, expect, it } from "vitest";
import { factory } from "../factory";
import type { Sql } from "../db";
import type { WorkerBindings } from "../env";
import { mountPortalRoutes } from "../routes/portal";

const ORG = "10000000-0000-4000-8000-000000000001";
const TENANT_A = "20000000-0000-4000-8000-00000000000a";
const TENANT_B = "20000000-0000-4000-8000-00000000000b";
const USER_A = "30000000-0000-4000-8000-00000000000a";
const LEASE_A = "60000000-0000-4000-8000-00000000000a";
const LEASE_B = "60000000-0000-4000-8000-00000000000b";
const LEASE_A_ENDED = "60000000-0000-4000-8000-0000000000ae";
const UNIT_A = "70000000-0000-4000-8000-00000000000a";
const UNIT_B = "70000000-0000-4000-8000-00000000000b";
const PROPERTY = "80000000-0000-4000-8000-000000000001";
const DOC_A = "90000000-0000-4000-8000-00000000000a";
const DOC_B = "90000000-0000-4000-8000-00000000000b";
const DOC_A_PHOTO = "90000000-0000-4000-8000-0000000000a1";
const DOC_A_DELETED = "90000000-0000-4000-8000-0000000000a2";
const THREAD_A = "40000000-0000-4000-8000-00000000000a";
const THREAD_B = "40000000-0000-4000-8000-00000000000b";

type Lease = { id: string; tenant: string; unit_id: string; status: string };
type Doc = { id: string; lease_id: string; kind: string; deleted: boolean; r2_key: string };
type WorkOrder = {
  id: string;
  organization_id: string;
  tenant_id: string;
  unit_id: string;
  property_id: string;
  title: string;
  status: string;
};

function createSql() {
  const leases: Lease[] = [
    { id: LEASE_A, tenant: TENANT_A, unit_id: UNIT_A, status: "active" },
    { id: LEASE_A_ENDED, tenant: TENANT_A, unit_id: UNIT_A, status: "ended" },
    { id: LEASE_B, tenant: TENANT_B, unit_id: UNIT_B, status: "active" },
  ];
  const documents: Doc[] = [
    { id: DOC_A, lease_id: LEASE_A, kind: "signed_lease", deleted: false, r2_key: "a.pdf" },
    { id: DOC_B, lease_id: LEASE_B, kind: "signed_lease", deleted: false, r2_key: "b.pdf" },
    { id: DOC_A_PHOTO, lease_id: LEASE_A, kind: "image", deleted: false, r2_key: "a.jpg" },
    { id: DOC_A_DELETED, lease_id: LEASE_A, kind: "signed_lease", deleted: true, r2_key: "x.pdf" },
  ];
  const threads = [
    { id: THREAD_A, tenant: TENANT_A, subject: "Recibo de octubre" },
    { id: THREAD_B, tenant: TENANT_B, subject: "Solo para B" },
  ];
  const messages: { id: string; thread_id: string; sender_user_id: string; body: string }[] = [];
  const workOrders: WorkOrder[] = [
    {
      id: "a0000000-0000-4000-8000-00000000000b",
      organization_id: ORG,
      tenant_id: TENANT_B,
      unit_id: UNIT_B,
      property_id: PROPERTY,
      title: "Fuga de B",
      status: "open",
    },
  ];

  const unsafe = async (text: string, params: unknown[] = []) => {
    if (text.includes("FROM documents d") && text.includes("d.id = $1")) {
      const [id, org, tenant] = params as string[];
      if (org !== ORG) return [];
      const doc = documents.find((row) => row.id === id);
      const lease = leases.find((row) => row.id === doc?.lease_id);
      if (!doc || !lease || doc.deleted || doc.kind !== "signed_lease" || lease.tenant !== tenant) {
        return [];
      }
      return [{ r2_key: doc.r2_key, filename: "contrato.pdf", mime: "application/pdf", size_bytes: 3 }];
    }
    if (text.includes("FROM message_threads t") && text.includes("LIMIT 50")) {
      const [org, tenant] = params as string[];
      if (org !== ORG) return [];
      return threads
        .filter((row) => row.tenant === tenant)
        .map((row) => ({ id: row.id, subject: row.subject, last_message_at: "2026-10-01T00:00:00Z", unread_count: 0 }));
    }
    if (text.includes("FROM message_threads t") && text.includes("t.id = $3")) {
      const [org, tenant, id] = params as string[];
      const thread = threads.find((row) => row.id === id && row.tenant === tenant && org === ORG);
      return thread ? [{ id: thread.id, subject: thread.subject, ok: 1 }] : [];
    }
    if (text.includes("FROM message_thread_participants")) return [];
    if (text.includes("FROM messages m")) {
      const [id] = params as string[];
      return messages.filter((row) => row.thread_id === id);
    }
    if (text.includes("INSERT INTO messages")) {
      const [id, thread_id, , sender_user_id, body] = params as string[];
      messages.push({ id, thread_id, sender_user_id, body });
      return [];
    }
    if (text.includes("UPDATE message_threads")) return [];
    if (text.includes("FROM work_orders w") && text.includes("w.tenant_id = $2")) {
      const [org, tenant] = params as string[];
      return workOrders.filter((row) => row.organization_id === org && row.tenant_id === tenant);
    }
    if (text.includes("FROM leases l") && text.includes("l.primary_tenant_id = $3")) {
      const [id, org, tenant] = params as string[];
      const lease = leases.find(
        (row) => row.id === id && row.tenant === tenant && row.status === "active" && org === ORG,
      );
      return lease ? [{ unit_id: lease.unit_id, property_id: PROPERTY }] : [];
    }
    if (text.includes("INSERT INTO work_orders")) {
      const [organization_id, property_id, unit_id, tenant_id, title] = params as string[];
      const id = `b0000000-0000-4000-8000-${String(workOrders.length).padStart(12, "0")}`;
      workOrders.push({ id, organization_id, property_id, unit_id, tenant_id, title, status: "open" });
      return [{ id }];
    }
    if (text.includes("FROM work_orders w") && text.includes("w.id = $1")) {
      const [id] = params as string[];
      return workOrders.filter((row) => row.id === id);
    }
    return [];
  };

  const sql = {
    unsafe,
    begin: async (fn: (tx: { unsafe: typeof unsafe }) => Promise<unknown>) => fn({ unsafe }),
  };
  return { sql: sql as unknown as Sql, messages, workOrders };
}

const bucket = {
  get: async (key: string) => ({ body: new Blob([key]).stream() }),
};

function portalApp(sql: Sql, tenantId: string | null = TENANT_A) {
  const app = factory.createApp();
  app.use("*", async (c, next) => {
    c.set("sql", sql);
    c.set("db", {} as never);
    c.set("orgId", ORG);
    c.set("userId", USER_A);
    c.set("userEmail", "ana@example.com");
    c.set("role", "viewer");
    c.set("portalTenantId", tenantId);
    await next();
  });
  mountPortalRoutes(app);
  const env = { FILES: bucket } as unknown as WorkerBindings;
  return {
    request: (path: string, init?: RequestInit) => app.request(path, init, env),
  };
}

function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("portal isolation (documents)", () => {
  it("downloads the tenant's own signed lease through the Worker", async () => {
    const { sql } = createSql();
    const res = await portalApp(sql).request(`/api/portal/documents/${DOC_A}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.text()).toBe("a.pdf");
  });

  it("answers 404 for another tenant's lease, other kinds, deleted rows and bad ids", async () => {
    const { sql } = createSql();
    const app = portalApp(sql);
    for (const id of [DOC_B, DOC_A_PHOTO, DOC_A_DELETED, "not-a-uuid"]) {
      const res = await app.request(`/api/portal/documents/${id}`);
      expect(res.status).toBe(404);
    }
  });

  it("refuses every portal route without a resolved tenant", async () => {
    const { sql } = createSql();
    const app = portalApp(sql, null);
    expect((await app.request(`/api/portal/documents/${DOC_A}`)).status).toBe(404);
    expect((await app.request("/api/portal/home")).status).toBe(403);
    expect((await app.request("/api/portal/work-orders")).status).toBe(403);
  });
});

describe("portal isolation (mail)", () => {
  it("lists only threads where this tenant participates", async () => {
    const { sql } = createSql();
    const res = await portalApp(sql).request("/api/portal/messages");
    const body = (await res.json()) as { threads: { id: string }[] };
    expect(body.threads.map((row) => row.id)).toEqual([THREAD_A]);
  });

  it("hides and refuses replies to another tenant's thread", async () => {
    const { sql, messages } = createSql();
    const app = portalApp(sql);
    expect((await app.request(`/api/portal/messages/${THREAD_B}`)).status).toBe(404);
    const reply = await app.request(`/api/portal/messages/${THREAD_B}/replies`, postJson({ body: "Hola" }));
    expect(reply.status).toBe(404);
    expect(messages).toHaveLength(0);
  });

  it("replies in its own thread as the portal account", async () => {
    const { sql, messages } = createSql();
    const res = await portalApp(sql).request(
      `/api/portal/messages/${THREAD_A}/replies`,
      postJson({ body: "Recibido, gracias" }),
    );
    expect(res.status).toBe(201);
    expect(messages).toEqual([
      expect.objectContaining({ thread_id: THREAD_A, sender_user_id: USER_A, body: "Recibido, gracias" }),
    ]);
  });
});

describe("portal isolation (work orders)", () => {
  it("lists only the tenant's own orders", async () => {
    const { sql } = createSql();
    const res = await portalApp(sql).request("/api/portal/work-orders");
    const body = (await res.json()) as { work_orders: unknown[] };
    expect(body.work_orders).toEqual([]);
  });

  it("rejects an order without lease_id or against someone else's lease", async () => {
    const { sql, workOrders } = createSql();
    const app = portalApp(sql);
    const before = workOrders.length;
    const missing = await app.request("/api/portal/work-orders", postJson({ title: "Gotera" }));
    expect(missing.status).toBe(400);
    const foreign = await app.request(
      "/api/portal/work-orders",
      postJson({ lease_id: LEASE_B, title: "Gotera" }),
    );
    expect(foreign.status).toBe(400);
    const ended = await app.request(
      "/api/portal/work-orders",
      postJson({ lease_id: LEASE_A_ENDED, title: "Gotera" }),
    );
    expect(ended.status).toBe(400);
    expect(workOrders).toHaveLength(before);
  });

  it("takes unit and tenant from the lease, not from the body", async () => {
    const { sql, workOrders } = createSql();
    const res = await portalApp(sql).request(
      "/api/portal/work-orders",
      postJson({
        lease_id: LEASE_A,
        title: "Gotera en el baño",
        priority: "high",
        unit_id: UNIT_B,
        tenant_id: TENANT_B,
        vendor_id: PROPERTY,
        cost: 9999,
      }),
    );
    expect(res.status).toBe(201);
    const created = workOrders[workOrders.length - 1];
    expect(created).toMatchObject({
      tenant_id: TENANT_A,
      unit_id: UNIT_A,
      property_id: PROPERTY,
      title: "Gotera en el baño",
      status: "open",
    });
  });
});
