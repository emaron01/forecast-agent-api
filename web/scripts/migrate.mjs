import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

function getRepoRootDir() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename); // .../web/scripts
  return path.resolve(__dirname, "..", ".."); // repo root
}

function getMigrationsDir() {
  return path.join(getRepoRootDir(), "migrations");
}

async function listSqlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".sql"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

async function loadSql(filePath) {
  const sql = await fs.readFile(filePath, "utf8");
  return String(sql || "").trim();
}

async function hasPublicIdColumn(client) {
  const res = await client.query(
    `
    SELECT
      EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'organizations'
           AND column_name = 'public_id'
      ) AS org_has_public_id,
      EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'users'
           AND column_name = 'public_id'
      ) AS users_has_public_id
    `
  );
  const row = res.rows?.[0] || {};
  return !!row.org_has_public_id && !!row.users_has_public_id;
}

function loadLocalEnvIfPresent() {
  // When running under Render, env vars come from platform.
  // For local runs, load `.env` / `.env.local` from `web/`.
  const webDir = path.join(getRepoRootDir(), "web");
  const envPath = path.join(webDir, ".env");
  const envLocalPath = path.join(webDir, ".env.local");
  dotenv.config({ path: envPath, override: false });
  dotenv.config({ path: envLocalPath, override: false });
}

/**
 * Best-effort migration runner (idempotent migrations).
 *
 * - Uses node-postgres (no `psql` dependency).
 * - Runs ALL `.sql` files in `/migrations` in lexical order.
 * - Intended for local dev + simple production deployments.
 */
export async function maybeRunMigrations() {
  loadLocalEnvIfPresent();

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) return { ok: false, skipped: true, reason: "DATABASE_URL not set" };

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const okAlready = await hasPublicIdColumn(client).catch(() => false);
    if (okAlready) return { ok: true, skipped: true, reason: "public_id columns already present" };

    const migrationsDir = getMigrationsDir();
    const files = await listSqlFiles(migrationsDir);
    if (!files.length) return { ok: false, skipped: true, reason: "no migrations found" };

    for (const f of files) {
      const fullPath = path.join(migrationsDir, f);
      const sql = await loadSql(fullPath);
      if (!sql) continue;
      // NOTE: most migration files are safe to run multiple times via IF NOT EXISTS / DO $$ guards.
      await client.query(sql);
    }

    return { ok: true, skipped: false, reason: "migrations applied" };
  } finally {
    await client.end();
  }
}

// Allow running as a script: `node web/scripts/migrate.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  maybeRunMigrations()
    .then((r) => {
      if (!r.ok) process.exitCode = 1;
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(r));
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(String(e?.message || e));
      process.exit(1);
    });
}

