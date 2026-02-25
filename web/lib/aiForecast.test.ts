import test from "node:test";
import assert from "node:assert/strict";
import { computeAiForecastFromHealthScore } from "./aiForecast";

test("computeAiForecastFromHealthScore returns Closed Won for won stage", () => {
  assert.strictEqual(
    computeAiForecastFromHealthScore({ healthScore: 25, forecastStage: "Closed Won" }),
    "Closed Won"
  );
  assert.strictEqual(
    computeAiForecastFromHealthScore({ healthScore: 25, salesStage: "Won" }),
    "Closed Won"
  );
  assert.strictEqual(
    computeAiForecastFromHealthScore({ healthScore: 25, salesStageForClosed: "Closed Won" }),
    "Closed Won"
  );
});

test("computeAiForecastFromHealthScore returns Closed Lost for lost/closed stage", () => {
  assert.strictEqual(
    computeAiForecastFromHealthScore({ healthScore: 25, forecastStage: "Closed Lost" }),
    "Closed Lost"
  );
  assert.strictEqual(
    computeAiForecastFromHealthScore({ healthScore: 25, salesStage: "Lost" }),
    "Closed Lost"
  );
  assert.strictEqual(
    computeAiForecastFromHealthScore({ healthScore: 25, salesStageForClosed: "Closed" }),
    "Closed Lost"
  );
});

test("computeAiForecastFromHealthScore Commit at 24+", () => {
  assert.strictEqual(
    computeAiForecastFromHealthScore({ healthScore: 24, forecastStage: "Commit" }),
    "Commit"
  );
  assert.strictEqual(
    computeAiForecastFromHealthScore({ healthScore: 30, forecastStage: "Best Case" }),
    "Commit"
  );
});

test("computeAiForecastFromHealthScore Best Case at 18-23", () => {
  assert.strictEqual(
    computeAiForecastFromHealthScore({ healthScore: 18, forecastStage: "Best Case" }),
    "Best Case"
  );
  assert.strictEqual(
    computeAiForecastFromHealthScore({ healthScore: 23, forecastStage: "Pipeline" }),
    "Best Case"
  );
});

test("computeAiForecastFromHealthScore Pipeline below 18", () => {
  assert.strictEqual(
    computeAiForecastFromHealthScore({ healthScore: 17, forecastStage: "Pipeline" }),
    "Pipeline"
  );
  assert.strictEqual(
    computeAiForecastFromHealthScore({ healthScore: 0, forecastStage: "Prospecting" }),
    "Pipeline"
  );
});

test("computeAiForecastFromHealthScore null for invalid healthScore", () => {
  assert.strictEqual(
    computeAiForecastFromHealthScore({ healthScore: null, forecastStage: "Commit" }),
    null
  );
  assert.strictEqual(
    computeAiForecastFromHealthScore({ healthScore: NaN, forecastStage: "Commit" }),
    null
  );
});
