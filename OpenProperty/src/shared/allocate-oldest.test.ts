import { describe, expect, it } from "vitest";
import { allocateOldestFirst } from "./allocate-oldest";

const charges = [
  { id: "nov", period: "2026-11", remainingCents: 50_000 },
  { id: "oct", period: "2026-10", remainingCents: 50_000 },
  { id: "dec", period: "2026-12", remainingCents: 50_000 },
];

describe("allocateOldestFirst", () => {
  it("fills the oldest rent first and leaves the rest for later months", () => {
    const result = allocateOldestFirst(charges, 80_000);
    expect(result).toEqual({
      ok: true,
      rows: [
        { id: "oct", period: "2026-10", cents: 50_000 },
        { id: "nov", period: "2026-11", cents: 30_000 },
      ],
    });
  });

  it("covers every open month when the amount is the full balance", () => {
    const result = allocateOldestFirst(charges, 150_000);
    expect(result.ok && result.rows.map((row) => row.id)).toEqual(["oct", "nov", "dec"]);
  });

  it("refuses more than the open balance", () => {
    expect(allocateOldestFirst(charges, 150_001)).toEqual({ ok: false, error: "exceeds" });
  });
});
