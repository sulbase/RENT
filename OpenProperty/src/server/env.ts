import type { Hyperdrive, R2Bucket } from "@cloudflare/workers-types";
import type { AppDb, Sql } from "./db";
import type { MembershipRole } from "./auth/roles";

export type WorkerBindings = {
  ASSETS: Fetcher;
  /** Transaction pooler (6543) or Hyperdrive connection string — never commit real values. */
  DATABASE_URL: string;
  /** Slug for local dev when AUTH_DEV_BYPASS or no JWT secret (never in production). */
  DEV_ORGANIZATION_SLUG?: string;
  /** HS256 secret from Supabase project settings — required in production. */
  SUPABASE_JWT_SECRET?: string;
  /** Set to "true" only in local wrangler.toml; omit in production. */
  AUTH_DEV_BYPASS?: string;
  HYPERDRIVE?: Hyperdrive;
  /** API key de firma.dev. Cabecera `Authorization` sin prefijo obligatorio. */
  FIRMA_API_KEY?: string;
  /** Secreto HMAC de los webhooks de firma.dev. */
  FIRMA_WEBHOOK_SECRET?: string;
  /** "true" sends the lab workers.dev host to https://rent.sulbase.com. */
  CANONICAL_REDIRECT?: string;
  /** Private R2 bucket. Downloads always go through the Worker. */
  FILES?: R2Bucket;
};

export type WorkerVariables = {
  orgId: string;
  sql: Sql;
  db: AppDb;
  userId: string | null;
  userEmail: string | null;
  role: MembershipRole;
  /** Set only on `/api/portal/*`, resolved from `tenants.user_id`. */
  portalTenantId: string | null;
};

declare module "hono" {
  interface ContextVariableMap extends WorkerVariables {}
}

export type AppEnv = {
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
};

export function resolveDatabaseUrl(env: WorkerBindings): string {
  const fromHyperdrive = env.HYPERDRIVE?.connectionString;
  if (fromHyperdrive) return fromHyperdrive;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  throw new Error(
    "DATABASE_URL (or HYPERDRIVE binding) is required. Use Supabase transaction pooler (port 6543) with prepare disabled.",
  );
}
