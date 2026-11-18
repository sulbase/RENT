export const VOID_REASONS = [
  { value: "duplicado", label: "Pago duplicado" },
  { value: "monto", label: "Monto incorrecto" },
  { value: "cargo", label: "Cargo equivocado" },
  { value: "no_recibido", label: "Pago no recibido" },
  { value: "error", label: "Error de registro" },
  { value: "otro", label: "Otro" },
] as const;

export function resolveVoidReason(kind: string, other: string): string {
  if (kind === "otro") return other.trim();
  return VOID_REASONS.find((item) => item.value === kind)?.label ?? "";
}