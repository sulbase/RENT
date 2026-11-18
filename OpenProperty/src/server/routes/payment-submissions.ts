import { z } from "zod";
import type { Context, Hono } from "hono";
import { createIpRateLimit } from "../auth/rate-limit";
import {
  buildObjectKey,
  contentDisposition,
  MAX_FILE_BYTES,
  MAX_UPLOAD_REQUEST_BYTES,
  orgQuotaAllows,
  validateUpload,
} from "../documents/policy";
import type { AppEnv } from "../env";
import { insertNotification } from "../notifications/insert";
import { get, normalizeRow, normalizeRows, orgId, query, uuidParam, type SqlParam } from "../pg";
import { centsToAmount, hasAtMostTwoDecimals, toCents } from "../rent/payment-balance";
import { recordPayment } from "../rent/record-payment";
import { allocateOldestFirst } from "../../shared/allocate-oldest";
import {
  askGemini,
  interpretReceipt,
  ONE_PAGE_ERROR,
  parseGeminiReceipt,
  pdfPageCount,
  READ_LIMIT,
  READ_LIMIT_ERROR,
  UNREADABLE_ERROR,
} from "../receipts/read-receipt";
import { parseJson, parseQuery } from "../validation";

/** Label on the tenant document that holds the receipt image or PDF. */
const RECEIPT_LABEL = "payment_receipt";
const MAX_PENDING_PER_CHARGE = 3;
const RECEIPT_TOO_LARGE = "El comprobante puede pesar como máximo 10 MB";
const RECEIPT_BAD_TYPE = "Solo se admiten imágenes JPEG, PNG, WebP, GIF o PDF";

const receiptUploadRateLimit = createIpRateLimit({
  windowMs: 60_000,
  limit: 10,
  scope: "receipt-upload",
});

const ReceiptFields = z.object({
  amount: z.coerce
    .number()
    .positive("El monto debe ser mayor que cero")
    .refine(hasAtMostTwoDecimals, "El monto debe tener como máximo 2 decimales"),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de pago inválida"),
  payer_bank_name: z.string().trim().min(1).max(80).optional(),
  receipt_number: z.string().trim().min(1).max(80).optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

const PortalBulkReceiptFields = z.object({
  amount: z.coerce
    .number()
    .positive("El monto debe ser mayor que cero")
    .refine(hasAtMostTwoDecimals, "El monto debe tener como máximo 2 decimales")
    .optional(),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de pago inválida"),
  payer_bank_name: z.string().trim().min(1, "Indica el nombre del banco").max(80),
  receipt_number: z.string().trim().min(1, "Indica el número de comprobante").max(80),
  reference: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => (value ? value : undefined)),
  fill_source: z.enum(["manual", "automatic"]).default("manual"),
});

const ListQuery = z.object({
  status: z.enum(["pending", "approved", "rejected", "all"]).default("pending"),
});

const RejectBody = z.object({ reason: z.string().trim().min(1).max(200) });

type Tx = {
  unsafe: (text: string, params?: SqlParam[]) => Promise<unknown>;
};

function uploadError(error: string): string {
  if (error === "Empty file") return "El archivo está vacío";
  if (error.includes("10 MB")) return RECEIPT_TOO_LARGE;
  return RECEIPT_BAD_TYPE;
}

function formText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

const DUPLICATE_RECEIPT = "Este número de comprobante ya fue usado, intente con otro";

function receiptKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Reserves the number for this file. Several months of one transfer share it. */
async function claimReceiptNumber(
  tx: Tx,
  organizationId: string,
  documentId: string,
  receiptNumber: string | null | undefined,
): Promise<boolean> {
  if (!receiptNumber?.trim()) return true;
  const rows = (await tx.unsafe(
    `INSERT INTO receipt_number_claims (organization_id, receipt_number, document_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, receipt_number) DO NOTHING
     RETURNING receipt_number`,
    [organizationId, receiptKey(receiptNumber), documentId],
  )) as unknown[];
  return rows.length > 0;
}

/** Tomorrow in UTC, so a tenant ahead of UTC can still date a transfer "today". */
function latestPaidOn(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

function portalTenant(c: Context<AppEnv>): string | null {
  return c.get("portalTenantId") ?? null;
}

const STAFF_SELECT = `
  SELECT s.id, s.charge_id, s.amount, s.paid_on::text AS paid_on, s.reference, s.payer_bank_name,
         s.receipt_number, s.note, s.status, s.fill_source,
         s.rejection_reason, s.created_at, s.reviewed_at, s.payment_id,
         c.period, c.due_date, c.amount AS charge_amount, c.amount_paid,
         t.id AS tenant_id, t.first_name AS tenant_first_name, t.last_name AS tenant_last_name,
         u.name AS unit_name, p.name AS property_name,
         d.id AS document_id, d.filename AS document_filename, d.mime AS document_mime
  FROM payment_submissions s
  JOIN rent_charges c ON c.id = s.charge_id AND c.organization_id = s.organization_id
  JOIN tenants t ON t.id = s.tenant_id AND t.organization_id = s.organization_id
  LEFT JOIN leases l ON l.id = c.lease_id AND l.organization_id = c.organization_id
  LEFT JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
  LEFT JOIN properties p ON p.id = u.property_id AND p.organization_id = u.organization_id
  LEFT JOIN documents d ON d.id = s.document_id AND d.organization_id = s.organization_id
    AND d.deleted_at IS NULL`;

export function mountPaymentSubmissionRoutes(app: Hono<AppEnv>) {
  app.get("/api/portal/payment-submissions", async (c) => {
    const tenantId = portalTenant(c);
    if (!tenantId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const rows = await query(
      c,
      `SELECT s.id, s.charge_id, s.document_id, s.amount, s.paid_on::text AS paid_on, s.reference,
              s.payer_bank_name, s.receipt_number, s.status,
              s.rejection_reason, s.created_at, s.reviewed_at, c.period,
              p.voided_at AS payment_voided_at, p.void_reason AS payment_void_reason,
              d.filename AS document_filename, d.mime AS document_mime
       FROM payment_submissions s
       JOIN rent_charges c ON c.id = s.charge_id AND c.organization_id = s.organization_id
       LEFT JOIN payments p ON p.id = s.payment_id AND p.organization_id = s.organization_id
       LEFT JOIN documents d ON d.id = s.document_id AND d.organization_id = s.organization_id
         AND d.deleted_at IS NULL
       WHERE s.organization_id = $1 AND s.tenant_id = $2
       ORDER BY s.created_at DESC
       LIMIT 100`,
      [orgId(c), tenantId],
    );
    return c.json({ submissions: normalizeRows(rows) });
  });

  app.get("/api/portal/payment-submissions/:id/document", async (c) => {
    const tenantId = portalTenant(c);
    const id = uuidParam(c.req.param("id"));
    if (!tenantId || !id) return c.json({ error: "Not found" }, 404);
    const row = await get<{ r2_key: string; filename: string; mime: string; size_bytes: number }>(
      c,
      `SELECT d.r2_key, d.filename, d.mime, d.size_bytes
       FROM payment_submissions s
       JOIN documents d ON d.id = s.document_id AND d.organization_id = s.organization_id
         AND d.deleted_at IS NULL
       WHERE s.id = $1 AND s.organization_id = $2 AND s.tenant_id = $3 AND s.document_id IS NOT NULL`,
      [id, orgId(c), tenantId],
    );
    if (!row) return c.json({ error: "Not found" }, 404);
    const bucket = c.env.FILES;
    if (!bucket) return c.json({ error: "File storage is not configured" }, 503);
    const object = await bucket.get(row.r2_key);
    if (!object) return c.json({ error: "Not found" }, 404);
    const download = c.req.query("download") === "1";
    return new Response(object.body as unknown as BodyInit, {
      headers: {
        "Content-Type": row.mime,
        "Content-Length": String(row.size_bytes),
        "Content-Disposition": contentDisposition(row.filename, !download),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  app.post("/api/portal/receipts/read", receiptUploadRateLimit, async (c) => {
    const tenantId = portalTenant(c);
    if (!tenantId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const apiKey = c.env.GEMINI_API_KEY?.trim();
    if (!apiKey) return c.json({ error: UNREADABLE_ERROR }, 503);
    const declaredLength = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_REQUEST_BYTES) {
      return c.json({ error: RECEIPT_TOO_LARGE }, 413);
    }
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "Adjunta el comprobante" }, 400);
    if (file.size > MAX_FILE_BYTES) return c.json({ error: RECEIPT_TOO_LARGE }, 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = validateUpload({
      filename: file.name,
      declaredType: file.type,
      bytes,
      size: file.size,
      kind: "other",
      isCover: false,
      maxBytes: MAX_FILE_BYTES,
      oversizeError: RECEIPT_TOO_LARGE,
    });
    if (!checked.ok) return c.json({ error: uploadError(checked.error) }, 400);
    if (checked.mime === "application/pdf") {
      const pages = pdfPageCount(bytes);
      if (pages !== 1) return c.json({ error: ONE_PAGE_ERROR }, 400);
    }
    const leaseId = uuidParam(formText(body.lease_id));
    if (!leaseId) return c.json({ error: "Elige la unidad" }, 400);
    const lease = await get<{ unit_id: string }>(
      c,
      `SELECT l.unit_id
       FROM leases l
       WHERE l.id = $1 AND l.organization_id = $2 AND l.primary_tenant_id = $3 AND l.status = 'active'`,
      [leaseId, orgId(c), tenantId],
    );
    if (!lease) return c.json({ error: "No tienes acceso al portal" }, 403);
    const reserved = await query<{ calls: number }>(
      c,
      `INSERT INTO receipt_read_quotas (organization_id, unit_id, period, calls)
       VALUES ($1, $2, to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM'), 1)
       ON CONFLICT (organization_id, unit_id, period)
       DO UPDATE SET calls = receipt_read_quotas.calls + 1
       WHERE receipt_read_quotas.calls < $3
       RETURNING calls`,
      [orgId(c), lease.unit_id, READ_LIMIT],
    );
    if (reserved.length === 0) return c.json({ manual: true, error: READ_LIMIT_ERROR });
    const accounts = await query<{ key: string; value: string }>(
      c,
      `SELECT key, value FROM settings
       WHERE organization_id = $1 AND key = ANY($2::text[])`,
      [orgId(c), ["bank_account", "bank_clabe"]],
    );
    let rawText = "";
    try {
      rawText = await askGemini(apiKey, checked.mime, bytes);
    } catch (err) {
      console.error("receipt read failed", err instanceof Error ? err.message : err);
      return c.json({ error: UNREADABLE_ERROR }, 502);
    }
    const parsed = parseGeminiReceipt(rawText);
    if (!parsed) return c.json({ error: UNREADABLE_ERROR }, 422);
    const outcome = interpretReceipt(
      parsed,
      accounts.map((row) => row.value),
    );
    if (!outcome.ok) return c.json({ error: outcome.error }, 422);
    if (outcome.draft.receipt_number) {
      const taken = await get(
        c,
        `SELECT 1 AS ok FROM receipt_number_claims
         WHERE organization_id = $1 AND receipt_number = $2`,
        [orgId(c), receiptKey(outcome.draft.receipt_number)],
      );
      if (taken) return c.json({ error: DUPLICATE_RECEIPT }, 409);
    }
    return c.json({ draft: outcome.draft });
  });

  app.post("/api/portal/charges/:id/receipts", receiptUploadRateLimit, async (c) => {
    const tenantId = portalTenant(c);
    if (!tenantId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const chargeId = uuidParam(c.req.param("id"));
    if (!chargeId) return c.json({ error: "Not found" }, 404);
    const bucket = c.env.FILES;
    if (!bucket) return c.json({ error: "File storage is not configured" }, 503);

    const declaredLength = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_REQUEST_BYTES) {
      return c.json({ error: RECEIPT_TOO_LARGE }, 413);
    }
    const body = await c.req.parseBody();
    const fields = ReceiptFields.safeParse({
      amount: formText(body.amount),
      paid_on: formText(body.paid_on),
      payer_bank_name: formText(body.payer_bank_name),
      receipt_number: formText(body.receipt_number),
      reference: formText(body.reference),
      note: formText(body.note),
    });
    if (!fields.success) {
      return c.json({ error: fields.error.issues[0]?.message ?? "Datos inválidos" }, 400);
    }
    const d = fields.data;
    if (d.paid_on > latestPaidOn()) {
      return c.json({ error: "La fecha de pago no puede ser futura" }, 400);
    }
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "Adjunta el comprobante" }, 400);
    if (file.size > MAX_FILE_BYTES) return c.json({ error: RECEIPT_TOO_LARGE }, 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = validateUpload({
      filename: file.name,
      declaredType: file.type,
      bytes,
      size: file.size,
      kind: "other",
      isCover: false,
      maxBytes: MAX_FILE_BYTES,
      oversizeError: RECEIPT_TOO_LARGE,
    });
    if (!checked.ok) {
      const message = uploadError(checked.error);
      return c.json({ error: message }, message === RECEIPT_TOO_LARGE ? 413 : 400);
    }

    const o = orgId(c);
    const charge = await get<{
      amount: string;
      amount_paid: string;
      status: string;
      period: string;
      pending: number;
      first_name: string;
      last_name: string;
    }>(
      c,
      `SELECT c.amount::text, COALESCE((
                SELECT SUM(p.amount) FROM payments p
                WHERE p.charge_id = c.id AND p.organization_id = c.organization_id
                  AND p.voided_at IS NULL
              ), 0)::text AS amount_paid,
              c.status, c.period,
              (SELECT COUNT(*)::int FROM payment_submissions s
               WHERE s.charge_id = c.id AND s.organization_id = c.organization_id
                 AND s.status = 'pending') AS pending,
              t.first_name, t.last_name
       FROM rent_charges c
       JOIN leases l ON l.id = c.lease_id AND l.organization_id = c.organization_id
       JOIN tenants t ON t.id = l.primary_tenant_id AND t.organization_id = l.organization_id
       WHERE c.id = $1 AND c.organization_id = $2 AND l.primary_tenant_id = $3`,
      [chargeId, o, tenantId],
    );
    if (!charge) return c.json({ error: "Not found" }, 404);
    if (charge.status === "paid" || charge.status === "waived") {
      return c.json({ error: "Este cargo ya no tiene saldo pendiente" }, 409);
    }
    const amountCents = toCents(d.amount);
    if (amountCents > toCents(charge.amount) - toCents(charge.amount_paid)) {
      return c.json({ error: "El monto supera el saldo del cargo" }, 400);
    }
    if (Number(charge.pending) >= MAX_PENDING_PER_CHARGE) {
      return c.json({ error: "Ya tienes comprobantes en revisión para este cargo" }, 409);
    }
    const usage = await get<{ file_count: number | string; total_bytes: number | string }>(
      c,
      `SELECT COUNT(*)::int AS file_count, COALESCE(SUM(size_bytes), 0)::bigint AS total_bytes
       FROM documents WHERE organization_id = $1 AND deleted_at IS NULL`,
      [o],
    );
    const quota = orgQuotaAllows({
      fileCount: Number(usage?.file_count ?? 0),
      totalBytes: Number(usage?.total_bytes ?? 0),
      nextSize: file.size,
    });
    if (!quota.ok)
      return c.json({ error: "No hay espacio para más archivos. Avisa a tu administración" }, 409);

    const documentId = crypto.randomUUID();
    const submissionId = crypto.randomUUID();
    const r2Key = buildObjectKey({
      organizationId: o,
      entityType: "tenant",
      entityId: tenantId,
      filename: checked.filename,
      objectId: documentId,
    });
    await bucket.put(r2Key, bytes, { httpMetadata: { contentType: checked.mime } });
    try {
      await c.get("sql").begin(async (raw) => {
        const tx = raw as unknown as Tx;
        await tx.unsafe(
          `INSERT INTO documents (
             id, organization_id, entity_type, entity_id, tenant_id,
             kind, r2_key, filename, mime, size_bytes, uploaded_by, is_cover, label
           ) VALUES ($1, $2, 'tenant', $3, $3, 'other', $4, $5, $6, $7, $8, false, $9)`,
          [
            documentId,
            o,
            tenantId,
            r2Key,
            checked.filename,
            checked.mime,
            file.size,
            c.get("userId"),
            RECEIPT_LABEL,
          ],
        );
        if (!(await claimReceiptNumber(tx, o, documentId, d.receipt_number))) {
          throw new Error(DUPLICATE_RECEIPT);
        }
        await tx.unsafe(
          `INSERT INTO payment_submissions (
             id, organization_id, tenant_id, charge_id, document_id,
             amount, paid_on, reference, payer_bank_name, receipt_number, note, submitted_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12)`,
          [
            submissionId,
            o,
            tenantId,
            chargeId,
            documentId,
            centsToAmount(amountCents),
            d.paid_on,
            d.reference || null,
            d.payer_bank_name || null,
            d.receipt_number || null,
            d.note || null,
            c.get("userId"),
          ],
        );
      });
    } catch (err) {
      await bucket.delete(r2Key);
      if (err instanceof Error && err.message === DUPLICATE_RECEIPT) {
        return c.json({ error: DUPLICATE_RECEIPT }, 409);
      }
      throw err;
    }

    try {
      await insertNotification(c.get("sql"), {
        organizationId: o,
        kind: "payment_receipt",
        title: "Comprobante de pago por revisar",
        body: `${charge.first_name} ${charge.last_name} envió un comprobante de ${centsToAmount(amountCents)} para la renta de ${charge.period}.`,
        severity: "info",
        entityType: "payment_submission",
        entityId: submissionId,
        period: "submitted",
      });
    } catch {
      /* the receipt is saved; the mailbox row is best effort */
    }
    return c.json({ submission: { id: submissionId, status: "pending" } }, 201);
  });

  app.post("/api/portal/receipts", receiptUploadRateLimit, async (c) => {
    const tenantId = portalTenant(c);
    if (!tenantId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const bucket = c.env.FILES;
    if (!bucket) return c.json({ error: "File storage is not configured" }, 503);
    const declaredLength = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_REQUEST_BYTES) {
      return c.json({ error: RECEIPT_TOO_LARGE }, 413);
    }
    const body = await c.req.parseBody();
    let chargeIds: string[] = [];
    try {
      const raw = formText(body.charge_ids);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      if (!Array.isArray(parsed)) throw new Error("bad");
      chargeIds = [...new Set(parsed.map((id) => String(id)))];
    } catch {
      return c.json({ error: "Selecciona al menos un cargo" }, 400);
    }
    if (
      chargeIds.length === 0 ||
      chargeIds.length > 24 ||
      chargeIds.some((id) => !z.string().uuid().safeParse(id).success)
    ) {
      return c.json({ error: "Selecciona los cargos a pagar" }, 400);
    }
    const declaredAmount = formText(body.amount);
    const fields = PortalBulkReceiptFields.safeParse({
      amount: declaredAmount,
      paid_on: formText(body.paid_on),
      payer_bank_name: formText(body.payer_bank_name),
      receipt_number: formText(body.receipt_number),
      reference: formText(body.reference),
      fill_source: formText(body.fill_source),
    });
    if (!fields.success) {
      return c.json({ error: fields.error.issues[0]?.message ?? "Datos inválidos" }, 400);
    }
    if (fields.data.paid_on > latestPaidOn()) {
      return c.json({ error: "La fecha de pago no puede ser futura" }, 400);
    }
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "Adjunta el comprobante" }, 400);
    if (file.size > MAX_FILE_BYTES) return c.json({ error: RECEIPT_TOO_LARGE }, 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = validateUpload({
      filename: file.name,
      declaredType: file.type,
      bytes,
      size: file.size,
      kind: "other",
      isCover: false,
      maxBytes: MAX_FILE_BYTES,
      oversizeError: RECEIPT_TOO_LARGE,
    });
    if (!checked.ok) {
      const message = uploadError(checked.error);
      return c.json({ error: message }, message === RECEIPT_TOO_LARGE ? 413 : 400);
    }

    const o = orgId(c);
    const rows = await query<{
      id: string;
      lease_id: string;
      amount: string;
      amount_paid: string;
      status: string;
      period: string;
      kind: string;
      pending: number;
      pending_amount: string;
      first_name: string;
      last_name: string;
    }>(
      c,
      `SELECT c.id, c.lease_id, c.amount::text,
              COALESCE((
                SELECT SUM(p.amount) FROM payments p
                WHERE p.charge_id = c.id AND p.organization_id = c.organization_id
                  AND p.voided_at IS NULL
              ), 0)::text AS amount_paid,
              c.status, c.period, c.kind,
              (SELECT COUNT(*)::int FROM payment_submissions s
               WHERE s.charge_id = c.id AND s.organization_id = c.organization_id
                 AND s.status = 'pending') AS pending,
              COALESCE((
                SELECT SUM(s.amount) FROM payment_submissions s
                WHERE s.charge_id = c.id AND s.organization_id = c.organization_id
                  AND s.status = 'pending'
              ), 0)::text AS pending_amount,
              t.first_name, t.last_name
       FROM rent_charges c
       JOIN leases l ON l.id = c.lease_id AND l.organization_id = c.organization_id
       JOIN tenants t ON t.id = l.primary_tenant_id AND t.organization_id = l.organization_id
       WHERE c.organization_id = $1 AND l.primary_tenant_id = $2 AND c.id = ANY($3::uuid[])`,
      [o, tenantId, chargeIds],
    );
    if (rows.length !== chargeIds.length) return c.json({ error: "Not found" }, 404);
    const leaseId = rows[0]?.lease_id;
    if (rows.some((row) => row.lease_id !== leaseId)) {
      return c.json({ error: "Los cargos deben ser de la misma unidad" }, 400);
    }
    for (const row of rows) {
      if (row.status === "paid" || row.status === "waived") {
        return c.json({ error: "Un cargo ya no tiene saldo pendiente" }, 409);
      }
    }
    const slices = rows.map((row) => ({
      id: row.id,
      period: row.period,
      kind: row.kind,
      remainingCents: Math.max(
        0,
        toCents(row.amount) - toCents(row.amount_paid) - toCents(row.pending_amount ?? "0"),
      ),
    }));
    const openCents = slices.reduce((sum, row) => sum + row.remainingCents, 0);
    const requestedCents = fields.data.amount == null ? openCents : toCents(fields.data.amount);
    const allocated = allocateOldestFirst(slices, requestedCents);
    if (!allocated.ok) {
      if (allocated.error === "exceeds") {
        return c.json({ error: "El monto supera el saldo pendiente" }, 400);
      }
      if (allocated.error === "empty") {
        return c.json({ error: "Un cargo ya no tiene saldo pendiente" }, 409);
      }
      return c.json({ error: "El monto debe ser mayor que cero" }, 400);
    }
    for (const slice of allocated.rows) {
      const row = rows.find((item) => item.id === slice.id);
      if (row && Number(row.pending) >= MAX_PENDING_PER_CHARGE) {
        return c.json({ error: "Ya tienes comprobantes en revisión para un cargo" }, 409);
      }
    }
    const allocations = allocated.rows;
    const usage = await get<{ file_count: number | string; total_bytes: number | string }>(
      c,
      `SELECT COUNT(*)::int AS file_count, COALESCE(SUM(size_bytes), 0)::bigint AS total_bytes
       FROM documents WHERE organization_id = $1 AND deleted_at IS NULL`,
      [o],
    );
    const quota = orgQuotaAllows({
      fileCount: Number(usage?.file_count ?? 0),
      totalBytes: Number(usage?.total_bytes ?? 0),
      nextSize: file.size,
    });
    if (!quota.ok)
      return c.json({ error: "No hay espacio para más archivos. Avisa a tu administración" }, 409);

    const documentId = crypto.randomUUID();
    const r2Key = buildObjectKey({
      organizationId: o,
      entityType: "tenant",
      entityId: tenantId,
      filename: checked.filename,
      objectId: documentId,
    });
    await bucket.put(r2Key, bytes, { httpMetadata: { contentType: checked.mime } });
    const submissionIds = allocations.map(() => crypto.randomUUID());
    try {
      await c.get("sql").begin(async (raw) => {
        const tx = raw as unknown as Tx;
        await tx.unsafe(
          `INSERT INTO documents (
             id, organization_id, entity_type, entity_id, tenant_id,
             kind, r2_key, filename, mime, size_bytes, uploaded_by, is_cover, label
           ) VALUES ($1, $2, 'tenant', $3, $3, 'other', $4, $5, $6, $7, $8, false, $9)`,
          [
            documentId,
            o,
            tenantId,
            r2Key,
            checked.filename,
            checked.mime,
            file.size,
            c.get("userId"),
            RECEIPT_LABEL,
          ],
        );
        if (!(await claimReceiptNumber(tx, o, documentId, fields.data.receipt_number))) {
          throw new Error(DUPLICATE_RECEIPT);
        }
        for (let i = 0; i < allocations.length; i++) {
          const row = allocations[i];
          if (!row) continue;
          await tx.unsafe(
            `INSERT INTO payment_submissions (
               id, organization_id, tenant_id, charge_id, document_id,
               amount, paid_on, reference, payer_bank_name, receipt_number, note, submitted_by, fill_source
             ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12, $13)`,
            [
              submissionIds[i],
              o,
              tenantId,
              row.id,
              documentId,
              centsToAmount(row.cents),
              fields.data.paid_on,
              fields.data.reference ?? null,
              fields.data.payer_bank_name,
              fields.data.receipt_number,
              null,
              c.get("userId"),
              fields.data.fill_source,
            ],
          );
        }
      });
    } catch (err) {
      await bucket.delete(r2Key);
      if (err instanceof Error && err.message === DUPLICATE_RECEIPT) {
        return c.json({ error: DUPLICATE_RECEIPT }, 409);
      }
      throw err;
    }
    const total = allocations.reduce((sum, row) => sum + row.cents, 0);
    const who = `${rows[0].first_name} ${rows[0].last_name}`;
    try {
      await insertNotification(c.get("sql"), {
        organizationId: o,
        kind: "payment_receipt",
        title: "Comprobante de pago por revisar",
        body: `${who} envió un comprobante de ${centsToAmount(total)} para ${allocations.length} cargo(s).`,
        severity: "info",
        entityType: "payment_submission",
        entityId: submissionIds[0],
        period: "submitted",
      });
    } catch {
      /* the receipt is saved; the mailbox row is best effort */
    }
    return c.json({ submissions: submissionIds.map((id) => ({ id, status: "pending" })) }, 201);
  });

  app.get("/api/payment-submissions", async (c) => {
    const parsed = parseQuery(c, ListQuery);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const status = parsed.data.status ?? "pending";
    const rows = await query(
      c,
      `${STAFF_SELECT}
       WHERE s.organization_id = $1 AND ($2 = 'all' OR s.status::text = $2)
       ORDER BY ${status === "pending" ? "c.period ASC, s.created_at ASC" : "s.created_at DESC"}
       LIMIT 200`,
      [orgId(c), status],
    );
    return c.json({ submissions: normalizeRows(rows) });
  });

  app.post("/api/payment-submissions/:id/approve", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const o = orgId(c);
    const reviewer = c.get("userId");
    const outcome = await c.get("sql").begin(async (raw) => {
      const tx = raw as unknown as Tx;
      const rows = (await tx.unsafe(
        `SELECT id, charge_id, document_id, amount::text, paid_on::text, reference, status
         FROM payment_submissions
         WHERE id = $1 AND organization_id = $2
         FOR UPDATE`,
        [id, o],
      )) as {
        id: string;
        charge_id: string;
        document_id: string | null;
        amount: string;
        paid_on: string;
        reference: string | null;
        status: string;
      }[];
      const submission = rows[0];
      if (!submission) return { ok: false as const, status: 404 as const, error: "Not found" };
      if (submission.status !== "pending") {
        return {
          ok: false as const,
          status: 409 as const,
          error: "Este comprobante ya fue revisado",
        };
      }
      const batch = submission.document_id
        ? ((await tx.unsafe(
            `SELECT s.id, s.charge_id, s.amount::text AS amount, s.paid_on::text AS paid_on, s.reference, c.period
             FROM payment_submissions s
             JOIN rent_charges c ON c.id = s.charge_id AND c.organization_id = s.organization_id
             WHERE s.organization_id = $1 AND s.document_id = $2 AND s.status = 'pending'
             ORDER BY c.period ASC, s.created_at ASC
             FOR UPDATE OF s`,
            [o, submission.document_id],
          )) as {
            id: string;
            charge_id: string;
            amount: string;
            paid_on: string;
            reference: string | null;
            period: string;
          }[])
        : [submission];
      const targets = batch.length > 0 ? batch : [submission];
      for (const item of targets) {
        const paid = await recordPayment(tx, {
          organizationId: o,
          chargeId: item.charge_id,
          amountCents: toCents(item.amount),
          paidAt: `${item.paid_on}T12:00:00Z`,
          method: "ach",
          reference: item.reference,
          notes: "Comprobante enviado desde el portal",
          source: "tenant_receipt",
          sourceId: item.id,
        });
        if (!paid.ok) return paid;
        await tx.unsafe(
          `UPDATE payment_submissions
           SET status = 'approved', reviewed_by = $3::uuid, reviewed_at = now(), payment_id = $4::uuid
           WHERE id = $1 AND organization_id = $2`,
          [item.id, o, reviewer, paid.paymentId],
        );
      }
      return { ok: true as const };
    });
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);
    const row = await get(c, `${STAFF_SELECT} WHERE s.id = $1 AND s.organization_id = $2`, [id, o]);
    return c.json({ submission: normalizeRow(row as Record<string, unknown>) });
  });

  app.post("/api/payment-submissions/:id/reject", async (c) => {
    const id = uuidParam(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const parsed = await parseJson(c, RejectBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const o = orgId(c);
    const updated = await get<{ id: string }>(
      c,
      `UPDATE payment_submissions AS s
       SET status = 'rejected', reviewed_by = $3::uuid, reviewed_at = now(), rejection_reason = $4
       WHERE s.organization_id = $2 AND s.status = 'pending'
         AND (
           s.id = $1
           OR s.document_id = (
             SELECT document_id FROM payment_submissions
             WHERE id = $1 AND organization_id = $2 AND document_id IS NOT NULL
           )
         )
       RETURNING s.id`,
      [id, o, c.get("userId"), parsed.data.reason],
    );
    if (updated) {
      await query(
        c,
        `DELETE FROM receipt_number_claims
         WHERE organization_id = $1
           AND document_id = (
             SELECT document_id FROM payment_submissions
             WHERE id = $2 AND organization_id = $1 AND document_id IS NOT NULL
           )`,
        [o, id],
      );
    }
    if (!updated) {
      const exists = await get(
        c,
        `SELECT 1 AS ok FROM payment_submissions WHERE id = $1 AND organization_id = $2`,
        [id, o],
      );
      return exists
        ? c.json({ error: "Este comprobante ya fue revisado" }, 409)
        : c.json({ error: "Not found" }, 404);
    }
    const row = await get(c, `${STAFF_SELECT} WHERE s.id = $1 AND s.organization_id = $2`, [id, o]);
    return c.json({ submission: normalizeRow(row as Record<string, unknown>) });
  });
}
