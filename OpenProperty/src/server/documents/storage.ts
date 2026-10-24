import type { Context } from "hono";
import type { AppEnv } from "../env";
import type { DocumentEntityType } from "./policy";
import { get, orgId, query } from "../pg";

const ENTITY_EXISTS: Record<Exclude<DocumentEntityType, "message">, string> = {
  property: "SELECT id FROM properties WHERE id = $1 AND organization_id = $2",
  unit: "SELECT id FROM units WHERE id = $1 AND organization_id = $2",
  lease: "SELECT id FROM leases WHERE id = $1 AND organization_id = $2",
  tenant: "SELECT id FROM tenants WHERE id = $1 AND organization_id = $2",
  work_order: "SELECT id FROM work_orders WHERE id = $1 AND organization_id = $2",
};

const MESSAGE_VISIBLE = `SELECT m.id FROM messages m
  WHERE m.id = $1 AND m.organization_id = $2
    AND (
      $3::uuid IS NULL
      OR EXISTS (
        SELECT 1 FROM message_thread_participants p
        WHERE p.thread_id = m.thread_id
          AND p.organization_id = m.organization_id
          AND p.user_id = $3::uuid
      )
    )`;

export async function entityInOrg(
  c: Context<AppEnv>,
  entityType: DocumentEntityType,
  entityId: string,
): Promise<boolean> {
  if (entityType === "message") {
    const row = await get(c, MESSAGE_VISIBLE, [entityId, orgId(c), c.get("userId")]);
    return Boolean(row);
  }
  const row = await get(c, ENTITY_EXISTS[entityType], [entityId, orgId(c)]);
  return Boolean(row);
}

/**
 * Keys that the following DELETE will cascade away, including child units and leases.
 * Collected before the DELETE so the R2 objects can be removed afterwards.
 */
const PURGE_SQL: Record<"property" | "unit" | DocumentEntityType, string> = {
  property: `SELECT d.r2_key FROM documents d
    WHERE d.organization_id = $1 AND (
      (d.entity_type = 'property' AND d.entity_id = $2)
      OR (d.entity_type = 'unit' AND d.entity_id IN (
        SELECT u.id FROM units u WHERE u.property_id = $2 AND u.organization_id = $1
      ))
      OR (d.entity_type = 'lease' AND d.entity_id IN (
        SELECT l.id FROM leases l
        JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
        WHERE u.property_id = $2 AND u.organization_id = $1
      ))
    )`,
  unit: `SELECT d.r2_key FROM documents d
    WHERE d.organization_id = $1 AND (
      (d.entity_type = 'unit' AND d.entity_id = $2)
      OR (d.entity_type = 'lease' AND d.entity_id IN (
        SELECT l.id FROM leases l WHERE l.unit_id = $2 AND l.organization_id = $1
      ))
    )`,
  lease: `SELECT d.r2_key FROM documents d
    WHERE d.organization_id = $1 AND d.entity_type = 'lease' AND d.entity_id = $2`,
  tenant: `SELECT d.r2_key FROM documents d
    WHERE d.organization_id = $1 AND d.entity_type = 'tenant' AND d.entity_id = $2`,
  work_order: `SELECT d.r2_key FROM documents d
    WHERE d.organization_id = $1 AND d.entity_type = 'work_order' AND d.entity_id = $2`,
  message: `SELECT d.r2_key FROM documents d
    WHERE d.organization_id = $1 AND d.entity_type = 'message' AND d.entity_id = $2`,
};

export async function collectCascadeKeys(
  c: Context<AppEnv>,
  scope: keyof typeof PURGE_SQL,
  entityId: string,
): Promise<string[]> {
  const rows = await query<{ r2_key: string }>(c, PURGE_SQL[scope], [orgId(c), entityId]);
  return rows.map((row) => row.r2_key).filter((key) => key.length > 0);
}

/** Hide a lease's files and return the R2 keys so the caller can drop the binaries. */
export async function retireLeaseFiles(c: Context<AppEnv>, leaseId: string): Promise<string[]> {
  const rows = await query<{ r2_key: string }>(
    c,
    `UPDATE documents SET deleted_at = now()
     WHERE organization_id = $1 AND entity_type = 'lease' AND entity_id = $2 AND deleted_at IS NULL
     RETURNING r2_key`,
    [orgId(c), leaseId],
  );
  return rows.map((row) => row.r2_key).filter((key) => key.length > 0);
}

export async function deleteR2Keys(env: AppEnv["Bindings"], keys: string[]): Promise<void> {
  const bucket = env.FILES;
  if (!bucket || keys.length === 0) return;
  const unique = [...new Set(keys)];
  await Promise.all(unique.map((key) => bucket.delete(key)));
}
