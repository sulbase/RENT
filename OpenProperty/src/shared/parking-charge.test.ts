import { describe, expect, it } from "vitest";
import { parkingChargeAmount } from "./parking-charge";

describe("parkingChargeAmount", () => {
  it("charges the fee once per vehicle, up to three", () => {
    expect(parkingChargeAmount(25, 1)).toBe(25);
    expect(parkingChargeAmount(25, 2)).toBe(50);
    expect(parkingChargeAmount(25, 3)).toBe(75);
    expect(parkingChargeAmount(25, 4)).toBe(75);
  });

  it("skips a charge when there is no fee or no vehicle", () => {
    expect(parkingChargeAmount(0, 2)).toBe(0);
    expect(parkingChargeAmount(25, 0)).toBe(0);
  });
});
