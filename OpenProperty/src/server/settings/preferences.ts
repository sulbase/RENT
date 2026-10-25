import type { z } from "zod";
import type { settingsPatchSchema } from "../schemas/common";

export const LOCALE_DEFAULTS = {
  timezone: "America/Mexico_City",
  language: "es",
  date_format: "dd/MM/yyyy",
  area_unit: "m2",
  currency: "MXN",
} as const;

type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export function normalizeSettingEntries(
  patch: SettingsPatch,
): { ok: true; entries: [string, string][] } | { ok: false; error: string } {
  const entries: [string, string][] = [];
  for (const [key, raw] of Object.entries(patch)) {
    if (raw === undefined) continue;
    const normalized = normalizeSetting(key, raw);
    if (!normalized.ok) return normalized;
    entries.push([key, normalized.value]);
  }
  return { ok: true, entries };
}

function normalizeSetting(
  key: string,
  raw: string | number | boolean,
): { ok: true; value: string } | { ok: false; error: string } {
  const text = String(raw).trim();
  switch (key) {
    case "default_rent_due_day": {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 1 || n > 31) {
        return { ok: false, error: "default_rent_due_day must be an integer from 1 to 31" };
      }
      return { ok: true, value: String(n) };
    }
    case "late_fee_amount": {
      const n = Number(text);
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
        return { ok: false, error: "late_fee_amount must be a number from 0 to 1000000" };
      }
      return { ok: true, value: String(n) };
    }
    case "late_fee_grace_days": {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 0 || n > 365) {
        return { ok: false, error: "late_fee_grace_days must be an integer from 0 to 365" };
      }
      return { ok: true, value: String(n) };
    }
    case "currency": {
      const code = text.toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) return { ok: false, error: "currency must be a 3-letter code" };
      return { ok: true, value: code };
    }
    case "timezone":
      if (!isTimeZone(text)) return { ok: false, error: "timezone must be a valid IANA name" };
      return { ok: true, value: text };
    case "language":
      if (text !== "es" && text !== "en") return { ok: false, error: "language must be es or en" };
      return { ok: true, value: text };
    case "date_format":
      if (text !== "dd/MM/yyyy" && text !== "MM/dd/yyyy" && text !== "yyyy-MM-dd") {
        return { ok: false, error: "date_format is not supported" };
      }
      return { ok: true, value: text };
    case "area_unit":
      if (text !== "m2" && text !== "ft2")
        return { ok: false, error: "area_unit must be m2 or ft2" };
      return { ok: true, value: text };
    case "landlord_first_name":
    case "landlord_last_name":
      if (text.length > 80)
        return { ok: false, error: "El nombre del arrendador es demasiado largo" };
      return { ok: true, value: text };
    case "landlord_email":
      if (!text) return { ok: true, value: "" };
      if (text.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        return { ok: false, error: "El correo del arrendador no es válido" };
      }
      return { ok: true, value: text.toLowerCase() };
    case "landlord_government_id":
      if (!text) return { ok: true, value: "" };
      if (text.length > 18) {
        return {
          ok: false,
          error: "El documento de identidad del arrendador admite hasta 18 caracteres",
        };
      }
      return { ok: true, value: text };
    case "bank_holder":
    case "bank_name":
      if (text.length > 120) return { ok: false, error: "El dato bancario es demasiado largo" };
      return { ok: true, value: text };
    case "bank_account":
    case "bank_clabe":
      if (text.length > 32) return { ok: false, error: "La cuenta o CLABE es demasiado larga" };
      return { ok: true, value: text };
    default:
      return { ok: false, error: `Unknown setting ${key}` };
  }
}

export function isTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
