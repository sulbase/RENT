import { describe, expect, it } from "vitest";
import { factory } from "../factory";
import type { Sql } from "../db";
import { mountTenantsRoutes } from "./tenants";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const TENANT_A = "30000000-0000-4000-8000-000000000010";
const TENANT_B = "30000000-0000-4000-8000-000000000011";

type PaymentRow = {
  organization_id: string;
  primary_tenant_id: string;
  id: string;
  charge_id: string;
  paid_at: string;
  amount: string;
  method: string;
  reference: string | null;
  notes: string | null;
  period: string;
  due_date: string;
  charge_amount: string;
  charge_status: string;
  lease_id: string;
  lease_status: string;
  unit_name: string;
  property_name: string;
};

function createSql(
  tenants: { id: string; organization_id: string }[],
  payments: PaymentRow[],
) {
  const unsafe = async (text: string, params: unknown[] = []) => {
    if (text.includes("FROM payments")) {
      const [org, tenantId] = params as [string, string];
      return payments
        .filter((row) => row.organization_id === org && row.primary_tenant_id === tenantId)
        .map(({ organization_id: _org, primary_tenant_id: _tenant, ...row }) => row);
    }
    if (text.includes("FROM tenants")) {
      const [id, org] = params as [string, string];
      const found = tenants.find((tenant) => tenant.id === id && tenant.organization_id === org);
      return found ? [{ id }] : [];
    }
    return [];
  };
  return { unsafe } as unknown as Sql;
}

function createApp(orgId: string, sql: Sql) {
  const app = factory.createApp();
  app.use("*", async (c, next) => {
    c.set("sql", sql);
    c.set("db", {} as never);
    c.set("orgId", orgId);
    c.set("userId", "00000000-0000-4000-8000-000000000099");
    c.set("userEmail", null);
    c.set("role", "owner");
    await next();
  });
  mountTenantsRoutes(app);
  return app;
}

describe("tenant payment history", () => {
  const tenants = [
    { id: TENANT_A, organization_id: ORG_A },
    { id: TENANT_B, organization_id: ORG_B },
  ];
  const payments: PaymentRow[] = [
    {
      organization_id: ORG_A,
      primary_tenant_id: TENANT_A,
      id: "40000000-0000-4000-8000-000000000001",
      charge_id: "50000000-0000-4000-8000-000000000001",
      paid_at: "2026-03-02T12:00:00.000Z",
      amount: "1500.00",
      method: "ach",
      reference: "SPEI-1",
      notes: null,
      period: "2026-03",
      due_date: "2026-03-01",
      charge_amount: "1500.00",
      charge_status: "paid",
      lease_id: "60000000-0000-4000-8000-000000000001",
      lease_status: "active",
      unit_name: "101",
      property_name: "Centro",
    },
    {
      organization_id: ORG_B,
      primary_tenant_id: TENANT_B,
      id: "40000000-0000-4000-8000-000000000002",
      charge_id: "50000000-0000-4000-8000-000000000002",
      paid_at: "2026-03-02T12:00:00.000Z",
      amount: "9000.00",
      method: "cash",
      reference: null,
      notes: null,
      period: "2026-03",
      due_date: "2026-03-01",
      charge_amount: "9000.00",
      charge_status: "paid",
      lease_id: "60000000-0000-4000-8000-000000000002",
      lease_status: "active",
      unit_name: "2",
      property_name: "Otra org",
    },
  ];

  it("returns payments of leases where the tenant is the primary holder", async () => {
    const app = createApp(ORG_A, createSql(tenants, payments));
    const res = await app.request(`/api/tenants/${TENANT_A}/payments`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { payments: { id: string; amount: number; property_name: string }[] };
    expect(body.payments).toEqual([
      expect.objectContaining({
        id: "40000000-0000-4000-8000-000000000001",
        amount: 1500,
        charge_amount: 1500,
        property_name: "Centro",
        unit_name: "101",
        period: "2026-03",
      }),
    ]);
  });

  it("hides another organization's payments and unknown tenants", async () => {
    const app = createApp(ORG_A, createSql(tenants, payments));
    const foreign = await app.request(`/api/tenants/${TENANT_B}/payments`);
    expect(foreign.status).toBe(404);

    const missing = await app.request(
      "/api/tenants/30000000-0000-4000-8000-000000000099/payments",
    );
    expect(missing.status).toBe(404);
  });
});
