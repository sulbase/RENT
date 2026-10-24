import type { Sql } from "../db";
import { insertNotification } from "./insert";
import type { NotificationDraft, NotificationSeverity } from "./types";

const PERIOD_MAX = 80;

function period(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= PERIOD_MAX ? trimmed : trimmed.slice(0, PERIOD_MAX);
}

function rateLimited(message: string): boolean {
  return /rate limit/i.test(message);
}

export function signatureEventDraft(input: {
  organizationId: string;
  signatureId: string;
  event: "signed" | "completed" | "declined" | "expired";
  detail: string;
  signerEmail?: string;
  label?: "contrato" | "inventario";
}): NotificationDraft {
  const titles = {
    signed: "Firma recibida",
    completed: input.label === "inventario" ? "Inventario firmado" : "Contrato firmado",
    declined: "Firma rechazada",
    expired: "Solicitud de firma vencida",
  } as const;
  const severities: Record<typeof input.event, NotificationSeverity> = {
    signed: "info",
    completed: "info",
    declined: "warning",
    expired: "warning",
  };
  const logicalPeriod =
    input.event === "signed"
      ? `signed:${(input.signerEmail ?? "firmante").trim().toLowerCase()}`
      : input.event;
  return {
    organizationId: input.organizationId,
    kind: "signature",
    title: titles[input.event],
    body: input.detail.trim() || titles[input.event],
    severity: severities[input.event],
    entityType: "lease_signature",
    entityId: input.signatureId,
    period: period(logicalPeriod),
  };
}

export function signatureFailureDraft(input: {
  organizationId: string;
  signatureId: string;
  message: string;
}): NotificationDraft {
  const limited = rateLimited(input.message);
  return {
    organizationId: input.organizationId,
    kind: "signature",
    title: limited ? "Límite de firma.dev" : "Fallo en la firma",
    body: input.message.trim() || "No se pudo completar la firma",
    severity: limited ? "warning" : "critical",
    entityType: "lease_signature",
    entityId: input.signatureId,
    period: "error",
  };
}

/** Records a firma.dev failure in the mailbox. Does not throw if the insert fails. */
export async function recordSignatureFailure(
  sql: Sql,
  input: { organizationId: string; signatureId: string; message: string },
): Promise<void> {
  try {
    await insertNotification(sql, signatureFailureDraft(input));
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: "mailbox signature failure insert failed",
        error: err instanceof Error ? err.message : "unknown",
      }),
    );
  }
}
