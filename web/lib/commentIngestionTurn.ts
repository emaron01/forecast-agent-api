import { loadScoringDiscipline, loadIngestRules, promptHash } from "./masterDcoPrompt";
import { buildCommentIngestionContextOnly } from "./prompt";
import { callResponsesApiSingleTurn } from "./responsesTurn";
import { listScoreDefinitions } from "./db";
import { createHash } from "node:crypto";
import {
  type CommentIngestionExtracted,
  type CategoryExtraction,
  tryParseExtraction,
  tryParseSingleCategoryExtraction,
  tryParseMetadataExtraction,
} from "./commentIngestionValidation";

export type { CommentIngestionExtracted };
export { validateCommentIngestionExtraction, stripJsonFence, tryParseExtraction } from "./commentIngestionValidation";

/** All 10 MEDDPICC+TB categories scored in separate parallel LLM calls. */
const INGEST_CATEGORIES = [
  "pain",
  "metrics",
  "champion",
  "economic_buyer",
  "decision_criteria",
  "decision_process",
  "paper_process",
  "competition",
  "timing",
  "budget",
] as const;

const RUBRIC_UNAVAILABLE_EXTRACTED: CommentIngestionExtracted = {
  summary: "Extraction aborted: score definitions could not be loaded; extraction cannot use authoritative rubric.",
  meddpicc: {},
  timing: { signal: "missing", evidence: [], gaps: [] },
  budget: { signal: "missing", evidence: [], gaps: [] },
  risk_flags: [
    { type: "rubric_unavailable", severity: "high", why: "Score definitions could not be loaded; extraction cannot use authoritative rubric." },
  ],
  next_steps: [],
  follow_up_questions: [],
  extraction_confidence: "low",
};

/** Category-specific instruction appended to the shared instructions base. */
function getCategoryInstruction(category: string): string {
  const label = category.replace(/_/g, " ");
  return [
    `Score ONLY the ${label} category. Return JSON for this category only:`,
    `{`,
    `  "score": 0-3,`,
    `  "evidence_text": "the exact sentence from the notes that supports this score, or empty string if none",`,
    `  "tip": "coaching tip",`,
    `  "signal": "strong|medium|weak|missing"`,
    `}`,
    `Return valid JSON only. No markdown.`,
  ].join("\n");
}

/** Instruction for the 11th call: metadata only (summary, names, confidence, risk_flags, next_steps, follow_up_questions). */
function getMetadataInstruction(): string {
  return [
    "From the CRM notes above, return a single JSON object with metadata only (no category scores):",
    `{`,
    `  "summary": "2-4 sentences summarizing the deal and notes",`,
    `  "extraction_confidence": "high|medium|low",`,
    `  "champion_name": "string or null (only if Champion/Internal Sponsor is explicitly named; otherwise null)",`,
    `  "champion_title": "string or null (only if Champion title is explicitly stated; otherwise null)",`,
    `  "eb_name": "string or null (only if Economic Buyer is explicitly named; otherwise null)",`,
    `  "eb_title": "string or null (only if Economic Buyer title is explicitly stated; otherwise null)",`,
    `  "risk_flags": [{ "type": "string", "severity": "low|med|high", "why": "string" }],`,
    `  "next_steps": ["string"],`,
    `  "follow_up_questions": [{ "category": "string", "question": "string", "priority": "high|med|low" }]`,
    `}`,
    `Return valid JSON only. No markdown.`,
  ].join("\n");
}

function singleResultToCategoryExtraction(r: { score: number; evidence_text: string; tip: string; signal: string }): CategoryExtraction {
  return {
    signal: r.signal,
    evidence: r.evidence_text ? [r.evidence_text] : [],
    gaps: [],
    score: r.score,
    evidence_text: r.evidence_text,
    tip: r.tip,
  };
}

/**
 * Runs one LLM call for a single MEDDPICC+TB category.
 * Retries that category only if response is invalid JSON and retryOnInvalid is true.
 */
export async function runSingleCategoryIngest(args: {
  instructionsBase: string;
  category: string;
  retryOnInvalid?: boolean;
}): Promise<{ category: string; rawText: string; score: number; evidence_text: string; tip: string; signal: string }> {
  const { instructionsBase, category, retryOnInvalid = true } = args;
  const instructions = instructionsBase + "\n\n" + getCategoryInstruction(category);
  const userMessage = `Return JSON for the ${category.replace(/_/g, " ")} category only.`;

  let rawText = await callResponsesApiSingleTurn({ instructions, userMessage });
  let parsed = tryParseSingleCategoryExtraction(rawText);

  if (!parsed && retryOnInvalid) {
    const retryInstructions = `${instructions}\n\nCORRECTION: Your previous response was not valid JSON. Return valid JSON only, matching the schema above. No markdown.`;
    rawText = await callResponsesApiSingleTurn({
      instructions: retryInstructions,
      userMessage: "Return valid JSON only.",
    });
    parsed = tryParseSingleCategoryExtraction(rawText);
  }

  if (!parsed) {
    throw new Error(`Comment ingestion returned invalid JSON for category ${category} after retry`);
  }

  return { category, rawText, ...parsed };
}

/**
 * Runs one LLM call for metadata only (summary, extraction_confidence, champion/eb names and titles, risk_flags, next_steps, follow_up_questions).
 * Retries once if response is invalid and retryOnInvalid is true.
 */
async function runMetadataIngest(args: {
  instructionsBase: string;
  retryOnInvalid?: boolean;
}): Promise<{
  rawText: string;
  summary: string;
  extraction_confidence: string;
  champion_name?: string | null;
  champion_title?: string | null;
  eb_name?: string | null;
  eb_title?: string | null;
  risk_flags: Array<{ type: string; severity: string; why: string }>;
  next_steps: string[];
  follow_up_questions: Array<{ category: string; question: string; priority: string }>;
}> {
  const { instructionsBase, retryOnInvalid = true } = args;
  const instructions = instructionsBase + "\n\n" + getMetadataInstruction();
  const userMessage = "Return the metadata JSON only (summary, confidence, names, risk_flags, next_steps, follow_up_questions).";

  let rawText = await callResponsesApiSingleTurn({ instructions, userMessage });
  let parsed = tryParseMetadataExtraction(rawText);

  if (!parsed && retryOnInvalid) {
    const retryInstructions = `${instructions}\n\nCORRECTION: Your previous response was not valid JSON. Return valid JSON only. No markdown.`;
    rawText = await callResponsesApiSingleTurn({
      instructions: retryInstructions,
      userMessage: "Return valid JSON only.",
    });
    parsed = tryParseMetadataExtraction(rawText);
  }

  if (!parsed) {
    throw new Error("Comment ingestion metadata call returned invalid JSON after retry");
  }

  return { rawText, ...parsed };
}

export async function runCommentIngestionTurn(args: {
  deal: Record<string, any>;
  rawNotes: string;
  orgId: number;
  retryOnInvalid?: boolean;
}): Promise<{ extracted: CommentIngestionExtracted; rawText: string }> {
  const { deal, rawNotes, orgId, retryOnInvalid = true } = args;

  const scoreDefs = await listScoreDefinitions().catch(() => []);
  if (!scoreDefs || scoreDefs.length === 0) {
    return { extracted: RUBRIC_UNAVAILABLE_EXTRACTED, rawText: "" };
  }

  const [scoring, ingest] = await Promise.all([
    loadScoringDiscipline(),
    loadIngestRules(),
  ]);
  const composedText = scoring.text + "\n\n---\n\n" + ingest.text;
  const contextBlock = buildCommentIngestionContextOnly(deal, rawNotes, scoreDefs);
  const instructionsBase = composedText + "\n\n---\n\n" + contextBlock;

  console.log(JSON.stringify({
    event: "prompt_composition",
    flow: "ingest",
    scoring_hash: promptHash(scoring.text),
    ingest_hash: promptHash(ingest.text),
    composed_hash: promptHash(composedText),
  }));

  // 10 parallel category calls + 1 metadata call (11 total)
  const categoryPromises = INGEST_CATEGORIES.map((category) =>
    runSingleCategoryIngest({ instructionsBase, category, retryOnInvalid })
  );
  const metadataPromise = runMetadataIngest({ instructionsBase, retryOnInvalid });

  const [categoryResults, metadata] = await Promise.all([
    Promise.all(categoryPromises),
    metadataPromise,
  ]);

  const meddpicc: Record<string, CategoryExtraction> = {};
  let timing: CategoryExtraction = { signal: "missing", evidence: [], gaps: [] };
  let budget: CategoryExtraction = { signal: "missing", evidence: [], gaps: [] };

  for (const r of categoryResults) {
    const catExtraction = singleResultToCategoryExtraction(r);
    if (r.category === "timing") {
      timing = catExtraction;
    } else if (r.category === "budget") {
      budget = catExtraction;
    } else {
      meddpicc[r.category] = catExtraction;
    }
  }

  const extracted: CommentIngestionExtracted = {
    summary: metadata.summary,
    meddpicc,
    timing,
    budget,
    risk_flags: metadata.risk_flags,
    next_steps: metadata.next_steps,
    follow_up_questions: metadata.follow_up_questions,
    extraction_confidence: metadata.extraction_confidence,
    champion_name: metadata.champion_name ?? null,
    champion_title: metadata.champion_title ?? null,
    eb_name: metadata.eb_name ?? null,
    eb_title: metadata.eb_title ?? null,
  };

  const rawText = [...categoryResults.map((r) => r.rawText), metadata.rawText].join("\n---\n");

  return { extracted, rawText };
}

export function getPromptVersionHash(): string {
  return createHash("sha256").update("comment_ingestion_v1").digest("hex").slice(0, 16);
}
