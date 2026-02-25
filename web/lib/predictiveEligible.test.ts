import test from "node:test";
import assert from "node:assert/strict";
import { isClosedStage } from "./opportunityOutcome";

/**
 * Tests for predictive_eligible logic used in CRM ingest.
 * Closed stage => predictive_eligible=false, open stage => predictive_eligible=true.
 */
test("isClosedStage returns true for Closed Won", () => {
  assert.strictEqual(isClosedStage("Closed Won"), true);
  assert.strictEqual(isClosedStage("CLOSED WON"), true);
  assert.strictEqual(isClosedStage("Won"), true);
});

test("isClosedStage returns true for Closed Lost", () => {
  assert.strictEqual(isClosedStage("Closed Lost"), true);
  assert.strictEqual(isClosedStage("Lost"), true);
  assert.strictEqual(isClosedStage("Closed"), true);
});

test("isClosedStage returns false for open stages", () => {
  assert.strictEqual(isClosedStage("Commit"), false);
  assert.strictEqual(isClosedStage("Best Case"), false);
  assert.strictEqual(isClosedStage("Pipeline"), false);
  assert.strictEqual(isClosedStage("Negotiation"), false);
  assert.strictEqual(isClosedStage(""), false);
  assert.strictEqual(isClosedStage(null), false);
});
