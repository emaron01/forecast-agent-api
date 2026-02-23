import test from "node:test";
import assert from "node:assert/strict";
import {
  stripJsonFence,
  tryParseExtraction,
  validateCommentIngestionExtraction,
  type CommentIngestionExtracted,
} from "./commentIngestionValidation";
import { buildCommentIngestionPrompt } from "./prompt";

test("stripJsonFence extracts JSON from markdown code block", () => {
  const input = '```json\n{"summary":"x","meddpicc":{},"timing":{},"budget":{},"risk_flags":[],"next_steps":[],"follow_up_questions":[],"extraction_confidence":"high"}\n```';
  const out = stripJsonFence(input);
  assert.ok(out.startsWith("{"));
  assert.ok(out.endsWith("}"));
  assert.ok(out.includes("summary"));
});

test("stripJsonFence extracts JSON from plain text with braces", () => {
  const input = 'Here is the result:\n\n{"summary":"ok","meddpicc":{},"timing":{},"budget":{},"risk_flags":[],"next_steps":[],"follow_up_questions":[],"extraction_confidence":"high"}\n\nEnd.';
  const out = stripJsonFence(input);
  assert.ok(out.startsWith("{"));
  assert.ok(out.endsWith("}"));
});

test("stripJsonFence returns empty for empty input", () => {
  assert.equal(stripJsonFence(""), "");
  assert.equal(stripJsonFence("   "), "");
});

test("validateCommentIngestionExtraction rejects invalid objects", () => {
  assert.equal(validateCommentIngestionExtraction(null), null);
  assert.equal(validateCommentIngestionExtraction(undefined), null);
  assert.equal(validateCommentIngestionExtraction(123), null);
  assert.equal(validateCommentIngestionExtraction({}), null);
  assert.equal(
    validateCommentIngestionExtraction({ summary: "x" }),
    null
  );
  assert.equal(
    validateCommentIngestionExtraction({
      summary: "x",
      meddpicc: {},
      timing: {},
      budget: {},
      risk_flags: "not array",
      next_steps: [],
      follow_up_questions: [],
      extraction_confidence: "high",
    }),
    null
  );
});

test("validateCommentIngestionExtraction accepts valid object", () => {
  const valid: CommentIngestionExtracted = {
    summary: "Deal looks strong.",
    meddpicc: {},
    timing: { signal: "strong", evidence: [], gaps: [] },
    budget: { signal: "medium", evidence: [], gaps: [] },
    risk_flags: [],
    next_steps: [],
    follow_up_questions: [],
    extraction_confidence: "high",
  };
  const out = validateCommentIngestionExtraction(valid);
  assert.ok(out);
  assert.equal(out!.summary, "Deal looks strong.");
});

test("tryParseExtraction returns null for invalid JSON", () => {
  assert.equal(tryParseExtraction("not json"), null);
  assert.equal(tryParseExtraction("{}"), null);
  assert.equal(tryParseExtraction('{"summary":"x"}'), null);
});

test("tryParseExtraction returns object for valid JSON", () => {
  const json = JSON.stringify({
    summary: "Deal looks strong.",
    meddpicc: {},
    timing: { signal: "strong", evidence: [], gaps: [] },
    budget: { signal: "medium", evidence: [], gaps: [] },
    risk_flags: [],
    next_steps: [],
    follow_up_questions: [],
    extraction_confidence: "high",
  });
  const out = tryParseExtraction(json);
  assert.ok(out);
  assert.equal(out!.summary, "Deal looks strong.");
});

test("tryParseExtraction returns object when JSON is wrapped in markdown", () => {
  const json = JSON.stringify({
    summary: "Deal looks strong.",
    meddpicc: {},
    timing: { signal: "strong", evidence: [], gaps: [] },
    budget: { signal: "medium", evidence: [], gaps: [] },
    risk_flags: [],
    next_steps: [],
    follow_up_questions: [],
    extraction_confidence: "high",
  });
  const wrapped = "```json\n" + json + "\n```";
  const out = tryParseExtraction(wrapped);
  assert.ok(out);
  assert.equal(out!.summary, "Deal looks strong.");
});

const FIXTURE_SCORE_DEFS = [
  { category: "pain", score: 1, label: "Weak", criteria: "Mentioned but not validated" },
  { category: "pain", score: 2, label: "Medium", criteria: "Validated by stakeholder" },
];

test("buildCommentIngestionPrompt with scoreDefs includes SCORING CRITERIA and known criterion, not No criteria available", () => {
  const deal = { id: 1, account_name: "Acme", opportunity_name: "Deal 1", amount: 10000, close_date: "2025-03-15", forecast_stage: "Pipeline" };
  const rawNotes = "Met with CFO. Budget approved.";
  const prompt = buildCommentIngestionPrompt(deal, rawNotes, FIXTURE_SCORE_DEFS);
  assert.ok(prompt.includes("SCORING CRITERIA (AUTHORITATIVE)"), "prompt must include SCORING CRITERIA (AUTHORITATIVE)");
  assert.ok(prompt.includes("Weak") || prompt.includes("Mentioned but not validated"), "prompt must include at least one known criterion from fixture");
  assert.ok(!prompt.includes("No criteria available."), "prompt must NOT contain No criteria available when scoreDefs provided");
});
