import { describe, expect, it } from "vitest";
import { signatureFieldLayout } from "./firma";

describe("signatureFieldLayout", () => {
  it("uses firma.dev percentages within page bounds", () => {
    for (let index = 0; index < 6; index++) {
      const { x, y, width, height } = signatureFieldLayout(index);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(x + width).toBeLessThanOrEqual(100);
      expect(y + height).toBeLessThanOrEqual(100);
    }
  });

  it("places the first signer on the left column", () => {
    const first = signatureFieldLayout(0);
    const second = signatureFieldLayout(1);
    expect(first.x).toBeLessThan(second.x);
    expect(first.y).toBe(second.y);
  });
});
