export type LedgerKind = "charge" | "payment";
export type LedgerSource = "owner" | "tenant";

export type LedgerCharge = {
  id: string;
  due_date: string;
  amount: number;
  status: string;
  period: string;
  property_name?: string | null;
  unit_name?: string | null;
  lease_id?: string;
};

export type LedgerPayment = {
  id: string;
  paid_at: string;
  amount: number;
  method: string;
  voided_at?: string | null;
  void_reason?: string | null;
  property_name?: string | null;
  unit_name?: string | null;
  lease_id?: string;
};

export type LedgerEntry = {
  id: string;
  date: string;
  kind: LedgerKind;
  typeLabel: string;
  source: LedgerSource;
  place: string | null;
  note: string | null;
  amount: number;
  counts: boolean;
  balance: number;
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  check: "Cheque",
  ach: "Transferencia",
  credit: "Tarjeta",
  other: "Otro",
};

export const LEDGER_SOURCE_LABELS: Record<LedgerSource, string> = {
  owner: "Propietario",
  tenant: "Arrendatario",
};

function cents(value: number): number {
  return Math.round(value * 100);
}

/** Same local calendar day the date column shows. */
export function ledgerDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function ledgerPlace(property?: string | null, unit?: string | null): string | null {
  const label = [property, unit].filter(Boolean).join(" · ");
  return label || null;
}

export function ledgerPlaces(
  rows: { property_name?: string | null; unit_name?: string | null }[],
): string[] {
  const labels = new Set<string>();
  for (const row of rows) {
    const label = ledgerPlace(row.property_name, row.unit_name);
    if (label) labels.add(label);
  }
  return [...labels].sort((a, b) => a.localeCompare(b, "es"));
}

export function buildTenantLedger(input: {
  charges: LedgerCharge[];
  payments: LedgerPayment[];
}): LedgerEntry[] {
  const drafts: Omit<LedgerEntry, "balance">[] = [
    ...input.charges.map((charge) => ({
      id: `charge:${charge.id}`,
      date: ledgerDate(charge.due_date),
      kind: "charge" as const,
      typeLabel: `Renta ${charge.period}`,
      source: "owner" as const,
      place: ledgerPlace(charge.property_name, charge.unit_name),
      note: charge.status === "waived" ? "Condonado" : null,
      amount: charge.amount,
      counts: charge.status !== "waived",
    })),
    ...input.payments.map((payment) => ({
      id: `payment:${payment.id}`,
      date: ledgerDate(payment.paid_at),
      kind: "payment" as const,
      typeLabel: METHOD_LABELS[payment.method] ?? payment.method,
      source: "tenant" as const,
      place: ledgerPlace(payment.property_name, payment.unit_name),
      note: payment.voided_at ? `Anulado: ${payment.void_reason ?? ""}`.trim() : null,
      amount: payment.amount,
      counts: !payment.voided_at,
    })),
  ];

  drafts.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "charge" ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

  let balanceCents = 0;
  const chronological = drafts.map((entry) => {
    if (entry.counts) {
      const delta = cents(entry.amount);
      balanceCents += entry.kind === "charge" ? delta : -delta;
    }
    return { ...entry, balance: balanceCents / 100 };
  });
  return chronological.reverse();
}
