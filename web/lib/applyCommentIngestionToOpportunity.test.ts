/**
 * Scoring trigger controls: ingestion must not rescore when baseline exists.
 *
 * Verification: run `node scripts/verify-scoring-triggers.mjs` (requires DATABASE_URL).
 * Manual: 1) First ingest sets baseline. 2) Re-ingest does not change baseline/health_score.
 * 3) Agent update sets health_score_source='agent'.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applyCommentIngestionToOpportunity } from "./applyCommentIngestionToOpportunity";

test("applyCommentIngestionToOpportunity is a function", () => {
  assert.strictEqual(typeof applyCommentIngestionToOpportunity, "function");
});
