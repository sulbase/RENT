/** Org-wide extra unit types. Stored as a JSON array in `settings`. */
export const UNIT_TYPE_KINDS_KEY = "unit_type_kinds";

export const BUILTIN_UNIT_TYPES = [
  { value: "departamento", label: "Departamento" },
  { value: "suite", label: "Suite" },
  { value: "local", label: "Local" },
  { value: "parqueadero", label: "Parqueadero" },
] as const;

export type BuiltinUnitType = (typeof BUILTIN_UNIT_TYPES)[number]["value"];

export const MAX_CUSTOM_UNIT_TYPES = 12;
export const MAX_UNIT_TYPE_LENGTH = 40;

const RESERVED = new Set<string>(BUILTIN_UNIT_TYPES.map((item) => item.value));

export type UnitTypeKindsResult = { ok: true; kinds: string[] } | { ok: false; error: string };

function cleanLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function isBuiltinUnitType(value: string): value is BuiltinUnitType {
  return RESERVED.has(value);
}

export function unitTypeLabel(value: string): string {
  return BUILTIN_UNIT_TYPES.find((item) => item.value === value)?.label ?? value;
}

export function normalizeUnitTypeKinds(input: string[]): UnitTypeKindsResult {
  if (input.length > MAX_CUSTOM_UNIT_TYPES) {
    return { ok: false, error: "Solo se pueden guardar 12 opciones extra" };
  }
  const kinds: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const label = cleanLabel(item);
    if (label.length < 1 || label.length > MAX_UNIT_TYPE_LENGTH) {
      return { ok: false, error: "Cada opción debe tener entre 1 y 40 caracteres" };
    }
    const key = label.toLocaleLowerCase("es");
    if (RESERVED.has(key)) {
      return {
        ok: false,
        error: "Departamento, Suite, Local y Parqueadero ya están en la lista",
      };
    }
    if (seen.has(key)) {
      return { ok: false, error: "Esa opción ya existe" };
    }
    seen.add(key);
    kinds.push(label);
  }
  return { ok: true, kinds };
}

/** Reads a previously stored JSON array. Invalid values become an empty list. */
export function parseUnitTypeKinds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) return [];
  const normalized = normalizeUnitTypeKinds(parsed);
  return normalized.ok ? normalized.kinds : [];
}

export function serializeUnitTypeKinds(kinds: string[]): string {
  return JSON.stringify(kinds);
}

/**
 * Accepts a built-in slug, its Spanish label, an extra option from the org list,
 * or the value already stored on the unit.
 */
export function acceptUnitType(
  value: string,
  extraKinds: string[],
  current?: string | null,
): { ok: true; unitType: string } | { ok: false; error: string } {
  const label = cleanLabel(value);
  if (label.length < 1 || label.length > MAX_UNIT_TYPE_LENGTH) {
    return { ok: false, error: "El tipo de unidad debe tener entre 1 y 40 caracteres" };
  }
  const key = label.toLocaleLowerCase("es");
  if (isBuiltinUnitType(key)) return { ok: true, unitType: key };
  const extra = extraKinds.find((item) => item.toLocaleLowerCase("es") === key);
  if (extra) return { ok: true, unitType: extra };
  if (current && current.toLocaleLowerCase("es") === key) return { ok: true, unitType: current };
  return { ok: false, error: "Ese tipo de unidad no está en la lista" };
}
