import fs from "node:fs";
import path from "node:path";

function isAbsolutePath(sourcePath: string) {
  return path.isAbsolute(sourcePath) || /^[a-zA-Z]:[\\/]/.test(sourcePath);
}

export function resolvePromptPath(defaultFileName: string, envOverride = "") {
  const envPath = String(envOverride || "").trim();
  if (envPath) {
    return isAbsolutePath(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  }

  const candidates = [
    path.join(process.cwd(), "prompts", defaultFileName),
    path.join(process.cwd(), "web", "prompts", defaultFileName),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}
