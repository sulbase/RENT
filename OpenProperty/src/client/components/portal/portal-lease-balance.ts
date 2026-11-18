import type { PortalCharge, PortalLease } from "./portal-types";
import { clampRentDueDay } from "../../../shared/rent-due-day";

export function balanceOf(charge: PortalCharge): number {
  return Math.max(0, Math.round((charge.amount - (charge.amount_paid ?? 0)) * 100) / 100);
}

export function openCharges(charges: PortalCharge[], leaseId: string): PortalCharge[] {
  return charges
    .filter(
      (charge) =>
        charge.lease_id === leaseId &&
        charge.status !== "paid" &&
        charge.status !== "waived" &&
        balanceOf(charge) > 0,
    )
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
}

export function leaseBalanceTotal(charges: PortalCharge[], leaseId: string): number {
  return openCharges(charges, leaseId).reduce((sum, charge) => sum + balanceOf(charge), 0);
}

export function cutoffIso(lease: PortalLease, charges: PortalCharge[]): string {
  const lines = openCharges(charges, lease.id);
  if (lines.length > 0) return lines[0].due_date.slice(0, 10);
  const day = clampRentDueDay(lease.rent_due_day);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let candidate = new Date(today.getFullYear(), today.getMonth(), day);
  if (candidate < startOfToday) candidate = new Date(today.getFullYear(), today.getMonth() + 1, day);
  return `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, "0")}-${String(candidate.getDate()).padStart(2, "0")}`;
}

export function cutoffIsPast(iso: string): boolean {
  const cutoff = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return cutoff < startOfToday;
}
