/**
 * Training Readiness / Feature Coverage Reporting.
 * Read-only analytics layer. Does NOT change scoring math or dashboard totals.
 */

import "server-only";
import { pool } from "./pool";
import {
  computeCrmBucket,
  computeCommitAdmission,
  isCommitAdmissionApplicable,
} from "./commitAdmission";
import { computeAiForecastFromHealthScore } from "./aiForecast";
import { closedOutcomeFromOpportunityRow } from "./opportunityOutcome";

const CATEGORIES = [
  "pain",
  "metrics",
  "champion",
  "eb",
  "criteria",
  "process",
  "competition",
  "paper",
  "timing",
  "budget",
] as const;

const GATE_CATEGORIES = ["paper", "process", "timing", "budget"] as const;
const GATE_CONF_KEYS = [
  "paper_confidence",
  "process_confidence",
  "timing_confidence",
  "budget_confidence",
] as const;


export type CategoryCoverage = {
  category: string;
  score_present_pct: number;
  score_present_count: number;
  score_total: number;
  confidence_present_pct: number;
  confidence_present_count: number;
  confidence_total: number;
  evidence_strength_present_pct: number;
  evidence_strength_present_count: number;
  evidence_strength_total: number;
};

export type GateSetDetails = {
  all_four_scores_pct: number;
  all_four_scores_count: number;
  gate_scope_total: number;
  high_confidence_two_plus_pct: number;
  high_confidence_two_plus_count: number;
  commit_admission_admitted_pct: number;
  commit_admission_admitted_count: number;
  commit_admission_needs_review_pct: number;
  commit_admission_needs_review_count: number;
  commit_admission_not_admitted_pct: number;
  commit_admission_not_admitted_count: number;
  commit_scope_total: number;
};

export type TrainingSnapshotDetails = {
  labeled_closed_total: number;
  with_usable_snapshot_count: number;
  with_usable_snapshot_pct: number;
  anti_leakage_ok_count: number;
  anti_leakage_ok_pct: number;
  leakage_violations_count: number;
};

export type MissingFeatureBreakdown = Record<string, { missing_count: number; total: number; pct: number }>;

export type TrainingReadinessResult = {
  coverage_by_category: Record<string, CategoryCoverage>;
  gate_set_details: GateSetDetails;
  training_snapshot_details: TrainingSnapshotDetails;
  leakage_diagnostics: {
    leakage_violations_count: number;
    sample_violations?: Array<{ opportunity_id: number; selected_event_time: string; close_date: string }>;
  };
  missing_feature_breakdown: MissingFeatureBreakdown;
  readiness_summary: {
    gate_set_completeness_pct: number;
    verified_evidence_rate_pct: number;
    training_snapshot_ready_pct: number;
    top_coverage_gaps: Array<{ category: string; gap_pct: number }>;
  };
};

export type TrainingReadinessArgs = {
  orgId: number;
  quotaPeriodId?: string;
  repIds?: number[];
  snapshot_offset_days?: number;
};

/**
 * Compute training readiness metrics.
 * OPEN pipeline: opportunities.predictive_eligible IS TRUE (not closed).
 * Training labels: closed won/lost opportunities.
 */
export async function computeTrainingReadiness(
  args: TrainingReadinessArgs
): Promise<TrainingReadinessResult> {
  const qpId = String(args.quotaPeriodId || "").trim();
  const repFilter = args.repIds ?? [];
  const useRepFilter = Array.isArray(repFilter) && repFilter.length > 0;
  const snapshotOffsetDays = args.snapshot_offset_days;
  let snapshotTime: Date | null = null;
  if (snapshotOffsetDays != null && Number.isFinite(snapshotOffsetDays)) {
    const d = new Date();
    d.setDate(d.getDate() - snapshotOffsetDays);
    snapshotTime = d;
  }

  const params = qpId
    ? [args.orgId, qpId, repFilter, useRepFilter]
    : [args.orgId, repFilter, useRepFilter];

  // OPEN pipeline: predictive_eligible IS TRUE, not closed
  const openSql = qpId
    ? `
      WITH qp AS (
        SELECT period_start::date AS period_start, period_end::date AS period_end
          FROM quota_periods
         WHERE org_id = $1::bigint AND id = $2::bigint
         LIMIT 1
      )
      SELECT o.id, o.rep_id,
        o.pain_score, o.metrics_score, o.champion_score, o.eb_score, o.criteria_score,
        o.process_score, o.competition_score, o.paper_score, o.timing_score, o.budget_score,
        o.pain_confidence, o.metrics_confidence, o.champion_confidence, o.eb_confidence,
        o.criteria_confidence, o.process_confidence, o.competition_confidence,
        o.paper_confidence, o.timing_confidence, o.budget_confidence,
        o.pain_evidence_strength, o.metrics_evidence_strength, o.champion_evidence_strength,
        o.eb_evidence_strength, o.criteria_evidence_strength, o.process_evidence_strength,
        o.competition_evidence_strength, o.paper_evidence_strength, o.timing_evidence_strength,
        o.budget_evidence_strength,
        o.forecast_stage, o.sales_stage, o.health_score
      FROM opportunities o
      JOIN qp ON TRUE
      WHERE o.org_id = $1::bigint
        AND (o.predictive_eligible IS TRUE)
        AND NOT (COALESCE(o.forecast_stage ~* '\\y(won|lost|closed)\\y', false))
        AND NOT (COALESCE(o.sales_stage ~* '\\y(won|lost|closed)\\y', false))
        AND o.close_date IS NOT NULL AND o.close_date >= qp.period_start AND o.close_date <= qp.period_end
        AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
    `
    : `
      SELECT o.id, o.rep_id,
        o.pain_score, o.metrics_score, o.champion_score, o.eb_score, o.criteria_score,
        o.process_score, o.competition_score, o.paper_score, o.timing_score, o.budget_score,
        o.pain_confidence, o.metrics_confidence, o.champion_confidence, o.eb_confidence,
        o.criteria_confidence, o.process_confidence, o.competition_confidence,
        o.paper_confidence, o.timing_confidence, o.budget_confidence,
        o.pain_evidence_strength, o.metrics_evidence_strength, o.champion_evidence_strength,
        o.eb_evidence_strength, o.criteria_evidence_strength, o.process_evidence_strength,
        o.competition_evidence_strength, o.paper_evidence_strength, o.timing_evidence_strength,
        o.budget_evidence_strength,
        o.forecast_stage, o.sales_stage, o.health_score
      FROM opportunities o
      WHERE o.org_id = $1::bigint
        AND (o.predictive_eligible IS TRUE)
        AND NOT (COALESCE(o.forecast_stage ~* '\\y(won|lost|closed)\\y', false))
        AND NOT (COALESCE(o.sales_stage ~* '\\y(won|lost|closed)\\y', false))
        AND (NOT $3::boolean OR o.rep_id = ANY($2::bigint[]))
    `;

  const { rows: openRows } = await pool
    .query(openSql, params as unknown[])
    .catch(() => ({ rows: [] }));

  const openDeals = openRows || [];
  const openTotal = openDeals.length;

  // Category coverage from OPEN pipeline
  const coverageByCategory: Record<string, CategoryCoverage> = {};
  for (const cat of CATEGORIES) {
    const prefix = cat === "eb" ? "eb" : cat;
    const scoreKey = `${prefix}_score`;
    const confKey = `${prefix}_confidence`;
    const esKey = `${prefix}_evidence_strength`;

    let scorePresent = 0;
    let confPresent = 0;
    let esPresent = 0;
    for (const row of openDeals) {
      const r = row as Record<string, unknown>;
      if (r[scoreKey] != null && (typeof r[scoreKey] === "number" || (typeof r[scoreKey] === "string" && String(r[scoreKey]).trim() !== "")))
        scorePresent++;
      if (r[confKey] != null && String(r[confKey] ?? "").trim() !== "") confPresent++;
      if (r[esKey] != null && String(r[esKey] ?? "").trim() !== "") esPresent++;
    }

    coverageByCategory[cat] = {
      category: cat,
      score_present_pct: openTotal > 0 ? (scorePresent / openTotal) * 100 : 0,
      score_present_count: scorePresent,
      score_total: openTotal,
      confidence_present_pct: openTotal > 0 ? (confPresent / openTotal) * 100 : 0,
      confidence_present_count: confPresent,
      confidence_total: openTotal,
      evidence_strength_present_pct: openTotal > 0 ? (esPresent / openTotal) * 100 : 0,
      evidence_strength_present_count: esPresent,
      evidence_strength_total: openTotal,
    };
  }

  // Gate-set completeness (paper, process, timing, budget) - Commit scope only
  let gateScopeTotal = 0;
  let allFourCount = 0;
  let highConfTwoPlusCount = 0;
  let commitScopeTotal = 0;
  let admittedCount = 0;
  let needsReviewCount = 0;
  let notAdmittedCount = 0;

  for (const row of openDeals) {
    const r = row as Record<string, unknown>;
    const hasAllFour = GATE_CATEGORIES.every((c) => {
      const k = `${c}_score`;
      return r[k] != null && (typeof r[k] === "number" || String(r[k] ?? "").trim() !== "");
    });
    gateScopeTotal++;
    if (hasAllFour) allFourCount++;

    const highConfCount = GATE_CONF_KEYS.filter(
      (k) => String((r[k] ?? "") as string).trim().toLowerCase() === "high"
    ).length;
    if (highConfCount >= 2) highConfTwoPlusCount++;

    const crmBucket = computeCrmBucket(row);
    const aiForecast = computeAiForecastFromHealthScore({
      healthScore: r.health_score as number | null | undefined,
      forecastStage: r.forecast_stage as string,
      salesStage: r.sales_stage as string,
    });
    const isCommitScope = crmBucket === "commit" || aiForecast === "Commit";
    if (!isCommitScope) continue;

    commitScopeTotal++;
    const applicable = isCommitAdmissionApplicable(row, aiForecast);
    const admission = computeCommitAdmission(row, applicable);
    if (admission.status === "admitted") admittedCount++;
    else if (admission.status === "needs_review") needsReviewCount++;
    else notAdmittedCount++;
  }

  const gateSetDetails: GateSetDetails = {
    all_four_scores_pct: gateScopeTotal > 0 ? (allFourCount / gateScopeTotal) * 100 : 0,
    all_four_scores_count: allFourCount,
    gate_scope_total: gateScopeTotal,
    high_confidence_two_plus_pct: gateScopeTotal > 0 ? (highConfTwoPlusCount / gateScopeTotal) * 100 : 0,
    high_confidence_two_plus_count: highConfTwoPlusCount,
    commit_admission_admitted_pct: commitScopeTotal > 0 ? (admittedCount / commitScopeTotal) * 100 : 0,
    commit_admission_admitted_count: admittedCount,
    commit_admission_needs_review_pct: commitScopeTotal > 0 ? (needsReviewCount / commitScopeTotal) * 100 : 0,
    commit_admission_needs_review_count: needsReviewCount,
    commit_admission_not_admitted_pct: commitScopeTotal > 0 ? (notAdmittedCount / commitScopeTotal) * 100 : 0,
    commit_admission_not_admitted_count: notAdmittedCount,
    commit_scope_total: commitScopeTotal,
  };

  // Training snapshot readiness (closed deals, opportunity_audit_events)
  const { rows: colRows } = await pool.query(
    `
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'opportunity_audit_events'
       AND column_name IN ('created_at', 'ts', 'org_id', 'organization_id')
    `
  );
  const colSet = new Set((colRows || []).map((r: { column_name: string }) => r.column_name));
  const eventTimeCol = colSet.has("created_at") ? "created_at" : colSet.has("ts") ? "ts" : null;
  const orgCol = colSet.has("org_id") ? "org_id" : colSet.has("organization_id") ? "organization_id" : null;
  if (!eventTimeCol || !orgCol) {
    return {
      coverage_by_category: Object.fromEntries(CATEGORIES.map((c) => [c, { category: c, score_present_pct: 0, score_present_count: 0, score_total: 0, confidence_present_pct: 0, confidence_present_count: 0, confidence_total: 0, evidence_strength_present_pct: 0, evidence_strength_present_count: 0, evidence_strength_total: 0 }])),
      gate_set_details: { all_four_scores_pct: 0, all_four_scores_count: 0, gate_scope_total: 0, high_confidence_two_plus_pct: 0, high_confidence_two_plus_count: 0, commit_admission_admitted_pct: 0, commit_admission_admitted_count: 0, commit_admission_needs_review_pct: 0, commit_admission_needs_review_count: 0, commit_admission_not_admitted_pct: 0, commit_admission_not_admitted_count: 0, commit_scope_total: 0 },
      training_snapshot_details: { labeled_closed_total: 0, with_usable_snapshot_count: 0, with_usable_snapshot_pct: 0, anti_leakage_ok_count: 0, anti_leakage_ok_pct: 0, leakage_violations_count: 0 },
      leakage_diagnostics: { leakage_violations_count: 0 },
      missing_feature_breakdown: {},
      readiness_summary: { gate_set_completeness_pct: 0, verified_evidence_rate_pct: 0, training_snapshot_ready_pct: 0, top_coverage_gaps: [] },
    };
  }

  const snapshotIso = snapshotTime?.toISOString() ?? new Date().toISOString();

  const closedSql = qpId
    ? `
      SELECT o.id, o.org_id, o.forecast_stage, o.sales_stage, o.close_date::text
        FROM opportunities o
        JOIN quota_periods qp ON qp.org_id = o.org_id AND qp.id = $2::bigint
       WHERE o.org_id = $1::bigint
         AND (COALESCE(o.forecast_stage ~* '\\y(won|lost|closed)\\y', false)
              OR COALESCE(o.sales_stage ~* '\\y(won|lost|closed)\\y', false))
         AND o.close_date IS NOT NULL AND o.close_date >= qp.period_start AND o.close_date <= qp.period_end
         AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
       LIMIT 2000
      `
    : `
      SELECT o.id, o.org_id, o.forecast_stage, o.sales_stage, o.close_date::text
        FROM opportunities o
       WHERE o.org_id = $1::bigint
         AND (COALESCE(o.forecast_stage ~* '\\y(won|lost|closed)\\y', false)
              OR COALESCE(o.sales_stage ~* '\\y(won|lost|closed)\\y', false))
         AND (NOT $3::boolean OR o.rep_id = ANY($2::bigint[]))
       LIMIT 2000
      `;

  const closedParams = qpId
    ? [args.orgId, qpId, repFilter, useRepFilter]
    : [args.orgId, repFilter, useRepFilter];

  const { rows: closedOpps } = await pool
    .query(closedSql, closedParams as unknown[])
    .catch(() => ({ rows: [] }));

  const closedList = closedOpps || [];
  const outcomeLabel = (row: { forecast_stage?: string; sales_stage?: string }): "Closed Won" | "Closed Lost" | null => {
    const closed = closedOutcomeFromOpportunityRow(row);
    if (closed === "Won") return "Closed Won";
    if (closed === "Lost") return "Closed Lost";
    return null;
  };

  let withUsableSnapshot = 0;
  let antiLeakageOk = 0;
  let leakageViolations = 0;
  const missingByCategory: Record<string, { missing: number; total: number }> = {};
  for (const cat of CATEGORIES) {
    missingByCategory[cat] = { missing: 0, total: 0 };
  }
  const sampleViolations: Array<{ opportunity_id: number; selected_event_time: string; close_date: string }> = [];

  for (const opp of closedList) {
    const label = outcomeLabel(opp);
    if (!label) continue;

    const closeDate = opp.close_date ? new Date(opp.close_date) : null;
    if (!closeDate || !Number.isFinite(closeDate.getTime())) continue;

    const { rows: events } = await pool.query(
      `
      SELECT id, opportunity_id, delta, meta, total_score, forecast_stage,
             ${eventTimeCol}::timestamptz AS event_time
        FROM opportunity_audit_events
       WHERE ${orgCol} = $1
         AND opportunity_id = $2
         AND ${eventTimeCol} <= $3::timestamptz
       ORDER BY ${eventTimeCol} DESC, id DESC
       LIMIT 1
      `,
      [args.orgId, opp.id, snapshotIso]
    );

    const event = events?.[0];
    if (!event) continue;

    const eventStage = event.forecast_stage ?? "";
    if (/\b(won|lost|closed)\b/i.test(eventStage)) continue;

    withUsableSnapshot++;
    const eventTime = event.event_time ? new Date(event.event_time) : null;
    const eventTimeMs = eventTime?.getTime() ?? 0;
    const closeMs = closeDate.getTime();
    if (eventTimeMs < closeMs) {
      antiLeakageOk++;
    } else {
      leakageViolations++;
      if (sampleViolations.length < 5) {
        sampleViolations.push({
          opportunity_id: opp.id,
          selected_event_time: eventTime ? eventTime.toISOString() : "",
          close_date: opp.close_date,
        });
      }
    }

    const delta = (event.delta as Record<string, unknown>) || {};
    const meta = (event.meta as Record<string, unknown>) || {};
    const metaScoring = (meta.scoring as Record<string, unknown>) || {};
    for (const cat of CATEGORIES) {
      const prefix = cat === "eb" ? "eb" : cat;
      const score = delta[`${prefix}_score`] ?? metaScoring[`${prefix}_score`];
      missingByCategory[cat].total++;
      if (score == null || (typeof score === "string" && String(score).trim() === "")) {
        missingByCategory[cat].missing++;
      }
    }
  }

  const labeledClosedTotal = closedList.filter((o) => outcomeLabel(o)).length;
  const trainingSnapshotDetails: TrainingSnapshotDetails = {
    labeled_closed_total: labeledClosedTotal,
    with_usable_snapshot_count: withUsableSnapshot,
    with_usable_snapshot_pct: labeledClosedTotal > 0 ? (withUsableSnapshot / labeledClosedTotal) * 100 : 0,
    anti_leakage_ok_count: antiLeakageOk,
    anti_leakage_ok_pct: withUsableSnapshot > 0 ? (antiLeakageOk / withUsableSnapshot) * 100 : 0,
    leakage_violations_count: leakageViolations,
  };

  const missingFeatureBreakdown: MissingFeatureBreakdown = {};
  for (const cat of CATEGORIES) {
    const m = missingByCategory[cat];
    missingFeatureBreakdown[cat] = {
      missing_count: m.missing,
      total: m.total,
      pct: m.total > 0 ? (m.missing / m.total) * 100 : 0,
    };
  }

  // Top coverage gaps (lowest score_present_pct)
  const topGaps = Object.values(coverageByCategory)
    .map((c) => ({ category: c.category, gap_pct: 100 - c.score_present_pct }))
    .filter((g) => g.gap_pct > 0)
    .sort((a, b) => b.gap_pct - a.gap_pct)
    .slice(0, 5);

  const readinessSummary = {
    gate_set_completeness_pct: gateSetDetails.all_four_scores_pct,
    verified_evidence_rate_pct: gateSetDetails.high_confidence_two_plus_pct,
    training_snapshot_ready_pct: trainingSnapshotDetails.with_usable_snapshot_pct,
    top_coverage_gaps: topGaps,
  };

  return {
    coverage_by_category: coverageByCategory,
    gate_set_details: gateSetDetails,
    training_snapshot_details: trainingSnapshotDetails,
    leakage_diagnostics: {
      leakage_violations_count: leakageViolations,
      sample_violations: sampleViolations.length > 0 ? sampleViolations : undefined,
    },
    missing_feature_breakdown: missingFeatureBreakdown,
    readiness_summary: readinessSummary,
  };
}
