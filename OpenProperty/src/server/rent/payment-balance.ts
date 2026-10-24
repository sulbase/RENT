export function hasAtMostTwoDecimals(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

/** Cents avoid float drift when comparing a payment with the charge balance. */
export function toCents(value: string | number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(n * 100);
}

export function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

export const ACTIVE_PAYMENT_SUM_SQL = `SELECT COALESCE(SUM(amount), 0)::text AS total
 FROM payments
 WHERE charge_id = $1 AND organization_id = $2 AND voided_at IS NULL`;

/** Recalculate a charge from the sum of payments that still count. */
export const APPLY_CHARGE_BALANCE_SQL = `UPDATE rent_charges
 SET amount_paid = $1::numeric,
     status = (CASE
       WHEN status = 'waived' THEN 'waived'
       WHEN $1::numeric >= amount THEN 'paid'
       WHEN due_date < CURRENT_DATE THEN 'overdue'
       WHEN $1::numeric > 0 THEN 'partial'
       ELSE 'open'
     END)::rent_charge_status
 WHERE id = $2 AND organization_id = $3`;

export function rejectPayment(input: {
  chargeStatus: string;
  chargeCents: number;
  paidCents: number;
  amountCents: number;
}): string | null {
  if (input.chargeStatus === "waived") return "El cargo está condonado.";
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return "El importe debe ser mayor que cero.";
  }
  const remaining = input.chargeCents - input.paidCents;
  if (input.amountCents > remaining) return "El importe supera el saldo del cargo.";
  return null;
}
