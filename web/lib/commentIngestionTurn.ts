import { loadMasterDcoPrompt } from "./masterDcoPrompt";
import { buildCommentIngestionPrompt } from "./prompt";
import { callResponsesApiSingleTurn } from "./responsesTurn";
import { listScoreDefinitions } from "./db";
import { createHash } from "node:crypto";
import {
  type CommentIngestionExtracted,
  tryParseExtraction,
} from "./commentIngestionValidation";

export type { CommentIngestionExtracted };
export { validateCommentIngestionExtraction, stripJsonFence, tryParseExtraction } from "./commentIngestionValidation";

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

  const master = await loadMasterDcoPrompt();
  const contextBlock = buildCommentIngestionPrompt(deal, rawNotes, scoreDefs);
  const instructions = `${master.text}\n\n---\n\n${contextBlock}`;

  const userMessage = `Analyze the CRM notes above and return the JSON extraction.`;

  let rawText = await callResponsesApiSingleTurn({ instructions, userMessage });
  let extracted = tryParseExtraction(rawText);

  if (!extracted && retryOnInvalid) {
    const retryInstructions = `${instructions}\n\nCORRECTION: Your previous response was not valid JSON. Return valid JSON only, matching the schema exactly. No markdown, no prose.`;
    rawText = await callResponsesApiSingleTurn({
      instructions: retryInstructions,
      userMessage: "Return valid JSON only, matching schema exactly.",
    });
    extracted = tryParseExtraction(rawText);
  }

  if (!extracted) {
    throw new Error("Comment ingestion returned invalid JSON after retry");
  }

  return { extracted, rawText };
}

export function getPromptVersionHash(): string {
  return createHash("sha256").update("comment_ingestion_v1").digest("hex").slice(0, 16);
}
