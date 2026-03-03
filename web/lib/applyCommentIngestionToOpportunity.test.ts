/**
 * Scoring trigger controls: ingestion must not rescore when baseline exists.
 *
 * Verification: run `node scripts/verify-scoring-triggers.mjs` (requires DATABASE_URL).
 * Manual: 1) First ingest sets baseline. 2) Re-ingest does not change baseline/health_score.
 * 3) Agent update sets health_score_source='agent'.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applyCommentIngestionToOpportunity, isBaselineEligibleForClosed } from "./applyCommentIngestionToOpportunity";

test("applyCommentIngestionToOpportunity is a function", () => {
  assert.strictEqual(typeof applyCommentIngestionToOpportunity, "function");
});

test("baseline closed eligibility: Closed Won inside last two completed quarters is eligible", () => {
  const opp = {
    forecast_stage: "Closed",
    sales_stage: "Won and Closed",
    close_date: "2025-07-07T00:00:00Z",
  };
  const now = new Date("2026-03-03T00:00:00Z");
  assert.strictEqual(isBaselineEligibleForClosed(opp, now), true);
});

test("baseline closed eligibility: Closed Won older than window is not eligible", () => {
  const opp = {
    forecast_stage: "Closed",
    sales_stage: "Won and Closed",
    close_date: "2025-06-30T00:00:00Z",
  };
  const now = new Date("2026-03-03T00:00:00Z");
  assert.strictEqual(isBaselineEligibleForClosed(opp, now), false);
});

test("baseline closed eligibility: current-quarter closed is eligible", () => {
  const opp = {
    forecast_stage: "Closed",
    sales_stage: "Won and Closed",
    close_date: "2026-01-21T00:00:00Z",
  };
  const now = new Date("2026-03-03T00:00:00Z");
  assert.strictEqual(isBaselineEligibleForClosed(opp, now), true);
});
