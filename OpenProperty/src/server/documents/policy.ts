export const DOCUMENT_ENTITY_TYPES = [
  "property",
  "unit",
  "lease",
  "tenant",
  "work_order",
  "message",
] as const;
export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number];

export const DOCUMENT_KINDS = [
  "image",
  "deed",
  "certificate",
  "invoice",
  "signed_lease",
  "inventory",
  "signed_inventory",
  "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Default per-file cap. Lease photos and property files use their own limits. */
export const MAX_ENTITY_IMAGE_PHOTOS = 25;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** One folder per property: 10 files, 30 MB each, 120 MB together. */
export const MAX_PROPERTY_FILES = 10;
export const MAX_PROPERTY_FILE_BYTES = 30 * 1024 * 1024;
export const MAX_PROPERTY_BYTES = 120 * 1024 * 1024;
export const PROPERTY_FILE_TOO_LARGE = "Cada archivo puede pesar como máximo 30 MB";
export const PROPERTY_FILE_LIMIT = "Esta propiedad admite como máximo 10 archivos";
export const PROPERTY_STORAGE_LIMIT = "Los archivos de esta propiedad no pueden superar 120 MB en total";
/** Multipart overhead above the default file cap. Property uploads use their own ceiling. */
export const MAX_UPLOAD_REQUEST_BYTES = MAX_FILE_BYTES + 1024 * 1024;
export const MAX_ORG_FILES = 500;
export const MAX_ORG_BYTES = 500 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};

const EXT_BY_MIME: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "application/pdf": ["pdf"],
};

export function basename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "";
  return base.replace(/[\r\n"]/g, "").trim();
}

export function displayFilename(filename: string): string {
  const base = basename(filename).slice(0, 180);
  return base.length > 0 ? base : "file";
}

export function fileExtension(filename: string): string {
  const base = basename(filename);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** ASCII object-name segment. Never preserves a client-supplied path. */
export function normalizeObjectName(filename: string): string {
  const base = basename(filename);
  const lower = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const safe = lower
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");
  const trimmed = safe.slice(0, 80);
  return trimmed.length > 0 ? trimmed : "file";
}

export function buildObjectKey(input: {
  organizationId: string;
  entityType: DocumentEntityType;
  entityId: string;
  filename: string;
  objectId?: string;
}): string {
  const objectId = input.objectId ?? crypto.randomUUID();
  const name = normalizeObjectName(input.filename);
  return `org/${input.organizationId}/${input.entityType}/${input.entityId}/${objectId}-${name}`;
}

export function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "application/pdf";
  }
  return null;
}

export type FileCheck = { ok: true; mime: string; filename: string } | { ok: false; error: string };

export function validateUpload(input: {
  filename: string;
  declaredType: string;
  bytes: Uint8Array;
  size: number;
  kind: DocumentKind;
  isCover: boolean;
  maxBytes?: number;
  oversizeError?: string;
  imagesOnly?: boolean;
  imagesOnlyError?: string;
}): FileCheck {
  const maxBytes = input.maxBytes ?? MAX_FILE_BYTES;
  if (input.size <= 0) return { ok: false, error: "Empty file" };
  if (input.size > maxBytes) {
    return { ok: false, error: input.oversizeError ?? "File exceeds 10 MB" };
  }
  if (input.bytes.byteLength < Math.min(input.size, 12) && input.size >= 12) {
    return { ok: false, error: "Could not read file header" };
  }

  const filename = displayFilename(input.filename);
  const ext = fileExtension(filename);
  const expected = MIME_BY_EXT[ext];
  if (!expected) return { ok: false, error: "File type is not allowed" };

  const declared = input.declaredType.trim().toLowerCase();
  if (declared && declared !== expected && declared !== "application/octet-stream") {
    return { ok: false, error: "File type does not match its extension" };
  }
  if (!EXT_BY_MIME[expected]?.includes(ext)) {
    return { ok: false, error: "File type is not allowed" };
  }

  const sniffed = sniffMime(input.bytes);
  if (sniffed !== expected) return { ok: false, error: "File contents do not match its type" };

  if ((input.imagesOnly || input.kind === "image") && !expected.startsWith("image/")) {
    return {
      ok: false,
      error: input.imagesOnlyError ?? "Images must be JPEG, PNG, WebP, or GIF",
    };
  }
  if (input.isCover && input.kind !== "image") {
    return { ok: false, error: "Only images can be the cover" };
  }

  return { ok: true, mime: expected, filename };
}

export function orgQuotaAllows(input: {
  fileCount: number;
  totalBytes: number;
  nextSize: number;
}): { ok: true } | { ok: false; error: string } {
  if (input.fileCount + 1 > MAX_ORG_FILES) {
    return { ok: false, error: "Organization file limit reached" };
  }
  if (input.totalBytes + input.nextSize > MAX_ORG_BYTES) {
    return { ok: false, error: "Organization storage limit reached" };
  }
  return { ok: true };
}

export function propertyQuotaAllows(input: {
  fileCount: number;
  totalBytes: number;
  nextSize: number;
}): { ok: true } | { ok: false; error: string } {
  if (input.fileCount + 1 > MAX_PROPERTY_FILES) {
    return { ok: false, error: PROPERTY_FILE_LIMIT };
  }
  if (input.totalBytes + input.nextSize > MAX_PROPERTY_BYTES) {
    return { ok: false, error: PROPERTY_STORAGE_LIMIT };
  }
  return { ok: true };
}

export function contentDisposition(filename: string, inline: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(filename);
  const kind = inline ? "inline" : "attachment";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
