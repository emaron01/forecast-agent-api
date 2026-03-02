import test from "node:test";
import assert from "node:assert/strict";
import { isClosedStage, isClosedDealInLastTwoCompletedQuarters } from "./opportunityOutcome";

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

test("isClosedDealInLastTwoCompletedQuarters gates closed deals by close_date window", () => {
  // Fix reference date to make quarter math deterministic: 2025-10-15 (UTC), i.e. current quarter = Q4 2025.
  const now = new Date(Date.UTC(2025, 9, 15));

  const closedWon = (closeDate: string) => ({
    forecast_stage: "Closed Won",
    sales_stage: null,
    close_date: closeDate,
  });

  const closedLost = (closeDate: string) => ({
    forecast_stage: "Closed Lost",
    sales_stage: null,
    close_date: closeDate,
  });

  // Last completed quarter (Q3 2025) → eligible
  assert.strictEqual(isClosedDealInLastTwoCompletedQuarters(closedWon("2025-08-15"), now), true);

  // Two quarters ago (Q2 2025) → eligible
  assert.strictEqual(isClosedDealInLastTwoCompletedQuarters(closedLost("2025-04-10"), now), true);

  // Three+ quarters ago (Q1 2025) → NOT eligible
  assert.strictEqual(isClosedDealInLastTwoCompletedQuarters(closedWon("2025-02-10"), now), false);

  // Current quarter-in-progress (Q4 2025) → NOT eligible
  assert.strictEqual(isClosedDealInLastTwoCompletedQuarters(closedWon("2025-10-05"), now), false);

  // Open deal with a close_date in-window should still be treated as ineligible by this helper
  assert.strictEqual(
    isClosedDealInLastTwoCompletedQuarters(
      { forecast_stage: "Best Case", sales_stage: null, close_date: "2025-08-15" },
      now
    ),
    false
  );
});
