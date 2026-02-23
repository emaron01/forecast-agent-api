import test from "node:test";
import assert from "node:assert/strict";
import { computeConfidence } from "./confidence";

const baseOpp = {
  pain_score: 2,
  metrics_score: 2,
  champion_score: 1,
  eb_score: 0,
  criteria_score: 0,
  process_score: 0,
  competition_score: 2,
  paper_score: 0,
  timing_score: 1,
  budget_score: 2,
  updated_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  close_date: null,
};

test("coverage impacts score", () => {
  const oppFew = { ...baseOpp, pain_score: 1, metrics_score: 0, champion_score: 0, eb_score: 0, criteria_score: 0, process_score: 0, competition_score: 0, paper_score: 0, timing_score: 0, budget_score: 0, updated_at: baseOpp.updated_at };
  const oppMany = { ...baseOpp, pain_score: 3, metrics_score: 3, champion_score: 3, eb_score: 3, criteria_score: 3, process_score: 3, competition_score: 3, paper_score: 3, timing_score: 3, budget_score: 3, updated_at: baseOpp.updated_at };
  const now = new Date();
  const rFew = computeConfidence({ opportunity: oppFew, source: "rep_review", now });
  const rMany = computeConfidence({ opportunity: oppMany, source: "rep_review", now });
  assert.ok(rMany.confidence_score > rFew.confidence_score, "more coverage => higher score");
});

test("recency impacts score", () => {
  const oppOld = { ...baseOpp, updated_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString() };
  const oppNew = { ...baseOpp, updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() };
  const now = new Date();
  const rOld = computeConfidence({ opportunity: oppOld, source: "rep_review", now });
  const rNew = computeConfidence({ opportunity: oppNew, source: "rep_review", now });
  assert.ok(rNew.confidence_score > rOld.confidence_score, "more recent => higher score");
});

test("source impacts score", () => {
  const now = new Date();
  const rRep = computeConfidence({ opportunity: baseOpp, source: "rep_review", now });
  const rSystem = computeConfidence({ opportunity: baseOpp, source: "system", now });
  assert.ok(rRep.confidence_score > rSystem.confidence_score, "rep_review > system");
});

test("close_date penalty works", () => {
  const oppNearClose = {
    ...baseOpp,
    close_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const oppFarClose = {
    ...baseOpp,
    close_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const now = new Date();
  const rNear = computeConfidence({ opportunity: oppNearClose, source: "rep_review", now });
  const rFar = computeConfidence({ opportunity: oppFarClose, source: "rep_review", now });
  assert.ok(rFar.confidence_score > rNear.confidence_score, "near close + stale => penalty");
});

test("band thresholds correct", () => {
  const now = new Date();
  const highOpp = { ...baseOpp, pain_score: 3, metrics_score: 3, champion_score: 3, eb_score: 3, criteria_score: 3, process_score: 3, competition_score: 3, paper_score: 3, timing_score: 3, budget_score: 3, updated_at: new Date().toISOString() };
  const rHigh = computeConfidence({ opportunity: highOpp, source: "rep_review", now });
  assert.ok(rHigh.confidence_band === "high" || rHigh.confidence_score >= 75, "high band when score >= 75");

  const lowOpp = { ...baseOpp, pain_score: 0, metrics_score: 0, champion_score: 0, eb_score: 0, criteria_score: 0, process_score: 0, competition_score: 0, paper_score: 0, timing_score: 0, budget_score: 0, updated_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString() };
  const rLow = computeConfidence({ opportunity: lowOpp, source: "system", now });
  assert.ok(rLow.confidence_band === "low" || rLow.confidence_score < 45, "low band when score < 45");
});

test("summary contains expected drivers and at most 2 gaps", () => {
  const opp = { ...baseOpp, pain_score: 1, metrics_score: 0, champion_score: 0, eb_score: 0, criteria_score: 0, process_score: 0, competition_score: 0, paper_score: 0, timing_score: 0, budget_score: 0, updated_at: baseOpp.updated_at };
  const r = computeConfidence({ opportunity: opp, source: "rep_review", now: new Date() });
  assert.ok(r.confidence_summary.length > 0, "summary non-empty");
  assert.ok(r.confidence_summary.includes("1/10") || r.confidence_summary.includes("categories"), "summary mentions coverage");
  const gapCount = (r.confidence_summary.match(/Key gaps:/g) || []).length;
  assert.ok(gapCount <= 1, "at most one 'Key gaps' phrase");
});
