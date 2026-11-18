import { describe, expect, it } from "vitest";
import { guaranteeAmount } from "./leases";

describe("guaranteeAmount", () => {
  it("multiplies the monthly rent by the months held", () => {
    expect(guaranteeAmount(2, 650)).toBe(1300);
  });

  it("rounds to cents", () => {
    expect(guaranteeAmount(3, 333.33)).toBe(999.99);
    expect(guaranteeAmount(3, 0.1)).toBe(0.3);
  });
});
