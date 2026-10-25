import { z } from "zod";
import type { Context, Hono } from "hono";
import { createIpRateLimit } from "../auth/rate-limit";
import {
  buildObjectKey,
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
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
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

/** Tomorrow in UTC, so a tenant ahead of UTC can still date a transfer "today". */
function latestPaidOn(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

function portalTenant(c: Context<AppEnv>): string | null {
  return c.get("portalTenantId") ?? null;
}

const STAFF_SELECT = `
  SELECT s.id, s.charge_id, s.amount, s.paid_on::text AS paid_on, s.reference, s.note, s.status,
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
      `SELECT s.id, s.charge_id, s.amount, s.paid_on::text AS paid_on, s.reference, s.status,
              s.rejection_reason, s.created_at, s.reviewed_at, c.period
       FROM payment_submissions s
       JOIN rent_charges c ON c.id = s.charge_id AND c.organization_id = s.organization_id
       WHERE s.organization_id = $1 AND s.tenant_id = $2
       ORDER BY s.created_at DESC
       LIMIT 100`,
      [orgId(c), tenantId],
    );
    return c.json({ submissions: normalizeRows(rows) });
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
        await tx.unsafe(
          `INSERT INTO payment_submissions (
             id, organization_id, tenant_id, charge_id, document_id,
             amount, paid_on, reference, note, submitted_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10)`,
          [
            submissionId,
            o,
            tenantId,
            chargeId,
            documentId,
            centsToAmount(amountCents),
            d.paid_on,
            d.reference || null,
            d.note || null,
            c.get("userId"),
          ],
        );
      });
    } catch (err) {
      await bucket.delete(r2Key);
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
    const fields = z
      .object({
        paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de pago inválida"),
        reference: z.string().trim().max(120).optional(),
        note: z.string().trim().max(500).optional(),
      })
      .safeParse({
        paid_on: formText(body.paid_on),
        reference: formText(body.reference),
        note: formText(body.note),
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
      pending: number;
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
              c.status, c.period,
              (SELECT COUNT(*)::int FROM payment_submissions s
               WHERE s.charge_id = c.id AND s.organization_id = c.organization_id
                 AND s.status = 'pending') AS pending,
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
    const allocations: { id: string; period: string; cents: number }[] = [];
    for (const row of rows) {
      if (row.status === "paid" || row.status === "waived") {
        return c.json({ error: "Un cargo ya no tiene saldo pendiente" }, 409);
      }
      if (Number(row.pending) >= MAX_PENDING_PER_CHARGE) {
        return c.json({ error: "Ya tienes comprobantes en revisión para un cargo" }, 409);
      }
      const cents = toCents(row.amount) - toCents(row.amount_paid);
      if (cents <= 0) return c.json({ error: "Un cargo ya no tiene saldo pendiente" }, 409);
      allocations.push({ id: row.id, period: row.period, cents });
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
        for (let i = 0; i < allocations.length; i++) {
          const row = allocations[i];
          if (!row) continue;
          await tx.unsafe(
            `INSERT INTO payment_submissions (
               id, organization_id, tenant_id, charge_id, document_id,
               amount, paid_on, reference, note, submitted_by
             ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10)`,
            [
              submissionIds[i],
              o,
              tenantId,
              row.id,
              documentId,
              centsToAmount(row.cents),
              fields.data.paid_on,
              fields.data.reference || null,
              fields.data.note || null,
              c.get("userId"),
            ],
          );
        }
      });
    } catch (err) {
      await bucket.delete(r2Key);
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
       ORDER BY s.created_at ${status === "pending" ? "ASC" : "DESC"}
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
        `SELECT charge_id, amount::text, paid_on::text, reference, status
         FROM payment_submissions
         WHERE id = $1 AND organization_id = $2
         FOR UPDATE`,
        [id, o],
      )) as {
        charge_id: string;
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
      const paid = await recordPayment(tx, {
        organizationId: o,
        chargeId: submission.charge_id,
        amountCents: toCents(submission.amount),
        paidAt: `${submission.paid_on}T12:00:00Z`,
        method: "ach",
        reference: submission.reference,
        notes: "Comprobante enviado desde el portal",
        source: "tenant_receipt",
        sourceId: id,
      });
      if (!paid.ok) return paid;
      await tx.unsafe(
        `UPDATE payment_submissions
         SET status = 'approved', reviewed_by = $3::uuid, reviewed_at = now(), payment_id = $4::uuid
         WHERE id = $1 AND organization_id = $2`,
        [id, o, reviewer, paid.paymentId],
      );
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
      `UPDATE payment_submissions
       SET status = 'rejected', reviewed_by = $3::uuid, reviewed_at = now(), rejection_reason = $4
       WHERE id = $1 AND organization_id = $2 AND status = 'pending'
       RETURNING id`,
      [id, o, c.get("userId"), parsed.data.reason],
    );
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
