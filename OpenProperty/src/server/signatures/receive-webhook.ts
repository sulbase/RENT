import { z } from "zod";
import type { Context } from "hono";
import { createDbHandle, type Sql } from "../db";
import type { AppEnv, WorkerBindings } from "../env";
import { verifyFirmaWebhook } from "../integrations/firma-webhook";
import { createFirmaClient, FirmaError, type FirmaClient } from "../integrations/firma";
import { insertNotification } from "../notifications/insert";
import { recordSignatureFailure, signatureEventDraft } from "../notifications/signature-alerts";
import { archiveSignedLease } from "./archive-signed";
import { reduceFirmaEvent, type FirmaWebhookEvent, type SignatureState } from "./reduce-event";

const Payload = z.object({
  id: z.string().optional(),
  type: z.string(),
  data: z
    .object({
      signing_request: z
        .object({
          id: z.string(),
        })
        .passthrough()
        .optional(),
      recipients: z
        .array(
          z
            .object({
              id: z.string().optional(),
              email: z.string().optional(),
              signed_at: z.string().nullable().optional(),
            })
            .passthrough(),
        )
        .optional(),
    })
    .passthrough()
    .optional(),
});

type RecipientRow = {
  email: string;
  provider_recipient_id: string | null;
  status: SignatureState["recipients"][number]["status"];
  signed_at: string | null;
};

type SignatureRow = {
  id: string;
  organization_id: string;
  lease_id: string;
  provider_request_id: string;
  status: SignatureState["status"];
  document_id: string | null;
  purpose: string | null;
};

async function one<T>(sql: Sql, text: string, params: unknown[]): Promise<T | undefined> {
  const rows = await sql.unsafe(text, params as never[]);
  return (rows as unknown as T[])[0];
}

function parseEvent(rawBody: string): FirmaWebhookEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const parsed = Payload.safeParse(json);
  if (!parsed.success) return null;
  const signingRequestId = parsed.data.data?.signing_request?.id;
  if (!signingRequestId) return null;
  return {
    type: parsed.data.type,
    signingRequestId,
    recipients: (parsed.data.data?.recipients ?? []).map((recipient) => ({
      id: recipient.id,
      email: recipient.email,
      signedAt: recipient.signed_at,
    })),
  };
}

export async function receiveFirmaWebhook(
  c: Context<AppEnv>,
  schedule: (task: Promise<void>) => void,
  firma?: FirmaClient,
): Promise<Response> {
  const secret = c.env.FIRMA_WEBHOOK_SECRET?.trim();
  if (!secret) return c.json({ error: "Webhook is not configured" }, 503);

  const rawBody = await c.req.text();
  const valid = await verifyFirmaWebhook({
    rawBody,
    signatureHeader: c.req.header("X-Firma-Signature"),
    previousSignatureHeader: c.req.header("X-Firma-Signature-Old"),
    secret,
  });
  if (!valid) return c.json({ error: "Invalid signature" }, 401);

  const deliveryId = c.req.header("X-Firma-Delivery")?.trim();
  if (!deliveryId) return c.json({ error: "Missing delivery id" }, 400);

  const event = parseEvent(rawBody);
  const claimed = await one<{ delivery_id: string }>(
    c.get("sql"),
    `INSERT INTO firma_webhook_deliveries (delivery_id, event_id)
     VALUES ($1, $2)
     ON CONFLICT (delivery_id) DO NOTHING
     RETURNING delivery_id`,
    [deliveryId, event ? event.type : null],
  );
  if (!claimed) return c.json({ received: true });
  if (!event) return c.json({ received: true });

  const env = c.env;
  const client = firma ?? firmaFromEnv(env);
  schedule(
    applyWebhookEvent(env, event, client).catch((err: unknown) => {
      console.error(
        JSON.stringify({
          msg: "firma webhook processing failed",
          type: event.type,
          error: err instanceof Error ? err.message : "unknown",
        }),
      );
    }),
  );
  return c.json({ received: true });
}

async function rememberSignatureError(
  sql: Sql,
  signature: SignatureRow,
  message: string,
): Promise<void> {
  await sql.unsafe(`UPDATE lease_signatures SET last_error = $2 WHERE id = $1`, [
    signature.id,
    message,
  ]);
  await recordSignatureFailure(sql, {
    organizationId: signature.organization_id,
    signatureId: signature.id,
    message,
  });
}

async function notifySignatureTransition(
  sql: Sql,
  signature: SignatureRow,
  previous: SignatureState,
  next: SignatureState,
  event: FirmaWebhookEvent,
): Promise<void> {
  try {
    if (event.type === "signing_request.recipient.signed") {
      for (const recipient of next.recipients) {
        const before = previous.recipients.find(
          (item) => item.email.trim().toLowerCase() === recipient.email.trim().toLowerCase(),
        );
        if (recipient.status !== "signed" || before?.status === "signed") continue;
        await insertNotification(
          sql,
          signatureEventDraft({
            organizationId: signature.organization_id,
            signatureId: signature.id,
            event: "signed",
            signerEmail: recipient.email,
            detail:
              signature.purpose === "inventory"
                ? `${recipient.email} firmó el inventario`
                : `${recipient.email} firmó el contrato`,
          }),
        );
      }
    }
    if (next.status === "completed" && previous.status !== "completed") {
      await insertNotification(
        sql,
        signatureEventDraft({
          organizationId: signature.organization_id,
          signatureId: signature.id,
          event: "completed",
          label: signature.purpose === "inventory" ? "inventario" : "contrato",
          detail:
            signature.purpose === "inventory"
              ? "Todos los firmantes completaron el inventario"
              : "Todos los firmantes completaron el contrato",
        }),
      );
    }
    if (
      (next.status === "declined" || next.status === "expired") &&
      next.status !== previous.status
    ) {
      await insertNotification(
        sql,
        signatureEventDraft({
          organizationId: signature.organization_id,
          signatureId: signature.id,
          event: next.status,
          detail:
            next.status === "declined"
              ? "Un firmante rechazó la solicitud"
              : "La solicitud de firma expiró",
        }),
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: "mailbox signature event insert failed",
        error: err instanceof Error ? err.message : "unknown",
      }),
    );
  }
}

function firmaFromEnv(env: WorkerBindings): FirmaClient | null {
  const apiKey = env.FIRMA_API_KEY?.trim();
  if (!apiKey) return null;
  return createFirmaClient({ apiKey });
}

async function applyWebhookEvent(
  env: WorkerBindings,
  event: FirmaWebhookEvent,
  firma: FirmaClient | null,
): Promise<void> {
  const handle = createDbHandle(env);
  try {
    const signature = await one<SignatureRow>(
      handle.sql,
      `SELECT id, organization_id, lease_id, purpose, provider_request_id, status, document_id
       FROM lease_signatures
       WHERE provider_request_id = $1`,
      [event.signingRequestId],
    );
    if (!signature) return;

    const recipientRows = await handle.sql.unsafe(
      `SELECT email, provider_recipient_id, status, signed_at
       FROM lease_signature_recipients
       WHERE signature_id = $1 AND organization_id = $2
       ORDER BY sort_order`,
      [signature.id, signature.organization_id],
    );
    const current: SignatureState = {
      status: signature.status,
      recipients: (recipientRows as unknown as RecipientRow[]).map((row) => ({
        email: row.email,
        providerRecipientId: row.provider_recipient_id,
        status: row.status,
        signedAt: row.signed_at,
      })),
    };
    const next = reduceFirmaEvent(current, event);
    const audit = JSON.stringify({
      type: event.type,
      at: new Date().toISOString(),
    });

    await handle.sql.unsafe(
      `UPDATE lease_signatures
       SET status = $2,
           completed_at = CASE WHEN $2 = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END,
           last_error = NULL,
           audit = audit || $3::jsonb
       WHERE id = $1 AND organization_id = $4`,
      [signature.id, next.state.status, `[${audit}]`, signature.organization_id],
    );

    for (const recipient of next.state.recipients) {
      await handle.sql.unsafe(
        `UPDATE lease_signature_recipients
         SET status = $3, signed_at = $4
         WHERE signature_id = $1 AND organization_id = $2 AND lower(email) = lower($5)`,
        [
          signature.id,
          signature.organization_id,
          recipient.status,
          recipient.signedAt,
          recipient.email,
        ],
      );
    }

    await notifySignatureTransition(handle.sql, signature, current, next.state, event);

    if (!next.archive || signature.document_id) return;
    if (!firma) {
      await rememberSignatureError(handle.sql, signature, "FIRMA_API_KEY is not configured");
      return;
    }
    try {
      const download = await firma.download(signature.provider_request_id);
      if (download.isPartial || download.status !== "finished") {
        await rememberSignatureError(handle.sql, signature, "Signed PDF is not ready yet");
        return;
      }
      await archiveSignedLease({
        sql: handle.sql,
        bucket: env.FILES,
        signature,
        downloadUrl: download.downloadUrl,
      });
    } catch (err) {
      const message = err instanceof FirmaError ? err.message : "Could not archive the signed PDF";
      await rememberSignatureError(handle.sql, signature, message);
    }
  } finally {
    await handle.close();
  }
}
