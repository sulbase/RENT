import { describe, expect, it } from "vitest";
import { factory } from "../factory";
import type { Sql } from "../db";
import { mountLeasesRoutes } from "./leases";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const LEASE_A = "40000000-0000-4000-8000-000000000010";
const VEHICLE_A = "50000000-0000-4000-8000-000000000001";
const VEHICLE_OTHER = "50000000-0000-4000-8000-000000000002";

function createSql() {
  const vehicles: { license_number: string }[] = [
    {
      license_number: "ABC123",
    },
  ];
  const unsafe = async (text: string, params: unknown[] = []) => {
    if (text.includes("DELETE FROM tenant_vehicles")) {
      const [vehicleId, org, leaseId] = params as string[];
      if (org !== ORG_A || leaseId !== LEASE_A || vehicleId !== VEHICLE_A) return [];
      return [{ id: vehicleId }];
    }
    if (text.includes("INSERT INTO tenant_vehicles")) {
      const [org, , leaseId, , , , , , , plate] = params as string[];
      if (org !== ORG_A || leaseId !== LEASE_A) return [];
      if (vehicles.length >= 3) return [];
      vehicles.push({ license_number: plate });
      return [{ id: "v-new", year: 2021, make: "Nissan", model: "Versa", color: "", vehicle_type: "Automóvil", plate_state: "JAL", license_number: plate }];
    }
    if (text.includes("primary_tenant_id FROM leases")) {
      const [id, org] = params as [string, string];
      return id === LEASE_A && org === ORG_A ? [{ primary_tenant_id: "tenant-a" }] : [];
    }
    if (text.includes("FROM leases") && text.includes("SELECT id")) {
      const [id, org] = params as [string, string];
      return id === LEASE_A && org === ORG_A ? [{ id }] : [];
    }
    if (text.includes("FROM tenant_vehicles")) {
      const [org, leaseId] = params as [string, string];
      if (org !== ORG_A || leaseId !== LEASE_A) return [];
      return [
        {
          id: "v1",
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
  mountLeasesRoutes(app);
  return app;
}

describe("lease vehicles", () => {
  it("lists vehicles of the lease", async () => {
    const res = await createApp(ORG_A).request(`/api/leases/${LEASE_A}/vehicles`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { vehicles: { license_number: string }[] };
    expect(body.vehicles[0]?.license_number).toBe("ABC123");
  });

  it("hides vehicles from another organization", async () => {
    const res = await createApp(ORG_B).request(`/api/leases/${LEASE_A}/vehicles`);
    expect(res.status).toBe(404);
  });

  it("lets staff register a vehicle on the lease", async () => {
    const res = await createApp(ORG_A).request(`/api/leases/${LEASE_A}/vehicles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year: 2021,
        vehicle_type: "Automóvil",
        plate_state: "JAL",
        license_number: "XYZ999",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { vehicle: { license_number: string } };
    expect(body.vehicle.license_number).toBe("XYZ999");
  });

  it("removes a vehicle that belongs to the lease", async () => {
    const gone = await createApp(ORG_A).request(`/api/leases/${LEASE_A}/vehicles/${VEHICLE_OTHER}`, {
      method: "DELETE",
    });
    expect(gone.status).toBe(404);

    const removed = await createApp(ORG_A).request(`/api/leases/${LEASE_A}/vehicles/${VEHICLE_A}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
  });
});
