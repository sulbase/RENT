import { describe, expect, it } from "vitest";
import { factory } from "../factory";
import type { Sql } from "../db";
import { mountRentRoutes } from "./rent";

const ORG = "10000000-0000-4000-8000-000000000001";
const CHARGE = "50000000-0000-4000-8000-000000000001";
const PAYMENT = "40000000-0000-4000-8000-000000000001";

type Payment = {
  id: string;
  organization_id: string;
  charge_id: string;
  amount: string;
  voided_at: string | null;
  void_reason: string | null;
  voided_by: string | null;
  paid_at: string;
  method: string;
  reference: string | null;
  notes: string | null;
};

function createSql() {
  const charges = [
    {
      id: CHARGE,
      organization_id: ORG,
      amount: "100.00",
      amount_paid: "100.00",
      status: "paid",
    },
  ];
  const payments: Payment[] = [
    {
      id: PAYMENT,
      organization_id: ORG,
      charge_id: CHARGE,
      amount: "100.00",
      voided_at: null,
      void_reason: null,
      voided_by: null,
      paid_at: "2026-09-24T12:00:00.000Z",
      method: "cash",
      reference: null,
      notes: null,
    },
  ];

  const unsafe = async (text: string, params: unknown[] = []) => {
    if (text.includes("FROM rent_charges") && text.includes("FOR UPDATE") && text.includes("amount::text")) {
      const [id, org] = params as [string, string];
      const charge = charges.find((row) => row.id === id && row.organization_id === org);
      return charge ? [{ amount: charge.amount, status: charge.status }] : [];
    }
    if (text.includes("voided_at IS NULL") && text.includes("SUM(amount)")) {
      const [chargeId, org] = params as [string, string];
      const total = payments
        .filter((row) => row.charge_id === chargeId && row.organization_id === org && !row.voided_at)
        .reduce((sum, row) => sum + Number(row.amount), 0);
      return [{ total: total.toFixed(2) }];
    }
    if (text.includes("INSERT INTO payments")) {
      const [org, chargeId, , amount, method, reference, notes] = params as string[];
      payments.push({
        id: "40000000-0000-4000-8000-000000000099",
        organization_id: org,
        charge_id: chargeId,
        amount,
        voided_at: null,
        void_reason: null,
        voided_by: null,
        paid_at: "2026-09-26T12:00:00.000Z",
        method,
        reference,
        notes,
      });
      return [];
    }
    if (text.includes("UPDATE rent_charges")) {
      const [amountPaid, id, org] = params as [string, string, string];
      const charge = charges.find((row) => row.id === id && row.organization_id === org);
      if (charge) {
        charge.amount_paid = amountPaid;
        charge.status = Number(amountPaid) >= Number(charge.amount) ? "paid" : Number(amountPaid) > 0 ? "partial" : "open";
      }
      return [];
    }
    if (text.includes("FROM payments") && text.includes("FOR UPDATE")) {
      const [id, org] = params as [string, string];
      const payment = payments.find((row) => row.id === id && row.organization_id === org);
      return payment ? [{ charge_id: payment.charge_id, voided_at: payment.voided_at }] : [];
    }
    if (text.includes("SET voided_at")) {
      const [id, org, reason, userId] = params as [string, string, string, string];
      const payment = payments.find((row) => row.id === id && row.organization_id === org && !row.voided_at);
      if (payment) {
        payment.voided_at = "2026-09-26T12:00:00.000Z";
        payment.void_reason = reason;
        payment.voided_by = userId;
      }
      return [];
    }
    if (text.includes("SELECT * FROM payments")) {
      const [chargeId, org] = params as [string, string];
      return payments.filter((row) => row.charge_id === chargeId && row.organization_id === org);
    }
    if (text.includes("FROM rent_charges c")) {
      const charge = charges[0];
      return [{ id: charge.id, amount: charge.amount, amount_paid: charge.amount_paid, status: charge.status }];
    }
    return [];
  };

  const sql = {
    unsafe,
    begin: async (fn: (tx: { unsafe: typeof unsafe }) => Promise<unknown>) => fn({ unsafe }),
  };
  return { sql: sql as unknown as Sql, charges, payments };
}

function createApp(sql: Sql) {
  const app = factory.createApp();
  app.use("*", async (c, next) => {
    c.set("sql", sql);
    c.set("db", {} as never);
    c.set("orgId", ORG);
    c.set("userId", "00000000-0000-4000-8000-000000000099");
    c.set("userEmail", null);
    c.set("role", "owner");
    await next();
  });
  mountRentRoutes(app);
  return app;
}

describe("payment void and balance cap", () => {
  it("rejects a payment above the remaining balance", async () => {
    const store = createSql();
    const app = createApp(store.sql);
    const res = await app.request("/api/payments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ charge_id: CHARGE, amount: 1, method: "cash" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "El importe supera el saldo del cargo." });
    expect(store.payments).toHaveLength(1);
  });

  it("voids a payment, keeps it, and frees the charge balance", async () => {
    const store = createSql();
    const app = createApp(store.sql);
    const res = await app.request(`/api/payments/${PAYMENT}/void`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Pago duplicado" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { payments: { void_reason: string }[]; charge: { amount_paid: number; status: string } };
    expect(body.payments[0]?.void_reason).toBe("Pago duplicado");
    expect(store.payments[0]?.voided_at).toBeTruthy();
    expect(store.charges[0]?.amount_paid).toBe("0.00");
    expect(store.charges[0]?.status).toBe("open");
    expect(body.charge.amount_paid).toBe(0);

    const again = await app.request("/api/payments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ charge_id: CHARGE, amount: 100, method: "cash" }),
    });
    expect(again.status).toBe(201);
    expect(store.payments).toHaveLength(2);
  });
});
