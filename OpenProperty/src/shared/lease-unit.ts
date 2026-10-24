export type LeaseClosePlan = { action: "remove" } | { action: "archive"; nextStatus: "ended" };

/**
 * Upcoming has no rent ledger, so closing it deletes the row and its files.
 * Active keeps the row as ended and drops only binaries.
 * A contract that is already ended or cancelled is left alone.
 */
export function leaseClosePlan(status: string): LeaseClosePlan | null {
  if (status === "upcoming") return { action: "remove" };
  if (status === "active") return { action: "archive", nextStatus: "ended" };
  return null;
}

/** A unit stays matched while its contract is upcoming or active. Ended and cancelled free it. */
export function leaseHoldsUnit(status: string | null | undefined): boolean {
  return status === "upcoming" || status === "active";
}

export type LeaseDrivenUnitStatus = "occupied" | "turnover";

/**
 * How a contract change writes unit status.
 * An active contract occupies its unit. Leaving active (ended, cancelled, or deleted)
 * puts that unit in turnover. Upcoming does not change the unit.
 * When the contract moves to another unit, only the previous unit is released.
 */
export function unitStatusAfterLeaseChange(input: {
  previousStatus?: string | null;
  nextStatus?: string | null;
  unitChanged: boolean;
}): { previousUnit: LeaseDrivenUnitStatus | null; nextUnit: LeaseDrivenUnitStatus | null } {
  const wasActive = input.previousStatus === "active";
  const nowActive = input.nextStatus === "active";
  if (input.unitChanged) {
    return {
      previousUnit: wasActive ? "turnover" : null,
      nextUnit: nowActive ? "occupied" : null,
    };
  }
  if (nowActive) return { previousUnit: null, nextUnit: "occupied" };
  if (wasActive) return { previousUnit: null, nextUnit: "turnover" };
  return { previousUnit: null, nextUnit: null };
}

/** People choose availability. Occupied is written only by an active contract. */
export function manualUnitStatusError(status: string, mode: "create" | "edit"): string | null {
  if (mode === "create") {
    if (status === "vacant" || status === "unavailable") return null;
    return "Al crear la unidad solo puede estar vacante o no disponible.";
  }
  if (status === "vacant" || status === "unavailable" || status === "turnover") return null;
  return "La ocupación la define el contrato activo.";
}
