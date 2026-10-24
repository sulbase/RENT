import { z } from "zod";
import type { Context, Hono } from "hono";
import type { AppEnv } from "../env";
import { buildLeaseSummaryPdf } from "../integrations/lease-pdf";
import { createFirmaClient, FirmaError, type FirmaClient } from "../integrations/firma";
import { recordSignatureFailure } from "../notifications/signature-alerts";
import { get, normalizeRows, orgId, query, uuidParam } from "../pg";
import { receiveFirmaWebhook } from "../signatures/receive-webhook";
import { parseJson } from "../validation";

const OPEN_STATUSES = "('draft', 'sent', 'viewed', 'partially_signed')";

const Purpose = z.enum(["lease", "inventory"]);

const CreateBody = z.object({
  purpose: Purpose.default("lease"),
  document_id: z.string().uuid().optional(),
  recipients: z
    .array(
      z.object({
        first_name: z.string().trim().min(1).max(80),
        last_name: z.string().trim().min(1).max(80),
        email: z.string().trim().email().max(200),
        role: z.enum(["owner", "tenant"]),
        order: z.number().int().min(1).max(20).optional(),
      }),
    )
    .min(1)
    .max(10),
});

const CancelBody = z.object({
  reason: z.string().trim().max(500).optional(),
});

type LeaseRow = {
  id: string;
  start_date: string;
  end_date: string;
  monthly_rent: string;
  unit_name: string | null;
  property_name: string | null;
  tenant_first_name: string | null;
  tenant_last_name: string | null;
  tenant_government_id: string | null;
};

function firmaFor(c: Context<AppEnv>, override?: FirmaClient): FirmaClient | Response {
  if (override) return override;
  const apiKey = c.env.FIRMA_API_KEY?.trim();
  if (!apiKey) return c.json({ error: "Signing is not configured" }, 503);
  return createFirmaClient({ apiKey });
}

function firmaFailure(c: Context<AppEnv>, err: unknown): Response {
  if (err instanceof FirmaError) {
    const status = err.status === 429 || err.status === 402 ? err.status : 502;
    return c.json({ error: err.message }, status);
  }
  throw err;
}

async function loadLease(c: Context<AppEnv>, leaseId: string): Promise<LeaseRow | undefined> {
  return get<LeaseRow>(
    c,
    `SELECT l.id, l.start_date::text, l.end_date::text, l.monthly_rent::text,
            u.name AS unit_name, p.name AS property_name,
            t.first_name AS tenant_first_name, t.last_name AS tenant_last_name,
            t.government_id AS tenant_government_id
     FROM leases l
     LEFT JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
     LEFT JOIN properties p ON p.id = u.property_id AND p.organization_id = u.organization_id
     LEFT JOIN tenants t ON t.id = l.primary_tenant_id AND t.organization_id = l.organization_id
     WHERE l.id = $1 AND l.organization_id = $2`,
    [leaseId, orgId(c)],
  );
}

export function mountSignatureRoutes(app: Hono<AppEnv>, deps?: { firma?: FirmaClient }) {
  app.get("/api/leases/:id/signature", async (c) => {
    const leaseId = uuidParam(c.req.param("id"));
    if (!leaseId) return c.json({ error: "Invalid ID" }, 400);
    const lease = await loadLease(c, leaseId);
    if (!lease) return c.json({ error: "Not found" }, 404);
    const signatures = await query(
      c,
      `SELECT id, purpose, provider, provider_request_id, status, document_id, source_document_id,
              created_by, sent_at, completed_at, last_error, created_at
       FROM lease_signatures
       WHERE organization_id = $1 AND lease_id = $2
       ORDER BY created_at DESC`,
      [orgId(c), leaseId],
    );
    const recipients = await query(
      c,
      `SELECT r.id, r.signature_id, r.name, r.email, r.role, r.sort_order, r.status, r.signed_at,
              r.provider_recipient_id
       FROM lease_signature_recipients r
       JOIN lease_signatures s
         ON s.id = r.signature_id AND s.organization_id = r.organization_id
       WHERE s.organization_id = $1 AND s.lease_id = $2
       ORDER BY r.sort_order`,
      [orgId(c), leaseId],
    );
    const bySignature = new Map<string, Record<string, unknown>[]>();
    for (const recipient of normalizeRows(recipients)) {
      const signatureId = String(recipient.signature_id);
      const list = bySignature.get(signatureId) ?? [];
      list.push(recipient);
      bySignature.set(signatureId, list);
    }
    return c.json({
      signatures: normalizeRows(signatures).map((signature) => ({
        ...signature,
        recipients: bySignature.get(String(signature.id)) ?? [],
      })),
    });
  });

  app.post("/api/leases/:id/signature", async (c) => {
    const leaseId = uuidParam(c.req.param("id"));
    if (!leaseId) return c.json({ error: "Invalid ID" }, 400);
    const parsed = await parseJson(c, CreateBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const lease = await loadLease(c, leaseId);
    if (!lease) return c.json({ error: "Not found" }, 404);

    const client = firmaFor(c, deps?.firma);
    if (client instanceof Response) return client;

    const purpose = parsed.data.purpose ?? "lease";
    const open = await get<{ id: string }>(
      c,
      `SELECT id FROM lease_signatures
       WHERE organization_id = $1 AND lease_id = $2 AND purpose = $3 AND status IN ${OPEN_STATUSES}`,
      [orgId(c), leaseId, purpose],
    );
    if (open) return c.json({ error: "A signature request is already in progress" }, 409);

    const pdf = await loadPdf(c, lease, purpose, parsed.data.document_id);
    if ("error" in pdf) return c.json({ error: pdf.error }, pdf.status);

    const signatureId = crypto.randomUUID();
    try {
      await query(
        c,
        `INSERT INTO lease_signatures (
           id, organization_id, lease_id, purpose, provider, status, source_document_id, created_by
         ) VALUES ($1, $2, $3, $4, 'firma_dev', 'draft', $5, $6)`,
        [signatureId, orgId(c), leaseId, purpose, pdf.sourceDocumentId, c.get("userId")],
      );
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        return c.json({ error: "A signature request is already in progress" }, 409);
      }
      throw err;
    }

    const recipients = parsed.data.recipients.map((recipient, index) => ({
      ...recipient,
      tempId: `temp_signer_${index + 1}`,
      order: recipient.order ?? index + 1,
    }));

    let sent: Awaited<ReturnType<FirmaClient["createAndSend"]>>;
    try {
      sent = await client.createAndSend({
        name: `${purpose === "inventory" ? "Inventario" : "Contrato"} ${lease.property_name ?? ""} ${lease.unit_name ?? ""}`
          .trim()
          .slice(0, 255),
        pdf: pdf.bytes,
        filename: pdf.filename,
        recipients: recipients.map((recipient) => ({
          id: recipient.tempId,
          firstName: recipient.first_name,
          lastName: recipient.last_name,
          email: recipient.email,
          order: recipient.order,
        })),
      });
    } catch (err) {
      const message =
        err instanceof FirmaError ? err.message : "Could not send the signature request";
      await query(
        c,
        `UPDATE lease_signatures
         SET status = 'cancelled', last_error = $2
         WHERE id = $1 AND organization_id = $3`,
        [signatureId, message, orgId(c)],
      );
      await recordSignatureFailure(c.get("sql"), {
        organizationId: orgId(c),
        signatureId,
        message,
      });
      if (err instanceof FirmaError) return firmaFailure(c, err);
      throw err;
    }

    await query(
      c,
      `UPDATE lease_signatures
       SET provider_request_id = $2, status = 'sent', sent_at = now(), last_error = NULL
       WHERE id = $1 AND organization_id = $3`,
      [signatureId, sent.id, orgId(c)],
    );

    for (const recipient of recipients) {
      const remote = sent.recipients.find(
        (item) => item.email.toLowerCase() === recipient.email.toLowerCase(),
      );
      await query(
        c,
        `INSERT INTO lease_signature_recipients (
           organization_id, signature_id, provider_recipient_id, name, email, role, sort_order, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
        [
          orgId(c),
          signatureId,
          remote?.id || null,
          `${recipient.first_name} ${recipient.last_name}`.trim(),
          recipient.email,
          recipient.role,
          recipient.order,
        ],
      );
    }

    return c.json({ id: signatureId, provider_request_id: sent.id, status: "sent" }, 201);
  });

  app.post("/api/leases/:id/signature/resend", async (c) => {
    const leaseId = uuidParam(c.req.param("id"));
    if (!leaseId) return c.json({ error: "Invalid ID" }, 400);
    const purpose = purposeQuery(c);
    if (!purpose) return c.json({ error: "Invalid purpose" }, 400);
    const lease = await loadLease(c, leaseId);
    if (!lease) return c.json({ error: "Not found" }, 404);
    const client = firmaFor(c, deps?.firma);
    if (client instanceof Response) return client;

    const signature = await get<{ id: string; provider_request_id: string | null }>(
      c,
      `SELECT id, provider_request_id FROM lease_signatures
       WHERE organization_id = $1 AND lease_id = $2 AND purpose = $3 AND status IN ${OPEN_STATUSES}
       ORDER BY created_at DESC LIMIT 1`,
      [orgId(c), leaseId, purpose],
    );
    if (!signature?.provider_request_id) return c.json({ error: "Not found" }, 404);
    const pending = await query<{ provider_recipient_id: string | null }>(
      c,
      `SELECT provider_recipient_id FROM lease_signature_recipients
       WHERE organization_id = $1 AND signature_id = $2 AND status <> 'signed'
         AND provider_recipient_id IS NOT NULL`,
      [orgId(c), signature.id],
    );
    const ids = pending
      .map((row) => row.provider_recipient_id)
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) return c.json({ error: "No recipients left to remind" }, 409);
    try {
      await client.resend(signature.provider_request_id, ids);
    } catch (err) {
      const message =
        err instanceof FirmaError ? err.message : "Could not resend the signature request";
      await query(
        c,
        `UPDATE lease_signatures SET last_error = $2 WHERE id = $1 AND organization_id = $3`,
        [signature.id, message, orgId(c)],
      );
      await recordSignatureFailure(c.get("sql"), {
        organizationId: orgId(c),
        signatureId: signature.id,
        message,
      });
      return firmaFailure(c, err);
    }
    return c.json({ ok: true });
  });

  app.post("/api/leases/:id/signature/cancel", async (c) => {
    const leaseId = uuidParam(c.req.param("id"));
    if (!leaseId) return c.json({ error: "Invalid ID" }, 400);
    const purpose = purposeQuery(c);
    if (!purpose) return c.json({ error: "Invalid purpose" }, 400);
    const parsed = await parseJson(c, CancelBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const lease = await loadLease(c, leaseId);
    if (!lease) return c.json({ error: "Not found" }, 404);
    const client = firmaFor(c, deps?.firma);
    if (client instanceof Response) return client;

    const signature = await get<{ id: string; provider_request_id: string | null; status: string }>(
      c,
      `SELECT id, provider_request_id, status FROM lease_signatures
       WHERE organization_id = $1 AND lease_id = $2 AND purpose = $3 AND status IN ${OPEN_STATUSES}
       ORDER BY created_at DESC LIMIT 1`,
      [orgId(c), leaseId, purpose],
    );
    if (!signature) return c.json({ error: "Not found" }, 404);
    if (signature.provider_request_id) {
      try {
        await client.cancel(signature.provider_request_id, parsed.data.reason);
      } catch (err) {
        const message =
          err instanceof FirmaError ? err.message : "Could not cancel the signature request";
        await query(
          c,
          `UPDATE lease_signatures SET last_error = $2 WHERE id = $1 AND organization_id = $3`,
          [signature.id, message, orgId(c)],
        );
        await recordSignatureFailure(c.get("sql"), {
          organizationId: orgId(c),
          signatureId: signature.id,
          message,
        });
        return firmaFailure(c, err);
      }
    }
    await query(
      c,
      `UPDATE lease_signatures SET status = 'cancelled', last_error = NULL
       WHERE id = $1 AND organization_id = $2`,
      [signature.id, orgId(c)],
    );
    return c.json({ ok: true, status: "cancelled" });
  });
}

async function loadLandlord(c: Context<AppEnv>): Promise<{ name: string; governmentId: string }> {
  const rows = await query<{ key: string; value: string }>(
    c,
    `SELECT key, value FROM settings
     WHERE organization_id = $1
       AND key IN ('landlord_first_name', 'landlord_last_name', 'landlord_government_id')`,
    [orgId(c)],
  );
  const values = new Map(rows.map((row) => [row.key, row.value.trim()]));
  const name = [values.get("landlord_first_name"), values.get("landlord_last_name")]
    .filter(Boolean)
    .join(" ");
  return { name, governmentId: values.get("landlord_government_id") ?? "" };
}

function purposeQuery(c: Context<AppEnv>): "lease" | "inventory" | null {
  const parsed = Purpose.safeParse(c.req.query("purpose") ?? "lease");
  return parsed.success ? parsed.data : null;
}

async function loadPdf(
  c: Context<AppEnv>,
  lease: LeaseRow,
  purpose: "lease" | "inventory",
  documentId: string | undefined,
): Promise<
  | { bytes: Uint8Array; filename: string; sourceDocumentId: string | null }
  | { error: string; status: 400 | 404 | 503 }
> {
  if (!documentId) {
    if (purpose === "inventory") {
      return { error: "Sube un PDF de inventario antes de enviarlo a firma", status: 400 };
    }
    const tenantName = [lease.tenant_first_name, lease.tenant_last_name].filter(Boolean).join(" ");
    const landlord = await loadLandlord(c);
    const bytes = buildLeaseSummaryPdf([
      "Contrato de arrendamiento",
      `${lease.property_name ?? "Propiedad"} · ${lease.unit_name ?? "Unidad"}`,
      `Arrendador: ${landlord.name || "—"}`,
      `Identidad del arrendador: ${landlord.governmentId || "—"}`,
      `Inquilino: ${tenantName || "—"}`,
      `Identidad del inquilino: ${lease.tenant_government_id?.trim() || "—"}`,
      `Inicio: ${lease.start_date}`,
      `Fin: ${lease.end_date}`,
      `Renta mensual: ${lease.monthly_rent}`,
    ]);
    return {
      bytes,
      filename: "contrato.pdf",
      sourceDocumentId: null,
    };
  }

  const document = await get<{ r2_key: string; filename: string; mime: string; kind: string }>(
    c,
    `SELECT r2_key, filename, mime, kind FROM documents
     WHERE id = $1 AND organization_id = $2 AND entity_type = 'lease' AND entity_id = $3
       AND deleted_at IS NULL`,
    [documentId, orgId(c), lease.id],
  );
  if (!document) return { error: "Not found", status: 404 };
  if (document.mime !== "application/pdf")
    return { error: "The contract file must be a PDF", status: 400 };
  if (purpose === "inventory" && document.kind !== "inventory") {
    return { error: "The inventory file must be an inventory PDF", status: 400 };
  }
  if (
    purpose === "lease" &&
    (document.kind === "inventory" || document.kind === "signed_inventory")
  ) {
    return { error: "The lease file cannot be an inventory PDF", status: 400 };
  }
  const bucket = c.env.FILES;
  if (!bucket) return { error: "File storage is not configured", status: 503 };
  const object = await bucket.get(document.r2_key);
  if (!object) return { error: "Not found", status: 404 };
  const bytes = new Uint8Array(await object.arrayBuffer());
  return { bytes, filename: document.filename, sourceDocumentId: documentId };
}

export function mountFirmaWebhookRoute(app: Hono<AppEnv>, deps?: { firma?: FirmaClient }) {
  app.post("/api/webhooks/firma", (c) =>
    receiveFirmaWebhook(
      c,
      (task) => {
        try {
          c.executionCtx.waitUntil(task);
        } catch {
          // Unit tests call the app without a Workers execution context.
        }
      },
      deps?.firma,
    ),
  );
}
