/**
 * Server-side aggregation of Commit Admission metrics for CRO/management dashboards.
 * Uses same logic as commitAdmission.ts; scoped to quota period + rep visibility.
 */

import "server-only";
import { pool } from "./pool";
import {
  computeCrmBucket,
  computeCommitAdmission,
  isCommitAdmissionApplicable,
} from "./commitAdmission";

function computeAiFromHealthScore(healthScore: any): "Commit" | "Best Case" | "Pipeline" | null {
  const n = Number(healthScore);
  if (!Number.isFinite(n)) return null;
  if (n >= 24) return "Commit";
  if (n >= 18) return "Best Case";
  return "Pipeline";
}

function n0(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export type CommitAdmissionAggregates = {
  unsupportedCommitAmount: number;
  unsupportedCommitCount: number;
  commitNeedsReviewAmount: number;
  commitNeedsReviewCount: number;
  totalCommitCrmAmount: number;
  aiSupportedCommitAmount: number;
  /** % of Commit deals with ≥2 of 4 gate categories (paper, process, timing, budget) at high confidence */
  commitEvidenceCoveragePct: number;
  /** Sum of amount for admitted Commit deals */
  verifiedCommitAmount: number;
  /** Count of admitted Commit deals */
  verifiedCommitCount: number;
};

export async function getCommitAdmissionAggregates(args: {
  orgId: number;
  quotaPeriodId: string;
  repIds: number[] | null;
}): Promise<CommitAdmissionAggregates> {
  const qpId = String(args.quotaPeriodId || "").trim();
  if (!qpId) {
    return {
      unsupportedCommitAmount: 0,
      unsupportedCommitCount: 0,
      commitNeedsReviewAmount: 0,
      commitNeedsReviewCount: 0,
      totalCommitCrmAmount: 0,
      aiSupportedCommitAmount: 0,
      commitEvidenceCoveragePct: 0,
      verifiedCommitAmount: 0,
      verifiedCommitCount: 0,
    };
  }

  const repFilter = args.repIds;
  const useScoped = Array.isArray(repFilter) && repFilter.length > 0;

  const { rows } = await pool
    .query(
      `
      WITH qp AS (
        SELECT period_start::date AS period_start, period_end::date AS period_end
          FROM quota_periods
         WHERE org_id = $1::bigint
           AND id = $2::bigint
         LIMIT 1
      ),
      base AS (
        SELECT
          COALESCE(o.amount, 0)::float8 AS amount,
          o.forecast_stage,
          o.sales_stage,
          o.health_score,
          o.paper_score, o.process_score, o.timing_score, o.budget_score,
          o.paper_confidence, o.process_confidence, o.timing_confidence, o.budget_confidence,
          lower(
            regexp_replace(
              COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''),
              '[^a-zA-Z]+',
              ' ',
              'g'
            )
          ) AS fs
        FROM opportunities o
        JOIN qp ON TRUE
        WHERE o.org_id = $1::bigint
          AND o.rep_id IS NOT NULL
          AND o.close_date IS NOT NULL
          AND o.close_date >= qp.period_start
          AND o.close_date <= qp.period_end
          AND (o.predictive_eligible IS NOT FALSE)
          AND NOT ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
          AND NOT ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
          AND NOT ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% closed %')
          AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
      )
      SELECT
        amount,
        forecast_stage,
        sales_stage,
        health_score,
        paper_score, process_score, timing_score, budget_score,
        paper_confidence, process_confidence, timing_confidence, budget_confidence
      FROM base
      `,
      [args.orgId, qpId, repFilter || [], useScoped]
    )
    .catch(() => ({ rows: [] }));

  const deals = rows || [];
  let unsupportedAmount = 0;
  let unsupportedCount = 0;
  let needsReviewAmount = 0;
  let needsReviewCount = 0;
  let totalCommitCrm = 0;
  let aiSupportedAmount = 0;
  let verifiedAmount = 0;
  let verifiedCount = 0;
  let evidenceCoveredCount = 0;
  let commitScopeCount = 0;

  const GATE_CONF_KEYS = ["paper_confidence", "process_confidence", "timing_confidence", "budget_confidence"] as const;

  for (const row of deals) {
    const crmBucket = computeCrmBucket(row);
    const aiForecast = computeAiFromHealthScore(row.health_score);
    const isCommitScope = crmBucket === "commit" || aiForecast === "Commit";

    if (!isCommitScope) continue;

    commitScopeCount += 1;
    if (crmBucket === "commit") totalCommitCrm += n0(row.amount);

    const applicable = isCommitAdmissionApplicable(row, aiForecast);
    const admission = computeCommitAdmission(row, applicable);

    if (admission.status === "not_admitted") {
      unsupportedAmount += n0(row.amount);
      unsupportedCount += 1;
    } else if (admission.status === "needs_review") {
      needsReviewAmount += n0(row.amount);
      needsReviewCount += 1;
    } else if (admission.status === "admitted") {
      aiSupportedAmount += n0(row.amount);
      verifiedAmount += n0(row.amount);
      verifiedCount += 1;
    }

    const highConfCount = GATE_CONF_KEYS.filter((k) => String((row as any)[k] ?? "").trim().toLowerCase() === "high").length;
    if (highConfCount >= 2) evidenceCoveredCount += 1;
  }

  const commitEvidenceCoveragePct = commitScopeCount > 0 ? (evidenceCoveredCount / commitScopeCount) * 100 : 0;

  return {
    unsupportedCommitAmount: unsupportedAmount,
    unsupportedCommitCount: unsupportedCount,
    commitNeedsReviewAmount: needsReviewAmount,
    commitNeedsReviewCount: needsReviewCount,
    totalCommitCrmAmount: totalCommitCrm,
    aiSupportedCommitAmount: aiSupportedAmount,
    commitEvidenceCoveragePct,
    verifiedCommitAmount: verifiedAmount,
    verifiedCommitCount: verifiedCount,
  };
}

export type CommitDealPanelItem = {
  id: string;
  account: string | null;
  name: string | null;
  amount: number;
  crmBucket: string | null;
  ai_forecast: "Commit" | "Best Case" | "Pipeline" | null;
  ai_verdict: string | null;
  commit_admission_status: "admitted" | "not_admitted" | "needs_review";
  commit_admission_reasons: string[];
  verdict_note: string | null;
  high_conf_categories?: string[];
  low_conf_categories?: string[];
};

export type CommitAdmissionDealPanels = {
  topPainDeals: CommitDealPanelItem[];
  topVerifiedDeals: CommitDealPanelItem[];
};

export async function getCommitAdmissionDealPanels(args: {
  orgId: number;
  quotaPeriodId: string;
  repIds: number[] | null;
}): Promise<CommitAdmissionDealPanels> {
  const qpId = String(args.quotaPeriodId || "").trim();
  if (!qpId) {
    return { topPainDeals: [], topVerifiedDeals: [] };
  }

  const repFilter = args.repIds;
  const useScoped = Array.isArray(repFilter) && repFilter.length > 0;

  const { rows } = await pool
    .query(
      `
      WITH qp AS (
        SELECT period_start::date AS period_start, period_end::date AS period_end
          FROM quota_periods
         WHERE org_id = $1::bigint
           AND id = $2::bigint
         LIMIT 1
      ),
      base AS (
        SELECT
          o.public_id::text AS id,
          o.account_name,
          o.opportunity_name,
          COALESCE(o.amount, 0)::float8 AS amount,
          o.forecast_stage,
          o.sales_stage,
          o.health_score,
          o.paper_score, o.process_score, o.timing_score, o.budget_score,
          o.paper_confidence, o.process_confidence, o.timing_confidence, o.budget_confidence,
          lower(
            regexp_replace(
              COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''),
              '[^a-zA-Z]+',
              ' ',
              'g'
            )
          ) AS fs
        FROM opportunities o
        JOIN qp ON TRUE
        WHERE o.org_id = $1::bigint
          AND o.rep_id IS NOT NULL
          AND o.close_date IS NOT NULL
          AND o.close_date >= qp.period_start
          AND o.close_date <= qp.period_end
          AND (o.predictive_eligible IS NOT FALSE)
          AND NOT ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
          AND NOT ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
          AND NOT ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% closed %')
          AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
      )
      SELECT
        id,
        account_name,
        opportunity_name,
        amount,
        forecast_stage,
        sales_stage,
        health_score,
        paper_score, process_score, timing_score, budget_score,
        paper_confidence, process_confidence, timing_confidence, budget_confidence
      FROM base
      `,
      [args.orgId, qpId, repFilter || [], useScoped]
    )
    .catch(() => ({ rows: [] }));

  const deals = rows || [];
  const GATE_CONF_KEYS = ["paper_confidence", "process_confidence", "timing_confidence", "budget_confidence"] as const;
  const GATE_DISPLAY: Record<string, string> = {
    paper_confidence: "Paper",
    process_confidence: "Decision",
    timing_confidence: "Timing",
    budget_confidence: "Budget",
  };

  const painItems: CommitDealPanelItem[] = [];
  const verifiedItems: CommitDealPanelItem[] = [];

  for (const row of deals) {
    const crmBucket = computeCrmBucket(row);
    const aiForecast = computeAiFromHealthScore(row.health_score);
    const isCommitScope = crmBucket === "commit" || aiForecast === "Commit";

    if (!isCommitScope) continue;

    const applicable = isCommitAdmissionApplicable(row, aiForecast);
    const admission = computeCommitAdmission(row, applicable);

    const highConfCount = GATE_CONF_KEYS.filter((k) => String((row as any)[k] ?? "").trim().toLowerCase() === "high").length;
    const highConfCategories = GATE_CONF_KEYS.filter((k) => String((row as any)[k] ?? "").trim().toLowerCase() === "high").map(
      (k) => GATE_DISPLAY[k] || k
    );
    const lowConfCategories = GATE_CONF_KEYS.filter((k) => {
      const v = String((row as any)[k] ?? "").trim().toLowerCase();
      return v && v !== "high";
    }).map((k) => GATE_DISPLAY[k] || k);

    const verdictNote =
      admission.status === "not_admitted"
        ? admission.reasons[0] || "Commit not supported"
        : admission.status === "needs_review"
          ? "Low-confidence evidence"
          : null;

    const item: CommitDealPanelItem = {
      id: String((row as any).id || "").trim() || "",
      account: String((row as any).account_name || "").trim() || null,
      name: String((row as any).opportunity_name || "").trim() || null,
      amount: n0(row.amount),
      crmBucket,
      ai_forecast: aiForecast,
      ai_verdict: verdictNote,
      commit_admission_status: admission.status,
      commit_admission_reasons: admission.reasons,
      verdict_note: verdictNote,
    };

    if (admission.status === "not_admitted" || admission.status === "needs_review") {
      item.low_conf_categories = lowConfCategories;
      painItems.push(item);
    } else if (admission.status === "admitted" && highConfCount >= 2) {
      item.high_conf_categories = highConfCategories;
      verifiedItems.push(item);
    }
  }

  painItems.sort((a, b) => b.amount - a.amount);
  verifiedItems.sort((a, b) => b.amount - a.amount);

  return {
    topPainDeals: painItems.slice(0, 5),
    topVerifiedDeals: verifiedItems.slice(0, 5),
  };
}
