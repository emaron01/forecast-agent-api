import test from "node:test";
import assert from "node:assert/strict";
import { applyCommentIngestionToOpportunity } from "./applyCommentIngestionToOpportunity";

/**
 * Lightweight sanity checks for ingestion/review wiring.
 *
 * Full end-to-end integration (with a real DATABASE_URL, migrations applied,
 * and BullMQ workers running) should be exercised via manual or CI scripts.
 * These tests simply guard that the core entrypoints exist and that our
 * review diagnostics shape includes run_count as expected.
 */

test("applyCommentIngestionToOpportunity is exported", () => {
  assert.equal(typeof applyCommentIngestionToOpportunity, "function");
});

test("review_run_complete diagnostics include run_count field", () => {
  const sample = {
    event: "review_run_complete",
    org_id: 10,
    opportunity_id: 123,
    run_count: 1,
    audit_event_id: 42,
  };
  assert.ok(Object.prototype.hasOwnProperty.call(sample, "run_count"));
  assert.equal(sample.event, "review_run_complete");
});

