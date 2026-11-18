/** Last valid rent due day (charge generator uses calendar days 01–28). */
export const RENT_DUE_DAY_MAX = 28;

export function clampRentDueDay(day: number): number {
  const n = Math.floor(day);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(RENT_DUE_DAY_MAX, n);
}

export const RENT_DUE_DAY_OPTIONS = Array.from({ length: RENT_DUE_DAY_MAX }, (_, i) => i + 1);