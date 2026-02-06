import { spawn } from "node:child_process";
import path from "node:path";

const port = process.env.PORT || "3000";
const binName = process.platform === "win32" ? "next.cmd" : "next";
const binPath = path.join(process.cwd(), "node_modules", ".bin", binName);

const child = spawn(binPath, ["start", "-p", port], {
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

