import test from "node:test";
import assert from "node:assert/strict";
import {
  evidenceDelta,
  scoreDelta,
  actionabilityDelta,
  shouldEmitNoMaterialChange,
  hasBudgetNegativeEvidence,
  fallbackForEvidenceOnly,
} from "./categoryUpdateDeltas";

test("pricing not discussed triggers evidence_delta and does NOT return no material change", () => {
  const userText = "We have not discussed any pricing.";
  assert.ok(hasBudgetNegativeEvidence(userText), "budget negative evidence detected");

  const evDelta = evidenceDelta({
    category: "budget",
    userText,
    lastEvidence: "Previously had some budget info",
    llmEvidence: undefined,
  });
  assert.strictEqual(evDelta, true, "evidence_delta is true for pricing not discussed");

  const scDelta = scoreDelta(2, 2);
  assert.strictEqual(scDelta, false, "score_delta false when same score");

  const actDelta = actionabilityDelta({ lastTip: "", llmTip: "", score: 2 });
  assert.strictEqual(actDelta, true, "actionability_delta true when score < 3 and no prior/LLM tip");

  const deltas = { evidence_delta: evDelta, score_delta: scDelta, actionability_delta: actDelta };
  assert.strictEqual(shouldEmitNoMaterialChange(deltas), false, "must NOT emit no material change");
});

test("truly empty or irrelevant response keeps no material change", () => {
  const userText = "no";
  const evDelta = evidenceDelta({
    category: "budget",
    userText,
    lastEvidence: "Some existing evidence",
    llmEvidence: "",
  });
  assert.strictEqual(evDelta, false, "evidence_delta false for trivial no");

  const evDeltaOk = evidenceDelta({
    category: "budget",
    userText: "ok",
    lastEvidence: "Some existing evidence",
    llmEvidence: "",
  });
  assert.strictEqual(evDeltaOk, false, "evidence_delta false for irrelevant filler");

  const scDelta = scoreDelta(2, 2);
  assert.strictEqual(scDelta, false);

  const actDelta = actionabilityDelta({ lastTip: "Same tip", llmTip: "Same tip", score: 2 });
  assert.strictEqual(actDelta, false);

  assert.strictEqual(
    shouldEmitNoMaterialChange({ evidence_delta: false, score_delta: false, actionability_delta: false }),
    true,
    "emit no material change when all deltas false"
  );
});

test("same negative text when already stored yields evidence_delta false and No material change", () => {
  const userText = "we have not discussed any pricing.";
  const lastEvidence = "We have not discussed any pricing."; // already persisted from first call
  const evDelta = evidenceDelta({
    category: "budget",
    userText,
    lastEvidence,
    llmEvidence: undefined,
  });
  assert.strictEqual(evDelta, false, "evidence_delta false when stored evidence already reflects same negative");
  assert.strictEqual(
    shouldEmitNoMaterialChange({ evidence_delta: false, score_delta: false, actionability_delta: false }),
    true,
    "emit no material change"
  );
});

test("actionability_delta is true when score < 3 and LLM tip missing and no prior tip exists", () => {
  assert.strictEqual(
    actionabilityDelta({ lastTip: "", llmTip: "", score: 2 }),
    true,
    "actionability_delta true when gap and no tips"
  );
  assert.strictEqual(
    actionabilityDelta({ lastTip: "Existing coaching tip", llmTip: "", score: 2 }),
    false,
    "actionability_delta false when gap but prior tip exists"
  );
  assert.strictEqual(
    shouldEmitNoMaterialChange({ evidence_delta: false, score_delta: false, actionability_delta: true }),
    false,
    "must NOT emit no material change when actionability_delta true"
  );
});

test("fallback for budget negative evidence returns low score and tip", () => {
  const out = fallbackForEvidenceOnly({ category: "budget", userText: "we have not discussed any pricing." });
  assert.strictEqual(out.score, 0);
  assert.ok(out.tip.length > 0);
  assert.ok(out.evidence.includes("not discussed"));
});
