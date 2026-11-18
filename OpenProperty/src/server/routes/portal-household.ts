import { z } from "zod";
import type { Context, Hono } from "hono";
import type { AppEnv } from "../env";
import { get, normalizeRow, normalizeRows, orgId, query, run, uuidParam } from "../pg";
import { MAX_VEHICLES_PER_UNIT } from "../../shared/parking-charge";
import { parseJson } from "../validation";

const MAX_EMERGENCY_CONTACTS = 3;

const VEHICLE_TYPES = ["Automóvil", "Motocicleta", "Camioneta", "SUV", "Otro"] as const;

const EmergencyContactBody = z
  .object({
    first_name: z.string().trim().min(1).max(40),
    last_name: z.string().trim().min(1).max(40),
    phone_country: z.string().trim().min(1).max(8),
    phone_number: z.string().trim().min(1).max(32),
    relationship: z.string().trim().min(1).max(80),
    email: z.string().trim().max(120).optional().default(""),
    company: z.string().trim().max(80).optional().default(""),
    has_access: z.boolean().default(false),
    age: z.number().int().min(0).max(130).optional().default(0),
    country: z.string().trim().max(80).optional().default(""),
    address_line1: z.string().trim().max(120).optional().default(""),
    address_line2: z.string().trim().max(120).optional().default(""),
    city: z.string().trim().max(80).optional().default(""),
    state_region: z.string().trim().max(80).optional().default(""),
    postal_code: z.string().trim().max(20).optional().default(""),
    notes: z.string().trim().max(2000).optional().default(""),
  })
  .strict();

const VehicleBody = z
  .object({
    lease_id: z.string().uuid(),
    make: z.string().trim().max(80).default(""),
    model: z.string().trim().max(80).default(""),
    year: z.number().int().min(1980).max(2100),
    color: z.string().trim().max(40).default(""),
    vehicle_type: z.enum(VEHICLE_TYPES),
    plate_state: z.string().trim().min(1).max(40),
    license_number: z.string().trim().min(1).max(20),
  })
  .strict();

function portalTenant(c: Context<AppEnv>): string | null {
  return c.get("portalTenantId") ?? null;
}

function contactName(first: string, last: string): string {
  return `${first} ${last}`.trim().slice(0, 80);
}

function contactPhone(country: string, number: string): string {
  return `${country} ${number}`.trim().slice(0, 40);
}

function metadataFromBody(d: z.output<typeof EmergencyContactBody>): Record<string, unknown> {
  return {
    first_name: d.first_name,
    last_name: d.last_name,
    phone_country: d.phone_country,
    phone_number: d.phone_number,
    email: d.email ?? "",
    company: d.company ?? "",
    age: d.age ?? 0,
    country: d.country ?? "",
    address_line1: d.address_line1 ?? "",
    address_line2: d.address_line2 ?? "",
    city: d.city ?? "",
    state_region: d.state_region ?? "",
    postal_code: d.postal_code ?? "",
    notes: d.notes ?? "",
  };
}

function parseLegacyName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return { first_name: "", last_name: "" };
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

function contactFromRow(row: Record<string, unknown>) {
  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const legacy = parseLegacyName(String(row.name ?? ""));
  const phone = String(row.phone ?? "");
  const phoneMatch = phone.match(/^(\+\d{1,4})\s*(.+)$/);

  return {
    id: row.id,
    first_name: String(meta.first_name ?? legacy.first_name),
    last_name: String(meta.last_name ?? legacy.last_name),
    phone_country: String(meta.phone_country ?? phoneMatch?.[1] ?? "+52"),
    phone_number: String(meta.phone_number ?? phoneMatch?.[2] ?? phone),
    relationship: row.relationship,
    email: String(meta.email ?? ""),
    company: String(meta.company ?? ""),
    has_access: Boolean(row.has_access),
    age: Number(meta.age ?? 0),
    country: String(meta.country ?? ""),
    address_line1: String(meta.address_line1 ?? ""),
    address_line2: String(meta.address_line2 ?? ""),
    city: String(meta.city ?? ""),
    state_region: String(meta.state_region ?? ""),
    postal_code: String(meta.postal_code ?? ""),
    notes: String(meta.notes ?? ""),
    created_at: row.created_at,
  };
}

async function contactCount(c: Context<AppEnv>, tenantId: string): Promise<number> {
  const row = await get(
    c,
    `SELECT COUNT(*)::int AS count
     FROM tenant_emergency_contacts
     WHERE organization_id = $1 AND tenant_id = $2`,
    [orgId(c), tenantId],
  );
  return Number((row as { count: number }).count ?? 0);
}

export function mountPortalHouseholdRoutes(app: Hono<AppEnv>) {
  app.get("/api/portal/emergency-contacts", async (c) => {
    const tenantId = portalTenant(c);
    if (!tenantId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const rows = await query(
      c,
      `SELECT id, name, relationship, phone, has_access, metadata, created_at
       FROM tenant_emergency_contacts
       WHERE organization_id = $1 AND tenant_id = $2
       ORDER BY created_at`,
      [orgId(c), tenantId],
    );
    return c.json({ contacts: normalizeRows(rows).map((row) => contactFromRow(row)) });
  });

  app.post("/api/portal/emergency-contacts", async (c) => {
    const tenantId = portalTenant(c);
    if (!tenantId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const parsed = await parseJson(c, EmergencyContactBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const d = EmergencyContactBody.parse(parsed.data);
    if ((await contactCount(c, tenantId)) >= MAX_EMERGENCY_CONTACTS) {
      return c.json({ error: "Solo puedes registrar hasta 3 contactos de emergencia" }, 400);
    }
    const row = await get(
      c,
      `INSERT INTO tenant_emergency_contacts (
         organization_id, tenant_id, name, relationship, phone, has_access, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, name, relationship, phone, has_access, metadata, created_at`,
      [
        orgId(c),
        tenantId,
        contactName(d.first_name, d.last_name),
        d.relationship,
        contactPhone(d.phone_country, d.phone_number),
        d.has_access ?? false,
        JSON.stringify(metadataFromBody(d)),
      ],
    );
    return c.json({ contact: contactFromRow(row as Record<string, unknown>) }, 201);
  });

  app.patch("/api/portal/emergency-contacts/:id", async (c) => {
    const tenantId = portalTenant(c);
    const id = uuidParam(c.req.param("id"));
    if (!tenantId || !id) return c.json({ error: "Not found" }, 404);
    const parsed = await parseJson(c, EmergencyContactBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const d = EmergencyContactBody.parse(parsed.data);
    const row = await get(
      c,
      `UPDATE tenant_emergency_contacts
       SET name = $4, relationship = $5, phone = $6, has_access = $7, metadata = $8::jsonb
       WHERE id = $1 AND organization_id = $2 AND tenant_id = $3
       RETURNING id, name, relationship, phone, has_access, metadata, created_at`,
      [
        id,
        orgId(c),
        tenantId,
        contactName(d.first_name, d.last_name),
        d.relationship,
        contactPhone(d.phone_country, d.phone_number),
        d.has_access ?? false,
        JSON.stringify(metadataFromBody(d)),
      ],
    );
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({ contact: contactFromRow(row as Record<string, unknown>) });
  });

  app.delete("/api/portal/emergency-contacts/:id", async (c) => {
    const tenantId = portalTenant(c);
    const id = uuidParam(c.req.param("id"));
    if (!tenantId || !id) return c.json({ error: "Not found" }, 404);
    const result = await run(
      c,
      `DELETE FROM tenant_emergency_contacts
       WHERE id = $1 AND organization_id = $2 AND tenant_id = $3`,
      [id, orgId(c), tenantId],
    );
    if (!result.changes) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/api/portal/vehicles", async (c) => {
    const tenantId = portalTenant(c);
    if (!tenantId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const leaseId = uuidParam(c.req.query("lease_id") ?? "");
    if (!leaseId) return c.json({ error: "Elige una unidad" }, 400);
    const rows = await query(
      c,
      `SELECT v.id, v.lease_id, v.make, v.model, v.year, v.color, v.vehicle_type,
              v.plate_state, v.license_number, v.created_at
       FROM tenant_vehicles v
       JOIN leases l ON l.id = v.lease_id AND l.organization_id = v.organization_id
       WHERE v.organization_id = $1 AND v.tenant_id = $2 AND v.lease_id = $3
         AND l.primary_tenant_id = $2
       ORDER BY v.created_at`,
      [orgId(c), tenantId, leaseId],
    );
    return c.json({ vehicles: normalizeRows(rows) });
  });

  app.post("/api/portal/vehicles", async (c) => {
    const tenantId = portalTenant(c);
    if (!tenantId) return c.json({ error: "No tienes acceso al portal" }, 403);
    const parsed = await parseJson(c, VehicleBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const d = parsed.data;
    const o = orgId(c);
    const lease = await get(
      c,
      `SELECT id FROM leases
       WHERE id = $1 AND organization_id = $2 AND primary_tenant_id = $3 AND status = 'active'`,
      [d.lease_id, o, tenantId],
    );
    if (!lease) return c.json({ error: "Not found" }, 404);
    const row = await get(
      c,
      `INSERT INTO tenant_vehicles (
         organization_id, tenant_id, lease_id, make, model, year, color,
         vehicle_type, plate_state, license_number
       ) SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
       WHERE (
         SELECT COUNT(*) FROM tenant_vehicles
         WHERE organization_id = $1 AND lease_id = $3
       ) < ${MAX_VEHICLES_PER_UNIT}
       RETURNING id, lease_id, make, model, year, color, vehicle_type, plate_state, license_number, created_at`,
      [
        o,
        tenantId,
        d.lease_id,
        d.make ?? "",
        d.model ?? "",
        d.year,
        d.color ?? "",
        d.vehicle_type,
        d.plate_state,
        d.license_number,
      ],
    );
    if (!row) return c.json({ error: "Esta unidad ya tiene 3 vehículos" }, 409);
    return c.json({ vehicle: normalizeRow(row as Record<string, unknown>) }, 201);
  });

  app.delete("/api/portal/vehicles/:id", async (c) => {
    const tenantId = portalTenant(c);
    const id = uuidParam(c.req.param("id"));
    if (!tenantId || !id) return c.json({ error: "Not found" }, 404);
    const result = await run(
      c,
      `DELETE FROM tenant_vehicles WHERE id = $1 AND organization_id = $2 AND tenant_id = $3`,
      [id, orgId(c), tenantId],
    );
    if (!result.changes) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  });
}
