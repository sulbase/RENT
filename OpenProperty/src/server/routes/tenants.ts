import { z } from "zod";
import type { Context, Hono } from "hono";
import {
  buildObjectKey,
  MAX_FILE_BYTES,
  MAX_UPLOAD_REQUEST_BYTES,
  orgQuotaAllows,
  validateUpload,
} from "../documents/policy";
import { collectCascadeKeys, deleteR2Keys, entityInOrg } from "../documents/storage";
import type { AppEnv } from "../env";
import { buildUpdate, get, normalizeRow, normalizeRows, orgId, query, run, uuidParam } from "../pg";
import { parseJson } from "../validation";
import {
  GOVERNMENT_ID_MAX,
  MARITAL_STATUSES,
  OCCUPANT_COUNT_MAX,
} from "../../shared/tenant-profile";

const MaritalStatus = z.enum(MARITAL_STATUSES.map((item) => item.value) as [string, ...string[]]);

const ID_LABEL = "identification";
const MAX_ID_FILES = 2;
const ID_COLUMNS = `id, entity_type, entity_id, kind, label, filename, mime, size_bytes, uploaded_by, is_cover, created_at`;
const ID_TOO_MANY = "Máximo 2 archivos de identificación";
const ID_TOO_LARGE = "Cada archivo puede pesar como máximo 10 MB";
const ID_BAD_TYPE = "Solo se admiten imágenes JPEG, PNG, WebP, GIF o PDF";

async function identificationCount(c: Context<AppEnv>, tenantId: string): Promise<number> {
  const row = await get<{ id_count: number | string }>(
    c,
    `SELECT COUNT(*)::int AS id_count
     FROM documents
     WHERE organization_id = $1 AND entity_type = 'tenant' AND entity_id = $2
       AND label = $3 AND deleted_at IS NULL`,
    [orgId(c), tenantId, ID_LABEL],
  );
  return Number(row?.id_count ?? 0);
}

async function documentUsage(c: Context<AppEnv>) {
  const row = await get<{ file_count: number | string; total_bytes: number | string }>(
    c,
    `SELECT COUNT(*)::int AS file_count, COALESCE(SUM(size_bytes), 0)::bigint AS total_bytes
     FROM documents WHERE organization_id = $1 AND deleted_at IS NULL`,
    [orgId(c)],
  );
  return {
    file_count: Number(row?.file_count ?? 0),
    total_bytes: Number(row?.total_bytes ?? 0),
  };
}

function identificationError(error: string): string {
  if (error === "Empty file") return "El archivo está vacío";
  if (error === "File exceeds 10 MB" || error.includes("10 MB")) return ID_TOO_LARGE;
  if (
    error === "File type is not allowed" ||
    error === "File type does not match its extension" ||
    error === "File contents do not match its type" ||
    error === "Could not read file header"
  ) {
    return ID_BAD_TYPE;
  }
  return error;
}

export function mountTenantsRoutes(app: Hono<AppEnv>) {
  const TenantInput = z.object({
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    email: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    date_of_birth: z.string().optional().nullable(),
    emergency_contact: z.string().optional().nullable(),
    employer: z.string().optional().nullable(),
    monthly_income: z.number().optional().nullable(),
    government_id: z.string().trim().max(GOVERNMENT_ID_MAX).optional().nullable(),
    marital_status: MaritalStatus.optional().nullable(),
    occupation: z.string().trim().max(80).optional().nullable(),
    work_address: z.string().trim().max(200).optional().nullable(),
    previous_address: z.string().trim().max(200).optional().nullable(),
    occupant_count: z.number().int().min(0).max(OCCUPANT_COUNT_MAX).optional().nullable(),
    notes: z.string().optional().nullable(),
  });

  const TENANT_EXTRA = `
       (SELECT u.id FROM leases l LEFT JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
          WHERE l.primary_tenant_id = t.id AND l.organization_id = t.organization_id AND l.status = 'active' LIMIT 1) as active_unit_id,
       (SELECT u.name FROM leases l LEFT JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
          WHERE l.primary_tenant_id = t.id AND l.organization_id = t.organization_id AND l.status = 'active' LIMIT 1) as active_unit_name,
       (SELECT p.name FROM leases l LEFT JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id LEFT JOIN properties p ON p.id = u.property_id AND p.organization_id = u.organization_id
          WHERE l.primary_tenant_id = t.id AND l.organization_id = t.organization_id AND l.status = 'active' LIMIT 1) as active_property_name`;

  app.get("/api/tenants", async (c) => {
    const o = orgId(c);
    const search = c.req.query("q")?.trim();
    if (search) {
      const like = `%${search}%`;
      const rows = await query(
        c,
        `SELECT t.*, ${TENANT_EXTRA}
       FROM tenants t
       WHERE t.organization_id = $1 AND (t.last_name ILIKE $2 OR t.first_name ILIKE $2 OR t.email ILIKE $2 OR t.phone ILIKE $2)
       ORDER BY t.last_name, t.first_name LIMIT 200`,
        [o, like],
      );
      return c.json({ tenants: normalizeRows(rows) });
    }
    const rows = await query(
      c,
      `SELECT t.*, ${TENANT_EXTRA}
     FROM tenants t WHERE t.organization_id = $1 ORDER BY t.last_name, t.first_name LIMIT 500`,
      [o],
    );
    return c.json({ tenants: normalizeRows(rows) });
  });

  app.get("/api/tenants/:id", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const o = orgId(c);
    const row = await get(c, "SELECT * FROM tenants WHERE id = $1 AND organization_id = $2", [
      id,
      o,
    ]);
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({ tenant: normalizeRow(row as Record<string, unknown>) });
  });

  app.get("/api/tenants/:id/payments", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const o = orgId(c);
    const tenant = await get(c, "SELECT id FROM tenants WHERE id = $1 AND organization_id = $2", [
      id,
      o,
    ]);
    if (!tenant) return c.json({ error: "Not found" }, 404);
    const rows = await query(
      c,
      `SELECT p.id, p.charge_id, p.paid_at, p.amount, p.method, p.reference, p.notes,
              p.voided_at, p.void_reason, p.voided_by,
              c.period, c.due_date, c.amount AS charge_amount, c.status AS charge_status,
              l.id AS lease_id, l.status AS lease_status,
              u.name AS unit_name, pr.name AS property_name
       FROM payments p
       JOIN rent_charges c ON c.id = p.charge_id AND c.organization_id = p.organization_id
       JOIN leases l ON l.id = c.lease_id AND l.organization_id = c.organization_id
       JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
       JOIN properties pr ON pr.id = u.property_id AND pr.organization_id = u.organization_id
       WHERE p.organization_id = $1 AND l.primary_tenant_id = $2
       ORDER BY p.paid_at DESC`,
      [o, id],
    );
    const charges = await query(
      c,
      `SELECT c.id, c.period, c.due_date, c.amount, c.status,
              l.id AS lease_id, u.name AS unit_name, pr.name AS property_name
       FROM rent_charges c
       JOIN leases l ON l.id = c.lease_id AND l.organization_id = c.organization_id
       JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
       JOIN properties pr ON pr.id = u.property_id AND pr.organization_id = u.organization_id
       WHERE c.organization_id = $1 AND l.primary_tenant_id = $2
       ORDER BY c.due_date`,
      [o, id],
    );
    return c.json({ payments: normalizeRows(rows), charges: normalizeRows(charges) });
  });

  app.post("/api/tenants", async (c) => {
    const parsed = await parseJson(c, TenantInput);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const d = parsed.data;
    const o = orgId(c);
    const row = await get(
      c,
      `INSERT INTO tenants (
         organization_id, first_name, last_name, email, phone, date_of_birth,
         emergency_contact, employer, monthly_income, government_id, marital_status,
         occupation, work_address, previous_address, occupant_count, notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
      [
        o,
        d.first_name,
        d.last_name,
        d.email ?? null,
        d.phone ?? null,
        d.date_of_birth ?? null,
        d.emergency_contact ?? null,
        d.employer ?? null,
        d.monthly_income != null ? String(d.monthly_income) : null,
        d.government_id || null,
        d.marital_status ?? null,
        d.occupation || null,
        d.work_address || null,
        d.previous_address || null,
        d.occupant_count ?? null,
        d.notes ?? null,
      ],
    );
    return c.json({ tenant: normalizeRow(row as Record<string, unknown>) }, 201);
  });

  app.put("/api/tenants/:id", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const parsed = await parseJson(c, TenantInput.partial());
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const data = { ...parsed.data };
    if (data.monthly_income !== undefined && data.monthly_income !== null) {
      data.monthly_income = String(data.monthly_income) as unknown as number;
    }
    for (const key of [
      "government_id",
      "occupation",
      "work_address",
      "previous_address",
    ] as const) {
      if (typeof data[key] === "string" && data[key].trim() === "") data[key] = null;
    }
    const { sets, params, next } = buildUpdate(data as Record<string, unknown>);
    if (!sets.length) return c.json({ error: "No fields" }, 400);
    const o = orgId(c);
    params.push(id, o);
    const r = await run(
      c,
      `UPDATE tenants SET ${sets.join(", ")} WHERE id = $${next} AND organization_id = $${next + 1}`,
      params,
    );
    if (!r.changes) return c.json({ error: "Not found" }, 404);
    const row = await get(c, "SELECT * FROM tenants WHERE id = $1 AND organization_id = $2", [
      id,
      o,
    ]);
    return c.json({ tenant: normalizeRow(row as Record<string, unknown>) });
  });

  app.get("/api/tenants/:id/identification", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    if (!(await entityInOrg(c, "tenant", id))) return c.json({ error: "Not found" }, 404);
    const rows = await query(
      c,
      `SELECT ${ID_COLUMNS} FROM documents
       WHERE organization_id = $1 AND entity_type = 'tenant' AND entity_id = $2
         AND label = $3 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [orgId(c), id, ID_LABEL],
    );
    return c.json({ documents: normalizeRows(rows) });
  });

  app.post("/api/tenants/:id/identification", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const bucket = c.env.FILES;
    if (!bucket) return c.json({ error: "File storage is not configured" }, 503);

    const declaredLength = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_REQUEST_BYTES) {
      return c.json({ error: ID_TOO_LARGE }, 413);
    }

    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "File is required" }, 400);
    if (file.size > MAX_FILE_BYTES) return c.json({ error: ID_TOO_LARGE }, 413);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = validateUpload({
      filename: file.name,
      declaredType: file.type,
      bytes,
      size: file.size,
      kind: "other",
      isCover: false,
      maxBytes: MAX_FILE_BYTES,
      oversizeError: ID_TOO_LARGE,
    });
    if (!checked.ok) {
      const message = identificationError(checked.error);
      const status = message === ID_TOO_LARGE ? 413 : 400;
      return c.json({ error: message }, status);
    }

    if (!(await entityInOrg(c, "tenant", id))) return c.json({ error: "Not found" }, 404);
    if ((await identificationCount(c, id)) >= MAX_ID_FILES) {
      return c.json({ error: ID_TOO_MANY }, 409);
    }

    const quota = await documentUsage(c);
    const allowed = orgQuotaAllows({
      fileCount: quota.file_count,
      totalBytes: quota.total_bytes,
      nextSize: file.size,
    });
    if (!allowed.ok) return c.json({ error: allowed.error }, 409);

    const documentId = crypto.randomUUID();
    const r2Key = buildObjectKey({
      organizationId: orgId(c),
      entityType: "tenant",
      entityId: id,
      filename: checked.filename,
    });
    await bucket.put(r2Key, bytes, {
      httpMetadata: { contentType: checked.mime },
    });

    try {
      const row = await get(
        c,
        `INSERT INTO documents (
           id, organization_id, entity_type, entity_id,
           property_id, unit_id, lease_id, tenant_id, work_order_id, message_id,
           kind, r2_key, filename, mime, size_bytes, uploaded_by, is_cover, label
         ) VALUES (
           $1, $2, 'tenant', $3,
           NULL, NULL, NULL, $3, NULL, NULL,
           'other', $4, $5, $6, $7, $8, false, $9
         ) RETURNING ${ID_COLUMNS}`,
        [
          documentId,
          orgId(c),
          id,
          r2Key,
          checked.filename,
          checked.mime,
          file.size,
          c.get("userId"),
          ID_LABEL,
        ],
      );
      if (!row) {
        await bucket.delete(r2Key);
        return c.json({ error: "Insert failed" }, 500);
      }
      return c.json({ document: normalizeRow(row as Record<string, unknown>) }, 201);
    } catch (err) {
      await bucket.delete(r2Key);
      const code = (err as { code?: string }).code;
      if (code === "23505") return c.json({ error: "Could not save document" }, 409);
      throw err;
    }
  });

  app.delete("/api/tenants/:id/identification/:documentId", async (c) => {
    const id = uuidParam(c.req.param("id"));
    const documentId = uuidParam(c.req.param("documentId"));
    if (!id || !documentId) return c.json({ error: "Invalid ID" }, 400);
    const row = await get<{ r2_key: string }>(
      c,
      `UPDATE documents SET deleted_at = now()
       WHERE id = $1 AND organization_id = $2 AND entity_type = 'tenant' AND entity_id = $3
         AND label = $4 AND deleted_at IS NULL
       RETURNING r2_key`,
      [documentId, orgId(c), id, ID_LABEL],
    );
    if (!row) return c.json({ error: "Not found" }, 404);
    await deleteR2Keys(c.env, [row.r2_key]);
    return c.json({ ok: true });
  });

  app.delete("/api/tenants/:id", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const o = orgId(c);
    const keys = await collectCascadeKeys(c, "tenant", id);
    const r = await run(c, "DELETE FROM tenants WHERE id = $1 AND organization_id = $2", [id, o]);
    if (!r.changes) return c.json({ error: "Not found" }, 404);
    await deleteR2Keys(c.env, keys);
    return c.json({ ok: true });
  });
}
