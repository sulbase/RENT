import { describe, expect, it } from "vitest";
import type { Sql } from "../db";
import type { WorkerBindings } from "../env";
import { factory } from "../factory";
import type { MembershipRole } from "../auth/roles";
import { mountPaymentSubmissionRoutes } from "../routes/payment-submissions";

const ORG = "10000000-0000-4000-8000-000000000001";
const TENANT_A = "20000000-0000-4000-8000-00000000000a";
const TENANT_B = "20000000-0000-4000-8000-00000000000b";
const USER_A = "30000000-0000-4000-8000-00000000000a";
const STAFF = "30000000-0000-4000-8000-0000000000ff";
const CHARGE_A = "50000000-0000-4000-8000-00000000000a";
const CHARGE_B = "50000000-0000-4000-8000-00000000000b";

type Charge = { id: string; tenant: string; amount: number; status: string; period: string };
type Submission = {
  id: string;
  tenant_id: string;
  charge_id: string;
  amount: string;
  paid_on: string;
  reference: string | null;
  status: string;
  rejection_reason: string | null;
  payment_id: string | null;
};

function createStore() {
  const charges: Charge[] = [
    { id: CHARGE_A, tenant: TENANT_A, amount: 500, status: "open", period: "2026-10" },
    { id: CHARGE_B, tenant: TENANT_B, amount: 700, status: "open", period: "2026-10" },
  ];
  const payments: { id: string; charge_id: string; amount: number; metadata: string }[] = [];
  const submissions: Submission[] = [];
  const documents: { id: string; r2_key: string; label: string }[] = [];
  const notifications: unknown[][] = [];
  const objects = new Map<string, Uint8Array>();

  const paid = (chargeId: string) =>
    payments.filter((row) => row.charge_id === chargeId).reduce((sum, row) => sum + row.amount, 0);

  const unsafe = async (text: string, params: unknown[] = []) => {
    if (text.includes("FROM rent_charges c") && text.includes("l.primary_tenant_id = $3")) {
      const [id, org, tenant] = params as string[];
      const charge = charges.find((row) => row.id === id && row.tenant === tenant && org === ORG);
      if (!charge) return [];
      return [
        {
          amount: charge.amount.toFixed(2),
          amount_paid: paid(id).toFixed(2),
          status: charge.status,
          period: charge.period,
          pending: submissions.filter((row) => row.charge_id === id && row.status === "pending").length,
          first_name: "Ana",
          last_name: "Ruiz",
        },
      ];
    }
    if (text.includes("FROM documents WHERE organization_id")) return [{ file_count: 0, total_bytes: 0 }];
    if (text.includes("INSERT INTO documents")) {
      documents.push({ id: params[0] as string, r2_key: params[3] as string, label: params[8] as string });
      return [];
    }
    if (text.includes("INSERT INTO payment_submissions")) {
      const [id, , tenant_id, charge_id, , amount, paid_on, reference] = params as string[];
      submissions.push({
        id,
        tenant_id,
        charge_id,
        amount,
        paid_on,
        reference,
        status: "pending",
        rejection_reason: null,
        payment_id: null,
      });
      return [];
    }
    if (text.includes("INSERT INTO notifications")) {
      notifications.push(params);
      return [{ id: "n1" }];
    }
    if (text.includes("FROM payment_submissions s") && text.includes("s.tenant_id = $2")) {
      const [, tenant] = params as string[];
      return submissions.filter((row) => row.tenant_id === tenant);
    }
    if (text.includes("FROM payment_submissions") && text.includes("FOR UPDATE")) {
      const row = submissions.find((item) => item.id === params[0] && params[1] === ORG);
      return row ? [row] : [];
    }
    if (text.includes("FROM rent_charges WHERE id = $1") && text.includes("FOR UPDATE")) {
      const charge = charges.find((row) => row.id === params[0]);
      return charge ? [{ amount: charge.amount.toFixed(2), status: charge.status }] : [];
    }
    if (text.includes("SUM(amount)") && text.includes("voided_at IS NULL")) {
      return [{ total: paid(params[0] as string).toFixed(2) }];
    }
    if (text.includes("INSERT INTO payments")) {
      const id = `40000000-0000-4000-8000-${String(payments.length + 1).padStart(12, "0")}`;
      payments.push({
        id,
        charge_id: params[1] as string,
        amount: Number(params[3]),
        metadata: params[7] as string,
      });
      return [{ id }];
    }
    if (text.includes("UPDATE rent_charges")) {
      const charge = charges.find((row) => row.id === params[1]);
      if (charge && Number(params[0]) >= charge.amount) charge.status = "paid";
      return [];
    }
    if (text.includes("SET status = 'approved'")) {
      const row = submissions.find((item) => item.id === params[0]);
      if (row) Object.assign(row, { status: "approved", payment_id: params[3] });
      return [];
    }
    if (text.includes("SET status = 'rejected'")) {
      const row = submissions.find((item) => item.id === params[0] && item.status === "pending");
      if (!row) return [];
      Object.assign(row, { status: "rejected", rejection_reason: params[3] });
      return [{ id: row.id }];
    }
    if (text.includes("FROM payment_submissions")) {
      const row = submissions.find((item) => item.id === params[0]);
      return row ? [row] : [];
    }
    return [];
  };

  const sql = {
    unsafe,
    begin: async (fn: (tx: { unsafe: typeof unsafe }) => Promise<unknown>) => fn({ unsafe }),
  } as unknown as Sql;
  const bucket = {
    put: async (key: string, bytes: Uint8Array) => {
      objects.set(key, bytes);
    },
    delete: async (key: string) => {
      objects.delete(key);
    },
  };
  return { sql, bucket, charges, payments, submissions, documents, notifications, objects };
}

type Store = ReturnType<typeof createStore>;

function appFor(store: Store, who: { tenantId?: string; role?: MembershipRole }) {
  const app = factory.createApp();
  app.use("*", async (c, next) => {
    c.set("sql", store.sql);
    c.set("db", {} as never);
    c.set("orgId", ORG);
    c.set("userId", who.tenantId ? USER_A : STAFF);
    c.set("userEmail", null);
    c.set("role", who.role ?? "viewer");
    c.set("portalTenantId", who.tenantId ?? null);
    await next();
  });
  mountPaymentSubmissionRoutes(app);
  const env = { FILES: store.bucket } as unknown as WorkerBindings;
  return (path: string, init?: RequestInit) => app.request(path, init, env);
}

const PDF = new TextEncoder().encode("%PDF-1.4\n% comprobante de transferencia\n");

function receipt(fields: Record<string, string>, file: Blob | null = new Blob([PDF], { type: "application/pdf" })) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (file) form.set("file", file, "transferencia.pdf");
  return { method: "POST", body: form };
}

const VALID = { amount: "500", paid_on: "2026-10-20", reference: "TRX-991" };

describe("tenant receipts (portal)", () => {
  it("stores the receipt under the tenant's folder and alerts the team", async () => {
    const store = createStore();
    const res = await appFor(store, { tenantId: TENANT_A })(
      `/api/portal/charges/${CHARGE_A}/receipts`,
      receipt(VALID),
    );
    expect(res.status).toBe(201);
    expect(store.submissions).toHaveLength(1);
    expect(store.submissions[0]).toMatchObject({ tenant_id: TENANT_A, amount: "500.00", status: "pending" });
    expect(store.documents[0]?.label).toBe("payment_receipt");
    expect([...store.objects.keys()][0]).toMatch(new RegExp(`^org/${ORG}/tenant/${TENANT_A}/`));
    expect(store.notifications).toHaveLength(1);
    expect(store.payments).toHaveLength(0);
  });

  it("refuses another tenant's charge without storing anything", async () => {
    const store = createStore();
    const res = await appFor(store, { tenantId: TENANT_A })(
      `/api/portal/charges/${CHARGE_B}/receipts`,
      receipt(VALID),
    );
    expect(res.status).toBe(404);
    expect(store.objects.size).toBe(0);
    expect(store.submissions).toHaveLength(0);
  });

  it("refuses an amount above the balance, a fake PDF and a missing file", async () => {
    const store = createStore();
    const request = appFor(store, { tenantId: TENANT_A });
    const path = `/api/portal/charges/${CHARGE_A}/receipts`;
    expect((await request(path, receipt({ ...VALID, amount: "500.01" }))).status).toBe(400);
    const fake = new Blob([new TextEncoder().encode("hola")], { type: "application/pdf" });
    expect((await request(path, receipt(VALID, fake))).status).toBe(400);
    expect((await request(path, receipt(VALID, null))).status).toBe(400);
    expect(store.submissions).toHaveLength(0);
    expect(store.objects.size).toBe(0);
  });

  it("lists only the tenant's own receipts", async () => {
    const store = createStore();
    await appFor(store, { tenantId: TENANT_B })(`/api/portal/charges/${CHARGE_B}/receipts`, receipt(VALID));
    const res = await appFor(store, { tenantId: TENANT_A })("/api/portal/payment-submissions");
    expect(((await res.json()) as { submissions: unknown[] }).submissions).toEqual([]);
  });
});

describe("reviewing receipts (staff)", () => {
  async function submitted() {
    const store = createStore();
    await appFor(store, { tenantId: TENANT_A })(`/api/portal/charges/${CHARGE_A}/receipts`, receipt(VALID));
    return { store, id: store.submissions[0].id, staff: appFor(store, { role: "staff" }) };
  }

  it("approving records one payment marked as coming from the tenant", async () => {
    const { store, id, staff } = await submitted();
    const first = await staff(`/api/payment-submissions/${id}/approve`, { method: "POST" });
    expect(first.status).toBe(200);
    const again = await staff(`/api/payment-submissions/${id}/approve`, { method: "POST" });
    expect(again.status).toBe(409);
    expect(store.payments).toHaveLength(1);
    expect(JSON.parse(store.payments[0].metadata)).toEqual({ source: "tenant_receipt", source_id: id });
    expect(store.submissions[0]).toMatchObject({ status: "approved", payment_id: store.payments[0].id });
    expect(store.charges[0].status).toBe("paid");
  });

  it("keeps the receipt pending when the charge was paid in the meantime", async () => {
    const { store, id, staff } = await submitted();
    store.payments.push({ id: "p0", charge_id: CHARGE_A, amount: 500, metadata: "{}" });
    store.charges[0].status = "paid";
    const res = await staff(`/api/payment-submissions/${id}/approve`, { method: "POST" });
    expect(res.status).toBe(400);
    expect(store.submissions[0].status).toBe("pending");
  });

  it("rejecting needs a reason and closes the receipt", async () => {
    const { store, id, staff } = await submitted();
    const json = (body: unknown) => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect((await staff(`/api/payment-submissions/${id}/reject`, json({ reason: "" }))).status).toBe(400);
    const res = await staff(`/api/payment-submissions/${id}/reject`, json({ reason: "No llegó la transferencia" }));
    expect(res.status).toBe(200);
    expect(store.submissions[0]).toMatchObject({ status: "rejected", rejection_reason: "No llegó la transferencia" });
    expect((await staff(`/api/payment-submissions/${id}/approve`, { method: "POST" })).status).toBe(409);
    expect(store.payments).toHaveLength(0);
  });
});
