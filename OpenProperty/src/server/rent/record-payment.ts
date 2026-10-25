import type { SqlParam } from "../pg";
import {
  ACTIVE_PAYMENT_SUM_SQL,
  APPLY_CHARGE_BALANCE_SQL,
  centsToAmount,
  rejectPayment,
  toCents,
} from "./payment-balance";

type Tx = {
  unsafe: (text: string, params?: SqlParam[]) => Promise<unknown>;
};

export type PaymentMethodValue = "cash" | "check" | "ach" | "credit" | "other";

/** Where the payment came from, kept in `payments.metadata.source`. */
export type PaymentSource = "staff" | "tenant_receipt";

export type RecordPaymentInput = {
  organizationId: string;
  chargeId: string;
  amountCents: number;
  paidAt: string | null;
  method: PaymentMethodValue;
  reference: string | null;
  notes: string | null;
  source: PaymentSource;
  sourceId?: string | null;
};

export type RecordPaymentOutcome =
  | { ok: true; paymentId: string | null }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Locks the charge, refuses anything above its balance and recalculates it.
 * Every way of paying a charge goes through here, inside the caller's transaction.
 */
export async function recordPayment(
  tx: Tx,
  input: RecordPaymentInput,
): Promise<RecordPaymentOutcome> {
  const charges = (await tx.unsafe(
    "SELECT amount::text, status FROM rent_charges WHERE id = $1 AND organization_id = $2 FOR UPDATE",
    [input.chargeId, input.organizationId],
  )) as { amount: string; status: string }[];
  const charge = charges[0];
  if (!charge) return { ok: false, status: 404, error: "Cargo no encontrado" };
  const sums = (await tx.unsafe(ACTIVE_PAYMENT_SUM_SQL, [
    input.chargeId,
    input.organizationId,
  ])) as {
    total: string;
  }[];
  const paidCents = toCents(sums[0]?.total ?? "0");
  const rejection = rejectPayment({
    chargeStatus: charge.status,
    chargeCents: toCents(charge.amount),
    paidCents,
    amountCents: input.amountCents,
  });
  if (rejection) return { ok: false, status: 400, error: rejection };
  const metadata = JSON.stringify(
    input.sourceId ? { source: input.source, source_id: input.sourceId } : { source: input.source },
  );
  const inserted = (await tx.unsafe(
    `INSERT INTO payments (organization_id, charge_id, paid_at, amount, method, reference, notes, metadata)
     VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, $5, $6, $7, $8::jsonb)
     RETURNING id`,
    [
      input.organizationId,
      input.chargeId,
      input.paidAt,
      centsToAmount(input.amountCents),
      input.method,
      input.reference,
      input.notes,
      metadata,
    ],
  )) as { id: string }[];
  await tx.unsafe(APPLY_CHARGE_BALANCE_SQL, [
    centsToAmount(paidCents + input.amountCents),
    input.chargeId,
    input.organizationId,
  ]);
  return { ok: true, paymentId: inserted[0]?.id ?? null };
}
