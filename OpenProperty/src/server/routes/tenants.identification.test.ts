import { describe, expect, it } from "vitest";
import type { R2Bucket } from "@cloudflare/workers-types";
import { factory } from "../factory";
import type { Sql } from "../db";
import { mountTenantsRoutes } from "./tenants";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const TENANT_A = "30000000-0000-4000-8000-000000000010";
const TENANT_B = "30000000-0000-4000-8000-000000000011";

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const PDF_BYTES = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

type Doc = {
  id: string;
  organization_id: string;
  entity_id: string;
  r2_key: string;
  filename: string;
  mime: string;
  size_bytes: number;
  label: string | null;
  deleted_at: string | null;
  created_at: string;
};

function createBucket() {
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    objects,
    async put(key: string, value: Uint8Array | ArrayBuffer) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      objects.set(key, bytes);
    },
    async get(key: string) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return { body: new Response(body).body, size: bytes.byteLength };
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  return bucket;
}

function createSql(tenants: { id: string; organization_id: string }[]) {
  const docs: Doc[] = [];
  const unsafe = async (text: string, params: unknown[] = []) => {
    if (text.includes("SELECT id FROM tenants")) {
      const [id, org] = params as [string, string];
      const found = tenants.find((tenant) => tenant.id === id && tenant.organization_id === org);
      return found ? [{ id }] : [];
    }
    if (text.includes("AS id_count")) {
      const [org, tenantId, label] = params as [string, string, string];
      return [
        {
          id_count: docs.filter(
            (doc) =>
              doc.organization_id === org &&
              doc.entity_id === tenantId &&
              doc.label === label &&
              !doc.deleted_at,
          ).length,
        },
      ];
    }
    if (text.includes("AS file_count")) {
      const org = params[0] as string;
      const active = docs.filter((doc) => doc.organization_id === org && !doc.deleted_at);
      return [
        {
          file_count: active.length,
          total_bytes: active.reduce((sum, doc) => sum + doc.size_bytes, 0),
        },
      ];
    }
    if (text.includes("INSERT INTO documents")) {
      const [id, organization_id, entity_id, r2_key, filename, mime, size_bytes, , label] =
        params as [string, string, string, string, string, string, number, string | null, string];
      const row: Doc = {
        id,
        organization_id,
        entity_id,
        r2_key,
        filename,
        mime,
        size_bytes,
        label,
        deleted_at: null,
        created_at: "2026-09-26T00:00:00.000Z",
      };
      docs.push(row);
      return [
        {
          id,
          entity_type: "tenant",
          entity_id,
          kind: "other",
          label,
          filename,
          mime,
          size_bytes,
          uploaded_by: params[7],
          is_cover: false,
          created_at: row.created_at,
        },
      ];
    }
    if (text.includes("SET deleted_at")) {
      const [id, org, tenantId, label] = params as [string, string, string, string];
      const doc = docs.find(
        (item) =>
          item.id === id &&
          item.organization_id === org &&
          item.entity_id === tenantId &&
          item.label === label &&
          !item.deleted_at,
      );
      if (!doc) return [];
      doc.deleted_at = "2026-09-26T00:00:00.000Z";
      return [{ r2_key: doc.r2_key }];
    }
    if (text.includes("FROM documents") && text.includes("label = $3")) {
      const [org, tenantId, label] = params as [string, string, string];
      return docs
        .filter(
          (doc) =>
            doc.organization_id === org &&
            doc.entity_id === tenantId &&
            doc.label === label &&
            !doc.deleted_at,
        )
        .map((doc) => ({
          id: doc.id,
          entity_type: "tenant",
          entity_id: doc.entity_id,
          kind: "other",
          label: doc.label,
          filename: doc.filename,
          mime: doc.mime,
          size_bytes: doc.size_bytes,
          uploaded_by: null,
          is_cover: false,
          created_at: doc.created_at,
        }));
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

function idFile(name: string, bytes: Uint8Array, type: string) {
  const form = new FormData();
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.set("file", new File([body], name, { type }));
  return form;
}

describe("tenant identification uploads", () => {
  const tenants = [
    { id: TENANT_A, organization_id: ORG_A },
    { id: TENANT_B, organization_id: ORG_B },
  ];

  it("stores up to two image or PDF files and rejects a third", async () => {
    const sql = createSql(tenants);
    const bucket = createBucket();
    const app = createApp(ORG_A, sql);
    const env = { FILES: bucket as unknown as R2Bucket };

    const image = await app.request(
      `/api/tenants/${TENANT_A}/identification`,
      { method: "POST", body: idFile("frente.png", PNG_BYTES, "image/png") },
      env,
    );
    expect(image.status).toBe(201);
    const pdf = await app.request(
      `/api/tenants/${TENANT_A}/identification`,
      { method: "POST", body: idFile("reverso.pdf", PDF_BYTES, "application/pdf") },
      env,
    );
    expect(pdf.status).toBe(201);
    expect([...bucket.objects.keys()].every((key) => key.startsWith(`org/${ORG_A}/tenant/`))).toBe(
      true,
    );

    const third = await app.request(
      `/api/tenants/${TENANT_A}/identification`,
      { method: "POST", body: idFile("extra.png", PNG_BYTES, "image/png") },
      env,
    );
    expect(third.status).toBe(409);

    const listed = await app.request(`/api/tenants/${TENANT_A}/identification`, {}, env);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { documents: { filename: string }[] };
    expect(body.documents).toHaveLength(2);
  });

  it("rejects a file that is not an image or PDF and a file over 10 MB", async () => {
    const sql = createSql(tenants);
    const bucket = createBucket();
    const app = createApp(ORG_A, sql);
    const env = { FILES: bucket as unknown as R2Bucket };

    const text = await app.request(
      `/api/tenants/${TENANT_A}/identification`,
      { method: "POST", body: idFile("notas.txt", Uint8Array.from([0x68, 0x69]), "text/plain") },
      env,
    );
    expect(text.status).toBe(400);
    expect(bucket.objects.size).toBe(0);

    const huge = new Uint8Array(10 * 1024 * 1024 + 1);
    const oversize = await app.request(
      `/api/tenants/${TENANT_A}/identification`,
      { method: "POST", body: idFile("grande.png", huge, "image/png") },
      env,
    );
    expect(oversize.status).toBe(413);
    expect(bucket.objects.size).toBe(0);
  });

  it("hides identification files from another organization and deletes the object", async () => {
    const sql = createSql(tenants);
    const bucket = createBucket();
    const env = { FILES: bucket as unknown as R2Bucket };
    const owner = createApp(ORG_B, sql);
    const created = await owner.request(
      `/api/tenants/${TENANT_B}/identification`,
      { method: "POST", body: idFile("id.png", PNG_BYTES, "image/png") },
      env,
    );
    expect(created.status).toBe(201);
    const documentId = ((await created.json()) as { document: { id: string } }).document.id;

    const other = createApp(ORG_A, sql);
    const missing = await other.request(`/api/tenants/${TENANT_B}/identification`, {}, env);
    expect(missing.status).toBe(404);
    const foreignDelete = await other.request(
      `/api/tenants/${TENANT_B}/identification/${documentId}`,
      { method: "DELETE" },
      env,
    );
    expect(foreignDelete.status).toBe(404);
    expect(bucket.objects.size).toBe(1);

    const removed = await owner.request(
      `/api/tenants/${TENANT_B}/identification/${documentId}`,
      { method: "DELETE" },
      env,
    );
    expect(removed.status).toBe(200);
    expect(bucket.objects.size).toBe(0);
  });
});
