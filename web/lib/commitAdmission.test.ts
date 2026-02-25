import test from "node:test";
import assert from "node:assert/strict";
import {
  computeCrmBucket,
  computeCommitAdmission,
  isCommitAdmissionApplicable,
} from "./commitAdmission";

test("computeCrmBucket returns commit for Commit stage", () => {
  assert.strictEqual(computeCrmBucket({ forecast_stage: "Commit" }), "commit");
  assert.strictEqual(computeCrmBucket({ forecast_stage: "Commit", sales_stage: "" }), "commit");
});

test("computeCrmBucket returns best_case for Best Case stage", () => {
  assert.strictEqual(computeCrmBucket({ forecast_stage: "Best Case" }), "best_case");
});

test("computeCrmBucket returns pipeline for Pipeline stage", () => {
  assert.strictEqual(computeCrmBucket({ forecast_stage: "Pipeline" }), "pipeline");
});

test("computeCrmBucket returns null for Closed Won", () => {
  assert.strictEqual(computeCrmBucket({ forecast_stage: "Closed Won" }), null);
});

test("computeCrmBucket returns null for Closed Lost", () => {
  assert.strictEqual(computeCrmBucket({ forecast_stage: "Closed Lost" }), null);
});

test("isCommitAdmissionApplicable false for closed deals", () => {
  assert.strictEqual(isCommitAdmissionApplicable({ forecast_stage: "Closed Won" }, "Commit"), false);
});

test("isCommitAdmissionApplicable true when CRM bucket is Commit", () => {
  assert.strictEqual(isCommitAdmissionApplicable({ forecast_stage: "Commit" }, null), true);
});

test("isCommitAdmissionApplicable true when ai_forecast is Commit", () => {
  assert.strictEqual(isCommitAdmissionApplicable({ forecast_stage: "Best Case" }, "Commit"), true);
});

test("isCommitAdmissionApplicable false when both CRM and AI are Best Case", () => {
  assert.strictEqual(isCommitAdmissionApplicable({ forecast_stage: "Best Case" }, "Best Case"), false);
});

test("computeCommitAdmission returns admitted when not applicable", () => {
  const r = computeCommitAdmission({}, false);
  assert.strictEqual(r.status, "admitted");
  assert.deepStrictEqual(r.reasons, []);
});

test("computeCommitAdmission not_admitted when paper_score <= 1 (validation case 1)", () => {
  const r = computeCommitAdmission(
    {
      paper_score: 1,
      process_score: 3,
      timing_score: 3,
      budget_score: 3,
      paper_confidence: "high",
    },
    true
  );
  assert.strictEqual(r.status, "not_admitted");
  assert.ok(r.reasons.includes("Paper Process weak for Commit"));
});

test("computeCommitAdmission not_admitted when any of 4 has score <= 1", () => {
  const r = computeCommitAdmission(
    {
      paper_score: 3,
      process_score: 2,
      timing_score: 0,
      budget_score: 3,
    },
    true
  );
  assert.strictEqual(r.status, "not_admitted");
  assert.ok(r.reasons.includes("Timing weak for Commit"));
});

test("computeCommitAdmission needs_review when all 4 >= 2 but 0-1 high confidence (validation case 2)", () => {
  const r = computeCommitAdmission(
    {
      paper_score: 2,
      process_score: 2,
      timing_score: 2,
      budget_score: 2,
      paper_confidence: "high",
      process_confidence: "medium",
      timing_confidence: "low",
      budget_confidence: "medium",
    },
    true
  );
  assert.strictEqual(r.status, "needs_review");
  assert.ok(r.reasons.includes("Commit support relies on low-confidence evidence"));
});

test("computeCommitAdmission admitted when all 4 >= 2 and >= 2 high confidence", () => {
  const r = computeCommitAdmission(
    {
      paper_score: 2,
      process_score: 3,
      timing_score: 2,
      budget_score: 2,
      paper_confidence: "high",
      process_confidence: "high",
      timing_confidence: "medium",
      budget_confidence: "low",
    },
    true
  );
  assert.strictEqual(r.status, "admitted");
  assert.deepStrictEqual(r.reasons, []);
});
