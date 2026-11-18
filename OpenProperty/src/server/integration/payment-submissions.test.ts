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
const CHARGE_A2 = "50000000-0000-4000-8000-00000000000c";
const CHARGE_B = "50000000-0000-4000-8000-00000000000b";
const LEASE_A = "40000000-0000-4000-8000-00000000000a";
const UNIT_A = "41000000-0000-4000-8000-00000000000a";

type Charge = {
  id: string;
  tenant: string;
  lease_id: string;
  amount: number;
  status: string;
  period: string;
};
type Submission = {
  id: string;
  tenant_id: string;
  charge_id: string;
  document_id: string | null;
  amount: string;
  paid_on: string;
  reference: string | null;
  status: string;
  rejection_reason: string | null;
  payment_id: string | null;
};

function createStore() {
  const charges: Charge[] = [
    { id: CHARGE_A, tenant: TENANT_A, lease_id: "lease-a", amount: 500, status: "open", period: "2026-10" },
    { id: CHARGE_A2, tenant: TENANT_A, lease_id: "lease-a", amount: 400, status: "open", period: "2026-11" },
    { id: CHARGE_B, tenant: TENANT_B, lease_id: "lease-b", amount: 700, status: "open", period: "2026-10" },
  ];
  const payments: {
    id: string;
    charge_id: string;
    amount: number;
    metadata: string;
    voided_at: string | null;
    void_reason: string | null;
  }[] = [];
  const submissions: Submission[] = [];
  const documents: {
    id: string;
    r2_key: string;
    label: string;
    filename: string;
    mime: string;
    size_bytes: number;
  }[] = [];
  const notifications: unknown[][] = [];
  let reads = 0;
  const claimed = new Set<string>();
  const objects = new Map<string, Uint8Array>();

  const paid = (chargeId: string) =>
    payments.filter((row) => row.charge_id === chargeId).reduce((sum, row) => sum + row.amount, 0);

  const unsafe = async (text: string, params: unknown[] = []) => {
    if (text.includes("c.id = ANY")) {
      const tenant = params[1] as string;
      const ids = params[2] as string[];
      return charges
        .filter((row) => params[0] === ORG && row.tenant === tenant && ids.includes(row.id))
        .map((charge) => {
          const pendingRows = submissions.filter(
            (row) => row.charge_id === charge.id && row.status === "pending",
          );
          return {
            id: charge.id,
            lease_id: charge.lease_id,
            amount: charge.amount.toFixed(2),
            amount_paid: paid(charge.id).toFixed(2),
            status: charge.status,
            period: charge.period,
            pending: pendingRows.length,
            pending_amount: pendingRows.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2),
            first_name: "Ana",
            last_name: "Ruiz",
          };
        });
    }
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
    if (text.includes("FROM leases l") && text.includes("primary_tenant_id")) {
      const [id, org, tenant] = params as string[];
      if (org === ORG && tenant === TENANT_A && id === LEASE_A) return [{ unit_id: UNIT_A }];
      return [];
    }
    if (text.includes("receipt_read_quotas")) {
      if (reads >= 5) return [];
      reads += 1;
      return [{ calls: reads }];
    }
    if (text.includes("FROM settings")) {
      if (params[0] !== ORG) return [];
      return [
        { key: "bank_account", value: "000000000000009012" },
        { key: "bank_clabe", value: "" },
      ];
    }
    if (text.includes("FROM documents WHERE organization_id")) return [{ file_count: 0, total_bytes: 0 }];
    if (text.includes("INSERT INTO documents")) {
      documents.push({
        id: params[0] as string,
        r2_key: params[3] as string,
        label: params[8] as string,
        filename: params[4] as string,
        mime: params[5] as string,
        size_bytes: Number(params[6]),
      });
      return [];
    }
    if (text.includes("INSERT INTO receipt_number_claims")) {
      const key = String(params[1]);
      if (claimed.has(key)) return [];
      claimed.add(key);
      return [{ receipt_number: key }];
    }
    if (text.includes("DELETE FROM receipt_number_claims")) {
      claimed.clear();
      return [];
    }
    if (text.includes("INSERT INTO payment_submissions")) {
      const [id, , tenant_id, charge_id, document_id, amount, paid_on, reference] = params as string[];
      submissions.push({
        id,
        tenant_id,
        charge_id,
        document_id,
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
    if (text.includes("s.tenant_id = $3") && text.includes("JOIN documents d")) {
      const [subId, org, tenant] = params as string[];
      if (org !== ORG) return [];
      const sub = submissions.find((row) => row.id === subId && row.tenant_id === tenant);
      if (!sub?.document_id) return [];
      const doc = documents.find((row) => row.id === sub.document_id);
      return doc
        ? [
            {
              r2_key: doc.r2_key,
              filename: doc.filename,
              mime: doc.mime,
              size_bytes: doc.size_bytes,
            },
          ]
        : [];
    }
    if (text.includes("FROM payment_submissions s") && text.includes("s.tenant_id = $2")) {
      const [, tenant] = params as string[];
      return submissions
        .filter((row) => row.tenant_id === tenant)
        .map((row) => {
          const charge = charges.find((item) => item.id === row.charge_id);
          const payment = row.payment_id ? payments.find((item) => item.id === row.payment_id) : null;
          const doc = row.document_id ? documents.find((item) => item.id === row.document_id) : null;
          return {
            ...row,
            period: charge?.period ?? "",
            payment_voided_at: payment?.voided_at ?? null,
            payment_void_reason: payment?.void_reason ?? null,
            document_filename: doc?.filename ?? null,
            document_mime: doc?.mime ?? null,
          };
        });
    }
    if (text.includes("s.document_id = $2") && text.includes("FOR UPDATE")) {
      const documentId = params[1] as string;
      return submissions
        .filter((row) => row.document_id === documentId && row.status === "pending")
        .map((row) => ({
          ...row,
          period: charges.find((charge) => charge.id === row.charge_id)?.period ?? "",
        }));
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
        voided_at: null,
        void_reason: null,
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
      const anchor = submissions.find((item) => item.id === params[0]);
      if (!anchor || anchor.status !== "pending") return [];
      const targets = anchor.document_id
        ? submissions.filter((item) => item.document_id === anchor.document_id && item.status === "pending")
        : [anchor];
      for (const row of targets) {
        Object.assign(row, { status: "rejected", rejection_reason: params[3] });
      }
      return targets.map((row) => ({ id: row.id }));
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
    get: async (key: string) => {
      const body = objects.get(key);
      return body ? { body } : null;
    },
    delete: async (key: string) => {
      objects.delete(key);
    },
  };
  return { sql, bucket, charges, payments, submissions, documents, notifications, objects };
}

type Store = ReturnType<typeof createStore>;

let nextRateIp = 1;

function appFor(store: Store, who: { tenantId?: string; role?: MembershipRole }) {
  const ip = `10.1.0.${nextRateIp++}`;
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
  const env = { FILES: store.bucket, GEMINI_API_KEY: "test-key" } as unknown as WorkerBindings;
  return (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("x-forwarded-for", ip);
    return app.request(path, { ...init, headers }, env);
  };
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

  it("splits one transfer across the oldest rents and reviews the whole receipt at once", async () => {
    const store = createStore();
    const tenant = appFor(store, { tenantId: TENANT_A });
    const sent = await tenant(
      "/api/portal/receipts",
      receipt({
        charge_ids: JSON.stringify([CHARGE_A2, CHARGE_A]),
        amount: "700",
        paid_on: "2026-11-02",
        payer_bank_name: "BBVA",
        receipt_number: "99",
        reference: "TRX-700",
      }),
    );
    expect(sent.status).toBe(201);
    expect(store.submissions.map((row) => [row.charge_id, row.amount])).toEqual([
      [CHARGE_A, "500.00"],
      [CHARGE_A2, "200.00"],
    ]);
    expect(new Set(store.submissions.map((row) => row.document_id)).size).toBe(1);

    const staff = appFor(store, { role: "staff" });
    const approved = await staff(`/api/payment-submissions/${store.submissions[1].id}/approve`, {
      method: "POST",
    });
    expect(approved.status).toBe(200);
    expect(store.payments.map((row) => [row.charge_id, row.amount])).toEqual([
      [CHARGE_A, 500],
      [CHARGE_A2, 200],
    ]);
    expect(store.submissions.every((row) => row.status === "approved")).toBe(true);
    expect(store.charges.find((row) => row.id === CHARGE_A)?.status).toBe("paid");
    expect(store.charges.find((row) => row.id === CHARGE_A2)?.status).toBe("open");
  });

  it("refuses a receipt number already used by another file", async () => {
    const store = createStore();
    const tenant = appFor(store, { tenantId: TENANT_A });
    const fields = {
      paid_on: "2026-11-02",
      payer_bank_name: "BBVA",
      receipt_number: "70951710",
      reference: "TRX",
    };
    const first = await tenant(
      "/api/portal/receipts",
      receipt({ ...fields, charge_ids: JSON.stringify([CHARGE_A]), amount: "500" }),
    );
    expect(first.status).toBe(201);
    const again = await tenant(
      "/api/portal/receipts",
      receipt({ ...fields, charge_ids: JSON.stringify([CHARGE_A2]), amount: "400" }),
    );
    expect(again.status).toBe(409);
    expect(store.submissions).toHaveLength(1);
  });

  it("lists only the tenant's own receipts", async () => {
    const store = createStore();
    await appFor(store, { tenantId: TENANT_B })(`/api/portal/charges/${CHARGE_B}/receipts`, receipt(VALID));
    const res = await appFor(store, { tenantId: TENANT_A })("/api/portal/payment-submissions");
    expect(((await res.json()) as { submissions: unknown[] }).submissions).toEqual([]);
  });

  it("lists voided payments on approved submissions and serves the receipt file", async () => {
    const store = createStore();
    const tenant = appFor(store, { tenantId: TENANT_A });
    await tenant(`/api/portal/charges/${CHARGE_A}/receipts`, receipt(VALID));
    const id = store.submissions[0].id;
    await appFor(store, { role: "staff" })(`/api/payment-submissions/${id}/approve`, { method: "POST" });
    store.payments[0].voided_at = "2026-09-26T12:00:00.000Z";
    store.payments[0].void_reason = "Pago duplicado";

    const list = await tenant("/api/portal/payment-submissions");
    const body = (await list.json()) as {
      submissions: { payment_voided_at: string; payment_void_reason: string }[];
    };
    expect(body.submissions[0]).toMatchObject({
      payment_voided_at: "2026-09-26T12:00:00.000Z",
      payment_void_reason: "Pago duplicado",
    });

    const file = await tenant(`/api/portal/payment-submissions/${id}/document`);
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Type")).toBe("application/pdf");
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
    store.payments.push({
      id: "p0",
      charge_id: CHARGE_A,
      amount: 500,
      metadata: "{}",
      voided_at: null,
      void_reason: null,
    });
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

  it("rejecting one line of a transfer rejects every month in that receipt", async () => {
    const store = createStore();
    const sent = await appFor(store, { tenantId: TENANT_A })(
      "/api/portal/receipts",
      receipt({
        charge_ids: JSON.stringify([CHARGE_A, CHARGE_A2]),
        amount: "900",
        paid_on: "2026-11-02",
        payer_bank_name: "BBVA",
        receipt_number: "99",
        reference: "TRX-900",
      }),
    );
    expect(sent.status).toBe(201);
    const staff = appFor(store, { role: "staff" });
    const res = await staff(`/api/payment-submissions/${store.submissions[0].id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "La referencia no coincide" }),
    });
    expect(res.status).toBe(200);
    expect(store.submissions).toHaveLength(2);
    expect(store.submissions.every((row) => row.status === "rejected")).toBe(true);
    expect(store.payments).toHaveLength(0);
  });

  it("reads a one-page receipt and refuses a destination account from another organization", async () => {
    const store = createStore();
    const tenant = appFor(store, { tenantId: TENANT_A });
    const many = new Blob([new TextEncoder().encode("%PDF-1.4\n<< /Type /Pages /Count 2 >>")], {
      type: "application/pdf",
    });
    const rejected = await tenant("/api/portal/receipts/read", receipt({}, many));
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: "El comprobante debe ser de una sola página" });

    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      amount: 500,
                      paid_on: "2026-10-20",
                      payer_bank_name: "BBVA",
                      receipt_number: "99",
                      reference: "TRX",
                      destination_account_digits: "1111",
                    }),
                  },
                ],
              },
            },
          ],
        }),
      )) as typeof fetch;
    try {
      const one = new Blob([new TextEncoder().encode("%PDF-1.4\n<< /Type /Page >>")], { type: "application/pdf" });
      const mismatch = await tenant("/api/portal/receipts/read", receipt({ lease_id: LEASE_A }, one));
      expect(mismatch.status).toBe(422);
      expect(((await mismatch.json()) as { error: string }).error).toContain("no coincide");
    } finally {
      globalThis.fetch = original;
    }
    expect(store.submissions).toHaveLength(0);
  });
});
