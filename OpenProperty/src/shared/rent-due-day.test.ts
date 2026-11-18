import { describe, expect, it } from "vitest";
import { clampRentDueDay } from "./rent-due-day";

describe("clampRentDueDay", () => {
  it("keeps values inside 1–28", () => {
    expect(clampRentDueDay(5)).toBe(5);
    expect(clampRentDueDay(28)).toBe(28);
  });

  it("limits legacy values above 28", () => {
    expect(clampRentDueDay(31)).toBe(28);
  });
});