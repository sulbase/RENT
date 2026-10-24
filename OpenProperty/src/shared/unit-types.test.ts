import { describe, expect, it } from "vitest";
import {
  acceptUnitType,
  normalizeUnitTypeKinds,
  parseUnitTypeKinds,
} from "./unit-types";

describe("unit type kinds", () => {
  it("keeps a JSON list of extra labels for one organization", () => {
    const saved = normalizeUnitTypeKinds([" Bodega ", "Local comercial"]);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(parseUnitTypeKinds(JSON.stringify(saved.kinds))).toEqual(["Bodega", "Local comercial"]);
  });

  it("rejects the fixed Departamento, Suite, Local and Parqueadero labels", () => {
    expect(normalizeUnitTypeKinds(["Departamento"]).ok).toBe(false);
    expect(parseUnitTypeKinds('["Suite"]')).toEqual([]);
  });

  it("maps a built-in label to its slug and keeps a custom option", () => {
    const builtin = acceptUnitType("Departamento", []);
    const custom = acceptUnitType("Bodega", ["Bodega"]);
    expect(builtin.ok && builtin.unitType).toBe("departamento");
    expect(custom.ok && custom.unitType).toBe("Bodega");
    expect(acceptUnitType("Terraza", ["Bodega"]).ok).toBe(false);
  });
});
