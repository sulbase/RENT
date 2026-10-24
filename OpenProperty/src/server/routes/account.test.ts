import { describe, expect, it } from "vitest";
import { factory } from "../factory";
import type { AppDb, Sql } from "../db";
import { settingsPatchSchema } from "../schemas/common";
import { normalizeSettingEntries } from "../settings/preferences";
import { mountAccountRoutes } from "./account";
import { mountMemberRoutes } from "./members";

const USER = "00000000-0000-4000-8000-000000000099";
const ORG = "10000000-0000-4000-8000-000000000001";

function sqlThatMustNotRun(): Sql {
  const fail = async () => {
    throw new Error("organization query should not run");
  };
  return { unsafe: fail, begin: fail } as unknown as Sql;
}

describe("GET /api/account", () => {
  it("returns the JWT user and does not read an organization from the client", async () => {
    const app = factory.createApp();
    app.use("*", async (c, next) => {
      c.set("sql", sqlThatMustNotRun());
      c.set("db", {} as AppDb);
      c.set("orgId", ORG);
      c.set("userId", USER);
      c.set("userEmail", "ana@example.com");
      c.set("role", "viewer");
      await next();
    });
    mountAccountRoutes(app);

    const res = await app.request("/api/account", {
      headers: { "X-Organization-Id": "20000000-0000-4000-8000-000000000002" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; email: string } };
    expect(body.user).toEqual({ id: USER, email: "ana@example.com" });
  });
});

describe("member routes", () => {
  it("rejects staff before touching membership rows", async () => {
    const app = factory.createApp();
    app.use("*", async (c, next) => {
      c.set("sql", sqlThatMustNotRun());
      c.set("db", {} as AppDb);
      c.set("orgId", ORG);
      c.set("userId", USER);
      c.set("userEmail", "ana@example.com");
      c.set("role", "staff");
      await next();
    });
    mountMemberRoutes(app);

    const res = await app.request("/api/settings/members");
    expect(res.status).toBe(403);
  });
});

describe("organization settings", () => {
  it("rejects unknown keys", () => {
    const parsed = settingsPatchSchema.safeParse({ currency: "MXN", injected: "1" });
    expect(parsed.success).toBe(false);
  });

  it("normalizes locale values", () => {
    const parsed = settingsPatchSchema.parse({
      currency: "mxn",
      language: "es",
      area_unit: "m2",
      timezone: "America/Mexico_City",
    });
    const normalized = normalizeSettingEntries(parsed);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.entries).toContainEqual(["currency", "MXN"]);
      expect(normalized.entries).toContainEqual(["area_unit", "m2"]);
    }
  });

  it("stores the landlord used on lease signatures", () => {
    const parsed = settingsPatchSchema.parse({
      landlord_first_name: "Ana",
      landlord_last_name: "Lopez",
      landlord_email: "Ana@Example.com",
      landlord_government_id: "LOPA800101HDFXXX01",
    });
    const normalized = normalizeSettingEntries(parsed);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.entries).toContainEqual(["landlord_email", "ana@example.com"]);
      expect(normalized.entries).toContainEqual(["landlord_government_id", "LOPA800101HDFXXX01"]);
    }
  });
});
