/**
 * Modo B local: genera `.dev.vars` para wrangler desde `.env` (sin AUTH_DEV_BYPASS).
 * No commitea secretos. Ejecutar desde OpenProperty: pnpm run prepare:local-auth
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
const localPath = resolve(root, ".env.local");
const devVarsPath = resolve(root, ".dev.vars");

if (!existsSync(envPath)) {
  console.error("Falta OpenProperty/.env — copia .env.example y rellena credenciales.");
  process.exit(1);
}

dotenv.config({ path: envPath });
if (existsSync(localPath)) {
  dotenv.config({ path: localPath, override: true });
}

const pooled = process.env.DATABASE_POOLED_URL?.trim();
const direct = process.env.DATABASE_URL?.trim();
const databaseUrl = pooled || (direct?.includes(":6543") ? direct : null);

if (!databaseUrl) {
  console.error(
    "Define DATABASE_POOLED_URL (6543) en .env, o DATABASE_URL con puerto 6543 para el Worker.",
  );
  process.exit(1);
}

const jwtSecret = process.env.SUPABASE_JWT_SECRET?.trim();
const viteUrl = process.env.VITE_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
const viteKey =
  process.env.VITE_SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();

const lines = [
  "# Generado por pnpm run prepare:local-auth — no editar a mano si vuelves a ejecutar el script.",
  `DATABASE_URL=${quote(databaseUrl)}`,
  // wrangler lee esta variable del entorno del proceso antes que .dev.vars.
  // scripts/dev-api.mjs es quien la inyecta al arrancar; esta copia queda para el archivo local.
  `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=${quote(databaseUrl)}`,
];

if (jwtSecret) {
  lines.push(`SUPABASE_JWT_SECRET=${quote(jwtSecret)}`);
} else {
  console.warn("Aviso: sin SUPABASE_JWT_SECRET en .env; el Worker usará solo JWKS si hay token ES256.");
}

const firmaKey = process.env.FIRMA_API_KEY?.trim() || readDevVar(devVarsPath, "FIRMA_API_KEY");
const firmaWebhook = process.env.FIRMA_WEBHOOK_SECRET?.trim() || readDevVar(devVarsPath, "FIRMA_WEBHOOK_SECRET");
if (firmaKey) lines.push(`FIRMA_API_KEY=${quote(firmaKey)}`);
if (firmaWebhook) lines.push(`FIRMA_WEBHOOK_SECRET=${quote(firmaWebhook)}`);

writeFileSync(devVarsPath, lines.join("\n") + "\n", "utf8");
console.log("Escrito:", devVarsPath);

if (!viteUrl || !viteKey) {
  console.error("En .env faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (o SUPABASE_URL / SUPABASE_ANON_KEY).");
  process.exit(1);
}

if (!existsSync(localPath)) {
  const localExample = resolve(root, ".env.local.example");
  if (existsSync(localExample)) {
    console.log("\nCopia .env.local.example → .env.local para redirect de email en localhost:");
    console.log("  copy .env.local.example .env.local");
  }
}

console.log(`
Modo B listo para: pnpm dev

Supabase Dashboard → Authentication → URL configuration:
  • Redirect URLs: http://localhost:5173/**  (la app vive en /app)
  • Site URL (lab): http://localhost:5173/app  (o mantén prod y usa el mail con redirect local)

Opcional: desactiva "Confirm email" en Email provider para no depender del correo.
`);

function quote(value) {
  if (/[\s#"']/.test(value)) return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return value;
}

/** Keep firma.dev secrets when regenerating `.dev.vars` (from .env or the file you edited). */
function readDevVar(path, key) {
  if (!existsSync(path)) return "";
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find((row) => row.startsWith(`${key}=`));
  if (!line) return "";
  const raw = line.slice(key.length + 1).trim();
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return raw;
}
