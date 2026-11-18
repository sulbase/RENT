export type OpenChargeSlice = {
  id: string;
  period: string;
  remainingCents: number;
  /** Rent is applied before parking when both belong to the same month. */
  kind?: string;
};

export type ChargeAllocation = {
  id: string;
  period: string;
  cents: number;
};

/**
 * Apply a transfer to open charges, oldest rent period first.
 * A shortfall stays on the newest period that still has a balance.
 */
export function allocateOldestFirst(
  charges: OpenChargeSlice[],
  amountCents: number,
): { ok: true; rows: ChargeAllocation[] } | { ok: false; error: "amount" | "exceeds" | "empty" } {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, error: "amount" };
  const ordered = charges
    .filter((row) => row.remainingCents > 0)
    .sort((a, b) => {
      if (a.period !== b.period) return a.period < b.period ? -1 : 1;
      const rank = (kind?: string) => (kind === "parking" ? 1 : 0);
      return rank(a.kind) - rank(b.kind) || a.id.localeCompare(b.id);
    });
  const total = ordered.reduce((sum, row) => sum + row.remainingCents, 0);
  if (total <= 0) return { ok: false, error: "empty" };
  if (amountCents > total) return { ok: false, error: "exceeds" };
  const rows: ChargeAllocation[] = [];
  let left = amountCents;
  for (const row of ordered) {
    if (left <= 0) break;
    const cents = Math.min(row.remainingCents, left);
    rows.push({ id: row.id, period: row.period, cents });
    left -= cents;
  }
  return { ok: true, rows };
}
