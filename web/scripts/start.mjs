import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

// Ensure local `.env` files are loaded when running `next start` via this script.
// (Production platforms like Render should provide env vars via the environment.)
const envPath = path.join(process.cwd(), ".env");
const envLocalPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
if (fs.existsSync(envLocalPath)) dotenv.config({ path: envLocalPath });

const port = process.env.PORT || "3000";
// On Windows, spawning `next.cmd` directly can fail with EINVAL.
// Use the JS entrypoint instead: `node node_modules/next/dist/bin/next start -p <port>`.
const nextJsBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextJsBin, "start", "-p", port], { stdio: "inherit" });

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

