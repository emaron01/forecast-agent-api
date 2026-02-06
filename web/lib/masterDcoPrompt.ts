import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export type MasterPromptRecord = {
  text: string;
  sha256: string;
  loadedAt: number;
  sourcePath: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __masterDcoPrompt__: MasterPromptRecord | undefined;
  // eslint-disable-next-line no-var
  var __masterDcoPromptPromise__: Promise<MasterPromptRecord> | undefined;
}

function defaultPromptPath() {
  // Default to a bundled, repo-shipped prompt file (works in Render/Linux).
  // Can be overridden with MASTER_DCO_PROMPT_PATH for local editing.
  return "prompts/master Dco Prompts.txt";
}

export async function loadMasterDcoPrompt(): Promise<MasterPromptRecord> {
  if (global.__masterDcoPrompt__) return global.__masterDcoPrompt__;
  if (global.__masterDcoPromptPromise__) return global.__masterDcoPromptPromise__;

  global.__masterDcoPromptPromise__ = (async () => {
    try {
      const envPath = String(process.env.MASTER_DCO_PROMPT_PATH || "").trim();
      const sourcePath = envPath || defaultPromptPath();

      // path.isAbsolute does not treat Windows drive paths as absolute on Linux/macOS.
      const isWindowsDriveAbs = /^[a-zA-Z]:[\\/]/.test(sourcePath);
      const absPath =
        path.isAbsolute(sourcePath) || isWindowsDriveAbs
          ? sourcePath
          : path.resolve(process.cwd(), sourcePath);
      const buf = await readFile(absPath);

      // Keep text verbatim: do NOT trim or normalize newlines.
      const text = buf.toString("utf8");
      const sha256 = createHash("sha256").update(buf).digest("hex");

      const rec: MasterPromptRecord = {
        text,
        sha256,
        loadedAt: Date.now(),
        sourcePath: absPath,
      };
      global.__masterDcoPrompt__ = rec;
      return rec;
    } catch (e) {
      // Allow retry on next call (don't permanently poison the cache).
      global.__masterDcoPromptPromise__ = undefined;
      throw e;
    }
  })();

  return global.__masterDcoPromptPromise__;
}

