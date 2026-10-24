import { describe, expect, it } from "vitest";
import { factory } from "../factory";
import type { Sql } from "../db";
import { signFirmaWebhook } from "../integrations/firma-webhook";
import { mountFirmaWebhookRoute, mountSignatureRoutes } from "./signatures";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const LEASE_B = "30000000-0000-4000-8000-000000000010";

function leaseSql(): Sql {
  const unsafe = async (text: string, params: unknown[] = []) => {
    if (text.includes("FROM leases")) {
      const [id, org] = params as string[];
      if (id === LEASE_B && org === ORG_B) {
        return [
          {
            id: LEASE_B,
            start_date: "2026-01-01",
            end_date: "2026-12-31",
            monthly_rent: "1000.00",
            unit_name: "1A",
            property_name: "Centro",
          },
        ];
      }
      return [];
    }
    if (text.includes("lease_signatures") || text.includes("lease_signature_recipients")) return [];
    return [];
  };
  return { unsafe } as unknown as Sql;
}

function signatureApp(orgId: string) {
  const app = factory.createApp();
  app.use("*", async (c, next) => {
    c.set("sql", leaseSql());
    c.set("db", {} as never);
    c.set("orgId", orgId);
    c.set("userId", "00000000-0000-4000-8000-000000000099");
    c.set("userEmail", null);
    c.set("role", "owner");
    await next();
  });
  mountSignatureRoutes(app, {
    firma: {
      async createAndSend() {
        throw new Error("firma should not be called");
      },
      async cancel() {},
      async resend() {},
      async download() {
        return { status: "finished", isPartial: false, downloadUrl: "https://example.test/pdf" };
      },
    },
  });
  return app;
}

describe("lease signature org isolation", () => {
  it("returns 404 for a lease owned by another organization", async () => {
    const res = await signatureApp(ORG_A).request(`/api/leases/${LEASE_B}/signature`);
    expect(res.status).toBe(404);
  });

  it("rejects an inventory signature that has no uploaded PDF", async () => {
    const res = await signatureApp(ORG_B).request(`/api/leases/${LEASE_B}/signature`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "inventory",
        recipients: [
          { first_name: "Ana", last_name: "Lopez", email: "ana@example.com", role: "tenant" },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns an empty list for the owning organization", async () => {
    const res = await signatureApp(ORG_B).request(`/api/leases/${LEASE_B}/signature`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { signatures: unknown[] };
    expect(body.signatures).toEqual([]);
  });
});

describe("firma webhook route", () => {
  it("rejects a manipulated signature", async () => {
    const app = factory.createApp();
    app.use("*", async (c, next) => {
      c.set("sql", { unsafe: async () => [] } as unknown as Sql);
      c.set("db", {} as never);
      c.set("orgId", ORG_A);
      c.set("userId", null);
      c.set("userEmail", null);
      c.set("role", "owner");
      await next();
    });
    mountFirmaWebhookRoute(app);
    const raw = JSON.stringify({ type: "signing_request.completed", data: { signing_request: { id: "sr" } } });
    const header = await signFirmaWebhook("expected-secret", raw, Math.floor(Date.now() / 1000));
    const res = await app.request(
      "/api/webhooks/firma",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Firma-Signature": header,
          "X-Firma-Delivery": "del_1",
        },
        body: `${raw} `,
      },
      { FIRMA_WEBHOOK_SECRET: "expected-secret" },
    );
    expect(res.status).toBe(401);
  });
});
