import type { R2Bucket } from "@cloudflare/workers-types";
import { buildObjectKey, MAX_FILE_BYTES, orgQuotaAllows, sniffMime } from "../documents/policy";
import type { Sql } from "../db";

type SignatureRow = {
  id: string;
  organization_id: string;
  lease_id: string;
  document_id: string | null;
  purpose?: string | null;
};

async function one<T>(sql: Sql, text: string, params: unknown[]): Promise<T | undefined> {
  const rows = await sql.unsafe(text, params as never[]);
  return (rows as unknown as T[])[0];
}

/** Downloads the finished PDF and stores it on the lease, apart from the other signed file. */
export async function archiveSignedLease(input: {
  sql: Sql;
  bucket: R2Bucket | undefined;
  fetchImpl?: typeof fetch;
  signature: SignatureRow;
  downloadUrl: string;
}): Promise<void> {
  if (input.signature.document_id) return;
  if (!input.bucket) {
    await markError(input.sql, input.signature.id, "File storage is not configured");
    return;
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const downloaded = await fetchImpl(input.downloadUrl);
  if (!downloaded.ok) {
    await markError(input.sql, input.signature.id, "Could not download the signed PDF");
    return;
  }
  const bytes = new Uint8Array(await downloaded.arrayBuffer());
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_FILE_BYTES ||
    sniffMime(bytes) !== "application/pdf"
  ) {
    await markError(input.sql, input.signature.id, "Signed PDF is missing or exceeds 10 MB");
    return;
  }

  const usage = await one<{ file_count: number | string; total_bytes: number | string }>(
    input.sql,
    `SELECT COUNT(*)::int AS file_count, COALESCE(SUM(size_bytes), 0)::bigint AS total_bytes
     FROM documents WHERE organization_id = $1 AND deleted_at IS NULL`,
    [input.signature.organization_id],
  );
  const allowed = orgQuotaAllows({
    fileCount: Number(usage?.file_count ?? 0),
    totalBytes: Number(usage?.total_bytes ?? 0),
    nextSize: bytes.byteLength,
  });
  if (!allowed.ok) {
    await markError(input.sql, input.signature.id, allowed.error);
    return;
  }

  const inventory = input.signature.purpose === "inventory";
  const documentId = crypto.randomUUID();
  const filename = inventory ? "inventario-firmado.pdf" : "contrato-firmado.pdf";
  const kind = inventory ? "signed_inventory" : "signed_lease";
  const r2Key = buildObjectKey({
    organizationId: input.signature.organization_id,
    entityType: "lease",
    entityId: input.signature.lease_id,
    filename,
    objectId: documentId,
  });
  await input.bucket.put(r2Key, bytes, { httpMetadata: { contentType: "application/pdf" } });

  try {
    await input.sql.unsafe(
      `INSERT INTO documents (
         id, organization_id, entity_type, entity_id, lease_id,
         kind, r2_key, filename, mime, size_bytes, is_cover
       ) VALUES ($1, $2, 'lease', $3, $3, $7, $4, $5, 'application/pdf', $6, false)`,
      [
        documentId,
        input.signature.organization_id,
        input.signature.lease_id,
        r2Key,
        filename,
        bytes.byteLength,
        kind,
      ],
    );
    const linked = await one<{ id: string }>(
      input.sql,
      `UPDATE lease_signatures
       SET document_id = $2, last_error = NULL, completed_at = COALESCE(completed_at, now())
       WHERE id = $1 AND organization_id = $3 AND document_id IS NULL
       RETURNING id`,
      [input.signature.id, documentId, input.signature.organization_id],
    );
    if (!linked) {
      await input.sql.unsafe(
        `UPDATE documents SET deleted_at = now() WHERE id = $1 AND organization_id = $2`,
        [documentId, input.signature.organization_id],
      );
      await input.bucket.delete(r2Key);
    }
  } catch (err) {
    await input.bucket.delete(r2Key);
    throw err;
  }
}

async function markError(sql: Sql, signatureId: string, message: string): Promise<void> {
  await sql.unsafe(`UPDATE lease_signatures SET last_error = $2 WHERE id = $1`, [
    signatureId,
    message,
  ]);
}
