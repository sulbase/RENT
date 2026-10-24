/**
 * wrangler dev checks CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
 * in the process environment before it reads .dev.vars. This script sets that
 * variable from DATABASE_POOLED_URL and then starts the local Worker.
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(root, ".env") });
dotenv.config({ path: resolve(root, ".env.local"), override: true });

const pooled = process.env.DATABASE_POOLED_URL?.trim();
if (!pooled) {
  console.error("DATABASE_POOLED_URL (puerto 6543) es obligatorio para emular Hyperdrive en local.");
  process.exit(1);
}

process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = pooled;

const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const child = spawn(process.execPath, [wrangler, "dev", "--port", "8787"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
