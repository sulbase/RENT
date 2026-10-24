import { describe, expect, it } from "vitest";
import { rejectPayment, toCents } from "./payment-balance";

describe("rejectPayment", () => {
  it("accepts an amount up to the remaining balance", () => {
    expect(
      rejectPayment({ chargeStatus: "open", chargeCents: 15000, paidCents: 5000, amountCents: 10000 }),
    ).toBeNull();
  });

  it("rejects an amount above the remaining balance", () => {
    expect(
      rejectPayment({ chargeStatus: "partial", chargeCents: 15000, paidCents: 5000, amountCents: 10001 }),
    ).toBe("El importe supera el saldo del cargo.");
  });

  it("rejects a new payment on a settled or waived charge", () => {
    expect(
      rejectPayment({ chargeStatus: "paid", chargeCents: 10000, paidCents: 10000, amountCents: 1 }),
    ).toBe("El importe supera el saldo del cargo.");
    expect(
      rejectPayment({ chargeStatus: "waived", chargeCents: 10000, paidCents: 0, amountCents: 10000 }),
    ).toBe("El cargo está condonado.");
  });

  it("reads money as cents", () => {
    expect(toCents("1500.00")).toBe(150000);
    expect(toCents(10.1)).toBe(1010);
  });
});
