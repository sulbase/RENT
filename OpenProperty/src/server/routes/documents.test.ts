import { describe, expect, it } from "vitest";
import type { R2Bucket } from "@cloudflare/workers-types";
import { factory } from "../factory";
import type { Sql } from "../db";
import { mountDocumentsRoutes } from "./documents";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const PROP_A = "20000000-0000-4000-8000-000000000010";
const PROP_B = "20000000-0000-4000-8000-000000000011";

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

type Doc = {
  id: string;
  organization_id: string;
  entity_type: string;
  entity_id: string;
  kind: string;
  r2_key: string;
  filename: string;
  mime: string;
  size_bytes: number;
  uploaded_by: string | null;
  is_cover: boolean;
  label: string | null;
  created_at: string;
  deleted_at: string | null;
};

type Entity = { type: string; id: string; organization_id: string };

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
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      return { body: new Response(copy).body, size: bytes.byteLength };
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  return bucket;
}

function createSql(entities: Entity[]) {
  const docs: Doc[] = [];

  const unsafe = async (text: string, params: unknown[] = []) => {
    if (text.startsWith("SELECT id FROM ")) {
      const [id, org] = params as [string, string];
      const type = text.includes("FROM properties")
        ? "property"
        : text.includes("FROM units")
          ? "unit"
          : text.includes("FROM leases")
            ? "lease"
            : text.includes("FROM tenants")
              ? "tenant"
              : text.includes("FROM work_orders")
                ? "work_order"
                : "";
      const found = entities.find(
        (entity) => entity.type === type && entity.id === id && entity.organization_id === org,
      );
      return found ? [{ id }] : [];
    }

    if (text.includes("AS photo_count")) {
      const [org, entityType, entityId] = params as [string, string, string];
      return [
        {
          photo_count: docs.filter(
            (doc) =>
              doc.organization_id === org &&
              doc.entity_type === entityType &&
              doc.entity_id === entityId &&
              !doc.deleted_at &&
              doc.mime.startsWith("image/"),
          ).length,
        },
      ];
    }

    if (text.includes("FROM settings")) {
      return [];
    }

    if (text.includes("AS folder_count")) {
      const [org, entityId] = params as [string, string];
      const active = docs.filter(
        (doc) =>
          doc.organization_id === org &&
          doc.entity_type === "property" &&
          doc.entity_id === entityId &&
          !doc.deleted_at,
      );
      return [
        {
          folder_count: active.length,
          folder_bytes: active.reduce((sum, doc) => sum + doc.size_bytes, 0),
        },
      ];
    }

    if (text.includes("COUNT(*)")) {
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
      const [
        id,
        organization_id,
        entity_type,
        entity_id,
        ,
        ,
        ,
        ,
        ,
        ,
        kind,
        r2_key,
        filename,
        mime,
        size_bytes,
        uploaded_by,
        is_cover,
      ] = params as [
        string,
        string,
        string,
        string,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string,
        string,
        string,
        string,
        number,
        string | null,
        boolean,
      ];
      const row: Doc = {
        id,
        organization_id,
        entity_type,
        entity_id,
        kind,
        r2_key,
        filename,
        mime,
        size_bytes,
        uploaded_by,
        is_cover,
        label: (params[17] as string | null) ?? null,
        created_at: "2026-09-25T00:00:00.000Z",
        deleted_at: null,
      };
      docs.push(row);
      return [publicRow(row)];
    }

    if (text.includes("SET is_cover = false")) {
      const [org, entityType, entityId, exceptId] = params as string[];
      for (const doc of docs) {
        if (
          doc.organization_id === org &&
          doc.entity_type === entityType &&
          doc.entity_id === entityId &&
          doc.is_cover &&
          !doc.deleted_at &&
          doc.id !== exceptId
        ) {
          doc.is_cover = false;
        }
      }
      return [];
    }

    if (text.includes("SET is_cover = true")) {
      const [id, org] = params as [string, string];
      const doc = docs.find((item) => item.id === id && item.organization_id === org && !item.deleted_at);
      if (!doc) return [];
      doc.is_cover = true;
      return [publicRow(doc)];
    }

    if (text.includes("SET deleted_at")) {
      const [id, org] = params as [string, string];
      const doc = docs.find((item) => item.id === id && item.organization_id === org && !item.deleted_at);
      if (!doc) return [];
      doc.deleted_at = "2026-09-25T00:00:00.000Z";
      return [{ r2_key: doc.r2_key }];
    }

    if (text.includes("SELECT r2_key, filename")) {
      const [id, org] = params as [string, string];
      const doc = docs.find((item) => item.id === id && item.organization_id === org && !item.deleted_at);
      return doc
        ? [{ r2_key: doc.r2_key, filename: doc.filename, mime: doc.mime, size_bytes: doc.size_bytes }]
        : [];
    }

    if (text.includes("SELECT entity_type, entity_id, kind")) {
      const [id, org] = params as [string, string];
      const doc = docs.find((item) => item.id === id && item.organization_id === org && !item.deleted_at);
      return doc ? [{ entity_type: doc.entity_type, entity_id: doc.entity_id, kind: doc.kind }] : [];
    }

    if (text.includes("ORDER BY is_cover")) {
      const [org, entityType, entityId] = params as [string, string, string];
      return docs
        .filter(
          (doc) =>
            doc.organization_id === org &&
            doc.entity_type === entityType &&
            doc.entity_id === entityId &&
            !doc.deleted_at,
        )
        .map(publicRow);
    }

    return [];
  };

  return { unsafe, docs } as Sql & { docs: Doc[] };
}

function publicRow(doc: Doc) {
  return {
    id: doc.id,
    entity_type: doc.entity_type,
    entity_id: doc.entity_id,
    kind: doc.kind,
    filename: doc.filename,
    mime: doc.mime,
    size_bytes: doc.size_bytes,
    uploaded_by: doc.uploaded_by,
    is_cover: doc.is_cover,
    label: doc.label,
    created_at: doc.created_at,
  };
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
  mountDocumentsRoutes(app);
  return app;
}

function leasePng(leaseId: string, name: string) {
  const form = pngForm(leaseId, name);
  form.set("entity_type", "lease");
  return form;
}

function pngForm(entityId: string, name: string, isCover = false) {
  const form = new FormData();
  form.set("entity_type", "property");
  form.set("entity_id", entityId);
  form.set("kind", "image");
  if (isCover) form.set("is_cover", "true");
  form.set("r2_key", "org/evil/path/secret.png");
  form.set("file", new File([PNG_BYTES], name, { type: "image/png" }));
  return form;
}

describe("documents API isolation", () => {
  const entities: Entity[] = [
    { type: "property", id: PROP_A, organization_id: ORG_A },
    { type: "property", id: PROP_B, organization_id: ORG_B },
  ];

  it("stores the file under the caller org and hides it from another org", async () => {
    const sql = createSql(entities);
    const bucket = createBucket();
    const appB = createApp(ORG_B, sql);
    const created = await appB.request(
      "/api/documents",
      { method: "POST", body: pngForm(PROP_B, "fachada.png", true) },
      { FILES: bucket as unknown as R2Bucket },
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { document: { id: string; is_cover: boolean } };
    expect(body.document.is_cover).toBe(true);
    expect([...bucket.objects.keys()][0]?.startsWith(`org/${ORG_B}/`)).toBe(true);
    expect([...bucket.objects.keys()][0]?.includes("evil")).toBe(false);

    const appA = createApp(ORG_A, sql);
    const env = { FILES: bucket as unknown as R2Bucket };
    const missing = await appA.request(`/api/documents/${body.document.id}`, {}, env);
    expect(missing.status).toBe(404);
    const foreignList = await appA.request(
      `/api/documents?entity_type=property&entity_id=${PROP_B}`,
      {},
      env,
    );
    expect(foreignList.status).toBe(404);
    const foreignDelete = await appA.request(
      `/api/documents/${body.document.id}`,
      { method: "DELETE" },
      env,
    );
    expect(foreignDelete.status).toBe(404);
    expect(bucket.objects.size).toBe(1);

    const ownList = await appB.request(
      `/api/documents?entity_type=property&entity_id=${PROP_B}`,
      {},
      env,
    );
    expect(ownList.status).toBe(200);
    const listed = (await ownList.json()) as { documents: { id: string }[] };
    expect(listed.documents).toHaveLength(1);

    const downloaded = await appB.request(`/api/documents/${body.document.id}`, {}, env);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toBe("image/png");
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store");

    const removed = await appB.request(
      `/api/documents/${body.document.id}`,
      { method: "DELETE" },
      env,
    );
    expect(removed.status).toBe(200);
    expect(bucket.objects.size).toBe(0);
    const gone = await appB.request(`/api/documents/${body.document.id}`, {}, env);
    expect(gone.status).toBe(404);
  });

  it("rejects an upload for an entity outside the organization", async () => {
    const sql = createSql(entities);
    const bucket = createBucket();
    const appA = createApp(ORG_A, sql);
    const res = await appA.request(
      "/api/documents",
      { method: "POST", body: pngForm(PROP_B, "foto.png") },
      { FILES: bucket as unknown as R2Bucket },
    );
    expect(res.status).toBe(404);
    expect(bucket.objects.size).toBe(0);
  });

  it("accepts only images on a lease and stops at 25 photos", async () => {
    const leaseId = "20000000-0000-4000-8000-000000000020";
    const sql = createSql([
      ...entities,
      { type: "lease", id: leaseId, organization_id: ORG_A },
    ]);
    const bucket = createBucket();
    const app = createApp(ORG_A, sql);
    const env = { FILES: bucket as unknown as R2Bucket };

    const pdf = new FormData();
    pdf.set("entity_type", "lease");
    pdf.set("entity_id", leaseId);
    pdf.set("kind", "invoice");
    pdf.set(
      "file",
      new File([Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d])], "factura.pdf", {
        type: "application/pdf",
      }),
    );
    const rejected = await app.request("/api/documents", { method: "POST", body: pdf }, env);
    expect(rejected.status).toBe(400);

    for (let index = 0; index < 25; index += 1) {
      const created = await app.request(
        "/api/documents",
        { method: "POST", body: leasePng(leaseId, `foto-${index}.png`) },
        env,
      );
      expect(created.status).toBe(201);
    }
    const overflow = await app.request(
      "/api/documents",
      { method: "POST", body: leasePng(leaseId, "foto-extra.png") },
      env,
    );
    expect(overflow.status).toBe(409);
  });

  it("stops a property folder at 10 files", async () => {
    const sql = createSql(entities);
    const bucket = createBucket();
    const app = createApp(ORG_A, sql);
    const env = { FILES: bucket as unknown as R2Bucket };

    for (let index = 0; index < 10; index += 1) {
      const created = await app.request(
        "/api/documents",
        { method: "POST", body: pngForm(PROP_A, `archivo-${index}.png`) },
        env,
      );
      expect(created.status).toBe(201);
    }
    const blocked = await app.request(
      "/api/documents",
      { method: "POST", body: pngForm(PROP_A, "archivo-extra.png") },
      env,
    );
    expect(blocked.status).toBe(409);
    const body = (await blocked.json()) as { error: string };
    expect(body.error).toContain("10 archivos");
  });

  it("stops unit image uploads at 25 photos", async () => {
    const unitId = "20000000-0000-4000-8000-000000000021";
    const sql = createSql([
      ...entities,
      { type: "unit", id: unitId, organization_id: ORG_A },
    ]);
    const bucket = createBucket();
    const app = createApp(ORG_A, sql);
    const env = { FILES: bucket as unknown as R2Bucket };

    for (let index = 0; index < 25; index += 1) {
      const form = pngForm(unitId, `foto-${index}.png`);
      form.set("entity_type", "unit");
      const created = await app.request("/api/documents", { method: "POST", body: form }, env);
      expect(created.status).toBe(201);
    }
    const overflow = pngForm(unitId, "foto-extra.png");
    overflow.set("entity_type", "unit");
    const blocked = await app.request("/api/documents", { method: "POST", body: overflow }, env);
    expect(blocked.status).toBe(409);
  });
});
