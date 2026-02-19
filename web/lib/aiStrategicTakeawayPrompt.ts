import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export type AiStrategicTakeawayPromptRecord = {
  text: string;
  sha256: string;
  loadedAt: number;
  sourcePath: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __aiStrategicTakeawayPrompt__: AiStrategicTakeawayPromptRecord | undefined;
  // eslint-disable-next-line no-var
  var __aiStrategicTakeawayPromptPromise__: Promise<AiStrategicTakeawayPromptRecord> | undefined;
}

function defaultPromptPath() {
  return "prompts/AI_STRATEGIC_TAKEAWAY_PROMPT_SHEET.md";
}

export async function loadAiStrategicTakeawayPrompt(): Promise<AiStrategicTakeawayPromptRecord> {
  if (global.__aiStrategicTakeawayPrompt__) return global.__aiStrategicTakeawayPrompt__;
  if (global.__aiStrategicTakeawayPromptPromise__) return global.__aiStrategicTakeawayPromptPromise__;

  global.__aiStrategicTakeawayPromptPromise__ = (async () => {
    try {
      const envPath = String(process.env.AI_STRATEGIC_TAKEAWAY_PROMPT_PATH || "").trim();
      const sourcePath = envPath || defaultPromptPath();

      const isWindowsDriveAbs = /^[a-zA-Z]:[\\/]/.test(sourcePath);
      const absPath =
        path.isAbsolute(sourcePath) || isWindowsDriveAbs ? sourcePath : path.resolve(process.cwd(), sourcePath);
      const buf = await readFile(absPath);
      const text = buf.toString("utf8");
      const sha256 = createHash("sha256").update(buf).digest("hex");

      const rec: AiStrategicTakeawayPromptRecord = {
        text,
        sha256,
        loadedAt: Date.now(),
        sourcePath: absPath,
      };
      global.__aiStrategicTakeawayPrompt__ = rec;
      return rec;
    } catch (e) {
      global.__aiStrategicTakeawayPromptPromise__ = undefined;
      throw e;
    }
  })();

  return global.__aiStrategicTakeawayPromptPromise__;
}

