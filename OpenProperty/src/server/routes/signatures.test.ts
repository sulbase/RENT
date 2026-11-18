import { describe, expect, it } from "vitest";
import { factory } from "../factory";
import type { Sql } from "../db";
import type { FirmaClient } from "../integrations/firma";
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
            deposit: "500.00",
            rent_due_day: 5,
            late_fee: "25.00",
            unit_name: "1A",
            property_name: "Centro",
            tenant_first_name: "Ana",
            tenant_last_name: "Núñez",
            tenant_government_id: null,
          },
        ];
      }
      return [];
    }
    if (text.includes("FROM settings")) {
      const [org] = params as string[];
      if (org !== ORG_B) return [];
      return [
        { key: "landlord_first_name", value: "José" },
        { key: "landlord_last_name", value: "Pérez" },
      ];
    }
    if (text.includes("FROM documents")) return [];
    if (text.includes("lease_signatures") || text.includes("lease_signature_recipients")) return [];
    return [];
  };
  return { unsafe } as unknown as Sql;
}

function signatureApp(orgId: string, firma?: Partial<FirmaClient>) {
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
      ...firma,
    } as FirmaClient,
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

  it("hides the contract preview from another organization", async () => {
    const res = await signatureApp(ORG_A).request(`/api/leases/${LEASE_B}/signature/preview`);
    expect(res.status).toBe(404);
  });

  it("refuses to preview a document that is not on this lease", async () => {
    const res = await signatureApp(ORG_B).request(
      `/api/leases/${LEASE_B}/signature/preview?document_id=40000000-0000-4000-8000-000000000001`,
    );
    expect(res.status).toBe(404);
  });

  it("previews the built-in contract as the PDF that would be signed", async () => {
    const res = await signatureApp(ORG_B).request(`/api/leases/${LEASE_B}/signature/preview`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const text = await res.text();
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Encoding /WinAnsiEncoding");
    expect(text).toContain("CONTRATO DE ARRENDAMIENTO");
    expect(text).toContain("(Jos\\351 P\\351rez)");
    expect(text).toContain("(Ana N\\372\\361ez)");
    expect(text).toContain("$1,000.00");
    expect(text).toContain("$500.00");
    expect(text).toContain("$25.00");
    expect(text).toContain("FIRMAS");
  });

  it("puts the signature fields on the contract's last page", async () => {
    const calls: { pdf: Uint8Array; signaturePage?: number }[] = [];
    const app = signatureApp(ORG_B, {
      async createAndSend(input) {
        calls.push({ pdf: input.pdf, signaturePage: input.signaturePage });
        return { id: "sr_1", status: "sent", recipients: [] };
      },
    });
    const res = await app.request(`/api/leases/${LEASE_B}/signature`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recipients: [
          { first_name: "José", last_name: "Pérez", email: "jose@example.com", role: "owner" },
          { first_name: "Ana", last_name: "Núñez", email: "ana@example.com", role: "tenant" },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const pdf = new TextDecoder().decode(calls[0]?.pdf);
    const pages = pdf.match(/\/Type \/Page /g)?.length ?? 0;
    expect(pages).toBeGreaterThan(1);
    expect(calls[0]?.signaturePage).toBe(pages);
  });

  it("returns an empty list for the owning organization", async () => {
    const res = await signatureApp(ORG_B).request(`/api/leases/${LEASE_B}/signature`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { signatures: unknown[] };
    expect(body.signatures).toEqual([]);
  });
});

describe("signature sync with firma.dev", () => {
  const SIGNATURE = "50000000-0000-4000-8000-000000000001";

  function syncApp(orgId: string, finished: boolean) {
    const state = {
      status: "sent",
      documentId: null as string | null,
      inserted: 0,
      notified: 0,
      notificationText: "",
    };
    const base = leaseSql();
    const sql = {
      unsafe: async (text: string, params: unknown[] = []) => {
        if (text.includes("FROM lease_signatures") && text.includes("provider_request_id IS NOT NULL")) {
          const [org, lease] = params as string[];
          if (org !== ORG_B || lease !== LEASE_B) return [];
          return [
            {
              id: SIGNATURE,
              organization_id: ORG_B,
              lease_id: LEASE_B,
              purpose: "lease",
              provider_request_id: "sr_1",
              status: state.status,
              document_id: state.documentId,
            },
          ];
        }
        if (text.includes("COUNT(*)::int AS file_count")) return [{ file_count: 0, total_bytes: 0 }];
        if (text.includes("INSERT INTO documents")) {
          state.inserted += 1;
          return [];
        }
        if (text.includes("SET document_id = $2")) {
          state.documentId = String(params[1]);
          return [{ id: SIGNATURE }];
        }
        if (text.includes("SET status = 'completed'")) {
          state.status = "completed";
          return [];
        }
        if (text.includes("INSERT INTO notifications")) {
          state.notified += 1;
          state.notificationText = params.map(String).join(" | ");
          return [{ id: "n1" }];
        }
        if (text.includes("SELECT document_id, last_error")) {
          return [{ document_id: state.documentId, last_error: null }];
        }
        return base.unsafe(text, params as never[]);
      },
    } as unknown as Sql;
    const objects = new Map<string, Uint8Array>();
    const bucket = {
      async put(key: string, value: Uint8Array) {
        objects.set(key, value);
      },
      async delete(key: string) {
        objects.delete(key);
      },
    };
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
    mountSignatureRoutes(app, {
      firma: {
        async download() {
          return finished
            ? { status: "finished", isPartial: false, downloadUrl: "https://firma.test/signed.pdf" }
            : { status: "in_progress", isPartial: true, downloadUrl: "https://firma.test/draft.pdf" };
        },
      } as unknown as FirmaClient,
      fetch: (async () =>
        new Response(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), {
          status: 200,
        })) as unknown as typeof fetch,
    });
    const request = (path: string) =>
      app.request(path, { method: "POST" }, { FILES: bucket, FIRMA_API_KEY: "key" } as never);
    return { request, state, objects };
  }

  it("does not sync another organization's contract", async () => {
    const { request, state } = syncApp(ORG_A, true);
    const res = await request(`/api/leases/${LEASE_B}/signature/sync?purpose=lease`);
    expect(res.status).toBe(404);
    expect(state.inserted).toBe(0);
  });

  it("leaves the request open while signatures are missing", async () => {
    const { request, state } = syncApp(ORG_B, false);
    const res = await request(`/api/leases/${LEASE_B}/signature/sync?purpose=lease`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { completed: boolean };
    expect(body.completed).toBe(false);
    expect(state.status).toBe("sent");
    expect(state.inserted).toBe(0);
  });

  it("archives the signed PDF once both parties signed", async () => {
    const { request, state, objects } = syncApp(ORG_B, true);
    const res = await request(`/api/leases/${LEASE_B}/signature/sync?purpose=lease`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { completed: boolean; document_id: string | null };
    expect(body.completed).toBe(true);
    expect(body.document_id).toBe(state.documentId);
    expect(state.status).toBe("completed");
    expect(state.inserted).toBe(1);
    expect(state.notified).toBe(1);
    expect(state.notificationText).toContain("Centro · 1A");
    expect([...objects.keys()][0]?.startsWith(`org/${ORG_B}/lease/${LEASE_B}/`)).toBe(true);
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
