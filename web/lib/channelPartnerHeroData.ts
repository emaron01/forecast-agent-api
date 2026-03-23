import "server-only";

import { pool } from "./pool";
import { getForecastStageProbabilities } from "./forecastStageProbabilities";
import { computeSalesVsVerdictForecastSummary } from "./forecastSummary";
import { getQuarterKpisSnapshot, type QuarterKpisSnapshot } from "./quarterKpisSnapshot";
import {
  getCommitAdmissionAggregates,
  getCommitAdmissionDealPanels,
  type CommitAdmissionAggregates,
  type CommitAdmissionDealPanels,
} from "./commitAdmissionAggregates";
import type { PipelineMomentumData } from "./pipelineMomentum";

type TotalsRow = {
  commit_amount: number;
  best_case_amount: number;
  pipeline_amount: number;
  commit_count: number;
  best_case_count: number;
  pipeline_count: number;
  commit_avg_health_score: number | null;
  best_case_avg_health_score: number | null;
  pipeline_avg_health_score: number | null;
  won_amount: number;
  total_active_count: number;
  total_active_avg_health_score: number | null;
};

type VerdictAggRow = {
  commit_crm: number;
  commit_verdict: number;
  best_case_crm: number;
  best_case_verdict: number;
  pipeline_crm: number;
  pipeline_verdict: number;
};

type StageSnap = {
  commit_amount: number;
  commit_count: number;
  commit_avg_health_score: number | null;
  best_case_amount: number;
  best_case_count: number;
  best_case_avg_health_score: number | null;
  pipeline_amount: number;
  pipeline_count: number;
  pipeline_avg_health_score: number | null;
  total_active_amount: number;
  total_active_count: number;
  total_active_avg_health_score: number | null;
  won_amount: number;
  won_count: number;
  lost_amount: number;
  lost_count: number;
};

const emptyStage: StageSnap = {
  commit_amount: 0,
  commit_count: 0,
  commit_avg_health_score: null,
  best_case_amount: 0,
  best_case_count: 0,
  best_case_avg_health_score: null,
  pipeline_amount: 0,
  pipeline_count: 0,
  pipeline_avg_health_score: null,
  total_active_amount: 0,
  total_active_count: 0,
  total_active_avg_health_score: null,
  won_amount: 0,
  won_count: 0,
  lost_amount: 0,
  lost_count: 0,
};

function healthPctFrom30(score: unknown): number | null {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((n / 30) * 100)));
}

function qoqPct(cur: number, prev: number) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

async function loadPartnerTotals(orgId: number, qpId: string, repIds: number[], useScoped: boolean): Promise<TotalsRow> {
  const { rows } = await pool
    .query<TotalsRow>(
      `
      WITH qp AS (
        SELECT period_start::date AS period_start, period_end::date AS period_end
          FROM quota_periods
         WHERE org_id = $1::bigint
           AND id = $2::bigint
         LIMIT 1
      ),
      deals AS (
        SELECT
          COALESCE(o.amount, 0)::float8 AS amount,
          o.id::bigint AS opp_id,
          lower(
            regexp_replace(
              COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''),
              '[^a-zA-Z]+',
              ' ',
              'g'
            )
          ) AS fs,
          o.health_score::float8 AS health_score,
          CASE
            WHEN o.close_date IS NULL THEN NULL
            WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
            WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
              to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
            ELSE NULL
          END AS close_d
        FROM opportunities o
        WHERE o.org_id = $1
          AND o.partner_name IS NOT NULL
          AND btrim(o.partner_name) <> ''
          AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
      ),
      deals_in_qtr AS (
        SELECT d.*
          FROM deals d
          JOIN qp ON TRUE
         WHERE d.close_d IS NOT NULL
           AND d.close_d >= qp.period_start
           AND d.close_d <= qp.period_end
      )
      ,
      open_deals AS (
        -- Active forecast stages only (exclude closed won/lost and generic closed rows),
        -- to match executive forecast dashboard totals semantics.
        SELECT d.*
          FROM deals_in_qtr d
         WHERE NOT ((' ' || d.fs || ' ') LIKE '% won %')
           AND NOT ((' ' || d.fs || ' ') LIKE '% lost %')
           AND NOT ((' ' || d.fs || ' ') LIKE '% closed %')
      )
      SELECT
        COALESCE(SUM(CASE WHEN fs LIKE '%commit%' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
        COALESCE(COUNT(DISTINCT CASE WHEN fs LIKE '%commit%' THEN opp_id ELSE NULL END), 0)::int AS commit_count,
        AVG(CASE WHEN fs LIKE '%commit%' THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS commit_avg_health_score,

        COALESCE(SUM(CASE WHEN fs LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS best_case_amount,
        COALESCE(COUNT(DISTINCT CASE WHEN fs LIKE '%best%' THEN opp_id ELSE NULL END), 0)::int AS best_case_count,
        AVG(CASE WHEN fs LIKE '%best%' THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS best_case_avg_health_score,

        COALESCE(SUM(CASE WHEN fs NOT LIKE '%commit%' AND fs NOT LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
        COALESCE(COUNT(DISTINCT CASE WHEN fs NOT LIKE '%commit%' AND fs NOT LIKE '%best%' THEN opp_id ELSE NULL END), 0)::int AS pipeline_count,
        AVG(CASE WHEN fs NOT LIKE '%commit%' AND fs NOT LIKE '%best%' THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS pipeline_avg_health_score,

        (
          SELECT COALESCE(
            SUM(CASE WHEN ((' ' || d2.fs || ' ') LIKE '% won %') THEN d2.amount ELSE 0 END),
            0
          )::float8
          FROM deals_in_qtr d2
        ) AS won_amount,

        COALESCE(COUNT(DISTINCT opp_id), 0)::int AS total_active_count,
        AVG(NULLIF(health_score, 0))::float8 AS total_active_avg_health_score
      FROM open_deals
      `,
      [orgId, qpId, repIds, useScoped]
    )
    .catch(() => ({ rows: [] }));
  return (
    (rows?.[0] as TotalsRow) || {
      commit_amount: 0,
      best_case_amount: 0,
      pipeline_amount: 0,
      commit_count: 0,
      best_case_count: 0,
      pipeline_count: 0,
      commit_avg_health_score: null,
      best_case_avg_health_score: null,
      pipeline_avg_health_score: null,
      won_amount: 0,
      total_active_count: 0,
      total_active_avg_health_score: null,
    }
  );
}

async function loadPartnerVerdictAgg(orgId: number, qpId: string, repIds: number[], useScoped: boolean): Promise<VerdictAggRow> {
  const empty: VerdictAggRow = {
    commit_crm: 0,
    commit_verdict: 0,
    best_case_crm: 0,
    best_case_verdict: 0,
    pipeline_crm: 0,
    pipeline_verdict: 0,
  };
  try {
    const row = await pool
      .query<VerdictAggRow>(
        `
        WITH qp AS (
          SELECT period_start::date AS period_start, period_end::date AS period_end
            FROM quota_periods
           WHERE org_id = $1::bigint
             AND id = $2::bigint
           LIMIT 1
        ),
        deals AS (
          SELECT
            COALESCE(o.amount, 0)::float8 AS amount,
            o.health_score,
            lower(
              regexp_replace(
                COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''),
                '[^a-zA-Z]+',
                ' ',
                'g'
              )
            ) AS fs,
            CASE
              WHEN o.close_date IS NULL THEN NULL
              WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
              WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
                to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
              ELSE NULL
            END AS close_d
          FROM opportunities o
          WHERE o.org_id = $1
            AND o.partner_name IS NOT NULL
            AND btrim(o.partner_name) <> ''
            AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
        ),
        deals_in_qtr AS (
          SELECT d.*
            FROM deals d
            JOIN qp ON TRUE
           WHERE d.close_d IS NOT NULL
             AND d.close_d >= qp.period_start
             AND d.close_d <= qp.period_end
        ),
        open_deals AS (
          SELECT *
            FROM deals_in_qtr d
           WHERE NOT ((' ' || d.fs || ' ') LIKE '% won %')
             AND NOT ((' ' || d.fs || ' ') LIKE '% lost %')
             AND NOT ((' ' || d.fs || ' ') LIKE '% closed %')
        ),
        classified AS (
          SELECT
            *,
            CASE
              WHEN fs LIKE '%commit%' THEN 'commit'
              WHEN fs LIKE '%best%' THEN 'best_case'
              ELSE 'pipeline'
            END AS crm_bucket
          FROM open_deals
        ),
        with_rules AS (
          SELECT
            c.*,
            COALESCE(hr.suppression, FALSE) AS suppression,
            COALESCE(hr.probability_modifier, 1.0)::float8 AS probability_modifier
          FROM classified c
          LEFT JOIN LATERAL (
            SELECT suppression, probability_modifier
              FROM health_score_rules
             WHERE org_id = $1::int
               AND c.crm_bucket IS NOT NULL
               AND mapped_category = CASE
                 WHEN c.crm_bucket = 'commit' THEN 'Commit'
                 WHEN c.crm_bucket = 'best_case' THEN 'Best Case'
                 WHEN c.crm_bucket = 'pipeline' THEN 'Pipeline'
                 ELSE mapped_category
               END
               AND c.health_score IS NOT NULL
               AND c.health_score >= min_score
               AND c.health_score <= max_score
             ORDER BY min_score DESC
             LIMIT 1
          ) hr ON TRUE
        ),
        with_modifier AS (
          SELECT
            *,
            CASE WHEN suppression THEN 0.0::float8 ELSE COALESCE(probability_modifier, 1.0)::float8 END AS health_modifier
          FROM with_rules
        )
        SELECT
          COALESCE(SUM(CASE WHEN crm_bucket = 'commit' THEN amount ELSE 0 END), 0)::float8 AS commit_crm,
          COALESCE(SUM(CASE WHEN crm_bucket = 'commit' THEN amount * health_modifier ELSE 0 END), 0)::float8 AS commit_verdict,
          COALESCE(SUM(CASE WHEN crm_bucket = 'best_case' THEN amount ELSE 0 END), 0)::float8 AS best_case_crm,
          COALESCE(SUM(CASE WHEN crm_bucket = 'best_case' THEN amount * health_modifier ELSE 0 END), 0)::float8 AS best_case_verdict,
          COALESCE(SUM(CASE WHEN crm_bucket = 'pipeline' THEN amount ELSE 0 END), 0)::float8 AS pipeline_crm,
          COALESCE(SUM(CASE WHEN crm_bucket = 'pipeline' THEN amount * health_modifier ELSE 0 END), 0)::float8 AS pipeline_verdict
        FROM with_modifier
        `,
        [orgId, qpId, repIds, useScoped]
      )
      .then((r) => r.rows?.[0] || empty);
    return row;
  } catch {
    return empty;
  }
}

async function loadPartnerPipelineStage(orgId: number, qpId: string, repIds: number[], useRepFilter: boolean): Promise<StageSnap> {
  const { rows } = await pool
    .query<StageSnap>(
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
          o.health_score::float8 AS health_score,
          o.predictive_eligible,
          lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs,
          CASE
            WHEN o.close_date IS NULL THEN NULL
            WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
            WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
              to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
            ELSE NULL
          END AS close_d
        FROM opportunities o
        JOIN qp ON TRUE
        WHERE o.org_id = $1
          AND o.partner_name IS NOT NULL
          AND btrim(o.partner_name) <> ''
          AND o.close_date IS NOT NULL
          AND (
            CASE
              WHEN o.close_date IS NULL THEN NULL
              WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
              WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
                to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
              ELSE NULL
            END
          ) IS NOT NULL
          AND (
            CASE
              WHEN o.close_date IS NULL THEN NULL
              WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
              WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
                to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
              ELSE NULL
            END
          ) >= qp.period_start
          AND (
            CASE
              WHEN o.close_date IS NULL THEN NULL
              WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
              WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
                to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
              ELSE NULL
            END
          ) <= qp.period_end
          AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
      ),
      classified AS (
        SELECT
          *,
          ((' ' || fs || ' ') LIKE '% won %') AS is_won,
          (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %')) AS is_lost,
          (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %'))) AS is_active,
          CASE
            WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %'))) AND fs LIKE '%commit%' THEN 'commit'
            WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %'))) AND fs LIKE '%best%' THEN 'best'
            WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %'))) THEN 'pipeline'
            ELSE 'other'
          END AS bucket
        FROM base
      )
      SELECT
        COALESCE(SUM(CASE WHEN is_active AND (predictive_eligible IS TRUE) AND bucket = 'commit' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
        COALESCE(SUM(CASE WHEN is_active AND (predictive_eligible IS TRUE) AND bucket = 'commit' THEN 1 ELSE 0 END), 0)::int AS commit_count,
        AVG(CASE WHEN is_active AND (predictive_eligible IS TRUE) AND bucket = 'commit' THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS commit_avg_health_score,
        COALESCE(SUM(CASE WHEN is_active AND (predictive_eligible IS TRUE) AND bucket = 'best' THEN amount ELSE 0 END), 0)::float8 AS best_case_amount,
        COALESCE(SUM(CASE WHEN is_active AND (predictive_eligible IS TRUE) AND bucket = 'best' THEN 1 ELSE 0 END), 0)::int AS best_case_count,
        AVG(CASE WHEN is_active AND (predictive_eligible IS TRUE) AND bucket = 'best' THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS best_case_avg_health_score,
        COALESCE(SUM(CASE WHEN is_active AND (predictive_eligible IS TRUE) AND bucket = 'pipeline' THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
        COALESCE(SUM(CASE WHEN is_active AND (predictive_eligible IS TRUE) AND bucket = 'pipeline' THEN 1 ELSE 0 END), 0)::int AS pipeline_count,
        AVG(CASE WHEN is_active AND (predictive_eligible IS TRUE) AND bucket = 'pipeline' THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS pipeline_avg_health_score,
        COALESCE(SUM(CASE WHEN is_active AND (predictive_eligible IS TRUE) THEN amount ELSE 0 END), 0)::float8 AS total_active_amount,
        COALESCE(SUM(CASE WHEN is_active AND (predictive_eligible IS TRUE) THEN 1 ELSE 0 END), 0)::int AS total_active_count,
        AVG(CASE WHEN is_active AND (predictive_eligible IS TRUE) THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS total_active_avg_health_score,
        COALESCE(SUM(CASE WHEN is_won THEN amount ELSE 0 END), 0)::float8 AS won_amount,
        COALESCE(SUM(CASE WHEN is_won THEN 1 ELSE 0 END), 0)::int AS won_count,
        COALESCE(SUM(CASE WHEN is_lost THEN amount ELSE 0 END), 0)::float8 AS lost_amount,
        COALESCE(SUM(CASE WHEN is_lost THEN 1 ELSE 0 END), 0)::int AS lost_count
      FROM classified
      `,
      [orgId, qpId, repIds, useRepFilter]
    )
    .catch(() => ({ rows: [] }));

  return (rows?.[0] as StageSnap) || emptyStage;
}

type ProductWonRow = {
  product: string;
  won_amount: number;
  won_count: number;
  avg_order_value: number;
  avg_health_score: number | null;
};

async function loadProductsClosedWonPartner(orgId: number, qpId: string, repIds: number[], useScoped: boolean): Promise<ProductWonRow[]> {
  return pool
    .query<ProductWonRow>(
      `
      WITH qp AS (
        SELECT period_start::date AS period_start, period_end::date AS period_end
          FROM quota_periods
         WHERE org_id = $1::bigint
           AND id = $2::bigint
         LIMIT 1
      ),
      deals AS (
        SELECT
          COALESCE(NULLIF(btrim(o.product), ''), '(Unspecified)') AS product,
          COALESCE(o.amount, 0) AS amount,
          o.health_score,
          lower(
            regexp_replace(
              COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''),
              '[^a-zA-Z]+',
              ' ',
              'g'
            )
          ) AS fs,
          CASE
            WHEN o.close_date IS NULL THEN NULL
            WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
            WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
              to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
            ELSE NULL
          END AS close_d
        FROM opportunities o
        WHERE o.org_id = $1
          AND o.partner_name IS NOT NULL
          AND btrim(o.partner_name) <> ''
          AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
      ),
      deals_in_qtr AS (
        SELECT d.*
          FROM deals d
          JOIN qp ON TRUE
         WHERE d.close_d IS NOT NULL
           AND d.close_d >= qp.period_start
           AND d.close_d <= qp.period_end
      ),
      won_deals AS (
        SELECT *
          FROM deals_in_qtr
         WHERE ((' ' || fs || ' ') LIKE '% won %')
      )
      SELECT
        product,
        COALESCE(SUM(amount), 0)::float8 AS won_amount,
        COUNT(*)::int AS won_count,
        CASE WHEN COUNT(*) > 0 THEN (COALESCE(SUM(amount), 0)::float8 / COUNT(*)::float8) ELSE 0 END AS avg_order_value,
        AVG(NULLIF(health_score, 0))::float8 AS avg_health_score
      FROM won_deals
      GROUP BY product
      ORDER BY won_amount DESC, product ASC
      LIMIT 30
      `,
      [orgId, qpId, repIds, useScoped]
    )
    .then((r) => (r.rows || []) as ProductWonRow[])
    .catch(() => []);
}

export type ChannelPartnerHeroProps = {
  quarterKpis: QuarterKpisSnapshot | null;
  productsClosedWon: ProductWonRow[];
  productsClosedWonPrevSummary: { total_revenue: number; total_orders: number; blended_acv: number } | null;
  pipelineMomentum: PipelineMomentumData | null;
  crmForecast: {
    commit_amount: number;
    best_case_amount: number;
    pipeline_amount: number;
    won_amount: number;
    weighted_forecast: number;
  };
  aiForecast: number;
  crmForecastWeighted: number;
  quota: number;
  forecastGap: number;
  pctToGoal: number | null;
  leftToGo: number;
  bucketDeltas: { commit: number; best_case: number; pipeline: number };
  commitAdmission: CommitAdmissionAggregates | null;
  commitDealPanels: CommitAdmissionDealPanels | null;
  healthModifiers: { commit_modifier: number; best_case_modifier: number; pipeline_modifier: number };
};

export async function loadChannelPartnerHeroProps(args: {
  orgId: number;
  quotaPeriodId: string;
  prevQuotaPeriodId: string;
  repIds: number[];
}): Promise<ChannelPartnerHeroProps | null> {
  const qpId = String(args.quotaPeriodId || "").trim();
  if (!qpId || !args.repIds.length) return null;

  const repIds = args.repIds;
  const useScoped = true;
  const prevQpId = String(args.prevQuotaPeriodId || "").trim();

  const stageProbabilities = await getForecastStageProbabilities({ orgId: args.orgId }).catch(() => ({
    commit: 0.8,
    best_case: 0.325,
    pipeline: 0.1,
  }));

  const [
    totals,
    verdictAgg,
    curStage,
    prevStage,
    quarterKpis,
    productsClosedWon,
    prevProductsRows,
    quotaRow,
    commitAdmission,
    commitDealPanels,
  ] = await Promise.all([
    loadPartnerTotals(args.orgId, qpId, repIds, useScoped),
    loadPartnerVerdictAgg(args.orgId, qpId, repIds, useScoped),
    loadPartnerPipelineStage(args.orgId, qpId, repIds, useScoped),
    prevQpId ? loadPartnerPipelineStage(args.orgId, prevQpId, repIds, useScoped) : Promise.resolve(emptyStage),
    getQuarterKpisSnapshot({
      orgId: args.orgId,
      quotaPeriodId: qpId,
      repIds,
      requirePartnerName: true,
    }).catch(() => null),
    loadProductsClosedWonPartner(args.orgId, qpId, repIds, useScoped),
    prevQpId ? loadProductsClosedWonPartner(args.orgId, prevQpId, repIds, useScoped) : Promise.resolve([]),
    pool
      .query<{ quota_amount: number }>(
        `
        SELECT COALESCE(SUM(quota_amount), 0)::float8 AS quota_amount
          FROM quotas
         WHERE org_id = $1::bigint
           AND role_level = 3
           AND quota_period_id = $2::bigint
           AND rep_id = ANY($3::bigint[])
        `,
        [args.orgId, qpId, repIds]
      )
      .then((r) => Number(r.rows?.[0]?.quota_amount || 0) || 0)
      .catch(() => 0),
    getCommitAdmissionAggregates({
      orgId: args.orgId,
      quotaPeriodId: qpId,
      repIds,
      requirePartnerName: true,
    }).catch(() => null),
    getCommitAdmissionDealPanels({
      orgId: args.orgId,
      quotaPeriodId: qpId,
      repIds,
      requirePartnerName: true,
    }).catch(() => null),
  ]);

  const healthModifiers = {
    commit_modifier: verdictAgg.commit_crm > 0 ? verdictAgg.commit_verdict / verdictAgg.commit_crm : 1,
    best_case_modifier: verdictAgg.best_case_crm > 0 ? verdictAgg.best_case_verdict / verdictAgg.best_case_crm : 1,
    pipeline_modifier: verdictAgg.pipeline_crm > 0 ? verdictAgg.pipeline_verdict / verdictAgg.pipeline_crm : 1,
  };

  const quota = quotaRow;

  const summary = computeSalesVsVerdictForecastSummary({
    crm_totals: {
      commit: Number(totals.commit_amount || 0) || 0,
      best_case: Number(totals.best_case_amount || 0) || 0,
      pipeline: Number(totals.pipeline_amount || 0) || 0,
      won: Number(totals.won_amount || 0) || 0,
      quota,
    },
    org_probabilities: {
      commit_pct: stageProbabilities.commit,
      best_case_pct: stageProbabilities.best_case,
      pipeline_pct: stageProbabilities.pipeline,
    },
    health_modifiers: healthModifiers,
  });

  const weightedCrm = summary.weighted.crm.forecast;
  const weightedAi = summary.weighted.verdict.forecast;
  const forecastGap = summary.forecast_gap;
  const pctToGoal = quota > 0 ? weightedAi / quota : null;
  const leftToGo = quota - weightedAi;

  const commitDelta = summary.weighted.verdict.commit_weighted - summary.weighted.crm.commit_weighted;
  const bestDelta = summary.weighted.verdict.best_case_weighted - summary.weighted.crm.best_case_weighted;
  const pipeDelta = summary.weighted.verdict.pipeline_weighted - summary.weighted.crm.pipeline_weighted;

  const productsClosedWonPrevSummary =
    prevQpId && prevProductsRows.length
      ? (() => {
          const totalRevenue = prevProductsRows.reduce((acc, r) => acc + (Number(r.won_amount || 0) || 0), 0);
          const totalOrders = prevProductsRows.reduce((acc, r) => acc + (Number(r.won_count || 0) || 0), 0);
          const blendedAcv = totalOrders > 0 ? totalRevenue / totalOrders : 0;
          return { total_revenue: totalRevenue, total_orders: totalOrders, blended_acv: blendedAcv };
        })()
      : prevQpId
        ? { total_revenue: 0, total_orders: 0, blended_acv: 0 }
        : null;

  const pipelineMomentum: PipelineMomentumData | null =
    curStage && Number.isFinite(Number(curStage.total_active_amount))
      ? {
          quota_target: Math.max(0, quota - (Number(curStage.won_amount || 0) || 0)),
          current_quarter: {
            total_pipeline: Number(curStage.total_active_amount || 0) || 0,
            // Use totals-derived counts/health so it matches the same deal set
            // that drives the card amounts (totals do not require predictive_eligible).
            total_opps: Number(totals.total_active_count || 0) || 0,
            avg_health_pct: healthPctFrom30(totals.total_active_avg_health_score),
            mix: {
              commit: {
                value: Number(curStage.commit_amount || 0) || 0,
                opps: Number(totals.commit_count || 0) || 0,
                qoq_change_pct: prevStage ? qoqPct(Number(curStage.commit_amount || 0) || 0, Number(prevStage.commit_amount || 0) || 0) : null,
                health_pct: healthPctFrom30(totals.commit_avg_health_score),
              },
              best_case: {
                value: Number(curStage.best_case_amount || 0) || 0,
                opps: Number(totals.best_case_count || 0) || 0,
                qoq_change_pct: prevStage
                  ? qoqPct(Number(curStage.best_case_amount || 0) || 0, Number(prevStage.best_case_amount || 0) || 0)
                  : null,
                health_pct: healthPctFrom30(totals.best_case_avg_health_score),
              },
              pipeline: {
                value: Number(curStage.pipeline_amount || 0) || 0,
                opps: Number(totals.pipeline_count || 0) || 0,
                qoq_change_pct: prevStage ? qoqPct(Number(curStage.pipeline_amount || 0) || 0, Number(prevStage.pipeline_amount || 0) || 0) : null,
                health_pct: healthPctFrom30(totals.pipeline_avg_health_score),
              },
            },
          },
          previous_quarter: {
            total_pipeline: prevStage ? (Number(prevStage.total_active_amount || 0) || 0) : null,
          },
        }
      : null;

  return {
    quarterKpis,
    productsClosedWon,
    productsClosedWonPrevSummary,
    pipelineMomentum,
    crmForecast: {
      commit_amount: Number(totals.commit_amount || 0) || 0,
      best_case_amount: Number(totals.best_case_amount || 0) || 0,
      pipeline_amount: Number(totals.pipeline_amount || 0) || 0,
      won_amount: Number(totals.won_amount || 0) || 0,
      weighted_forecast: weightedCrm,
    },
    aiForecast: weightedAi,
    crmForecastWeighted: weightedCrm,
    quota,
    forecastGap,
    pctToGoal,
    leftToGo,
    bucketDeltas: {
      commit: commitDelta,
      best_case: bestDelta,
      pipeline: pipeDelta,
    },
    commitAdmission,
    commitDealPanels,
    healthModifiers,
  };
}

export type ChannelLedFedRow = {
  metric: string;
  channelLed: number;
  channelFed: number;
  total: number;
  isCurrency: boolean;
};

export async function loadChannelLedFedRows(args: {
  orgId: number;
  quotaPeriodId: string;
  repIds: number[];
}): Promise<ChannelLedFedRow[]> {
  const qpId = String(args.quotaPeriodId || "").trim();
  if (!qpId || !args.repIds.length) return [];

  const useScoped = true;
  const { rows } = await pool
    .query<{
      led_total_pipeline: string | null;
      fed_total_pipeline: string | null;
      led_commit: string | null;
      fed_commit: string | null;
      led_best: string | null;
      fed_best: string | null;
      led_won: string | null;
      fed_won: string | null;
      led_deal_count: string | null;
      fed_deal_count: string | null;
    }>(
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
          o.deal_registration,
          o.predictive_eligible,
          lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs,
          CASE
            WHEN o.close_date IS NULL THEN NULL
            WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
            WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
              to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
            ELSE NULL
          END AS close_d
        FROM opportunities o
        JOIN qp ON TRUE
        WHERE o.org_id = $1
          AND o.partner_name IS NOT NULL
          AND btrim(o.partner_name) <> ''
          AND o.close_date IS NOT NULL
          AND (
            CASE
              WHEN o.close_date IS NULL THEN NULL
              WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
              WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
                to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
              ELSE NULL
            END
          ) IS NOT NULL
          AND (
            CASE
              WHEN o.close_date IS NULL THEN NULL
              WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
              WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
                to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
              ELSE NULL
            END
          ) >= qp.period_start
          AND (
            CASE
              WHEN o.close_date IS NULL THEN NULL
              WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
              WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
                to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
              ELSE NULL
            END
          ) <= qp.period_end
          AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
      ),
      classified AS (
        SELECT
          *,
          ((' ' || fs || ' ') LIKE '% won %') AS is_won,
          (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %')) AS is_lost,
          (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %'))) AS is_active,
          CASE
            WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %'))) AND fs LIKE '%commit%' THEN 'commit'
            WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %'))) AND fs LIKE '%best%' THEN 'best'
            WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %'))) THEN 'pipeline'
            ELSE 'other'
          END AS bucket,
          CASE WHEN deal_registration IS NOT NULL THEN TRUE ELSE FALSE END AS is_led
        FROM base
      )
      SELECT
        COALESCE(SUM(CASE WHEN is_active AND (predictive_eligible IS TRUE) AND is_led THEN amount ELSE 0 END), 0)::float8 AS led_total_pipeline,
        COALESCE(SUM(CASE WHEN is_active AND (predictive_eligible IS TRUE) AND NOT is_led THEN amount ELSE 0 END), 0)::float8 AS fed_total_pipeline,
        COALESCE(SUM(CASE WHEN is_active AND (predictive_eligible IS TRUE) AND bucket = 'commit' AND is_led THEN amount ELSE 0 END), 0)::float8 AS led_commit,
        COALESCE(SUM(CASE WHEN is_active AND (predictive_eligible IS TRUE) AND bucket = 'commit' AND NOT is_led THEN amount ELSE 0 END), 0)::float8 AS fed_commit,
        COALESCE(SUM(CASE WHEN is_active AND (predictive_eligible IS TRUE) AND bucket = 'best' AND is_led THEN amount ELSE 0 END), 0)::float8 AS led_best,
        COALESCE(SUM(CASE WHEN is_active AND (predictive_eligible IS TRUE) AND bucket = 'best' AND NOT is_led THEN amount ELSE 0 END), 0)::float8 AS fed_best,
        COALESCE(SUM(CASE WHEN is_won AND is_led THEN amount ELSE 0 END), 0)::float8 AS led_won,
        COALESCE(SUM(CASE WHEN is_won AND NOT is_led THEN amount ELSE 0 END), 0)::float8 AS fed_won,
        COALESCE(COUNT(*) FILTER (WHERE is_led), 0)::float8 AS led_deal_count,
        COALESCE(COUNT(*) FILTER (WHERE NOT is_led), 0)::float8 AS fed_deal_count
      FROM classified
      `,
      [args.orgId, qpId, args.repIds, useScoped]
    )
    .catch(() => ({ rows: [] }));

  const r = rows?.[0];
  if (!r) return [];

  const n = (v: string | null | undefined) => Number(v || 0) || 0;

  const ledPipe = n(r.led_total_pipeline);
  const fedPipe = n(r.fed_total_pipeline);
  const ledCommit = n(r.led_commit);
  const fedCommit = n(r.fed_commit);
  const ledBest = n(r.led_best);
  const fedBest = n(r.fed_best);
  const ledWon = n(r.led_won);
  const fedWon = n(r.fed_won);
  const ledCnt = Math.round(n(r.led_deal_count));
  const fedCnt = Math.round(n(r.fed_deal_count));

  return [
    {
      metric: "Total Pipeline",
      channelLed: ledPipe,
      channelFed: fedPipe,
      total: ledPipe + fedPipe,
      isCurrency: true,
    },
    {
      metric: "Commit",
      channelLed: ledCommit,
      channelFed: fedCommit,
      total: ledCommit + fedCommit,
      isCurrency: true,
    },
    {
      metric: "Best Case",
      channelLed: ledBest,
      channelFed: fedBest,
      total: ledBest + fedBest,
      isCurrency: true,
    },
    {
      metric: "Won Revenue",
      channelLed: ledWon,
      channelFed: fedWon,
      total: ledWon + fedWon,
      isCurrency: true,
    },
    {
      metric: "Deal Count",
      channelLed: ledCnt,
      channelFed: fedCnt,
      total: ledCnt + fedCnt,
      isCurrency: false,
    },
  ];
}
