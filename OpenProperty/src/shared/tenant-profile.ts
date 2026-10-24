/** Longest common personal ID in this product's locale: a CURP is 18 characters. */
export const GOVERNMENT_ID_MAX = 18;
export const OCCUPANT_COUNT_MAX = 99;

export const MARITAL_STATUSES = [
  { value: "soltero", label: "Soltero/a" },
  { value: "casado", label: "Casado/a" },
  { value: "divorciado", label: "Divorciado/a" },
  { value: "viudo", label: "Viudo/a" },
  { value: "union_libre", label: "Unión libre" },
  { value: "separado", label: "Separado/a" },
] as const;

export type MaritalStatus = (typeof MARITAL_STATUSES)[number]["value"];

export function maritalStatusLabel(value: string | null | undefined): string {
  return MARITAL_STATUSES.find((item) => item.value === value)?.label ?? "—";
}
