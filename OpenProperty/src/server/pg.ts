import type { Context } from "hono";
import type { Sql } from "./db";
import type { AppEnv } from "./env";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function orgId(c: Context<AppEnv>): string {
  return c.get("orgId");
}

export function membershipRole(c: Context<AppEnv>) {
  return c.get("role");
}

export function sqlClient(c: Context<AppEnv>): Sql {
  return c.get("sql");
}

export function uuidParam(raw: string | undefined): string | null {
  if (!raw || !UUID_RE.test(raw)) return null;
  return raw;
}

export async function query<T>(
  c: Context<AppEnv>,
  text: string,
  params: SqlParam[] = [],
): Promise<T[]> {
  const rows = await sqlClient(c).unsafe(text, params);
  return rows as unknown as T[];
}

export async function get<T>(
  c: Context<AppEnv>,
  text: string,
  params: SqlParam[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(c, text, params);
  return rows[0];
}

export type SqlParam = string | number | boolean | null | string[];

export async function run(
  c: Context<AppEnv>,
  text: string,
  params: SqlParam[] = [],
): Promise<{ changes: number }> {
  const result = await sqlClient(c).unsafe(text, params);
  const count = (result as { count?: number }).count;
  return { changes: typeof count === "number" ? count : 0 };
}

export function buildUpdate(
  fields: Record<string, unknown>,
  startAt = 1,
): { sets: string[]; params: SqlParam[]; next: number } {
  const sets: string[] = [];
  const params: SqlParam[] = [];
  let i = startAt;
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) {
      sets.push(`${k} = $${i++}`);
      params.push(v as SqlParam);
    }
  }
  return { sets, params, next: i };
}

const MONEY_KEYS = new Set([
  "market_rent",
  "monthly_rent",
  "monthly_income",
  "deposit",
  "late_fee",
  "amount",
  "amount_paid",
  "charge_amount",
  "cost",
  "aliquot_price",
]);

const COUNT_KEYS = new Set(["bedrooms", "bathrooms"]);

/** Postgres `numeric` arrives as string in postgres.js. */
export function normalizeRow<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row };
  for (const [k, v] of Object.entries(out)) {
    if (v === null || v === undefined) continue;
    if (MONEY_KEYS.has(k) || COUNT_KEYS.has(k)) {
      const n = Number(v);
      if (!Number.isNaN(n)) (out as Record<string, unknown>)[k] = n;
    }
    if (k.endsWith("_at") || k === "created_at" || k === "paid_at" || k === "updated_at") {
      if (v instanceof Date) (out as Record<string, unknown>)[k] = v.toISOString();
      else if (typeof v === "string" && v.includes("T")) {
        /* keep ISO */
      }
    }
    if (
      k.endsWith("_date") ||
      k === "start_date" ||
      k === "end_date" ||
      k === "due_date" ||
      k === "date_of_birth" ||
      k === "desired_move_in"
    ) {
      if (v instanceof Date) {
        (out as Record<string, unknown>)[k] = v.toISOString().slice(0, 10);
      }
    }
  }
  return out;
}

export function normalizeRows<T extends Record<string, unknown>>(rows: T[] | unknown[]): T[] {
  return (rows as T[]).map((r) => normalizeRow(r));
}
