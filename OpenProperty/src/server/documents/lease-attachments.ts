import { MAX_ENTITY_IMAGE_PHOTOS } from "./policy";

/** Org-wide extra categories for lease photos. Stored as a JSON array in `settings`. */
export const LEASE_ATTACHMENT_KINDS_KEY = "lease_attachment_kinds";

export const MAX_LEASE_PHOTOS = MAX_ENTITY_IMAGE_PHOTOS;
export const MAX_LEASE_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_CUSTOM_ATTACHMENT_KINDS = 12;
export const MAX_ATTACHMENT_KIND_LENGTH = 40;

const RESERVED = new Set(["imagen", "factura"]);

export type AttachmentKindsResult = { ok: true; kinds: string[] } | { ok: false; error: string };

function cleanLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeLeaseAttachmentKinds(input: string[]): AttachmentKindsResult {
  if (input.length > MAX_CUSTOM_ATTACHMENT_KINDS) {
    return { ok: false, error: "Solo se pueden guardar 12 opciones extra" };
  }
  const kinds: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const label = cleanLabel(item);
    if (label.length < 1 || label.length > MAX_ATTACHMENT_KIND_LENGTH) {
      return { ok: false, error: "Cada opción debe tener entre 1 y 40 caracteres" };
    }
    const key = label.toLocaleLowerCase("es");
    if (RESERVED.has(key)) {
      return { ok: false, error: "Imagen y Factura ya están en la lista" };
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
export function parseLeaseAttachmentKinds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) return [];
  const normalized = normalizeLeaseAttachmentKinds(parsed);
  return normalized.ok ? normalized.kinds : [];
}

export function serializeLeaseAttachmentKinds(kinds: string[]): string {
  return JSON.stringify(kinds);
}
