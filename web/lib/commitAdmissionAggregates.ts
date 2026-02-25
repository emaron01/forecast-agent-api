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

  for (const row of deals) {
    const crmBucket = computeCrmBucket(row);
    const aiForecast = computeAiFromHealthScore(row.health_score);
    const isCommitScope = crmBucket === "commit" || aiForecast === "Commit";

    if (!isCommitScope) continue;

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
    }
  }

  return {
    unsupportedCommitAmount: unsupportedAmount,
    unsupportedCommitCount: unsupportedCount,
    commitNeedsReviewAmount: needsReviewAmount,
    commitNeedsReviewCount: needsReviewCount,
    totalCommitCrmAmount: totalCommitCrm,
    aiSupportedCommitAmount: aiSupportedAmount,
  };
}
