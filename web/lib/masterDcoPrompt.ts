import { readFile } from "node:fs/promises";
import fs from "node:fs";
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
  // eslint-disable-next-line no-var
  var __scoringDiscipline__: MasterPromptRecord | undefined;
  // eslint-disable-next-line no-var
  var __scoringDisciplinePromise__: Promise<MasterPromptRecord> | undefined;
  // eslint-disable-next-line no-var
  var __conversationalRules__: MasterPromptRecord | undefined;
  // eslint-disable-next-line no-var
  var __conversationalRulesPromise__: Promise<MasterPromptRecord> | undefined;
  // eslint-disable-next-line no-var
  var __ingestRules__: MasterPromptRecord | undefined;
  // eslint-disable-next-line no-var
  var __ingestRulesPromise__: Promise<MasterPromptRecord> | undefined;
}

const MIN_PROMPT_LENGTH = 100;

const SCORING_TERMS_NEAR_MANDATORY = [
  "Explicit & Verified",
  "Credible but Indirect",
  "Vague / Rep Assertion",
  "Evidence Floor",
  "Conservative Bias",
  "Score Gating",
];

const CONVERSATIONAL_TERMS_IN_INGEST = [
  "SPOKEN",
  "ask ONE",
  "say ONLY",
  "Do NOT speak",
  "End the rep turn",
];

function resolvePath(
  defaultRelativePath: string,
  envOverride: string
): string {
  const envPath = String(envOverride || "").trim();
  const sourcePath = envPath || defaultRelativePath;

  const isWindowsDriveAbs = /^[a-zA-Z]:[\\/]/.test(sourcePath);
  if (path.isAbsolute(sourcePath) || isWindowsDriveAbs) return sourcePath;

  if (!envPath) {
    const candidates = [
      path.resolve(process.cwd(), sourcePath),
      path.resolve(process.cwd(), "web", sourcePath),
    ];
    const existing = candidates.find((p) => fs.existsSync(p));
    return existing || candidates[0];
  }

  return path.resolve(process.cwd(), sourcePath);
}

async function loadPromptFile(
  defaultRelativePath: string,
  envVar: string
): Promise<{ text: string; absPath: string }> {
  const absPath = resolvePath(defaultRelativePath, process.env[envVar] || "");
  if (!fs.existsSync(absPath)) {
    throw new Error(`Prompt file not found: ${absPath}`);
  }
  const buf = await readFile(absPath);
  const text = buf.toString("utf8");
  return { text, absPath };
}

/**
 * Returns first 12 chars of sha256 hex of the input. Exported for call sites to log composition hashes.
 */
export function promptHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

/**
 * Validates that prompt files do not leak scoring-only terms into conversational or conversational terms into ingest.
 * Throws with a clear error message if validation fails.
 * Call after reading each file in loaders; also export for server startup.
 */
export function validatePromptComposition(
  scoring: MasterPromptRecord,
  conversational: MasterPromptRecord,
  ingest: MasterPromptRecord
): void {
  const checks: string[] = [];

  // (a) Conversational must not define scoring terms as MANDATORY
  for (const term of SCORING_TERMS_NEAR_MANDATORY) {
    if (!conversational.text.includes(term)) continue;
    const idx = conversational.text.indexOf(term);
    const window = conversational.text.slice(
      Math.max(0, idx - 120),
      idx + term.length + 120
    );
    if (window.includes("MANDATORY")) {
      checks.push(
        `conversational_rules must not contain MANDATORY adjacent to scoring term "${term}" (scoring-only)`
      );
    }
  }

  // (b) Ingest must not contain conversational-only phrases
  for (const phrase of CONVERSATIONAL_TERMS_IN_INGEST) {
    if (ingest.text.includes(phrase)) {
      checks.push(
        `ingest_rules must not contain conversational phrase "${phrase}"`
      );
    }
  }

  // (c) No empty or tiny files
  if (!scoring.text || scoring.text.length < MIN_PROMPT_LENGTH) {
    checks.push(
      `scoring_discipline is empty or under ${MIN_PROMPT_LENGTH} characters`
    );
  }
  if (!conversational.text || conversational.text.length < MIN_PROMPT_LENGTH) {
    checks.push(
      `conversational_rules is empty or under ${MIN_PROMPT_LENGTH} characters`
    );
  }
  if (!ingest.text || ingest.text.length < MIN_PROMPT_LENGTH) {
    checks.push(
      `ingest_rules is empty or under ${MIN_PROMPT_LENGTH} characters`
    );
  }

  if (checks.length > 0) {
    throw new Error(
      `Prompt composition validation failed:\n${checks.map((c) => ` - ${c}`).join("\n")}`
    );
  }
}

function toRecord(
  text: string,
  absPath: string
): MasterPromptRecord {
  return {
    text,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    loadedAt: Date.now(),
    sourcePath: absPath,
  };
}

export async function loadScoringDiscipline(): Promise<MasterPromptRecord> {
  if (global.__scoringDiscipline__) return global.__scoringDiscipline__;
  if (global.__scoringDisciplinePromise__)
    return global.__scoringDisciplinePromise__;

  global.__scoringDisciplinePromise__ = (async () => {
    try {
      const { text, absPath } = await loadPromptFile(
        "prompts/scoring_discipline.txt",
        "SCORING_DISCIPLINE_PATH"
      );
      const rec = toRecord(text, absPath);
      if (!rec.text || rec.text.length < MIN_PROMPT_LENGTH) {
        throw new Error(
          `scoring_discipline is empty or under ${MIN_PROMPT_LENGTH} characters`
        );
      }
      global.__scoringDiscipline__ = rec;
      return rec;
    } catch (e) {
      global.__scoringDisciplinePromise__ = undefined;
      throw e;
    }
  })();

  return global.__scoringDisciplinePromise__;
}

export async function loadConversationalRules(): Promise<MasterPromptRecord> {
  if (global.__conversationalRules__) return global.__conversationalRules__;
  if (global.__conversationalRulesPromise__)
    return global.__conversationalRulesPromise__;

  global.__conversationalRulesPromise__ = (async () => {
    try {
      const { text, absPath } = await loadPromptFile(
        "prompts/conversational_rules.txt",
        "CONVERSATIONAL_RULES_PATH"
      );
      const rec = toRecord(text, absPath);
      if (!rec.text || rec.text.length < MIN_PROMPT_LENGTH) {
        throw new Error(
          `conversational_rules is empty or under ${MIN_PROMPT_LENGTH} characters`
        );
      }
      const scoring = await loadScoringDiscipline();
      const placeholderIngest: MasterPromptRecord = {
        text: rec.text.length >= MIN_PROMPT_LENGTH ? "x".repeat(MIN_PROMPT_LENGTH) : "",
        sha256: "",
        loadedAt: 0,
        sourcePath: "",
      };
      validatePromptComposition(scoring, rec, placeholderIngest);
      global.__conversationalRules__ = rec;
      return rec;
    } catch (e) {
      global.__conversationalRulesPromise__ = undefined;
      throw e;
    }
  })();

  return global.__conversationalRulesPromise__;
}

export async function loadIngestRules(): Promise<MasterPromptRecord> {
  if (global.__ingestRules__) return global.__ingestRules__;
  if (global.__ingestRulesPromise__) return global.__ingestRulesPromise__;

  global.__ingestRulesPromise__ = (async () => {
    try {
      const { text, absPath } = await loadPromptFile(
        "prompts/ingest_rules.txt",
        "INGEST_RULES_PATH"
      );
      const rec = toRecord(text, absPath);
      if (!rec.text || rec.text.length < MIN_PROMPT_LENGTH) {
        throw new Error(
          `ingest_rules is empty or under ${MIN_PROMPT_LENGTH} characters`
        );
      }
      const scoring = await loadScoringDiscipline();
      const placeholderConversational: MasterPromptRecord = {
        text: "x".repeat(MIN_PROMPT_LENGTH),
        sha256: "",
        loadedAt: 0,
        sourcePath: "",
      };
      validatePromptComposition(scoring, placeholderConversational, rec);
      global.__ingestRules__ = rec;
      return rec;
    } catch (e) {
      global.__ingestRulesPromise__ = undefined;
      throw e;
    }
  })();

  return global.__ingestRulesPromise__;
}

/**
 * @deprecated Use loadScoringDiscipline + loadConversationalRules and compose at call site. Kept for backward compatibility.
 */
export async function loadMasterDcoPrompt(): Promise<MasterPromptRecord> {
  if (global.__masterDcoPrompt__) return global.__masterDcoPrompt__;
  if (global.__masterDcoPromptPromise__) return global.__masterDcoPromptPromise__;

  global.__masterDcoPromptPromise__ = (async () => {
    try {
      const [scoringDiscipline, conversationalRules] = await Promise.all([
        loadScoringDiscipline(),
        loadConversationalRules(),
      ]);
      const composedText =
        scoringDiscipline.text +
        "\n\n---\n\n" +
        conversationalRules.text;
      const rec: MasterPromptRecord = {
        text: composedText,
        sha256: createHash("sha256").update(composedText, "utf8").digest("hex"),
        loadedAt: Date.now(),
        sourcePath: "composed:scoring_discipline+conversational_rules",
      };
      global.__masterDcoPrompt__ = rec;
      return rec;
    } catch (e) {
      global.__masterDcoPromptPromise__ = undefined;
      throw e;
    }
  })();

  return global.__masterDcoPromptPromise__;
}
