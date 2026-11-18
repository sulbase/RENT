import { describe, expect, it } from "vitest";
import { factory } from "../factory";
import type { Sql } from "../db";
import { mountTenantsRoutes } from "./tenants";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const TENANT_A = "30000000-0000-4000-8000-000000000010";

function createSql() {
  const unsafe = async (text: string, params: unknown[] = []) => {
    if (text.includes("FROM tenants")) {
      const [id, org] = params as [string, string];
      return id === TENANT_A && org === ORG_A ? [{ id }] : [];
    }
    if (text.includes("FROM tenant_emergency_contacts")) {
      const [org, tenant] = params as [string, string];
      if (org !== ORG_A || tenant !== TENANT_A) return [];
      return [
        {
          id: "c1",
          name: "Ana Ruiz",
          relationship: "Madre",
          phone: "+52 3311111111",
          metadata: { first_name: "Ana", last_name: "Ruiz" },
        },
      ];
    }
    if (text.includes("FROM tenant_vehicles")) {
      const [org, tenant] = params as [string, string];
      if (org !== ORG_A || tenant !== TENANT_A) return [];
      return [
        {
          id: "v1",
          lease_id: "lease-a",
          year: 2020,
          make: "Toyota",
          model: "Corolla",
          color: "Blanco",
          vehicle_type: "Automóvil",
          plate_state: "JAL",
          license_number: "ABC123",
        },
      ];
    }
    return [];
  };
  return { unsafe } as unknown as Sql;
}

function createApp(orgId: string) {
  const app = factory.createApp();
  app.use("*", async (c, next) => {
    c.set("sql", createSql());
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

describe("tenant household", () => {
  it("returns the tenant's contacts and vehicles", async () => {
    const res = await createApp(ORG_A).request(`/api/tenants/${TENANT_A}/household`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      contacts: { first_name: string }[];
      vehicles: { license_number: string }[];
    };
    expect(body.contacts[0]?.first_name).toBe("Ana");
    expect(body.vehicles[0]?.license_number).toBe("ABC123");
  });

  it("does not show another organization's household", async () => {
    const res = await createApp(ORG_B).request(`/api/tenants/${TENANT_A}/household`);
    expect(res.status).toBe(404);
  });
});
