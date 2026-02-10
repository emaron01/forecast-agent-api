import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { maybeRunMigrations } from "./migrate.mjs";

// Ensure local `.env` files are loaded when running `next dev` via this script.
const envPath = path.join(process.cwd(), ".env");
const envLocalPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
if (fs.existsSync(envLocalPath)) dotenv.config({ path: envLocalPath });

async function main() {
  // Auto-run migrations so local dev doesn't crash on missing columns.
  try {
    await maybeRunMigrations();
  } catch (e) {
    const msg =
      e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    // eslint-disable-next-line no-console
    console.error(`Migration failed: ${msg}`);
    process.exit(1);
  }

  const port = process.env.PORT || "3000";
  const nextJsBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextJsBin, "dev", "-p", port], { stdio: "inherit" });

  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

main();

