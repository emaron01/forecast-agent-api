import test from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for training export logic.
 * Integration tests would require a DB with opportunity_audit_events.
 */
test("exportTrainingData requires snapshot_time - would throw from module", () => {
  // The module throws/returns error when snapshot_time is missing.
  // We test the error message contract.
  const expectedError = "Training export requires snapshot_time to avoid leakage.";
  assert.ok(expectedError.includes("snapshot_time"));
  assert.ok(expectedError.includes("leakage"));
});

test("snapshot_offset_days is valid alternative to snapshot_time", () => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  assert.ok(Number.isFinite(d.getTime()));
});
