/** Vehicles registered on one unit that can be billed in a month. */
export const MAX_VEHICLES_PER_UNIT = 3;

/** Monthly parking total: per-vehicle fee times how many vehicles apply, capped at 3. */
export function parkingChargeAmount(fee: number, vehicleCount: number): number {
  const count = Math.min(MAX_VEHICLES_PER_UNIT, Math.max(0, Math.floor(vehicleCount)));
  if (!(fee > 0) || count === 0) return 0;
  return Math.round(fee * count * 100) / 100;
}

export function chargeConcept(kind: string | null | undefined): string {
  return kind === "parking" ? "Estacionamiento" : "Renta";
}
