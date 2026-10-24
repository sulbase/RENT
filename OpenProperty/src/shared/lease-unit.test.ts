import { describe, expect, it } from "vitest";
import {
  leaseClosePlan,
  leaseHoldsUnit,
  manualUnitStatusError,
  unitStatusAfterLeaseChange,
} from "./lease-unit";

describe("leaseClosePlan", () => {
  it("deletes an upcoming contract", () => {
    expect(leaseClosePlan("upcoming")).toEqual({ action: "remove" });
  });

  it("ends an active contract and ignores one that is already closed", () => {
    expect(leaseClosePlan("active")).toEqual({ action: "archive", nextStatus: "ended" });
    expect(leaseClosePlan("ended")).toBeNull();
    expect(leaseClosePlan("cancelled")).toBeNull();
  });
});

describe("leaseHoldsUnit", () => {
  it("holds a unit for upcoming and active contracts", () => {
    expect(leaseHoldsUnit("upcoming")).toBe(true);
    expect(leaseHoldsUnit("active")).toBe(true);
  });

  it("frees a unit when the contract ends or is cancelled", () => {
    expect(leaseHoldsUnit("ended")).toBe(false);
    expect(leaseHoldsUnit("cancelled")).toBe(false);
    expect(leaseHoldsUnit(null)).toBe(false);
  });
});

describe("unitStatusAfterLeaseChange", () => {
  it("occupies the unit when the contract is active", () => {
    expect(
      unitStatusAfterLeaseChange({
        previousStatus: null,
        nextStatus: "active",
        unitChanged: false,
      }),
    ).toEqual({ previousUnit: null, nextUnit: "occupied" });
  });

  it("leaves the unit alone for an upcoming contract", () => {
    expect(
      unitStatusAfterLeaseChange({
        previousStatus: null,
        nextStatus: "upcoming",
        unitChanged: false,
      }),
    ).toEqual({ previousUnit: null, nextUnit: null });
  });

  it("moves the unit to turnover when an active contract ends or is removed", () => {
    expect(
      unitStatusAfterLeaseChange({
        previousStatus: "active",
        nextStatus: "ended",
        unitChanged: false,
      }).nextUnit,
    ).toBe("turnover");
    expect(
      unitStatusAfterLeaseChange({
        previousStatus: "active",
        nextStatus: null,
        unitChanged: false,
      }).nextUnit,
    ).toBe("turnover");
  });

  it("releases the previous unit and occupies the new one when an active contract moves", () => {
    expect(
      unitStatusAfterLeaseChange({
        previousStatus: "active",
        nextStatus: "active",
        unitChanged: true,
      }),
    ).toEqual({ previousUnit: "turnover", nextUnit: "occupied" });
  });
});

describe("manualUnitStatusError", () => {
  it("allows vacant and unavailable when creating a unit", () => {
    expect(manualUnitStatusError("vacant", "create")).toBeNull();
    expect(manualUnitStatusError("unavailable", "create")).toBeNull();
    expect(manualUnitStatusError("occupied", "create")).toBeTruthy();
    expect(manualUnitStatusError("turnover", "create")).toBeTruthy();
  });

  it("allows turnover on edit and keeps occupied for the contract", () => {
    expect(manualUnitStatusError("turnover", "edit")).toBeNull();
    expect(manualUnitStatusError("occupied", "edit")).toBeTruthy();
  });
});
