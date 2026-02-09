import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function getRootDir() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "..");
}

function getMigrationsDir() {
  return path.join(getRootDir(), "migrations");
}

async function listSqlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".sql"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

function runPsql(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql exited with code ${code}`));
    });
  });
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const migrationsDir = getMigrationsDir();
  const files = await listSqlFiles(migrationsDir);
  if (!files.length) {
    throw new Error(`No .sql files found in ${migrationsDir}`);
  }

  for (const f of files) {
    const fullPath = path.join(migrationsDir, f);
    await runPsql([databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", fullPath]);
  }
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});

