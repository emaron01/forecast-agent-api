import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { maybeRunMigrations } from "./migrate.mjs";

// Ensure local `.env` files are loaded when running `next start` via this script.
// (Production platforms like Render should provide env vars via the environment.)
const envPath = path.join(process.cwd(), ".env");
const envLocalPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
if (fs.existsSync(envLocalPath)) dotenv.config({ path: envLocalPath });

async function main() {
  // Ensure DB migrations are applied (prevents missing-column crashes like `public_id`).
  // This is safe because migrations are written to be idempotent.
  try {
    const r = await maybeRunMigrations();
    // eslint-disable-next-line no-console
    console.log(`[migrations] ${JSON.stringify(r)}`);
  } catch (e) {
    // If migrations fail, we should fail fast rather than booting a broken server.
    const msg =
      e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    // eslint-disable-next-line no-console
    console.error(`Migration failed: ${msg}`);
    process.exit(1);
  }

  const port = process.env.PORT || "3000";
  // On Windows, spawning `next.cmd` directly can fail with EINVAL.
  // Use the JS entrypoint instead: `node node_modules/next/dist/bin/next start -p <port>`.
  const nextJsBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextJsBin, "start", "-p", port], { stdio: "inherit" });

  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

main();

