import { z } from "zod";
import type { Context, Hono } from "hono";
import type { AppEnv } from "../env";
import { buildLeaseContractPdf, type ContractBlock } from "../integrations/lease-pdf";
import { createFirmaClient, FirmaError, type FirmaClient } from "../integrations/firma";
import { insertNotification } from "../notifications/insert";
import { recordSignatureFailure, signatureEventDraft } from "../notifications/signature-alerts";
import { archiveSignedLease } from "../signatures/archive-signed";
import { get, normalizeRows, orgId, query, uuidParam } from "../pg";
import { receiveFirmaWebhook } from "../signatures/receive-webhook";
import { clampRentDueDay } from "../../shared/rent-due-day";
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
  deposit: string | null;
  rent_due_day: number | null;
  late_fee: string | null;
  late_fee_grace_days: number | null;
  guarantee_months: string | null;
  notes: string | null;
  unit_name: string | null;
  property_name: string | null;
  property_address: string | null;
  property_city: string | null;
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
            l.deposit::text, l.rent_due_day, l.late_fee::text, l.late_fee_grace_days, l.notes,
            l.metadata->>'guarantee_months' AS guarantee_months,
            u.name AS unit_name, p.name AS property_name,
            p.address AS property_address, p.city AS property_city,
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

export function mountSignatureRoutes(
  app: Hono<AppEnv>,
  deps?: { firma?: FirmaClient; fetch?: typeof fetch },
) {
  /** Asks firma.dev directly, for when the webhook never reached this Worker. */
  app.post("/api/leases/:id/signature/sync", async (c) => {
    const leaseId = uuidParam(c.req.param("id"));
    if (!leaseId) return c.json({ error: "Invalid ID" }, 400);
    const purpose = purposeQuery(c);
    if (!purpose) return c.json({ error: "Invalid purpose" }, 400);
    const lease = await loadLease(c, leaseId);
    if (!lease) return c.json({ error: "Not found" }, 404);

    const signature = await get<{
      id: string;
      organization_id: string;
      lease_id: string;
      purpose: string;
      provider_request_id: string;
      status: string;
      document_id: string | null;
    }>(
      c,
      `SELECT id, organization_id, lease_id, purpose, provider_request_id, status, document_id
       FROM lease_signatures
       WHERE organization_id = $1 AND lease_id = $2 AND purpose = $3
         AND provider_request_id IS NOT NULL
         AND (status IN ${OPEN_STATUSES} OR (status = 'completed' AND document_id IS NULL))
       ORDER BY created_at DESC LIMIT 1`,
      [orgId(c), leaseId, purpose],
    );
    if (!signature) return c.json({ status: "none", completed: false });

    const client = firmaFor(c, deps?.firma);
    if (client instanceof Response) return client;
    let download: Awaited<ReturnType<FirmaClient["download"]>>;
    try {
      download = await client.download(signature.provider_request_id);
    } catch (err) {
      if (
        err instanceof FirmaError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 429
      ) {
        return c.json({ status: signature.status, completed: false });
      }
      return firmaFailure(c, err);
    }
    if (download.isPartial || download.status !== "finished") {
      return c.json({ status: signature.status, completed: false });
    }

    await archiveSignedLease({
      sql: c.get("sql"),
      bucket: c.env.FILES,
      fetchImpl: deps?.fetch,
      signature,
      downloadUrl: download.downloadUrl,
    });
    await query(
      c,
      `UPDATE lease_signatures
       SET status = 'completed', completed_at = COALESCE(completed_at, now())
       WHERE id = $1 AND organization_id = $2`,
      [signature.id, orgId(c)],
    );
    await query(
      c,
      `UPDATE lease_signature_recipients
       SET status = 'signed', signed_at = COALESCE(signed_at, now())
       WHERE signature_id = $1 AND organization_id = $2`,
      [signature.id, orgId(c)],
    );
    if (signature.status !== "completed") {
      const inventory = signature.purpose === "inventory";
      const place = [lease.property_name, lease.unit_name].filter(Boolean).join(" · ");
      await insertNotification(
        c.get("sql"),
        signatureEventDraft({
          organizationId: orgId(c),
          signatureId: signature.id,
          event: "completed",
          label: inventory ? "inventario" : "contrato",
          detail: `Todos los firmantes completaron el ${inventory ? "inventario" : "contrato"}${place ? ` de ${place}` : ""}`,
        }),
      );
    }
    const archived = await get<{ document_id: string | null; last_error: string | null }>(
      c,
      `SELECT document_id, last_error FROM lease_signatures WHERE id = $1 AND organization_id = $2`,
      [signature.id, orgId(c)],
    );
    return c.json({
      status: "completed",
      completed: true,
      document_id: archived?.document_id ?? null,
      error: archived?.document_id ? null : (archived?.last_error ?? null),
    });
  });

  app.get("/api/leases/:id/signature/preview", async (c) => {
    const leaseId = uuidParam(c.req.param("id"));
    if (!leaseId) return c.json({ error: "Invalid ID" }, 400);
    const rawDocumentId = c.req.query("document_id");
    const documentId = rawDocumentId ? uuidParam(rawDocumentId) : undefined;
    if (rawDocumentId && !documentId) return c.json({ error: "Invalid ID" }, 400);
    const lease = await loadLease(c, leaseId);
    if (!lease) return c.json({ error: "Not found" }, 404);
    const pdf = await loadPdf(c, lease, "lease", documentId ?? undefined);
    if ("error" in pdf) return c.json({ error: pdf.error }, pdf.status);
    return new Response(pdf.bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.bytes.byteLength),
        "Content-Disposition": `inline; filename="${pdf.filename.replace(/["\\\r\n]/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

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
        signaturePage: pdf.signaturePage,
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

const DOLLARS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

function dollars(value: string | null): string {
  const amount = Number.parseFloat(value ?? "");
  return Number.isFinite(amount) ? DOLLARS.format(amount) : "—";
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** `2026-09-27` → `27 de septiembre de 2026`. */
function longDate(iso: string): string {
  const [year, month, day] = iso.split("-").map((part) => Number.parseInt(part, 10));
  const name = MONTHS[(month ?? 0) - 1];
  if (!year || !name || !day) return iso;
  return `${day} de ${name} de ${year}`;
}

/** Built-in contract. Preview and send both use it, so what is read is what is signed. */
function contractPdf(lease: LeaseRow, landlord: { name: string; governmentId: string }) {
  const tenantName =
    [lease.tenant_first_name, lease.tenant_last_name].filter(Boolean).join(" ") || "—";
  const tenantId = lease.tenant_government_id?.trim() || "—";
  const landlordName = landlord.name || "—";
  const landlordId = landlord.governmentId || "—";
  const unit = lease.unit_name ?? "Unidad";
  const property = lease.property_name ?? "Propiedad";
  const where = [lease.property_address, lease.property_city].filter(Boolean).join(", ");
  const dueDay = clampRentDueDay(lease.rent_due_day ?? 1);
  const guaranteeMonths = Number.parseInt(lease.guarantee_months ?? "", 10) || 0;

  const blocks: ContractBlock[] = [
    { kind: "title", text: "CONTRATO DE ARRENDAMIENTO" },
    {
      kind: "paragraph",
      text: `Comparecen, por una parte, ${landlordName}, con identificación ${landlordId}, a quien en adelante se denominará "el ARRENDADOR"; y, por otra, ${tenantName}, con identificación ${tenantId}, a quien en adelante se denominará "el ARRENDATARIO". Las partes acuerdan celebrar el presente contrato de arrendamiento al tenor de las siguientes cláusulas:`,
    },
    { kind: "heading", text: "PRIMERA. OBJETO" },
    {
      kind: "paragraph",
      text: `El ARRENDADOR da en arrendamiento al ARRENDATARIO la unidad ${unit} de ${property}${where ? `, ubicada en ${where}` : ""}, que el ARRENDATARIO destinará exclusivamente a vivienda.`,
    },
    { kind: "heading", text: "SEGUNDA. PLAZO" },
    {
      kind: "paragraph",
      text: `El plazo del arrendamiento es desde el ${longDate(lease.start_date)} hasta el ${longDate(lease.end_date)}. Si las partes desean renovarlo, lo harán por escrito antes de su vencimiento.`,
    },
    { kind: "heading", text: "TERCERA. CANON DE ARRENDAMIENTO" },
    {
      kind: "paragraph",
      text: `El ARRENDATARIO pagará una renta mensual de ${dollars(lease.monthly_rent)}, por adelantado, a más tardar el día ${dueDay} de cada mes, mediante los medios de pago que indique el ARRENDADOR.`,
    },
    { kind: "heading", text: "CUARTA. MORA" },
    {
      kind: "paragraph",
      text: lease.late_fee_grace_days
        ? `Si el pago no se realiza dentro de los ${lease.late_fee_grace_days} días siguientes a la fecha acordada, el ARRENDATARIO pagará un recargo por mora de ${dollars(lease.late_fee)}, sin perjuicio de las demás acciones que correspondan al ARRENDADOR.`
        : `Si el pago no se realiza en la fecha acordada, el ARRENDATARIO pagará un recargo por mora de ${dollars(lease.late_fee)}, sin perjuicio de las demás acciones que correspondan al ARRENDADOR.`,
    },
    { kind: "heading", text: "QUINTA. GARANTÍA" },
    {
      kind: "paragraph",
      text: `El ARRENDATARIO entrega en garantía la suma de ${dollars(lease.deposit)}${guaranteeMonths ? `, equivalente a ${guaranteeMonths === 1 ? "un (1) mes" : `${guaranteeMonths} meses`} de renta` : ""}. Al terminar el contrato, el ARRENDADOR la devolverá una vez verificado el estado de la unidad, descontando el valor de los daños causados y de cualquier pago pendiente.`,
    },
    { kind: "heading", text: "SEXTA. USO Y CONSERVACIÓN" },
    {
      kind: "paragraph",
      text: "El ARRENDATARIO usará la unidad con cuidado, la mantendrá en buen estado y asumirá las reparaciones menores derivadas del uso diario. No podrá subarrendarla, cederla ni hacer modificaciones sin autorización escrita del ARRENDADOR.",
    },
    { kind: "heading", text: "SÉPTIMA. SERVICIOS" },
    {
      kind: "paragraph",
      text: "Los consumos de servicios básicos durante el arrendamiento correrán por cuenta del ARRENDATARIO, salvo acuerdo distinto por escrito.",
    },
    { kind: "heading", text: "OCTAVA. INVENTARIO" },
    {
      kind: "paragraph",
      text: "El estado de la unidad al momento de la entrega consta en el inventario y las fotografías registradas en el sistema, que forman parte de este contrato. La unidad se devolverá en el mismo estado, salvo el desgaste normal por el uso.",
    },
    { kind: "heading", text: "NOVENA. TERMINACIÓN" },
    {
      kind: "paragraph",
      text: "El contrato termina al vencer el plazo, por mutuo acuerdo o por incumplimiento de cualquiera de las partes. La parte que desee terminarlo antes del plazo avisará por escrito con al menos treinta (30) días de anticipación.",
    },
  ];
  const notes = lease.notes?.trim();
  if (notes) {
    blocks.push(
      { kind: "heading", text: "DÉCIMA. CLÁUSULA ADICIONAL" },
      { kind: "paragraph", text: notes },
    );
  }
  blocks.push(
    { kind: "heading", text: notes ? "UNDÉCIMA. ACEPTACIÓN" : "DÉCIMA. ACEPTACIÓN" },
    {
      kind: "paragraph",
      text: "Las partes declaran haber leído el presente contrato, lo aceptan en todas sus partes y lo firman electrónicamente.",
    },
  );

  return buildLeaseContractPdf(blocks, [
    { role: "ARRENDADOR", name: landlordName, governmentId: landlordId },
    { role: "ARRENDATARIO", name: tenantName, governmentId: tenantId },
  ]);
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
  | { bytes: Uint8Array; filename: string; sourceDocumentId: string | null; signaturePage: number }
  | { error: string; status: 400 | 404 | 503 }
> {
  if (!documentId) {
    if (purpose === "inventory") {
      return { error: "Sube un PDF de inventario antes de enviarlo a firma", status: 400 };
    }
    const contract = contractPdf(lease, await loadLandlord(c));
    return {
      bytes: contract.bytes,
      filename: "contrato.pdf",
      sourceDocumentId: null,
      signaturePage: contract.pageCount,
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
  return { bytes, filename: document.filename, sourceDocumentId: documentId, signaturePage: 1 };
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
