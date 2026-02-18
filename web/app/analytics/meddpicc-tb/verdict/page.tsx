import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization } from "../../../../lib/db";
import { pool } from "../../../../lib/pool";
import { UserTopNav } from "../../../_components/UserTopNav";
import { VerdictFiltersClient } from "./FiltersClient";
import { getScopedRepDirectory } from "../../../../lib/repScope";
import { getForecastStageProbabilities } from "../../../../lib/forecastStageProbabilities";
import { computeSalesVsVerdictForecastSummary } from "../../../../lib/forecastSummary";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtNum(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString();
}

function fmtPct(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function deltaClass(n: number) {
  if (!Number.isFinite(n) || n === 0) return "text-[color:var(--sf-text-secondary)]";
  return n > 0 ? "text-[#2ECC71]" : "text-[#E74C3C]";
}

type QuotaPeriodLite = {
  id: string;
  fiscal_year: string;
  fiscal_quarter: string;
  period_name: string;
  period_start: string;
  period_end: string;
};

type ForecastAggRow = {
  crm_commit_amount: number;
  crm_commit_count: number;
  crm_best_amount: number;
  crm_best_count: number;
  crm_pipeline_amount: number;
  crm_pipeline_count: number;
  crm_total_amount: number;
  crm_total_count: number;
  won_amount: number;
  won_count: number;
  verdict_commit_amount: number;
  verdict_commit_count: number;
  verdict_best_amount: number;
  verdict_best_count: number;
  verdict_pipeline_amount: number;
  verdict_pipeline_count: number;
  verdict_total_amount: number;
  verdict_total_count: number;
  commit_modifier: number;
  best_case_modifier: number;
  pipeline_modifier: number;
};

type ForecastAggByRoleRow = ForecastAggRow & { owner_role: string };

type TotalPipelineByRepRow = {
  manager_id: string;
  manager_name: string;
  rep_id: string;
  rep_name: string;
  crm_total_amount: number;
  crm_total_count: number;
  verdict_total_amount: number;
  verdict_total_count: number;
};

function rangeLabel(a: number, b: number) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return `${fmtMoney(lo)} → ${fmtMoney(hi)}`;
}

export default async function VerdictForecastPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "REP") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const quota_period_id = String(sp(searchParams?.quota_period_id) || "").trim();

  const periods = await pool
    .query<QuotaPeriodLite>(
      `
      SELECT
        id::text AS id,
        fiscal_year,
        fiscal_quarter::text AS fiscal_quarter,
        period_name,
        period_start::text AS period_start,
        period_end::text AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
      ORDER BY period_start DESC, id DESC
      `,
      [ctx.user.org_id]
    )
    .then((r) => r.rows || [])
    .catch(() => []);

  const scope = await getScopedRepDirectory({ orgId: ctx.user.org_id, userId: ctx.user.id, role: ctx.user.role as any }).catch(() => null);
  // IMPORTANT: enforce scope by default; only explicit `null` means "no filter" (admin).
  const allowedRepIds = scope?.allowedRepIds; // number[] | null | undefined
  const scopedRepIds = Array.isArray(allowedRepIds) ? allowedRepIds : [];
  const useScopedRepIds = allowedRepIds !== null;

  const { rows: savedReports } = await pool.query(
    `
    SELECT id::text AS id, report_type, name, description, config, created_at::text AS created_at, updated_at::text AS updated_at
    FROM analytics_saved_reports
    WHERE org_id = $1::bigint
      AND owner_user_id = $2::bigint
      AND report_type = 'verdict_filters_v1'
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 100
    `,
    [ctx.user.org_id, ctx.user.id]
  );

  const saved_report_id = String(sp(searchParams?.saved_report_id) || "").trim();

  const todayIso = new Date().toISOString().slice(0, 10);
  const containingToday = periods.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;
  const defaultQuotaPeriodId = String(containingToday?.id || periods?.[0]?.id || "").trim();
  const savedRow = saved_report_id ? (savedReports || []).find((r: any) => String(r.id) === saved_report_id) || null : null;
  const savedCfg = savedRow?.config as any;
  const savedQuotaPeriodId = String(savedCfg?.quotaPeriodId || "").trim();

  const qpId = quota_period_id || savedQuotaPeriodId || defaultQuotaPeriodId;
  const qp = qpId ? periods.find((p) => String(p.id) === qpId) || null : null;

  const orgProb = await getForecastStageProbabilities({ orgId: ctx.user.org_id }).catch(() => ({
    commit: 0.8,
    best_case: 0.325,
    pipeline: 0.1,
  }));

  const quarterlyQuotaAmount = qpId
    ? await pool
        .query<{ quota_amount: number }>(
          `
          SELECT
            COALESCE(SUM(q.quota_amount), 0)::float8 AS quota_amount
          FROM quotas q
          JOIN reps r
            ON r.organization_id = $1::bigint
           AND r.id = q.rep_id
          WHERE q.org_id = $1::bigint
            AND q.quota_period_id = $2::bigint
            AND q.role_level = 3
            AND q.rep_id IS NOT NULL
            AND r.role = 'REP'
            AND (NOT $3::boolean OR q.rep_id = ANY($4::bigint[]))
          `,
          [ctx.user.org_id, qpId, useScopedRepIds, scopedRepIds]
        )
        .then((r) => Number(r.rows?.[0]?.quota_amount || 0) || 0)
        .catch(() => 0)
    : 0;

  let aggRows: ForecastAggByRoleRow[] = [];
  if (qpId && qp) {
    try {
      aggRows = await pool
        .query<ForecastAggByRoleRow>(
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
              CASE
                WHEN r.role IN ('EXEC_MANAGER', 'MANAGER', 'REP') THEN r.role
                ELSE 'UNASSIGNED'
              END AS owner_role,
              lower(
                regexp_replace(
                  COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
                  '[^a-zA-Z]+',
                  ' ',
                  'g'
                )
              ) AS fs
            FROM opportunities o
            JOIN qp ON TRUE
            LEFT JOIN reps r
              ON r.organization_id = $1
             AND r.id = o.rep_id
            WHERE o.org_id = $1
              AND o.close_date IS NOT NULL
              AND o.close_date >= qp.period_start
              AND o.close_date <= qp.period_end
              AND (NOT $3::boolean OR o.rep_id = ANY($4::bigint[]))
          ),
          classified AS (
            SELECT
              *,
              ((' ' || fs || ' ') LIKE '% won %') AS is_won,
              (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %')) AS is_lost,
              ((' ' || fs || ' ') LIKE '% closed %') AS is_closed_kw,
              (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %') AND NOT ((' ' || fs || ' ') LIKE '% loss %') AND NOT ((' ' || fs || ' ') LIKE '% closed %')) AS is_open,
              CASE
                WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %') AND NOT ((' ' || fs || ' ') LIKE '% loss %') AND NOT ((' ' || fs || ' ') LIKE '% closed %')) AND fs LIKE '%commit%' THEN 'commit'
                WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %') AND NOT ((' ' || fs || ' ') LIKE '% loss %') AND NOT ((' ' || fs || ' ') LIKE '% closed %')) AND fs LIKE '%best%' THEN 'best_case'
                WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %') AND NOT ((' ' || fs || ' ') LIKE '% loss %') AND NOT ((' ' || fs || ' ') LIKE '% closed %')) THEN 'pipeline'
                ELSE NULL
              END AS crm_bucket
            FROM deals
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
                 AND c.health_score IS NOT NULL
                 AND c.health_score >= min_score
                 AND c.health_score <= max_score
               ORDER BY min_score DESC, max_score ASC, id ASC
               LIMIT 1
            ) hr ON TRUE
          ),
          modded AS (
            SELECT
              *,
              CASE WHEN suppression THEN 0.0::float8 ELSE COALESCE(probability_modifier, 1.0)::float8 END AS health_modifier
            FROM with_rules
          )
          SELECT
            COALESCE(owner_role, 'ALL') AS owner_role,
            COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'commit' THEN amount ELSE 0 END), 0)::float8 AS crm_commit_amount,
            COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'commit' THEN 1 ELSE 0 END), 0)::int AS crm_commit_count,
            COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'best_case' THEN amount ELSE 0 END), 0)::float8 AS crm_best_amount,
            COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'best_case' THEN 1 ELSE 0 END), 0)::int AS crm_best_count,
            COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'pipeline' THEN amount ELSE 0 END), 0)::float8 AS crm_pipeline_amount,
            COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'pipeline' THEN 1 ELSE 0 END), 0)::int AS crm_pipeline_count,
            COALESCE(SUM(CASE WHEN is_open THEN amount ELSE 0 END), 0)::float8 AS crm_total_amount,
            COALESCE(SUM(CASE WHEN is_open THEN 1 ELSE 0 END), 0)::int AS crm_total_count,
            COALESCE(SUM(CASE WHEN is_won THEN amount ELSE 0 END), 0)::float8 AS won_amount,
            COALESCE(SUM(CASE WHEN is_won THEN 1 ELSE 0 END), 0)::int AS won_count,
            COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'commit' THEN (amount * health_modifier) ELSE 0 END), 0)::float8 AS verdict_commit_amount,
            COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'commit' THEN 1 ELSE 0 END), 0)::int AS verdict_commit_count,
            COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'best_case' THEN (amount * health_modifier) ELSE 0 END), 0)::float8 AS verdict_best_amount,
            COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'best_case' THEN 1 ELSE 0 END), 0)::int AS verdict_best_count,
            COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'pipeline' THEN (amount * health_modifier) ELSE 0 END), 0)::float8 AS verdict_pipeline_amount,
            COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'pipeline' THEN 1 ELSE 0 END), 0)::int AS verdict_pipeline_count,
            COALESCE(SUM(CASE WHEN is_open THEN (amount * health_modifier) ELSE 0 END), 0)::float8 AS verdict_total_amount,
            COALESCE(SUM(CASE WHEN is_open THEN 1 ELSE 0 END), 0)::int AS verdict_total_count,
            CASE
              WHEN COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'commit' THEN amount ELSE 0 END), 0) > 0
              THEN (COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'commit' THEN (amount * health_modifier) ELSE 0 END), 0)
                / COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'commit' THEN amount ELSE 0 END), 1)
              )::float8
              ELSE 1.0::float8
            END AS commit_modifier,
            CASE
              WHEN COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'best_case' THEN amount ELSE 0 END), 0) > 0
              THEN (COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'best_case' THEN (amount * health_modifier) ELSE 0 END), 0)
                / COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'best_case' THEN amount ELSE 0 END), 1)
              )::float8
              ELSE 1.0::float8
            END AS best_case_modifier,
            CASE
              WHEN COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'pipeline' THEN amount ELSE 0 END), 0) > 0
              THEN (COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'pipeline' THEN (amount * health_modifier) ELSE 0 END), 0)
                / COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'pipeline' THEN amount ELSE 0 END), 1)
              )::float8
              ELSE 1.0::float8
            END AS pipeline_modifier
          FROM modded
          GROUP BY GROUPING SETS ((owner_role), ())
          `,
          [ctx.user.org_id, qpId, useScopedRepIds, scopedRepIds]
        )
        .then((r) => r.rows || []);
    } catch (e: any) {
      // Fallback: if health_score_rules isn't present yet, compute Verdict = CRM (modifier=1.0).
      const code = String(e?.code || "");
      if (code === "42P01") {
        aggRows = await pool
          .query<ForecastAggByRoleRow>(
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
                CASE
                  WHEN r.role IN ('EXEC_MANAGER', 'MANAGER', 'REP') THEN r.role
                  ELSE 'UNASSIGNED'
                END AS owner_role,
                lower(
                  regexp_replace(
                    COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
                    '[^a-zA-Z]+',
                    ' ',
                    'g'
                  )
                ) AS fs
              FROM opportunities o
              JOIN qp ON TRUE
              LEFT JOIN reps r
                ON r.organization_id = $1
               AND r.id = o.rep_id
              WHERE o.org_id = $1
                AND o.close_date IS NOT NULL
                AND o.close_date >= qp.period_start
                AND o.close_date <= qp.period_end
                AND (NOT $3::boolean OR o.rep_id = ANY($4::bigint[]))
            ),
            classified AS (
              SELECT
                *,
                ((' ' || fs || ' ') LIKE '% won %') AS is_won,
                (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %')) AS is_lost,
                ((' ' || fs || ' ') LIKE '% closed %') AS is_closed_kw,
                (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %') AND NOT ((' ' || fs || ' ') LIKE '% loss %') AND NOT ((' ' || fs || ' ') LIKE '% closed %')) AS is_open,
                CASE
                  WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %') AND NOT ((' ' || fs || ' ') LIKE '% loss %') AND NOT ((' ' || fs || ' ') LIKE '% closed %')) AND fs LIKE '%commit%' THEN 'commit'
                  WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %') AND NOT ((' ' || fs || ' ') LIKE '% loss %') AND NOT ((' ' || fs || ' ') LIKE '% closed %')) AND fs LIKE '%best%' THEN 'best_case'
                  WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %') AND NOT ((' ' || fs || ' ') LIKE '% loss %') AND NOT ((' ' || fs || ' ') LIKE '% closed %')) THEN 'pipeline'
                  ELSE NULL
                END AS crm_bucket
              FROM deals
            ),
            modded AS (
              SELECT *, 1.0::float8 AS health_modifier
              FROM classified
            )
            SELECT
              COALESCE(owner_role, 'ALL') AS owner_role,
              COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'commit' THEN amount ELSE 0 END), 0)::float8 AS crm_commit_amount,
              COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'commit' THEN 1 ELSE 0 END), 0)::int AS crm_commit_count,
              COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'best_case' THEN amount ELSE 0 END), 0)::float8 AS crm_best_amount,
              COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'best_case' THEN 1 ELSE 0 END), 0)::int AS crm_best_count,
              COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'pipeline' THEN amount ELSE 0 END), 0)::float8 AS crm_pipeline_amount,
              COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'pipeline' THEN 1 ELSE 0 END), 0)::int AS crm_pipeline_count,
              COALESCE(SUM(CASE WHEN is_open THEN amount ELSE 0 END), 0)::float8 AS crm_total_amount,
              COALESCE(SUM(CASE WHEN is_open THEN 1 ELSE 0 END), 0)::int AS crm_total_count,
              COALESCE(SUM(CASE WHEN is_won THEN amount ELSE 0 END), 0)::float8 AS won_amount,
              COALESCE(SUM(CASE WHEN is_won THEN 1 ELSE 0 END), 0)::int AS won_count,
              COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'commit' THEN amount ELSE 0 END), 0)::float8 AS verdict_commit_amount,
              COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'commit' THEN 1 ELSE 0 END), 0)::int AS verdict_commit_count,
              COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'best_case' THEN amount ELSE 0 END), 0)::float8 AS verdict_best_amount,
              COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'best_case' THEN 1 ELSE 0 END), 0)::int AS verdict_best_count,
              COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'pipeline' THEN amount ELSE 0 END), 0)::float8 AS verdict_pipeline_amount,
              COALESCE(SUM(CASE WHEN is_open AND crm_bucket = 'pipeline' THEN 1 ELSE 0 END), 0)::int AS verdict_pipeline_count,
              COALESCE(SUM(CASE WHEN is_open THEN amount ELSE 0 END), 0)::float8 AS verdict_total_amount,
              COALESCE(SUM(CASE WHEN is_open THEN 1 ELSE 0 END), 0)::int AS verdict_total_count,
              1.0::float8 AS commit_modifier,
              1.0::float8 AS best_case_modifier,
              1.0::float8 AS pipeline_modifier
            FROM modded
            GROUP BY GROUPING SETS ((owner_role), ())
            `,
            [ctx.user.org_id, qpId, useScopedRepIds, scopedRepIds]
          )
          .then((r) => r.rows || []);
      } else {
        throw e;
      }
    }
  }

  const normalizeAggRow = (r: any, owner_role: string): ForecastAggByRoleRow => {
    const z = (k: keyof ForecastAggRow) => Number(r?.[k] || 0) || 0;
    const zi = (k: keyof ForecastAggRow) => Number(r?.[k] || 0) || 0;
    return {
      owner_role,
      crm_commit_amount: z("crm_commit_amount"),
      crm_commit_count: zi("crm_commit_count"),
      crm_best_amount: z("crm_best_amount"),
      crm_best_count: zi("crm_best_count"),
      crm_pipeline_amount: z("crm_pipeline_amount"),
      crm_pipeline_count: zi("crm_pipeline_count"),
      crm_total_amount: z("crm_total_amount"),
      crm_total_count: zi("crm_total_count"),
      won_amount: z("won_amount"),
      won_count: zi("won_count"),
      verdict_commit_amount: z("verdict_commit_amount"),
      verdict_commit_count: zi("verdict_commit_count"),
      verdict_best_amount: z("verdict_best_amount"),
      verdict_best_count: zi("verdict_best_count"),
      verdict_pipeline_amount: z("verdict_pipeline_amount"),
      verdict_pipeline_count: zi("verdict_pipeline_count"),
      verdict_total_amount: z("verdict_total_amount"),
      verdict_total_count: zi("verdict_total_count"),
      commit_modifier: z("commit_modifier"),
      best_case_modifier: z("best_case_modifier"),
      pipeline_modifier: z("pipeline_modifier"),
    };
  };

  const aggList = Array.isArray(aggRows) ? aggRows : [];
  const allAggRowRaw = aggList.find((r) => String((r as any)?.owner_role || "").toUpperCase() === "ALL") || null;
  const aggAll = normalizeAggRow(allAggRowRaw, "ALL");

  const diff = {
    commit_amount: aggAll.verdict_commit_amount - aggAll.crm_commit_amount,
    commit_count: aggAll.verdict_commit_count - aggAll.crm_commit_count,
    best_amount: aggAll.verdict_best_amount - aggAll.crm_best_amount,
    best_count: aggAll.verdict_best_count - aggAll.crm_best_count,
    pipeline_amount: aggAll.verdict_pipeline_amount - aggAll.crm_pipeline_amount,
    pipeline_count: aggAll.verdict_pipeline_count - aggAll.crm_pipeline_count,
    total_amount: aggAll.verdict_total_amount - aggAll.crm_total_amount,
    total_count: aggAll.verdict_total_count - aggAll.crm_total_count,
  };

  const leftToGo = quarterlyQuotaAmount - (Number(aggAll.won_amount || 0) || 0);
  const summary = computeSalesVsVerdictForecastSummary({
    crm_totals: {
      commit: aggAll.crm_commit_amount,
      best_case: aggAll.crm_best_amount,
      pipeline: aggAll.crm_pipeline_amount,
      won: aggAll.won_amount,
      quota: quarterlyQuotaAmount,
    },
    org_probabilities: {
      commit_pct: orgProb.commit,
      best_case_pct: orgProb.best_case,
      pipeline_pct: orgProb.pipeline,
    },
    health_modifiers: {
      commit_modifier: aggAll.commit_modifier,
      best_case_modifier: aggAll.best_case_modifier,
      pipeline_modifier: aggAll.pipeline_modifier,
    },
  });
  const pctToGoal = quarterlyQuotaAmount > 0 ? summary.weighted.verdict.forecast / quarterlyQuotaAmount : null;

  let pipelineByRepRows: TotalPipelineByRepRow[] = [];
  if (qpId && qp) {
    try {
      pipelineByRepRows = await pool
        .query<TotalPipelineByRepRow>(
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
              o.rep_id,
              o.rep_name,
              r.manager_rep_id,
              COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), NULLIF(btrim(o.rep_name), ''), '(Unknown rep)') AS rep_name_norm,
              COALESCE(NULLIF(btrim(m.display_name), ''), NULLIF(btrim(m.rep_name), ''), '(Unassigned)') AS manager_name_norm,
              lower(
                regexp_replace(
                  COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
                  '[^a-zA-Z]+',
                  ' ',
                  'g'
                )
              ) AS fs
            FROM opportunities o
            JOIN qp ON TRUE
            LEFT JOIN reps r
              ON r.organization_id = $1
             AND r.id = o.rep_id
            LEFT JOIN reps m
              ON m.organization_id = $1
             AND m.id = r.manager_rep_id
            WHERE o.org_id = $1
              AND o.close_date IS NOT NULL
              AND o.close_date >= qp.period_start
              AND o.close_date <= qp.period_end
              AND (NOT $3::boolean OR o.rep_id = ANY($4::bigint[]))
          ),
          classified AS (
            SELECT
              *,
              ((' ' || fs || ' ') LIKE '% won %') AS is_won,
              (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %')) AS is_lost,
              ((' ' || fs || ' ') LIKE '% closed %') AS is_closed_kw,
              (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %') AND NOT ((' ' || fs || ' ') LIKE '% loss %') AND NOT ((' ' || fs || ' ') LIKE '% closed %')) AS is_open
            FROM deals
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
                 AND c.health_score IS NOT NULL
                 AND c.health_score >= min_score
                 AND c.health_score <= max_score
               ORDER BY min_score DESC, max_score ASC, id ASC
               LIMIT 1
            ) hr ON TRUE
          ),
          modded AS (
            SELECT
              *,
              CASE WHEN suppression THEN 0.0::float8 ELSE COALESCE(probability_modifier, 1.0)::float8 END AS health_modifier
            FROM with_rules
          )
          SELECT
            COALESCE(manager_rep_id::text, '') AS manager_id,
            COALESCE(NULLIF(btrim(manager_name_norm), ''), '(Unassigned)') AS manager_name,
            COALESCE(rep_id::text, '') AS rep_id,
            COALESCE(NULLIF(btrim(rep_name_norm), ''), '(Unknown rep)') AS rep_name,
            COALESCE(SUM(CASE WHEN is_open THEN amount ELSE 0 END), 0)::float8 AS crm_total_amount,
            COALESCE(SUM(CASE WHEN is_open THEN 1 ELSE 0 END), 0)::int AS crm_total_count,
            COALESCE(SUM(CASE WHEN is_open THEN (amount * health_modifier) ELSE 0 END), 0)::float8 AS verdict_total_amount,
            COALESCE(SUM(CASE WHEN is_open THEN 1 ELSE 0 END), 0)::int AS verdict_total_count
          FROM modded
          GROUP BY COALESCE(manager_rep_id::text, ''), COALESCE(NULLIF(btrim(manager_name_norm), ''), '(Unassigned)'), COALESCE(rep_id::text, ''), COALESCE(NULLIF(btrim(rep_name_norm), ''), '(Unknown rep)')
          ORDER BY manager_name ASC, rep_name ASC
          `,
          [ctx.user.org_id, qpId, useScopedRepIds, scopedRepIds]
        )
        .then((r) => (r.rows || []) as any[]);
    } catch (e: any) {
      const code = String(e?.code || "");
      if (code === "42P01") {
        pipelineByRepRows = await pool
          .query<TotalPipelineByRepRow>(
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
                o.rep_id,
                o.rep_name,
                r.manager_rep_id,
                COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), NULLIF(btrim(o.rep_name), ''), '(Unknown rep)') AS rep_name_norm,
                COALESCE(NULLIF(btrim(m.display_name), ''), NULLIF(btrim(m.rep_name), ''), '(Unassigned)') AS manager_name_norm,
                lower(
                  regexp_replace(
                    COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
                    '[^a-zA-Z]+',
                    ' ',
                    'g'
                  )
                ) AS fs
              FROM opportunities o
              JOIN qp ON TRUE
              LEFT JOIN reps r
                ON r.organization_id = $1
               AND r.id = o.rep_id
              LEFT JOIN reps m
                ON m.organization_id = $1
               AND m.id = r.manager_rep_id
              WHERE o.org_id = $1
                AND o.close_date IS NOT NULL
                AND o.close_date >= qp.period_start
                AND o.close_date <= qp.period_end
                AND (NOT $3::boolean OR o.rep_id = ANY($4::bigint[]))
            ),
            classified AS (
              SELECT
                *,
                ((' ' || fs || ' ') LIKE '% won %') AS is_won,
                (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %')) AS is_lost,
                ((' ' || fs || ' ') LIKE '% closed %') AS is_closed_kw,
                (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %') AND NOT ((' ' || fs || ' ') LIKE '% loss %') AND NOT ((' ' || fs || ' ') LIKE '% closed %')) AS is_open
              FROM deals
            )
            SELECT
              COALESCE(manager_rep_id::text, '') AS manager_id,
              COALESCE(NULLIF(btrim(manager_name_norm), ''), '(Unassigned)') AS manager_name,
              COALESCE(rep_id::text, '') AS rep_id,
              COALESCE(NULLIF(btrim(rep_name_norm), ''), '(Unknown rep)') AS rep_name,
              COALESCE(SUM(CASE WHEN is_open THEN amount ELSE 0 END), 0)::float8 AS crm_total_amount,
              COALESCE(SUM(CASE WHEN is_open THEN 1 ELSE 0 END), 0)::int AS crm_total_count,
              COALESCE(SUM(CASE WHEN is_open THEN amount ELSE 0 END), 0)::float8 AS verdict_total_amount,
              COALESCE(SUM(CASE WHEN is_open THEN 1 ELSE 0 END), 0)::int AS verdict_total_count
            FROM classified
            GROUP BY COALESCE(manager_rep_id::text, ''), COALESCE(NULLIF(btrim(manager_name_norm), ''), '(Unassigned)'), COALESCE(rep_id::text, ''), COALESCE(NULLIF(btrim(rep_name_norm), ''), '(Unknown rep)')
            ORDER BY manager_name ASC, rep_name ASC
            `,
            [ctx.user.org_id, qpId, useScopedRepIds, scopedRepIds]
          )
          .then((r) => (r.rows || []) as any[]);
      } else {
        throw e;
      }
    }
  }

  const pipelineByRep = (pipelineByRepRows || []).filter((r) => (Number(r.crm_total_count || 0) || 0) > 0 || (Number(r.verdict_total_count || 0) || 0) > 0);

  const pipelineGroups = (() => {
    const byMgr = new Map<string, { manager_id: string; manager_name: string; reps: TotalPipelineByRepRow[] }>();
    for (const r of pipelineByRep) {
      const mid = String(r.manager_id || "");
      const mname = String(r.manager_name || "(Unassigned)");
      const key = mid || "(unassigned)";
      const cur = byMgr.get(key) || { manager_id: mid, manager_name: mname, reps: [] };
      cur.manager_name = mname;
      cur.reps.push(r);
      byMgr.set(key, cur);
    }
    const groups = Array.from(byMgr.values());
    groups.sort((a, b) => a.manager_name.localeCompare(b.manager_name));
    for (const g of groups) g.reps.sort((a, b) => (Number(b.crm_total_amount || 0) - Number(a.crm_total_amount || 0)) || a.rep_name.localeCompare(b.rep_name));
    return groups;
  })();

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Verdict (Sales Forecast vs AI Forecast)</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              CRM Forecast uses <span className="font-mono text-xs">forecast_stage</span> + org probabilities. The Verdict applies a health modifier
              (rules) to each CRM bucket, then weights by the same org probabilities.
            </p>
            <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/analytics/meddpicc-tb">
                MEDDPICC+TB Reports
              </Link>
              {" · "}
              <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/analytics">
                Analytics home
              </Link>
            </div>
          </div>
        </div>

        <VerdictFiltersClient
          basePath="/analytics/meddpicc-tb/verdict"
          periodLabel={qp ? `${qp.period_name} (FY${qp.fiscal_year} Q${qp.fiscal_quarter})` : "—"}
          periods={periods}
          savedReports={(savedReports || []) as any}
          initialQuotaPeriodId={qpId}
          initialSavedReportId={savedRow?.id ? String(savedRow.id) : ""}
        />

        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Sales Forecast vs AI Forecast (summary)</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Rep‑Weighted uses org forecast probabilities. AI‑Weighted uses health score rules (modifier/suppression) applied to CRM buckets, then the same org
            probabilities. No blending.
          </p>

          {(() => {
            const quota = Number(quarterlyQuotaAmount || 0) || 0;
            const won = Number(summary.crm_totals.won || 0) || 0;

            const pctWon = quota > 0 ? won / quota : null;
            const leftWon = quota - won;

            const crmWeighted = summary.weighted.crm.forecast;
            const verdictWeighted = summary.weighted.verdict.forecast;

            const pctCrmWeighted = quota > 0 ? crmWeighted / quota : null;
            const leftCrmWeighted = quota - crmWeighted;

            const pctVerdictWeighted = quota > 0 ? verdictWeighted / quota : null;
            const leftVerdictWeighted = quota - verdictWeighted;

            const totalsGap = {
              commit: summary.crm_totals.commit - summary.verdict_totals.commit,
              best_case: summary.crm_totals.best_case - summary.verdict_totals.best_case,
              pipeline: summary.crm_totals.pipeline - summary.verdict_totals.pipeline,
              total_pipeline:
                (summary.crm_totals.commit + summary.crm_totals.best_case + summary.crm_totals.pipeline) -
                (summary.verdict_totals.commit + summary.verdict_totals.best_case + summary.verdict_totals.pipeline),
            };

            const weightedGap = {
              commit: summary.weighted.crm.commit_weighted - summary.weighted.verdict.commit_weighted,
              best_case: summary.weighted.crm.best_case_weighted - summary.weighted.verdict.best_case_weighted,
              pipeline: summary.weighted.crm.pipeline_weighted - summary.weighted.verdict.pipeline_weighted,
              forecast: summary.forecast_gap,
            };

            const td = "px-3 py-2 align-top";
            const tdNum = `${td} text-right font-mono text-xs`;
            const th = "px-3 py-2 text-left text-xs font-semibold text-[color:var(--sf-text-secondary)]";
            const thR = `${th} text-right`;

            const pctCell = (v: number | null) => (v == null ? "—" : fmtPct(v));
            const money = (v: any) => fmtMoney(v);

            return (
              <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
                <table className="w-full min-w-[1180px] text-left text-sm">
                  <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                    <tr>
                      <th className={th} rowSpan={2}>
                        Row
                      </th>
                      <th className={th} colSpan={4}>
                        CRM Totals
                      </th>
                      <th className={th} colSpan={4}>
                        Quarterly Weighted Forecast
                      </th>
                      <th className={th} colSpan={4}>
                        Targets
                      </th>
                    </tr>
                    <tr>
                      <th className={thR}>Commit</th>
                      <th className={thR}>Best Case</th>
                      <th className={thR}>Pipeline</th>
                      <th className={thR}>Total Pipeline</th>
                      <th className={thR}>Commit Closing</th>
                      <th className={thR}>Best Case Closing</th>
                      <th className={thR}>Pipeline Closing</th>
                      <th className={thR}>Weighted Qtr Closing</th>
                      <th className={thR}>Won</th>
                      <th className={thR}>Quota</th>
                      <th className={thR}>% To Goal</th>
                      <th className={thR}>Left To Go</th>
                    </tr>
                  </thead>
                  <tbody className="text-[color:var(--sf-text-primary)]">
                    <tr className="border-t border-[color:var(--sf-border)]">
                      <td className={td}>
                        <div className="font-medium">CRM Totals</div>
                        <div className="text-xs text-[color:var(--sf-text-secondary)]">From CRM Forecast Stage buckets</div>
                      </td>
                      <td className={tdNum}>{money(summary.crm_totals.commit)}</td>
                      <td className={tdNum}>{money(summary.crm_totals.best_case)}</td>
                      <td className={tdNum}>{money(summary.crm_totals.pipeline)}</td>
                      <td className={tdNum}>{money(summary.crm_totals.commit + summary.crm_totals.best_case + summary.crm_totals.pipeline)}</td>
                      <td className={tdNum}>—</td>
                      <td className={tdNum}>—</td>
                      <td className={tdNum}>—</td>
                      <td className={tdNum}>—</td>
                      <td className={tdNum}>{money(won)}</td>
                      <td className={tdNum}>{money(quota)}</td>
                      <td className={tdNum}>{pctCell(pctWon)}</td>
                      <td className={tdNum}>{money(leftWon)}</td>
                    </tr>

                    <tr className="border-t border-[color:var(--sf-border)]">
                      <td className={td}>
                        <div className="font-medium">CRM Forecast (Rep‑Weighted)</div>
                        <div className="text-xs text-[color:var(--sf-text-secondary)]">Bucket × org %</div>
                      </td>
                      <td className={tdNum}>—</td>
                      <td className={tdNum}>—</td>
                      <td className={tdNum}>—</td>
                      <td className={tdNum}>—</td>
                      <td className={tdNum}>{money(summary.weighted.crm.commit_weighted)}</td>
                      <td className={tdNum}>{money(summary.weighted.crm.best_case_weighted)}</td>
                      <td className={tdNum}>{money(summary.weighted.crm.pipeline_weighted)}</td>
                      <td className={tdNum}>{money(crmWeighted)}</td>
                      <td className={tdNum}>{money(won)}</td>
                      <td className={tdNum}>{money(quota)}</td>
                      <td className={tdNum}>{pctCell(pctCrmWeighted)}</td>
                      <td className={tdNum}>{money(leftCrmWeighted)}</td>
                    </tr>

                    <tr className="border-t border-[color:var(--sf-border)]">
                      <td className={td}>
                        <div className="font-medium">Verdict Forecast (AI‑Weighted)</div>
                        <div className="text-xs text-[color:var(--sf-text-secondary)]">Bucket × AI modifier × org %</div>
                      </td>
                      <td className={tdNum}>{money(summary.verdict_totals.commit)}</td>
                      <td className={tdNum}>{money(summary.verdict_totals.best_case)}</td>
                      <td className={tdNum}>{money(summary.verdict_totals.pipeline)}</td>
                      <td className={tdNum}>{money(summary.verdict_totals.commit + summary.verdict_totals.best_case + summary.verdict_totals.pipeline)}</td>
                      <td className={tdNum}>{money(summary.weighted.verdict.commit_weighted)}</td>
                      <td className={tdNum}>{money(summary.weighted.verdict.best_case_weighted)}</td>
                      <td className={tdNum}>{money(summary.weighted.verdict.pipeline_weighted)}</td>
                      <td className={tdNum}>{money(verdictWeighted)}</td>
                      <td className={tdNum}>{money(won)}</td>
                      <td className={tdNum}>{money(quota)}</td>
                      <td className={tdNum}>{pctCell(pctVerdictWeighted)}</td>
                      <td className={tdNum}>{money(leftVerdictWeighted)}</td>
                    </tr>

                    <tr className="border-t border-[color:var(--sf-border)]">
                      <td className={td}>
                        <div className="font-medium">Forecast Gap (CRM − Verdict)</div>
                        <div className="text-xs text-[color:var(--sf-text-secondary)]">Difference drives coaching</div>
                      </td>
                      <td className={tdNum}>{money(totalsGap.commit)}</td>
                      <td className={tdNum}>{money(totalsGap.best_case)}</td>
                      <td className={tdNum}>{money(totalsGap.pipeline)}</td>
                      <td className={tdNum}>{money(totalsGap.total_pipeline)}</td>
                      <td className={tdNum}>{money(weightedGap.commit)}</td>
                      <td className={tdNum}>{money(weightedGap.best_case)}</td>
                      <td className={tdNum}>{money(weightedGap.pipeline)}</td>
                      <td className={tdNum}>{money(weightedGap.forecast)}</td>
                      <td className={tdNum}>—</td>
                      <td className={tdNum}>—</td>
                      <td className={tdNum}>—</td>
                      <td className={tdNum}>—</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })()}

          <div className="mt-3 text-xs text-[color:var(--sf-text-secondary)]">
            Org forecast probabilities: Commit {fmtPct(orgProb.commit)} · Best Case {fmtPct(orgProb.best_case)} · Pipeline {fmtPct(orgProb.pipeline)} ·
            Health modifiers (amount‑weighted): Commit × {aggAll.commit_modifier.toFixed(2)} · Best Case × {aggAll.best_case_modifier.toFixed(2)} · Pipeline ×{" "}
            {aggAll.pipeline_modifier.toFixed(2)}
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">People comparison (Total Pipeline)</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Rep breakdown grouped by manager. Visibility respects your team scope.
          </p>

          {!pipelineGroups.length ? (
            <div className="mt-4 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 text-sm text-[color:var(--sf-text-secondary)]">
              No open pipeline found for the selected period + filters.
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {pipelineGroups.map((g) => {
                const crmAmt = g.reps.reduce((acc, r) => acc + (Number(r.crm_total_amount || 0) || 0), 0);
                const verdictAmt = g.reps.reduce((acc, r) => acc + (Number(r.verdict_total_amount || 0) || 0), 0);
                const crmCnt = g.reps.reduce((acc, r) => acc + (Number(r.crm_total_count || 0) || 0), 0);
                const verdictCnt = g.reps.reduce((acc, r) => acc + (Number(r.verdict_total_count || 0) || 0), 0);
                const da = verdictAmt - crmAmt;
                const dc = verdictCnt - crmCnt;
                return (
                  <details key={`mgr:${g.manager_id || "unassigned"}`} className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
                    <summary className="cursor-pointer text-sm font-semibold text-[color:var(--sf-text-primary)]">
                      {g.manager_name}{" "}
                      <span className="ml-2 text-xs font-normal text-[color:var(--sf-text-secondary)]">
                        ({g.reps.length} reps) · SF {fmtMoney(crmAmt)} · Verdict {fmtMoney(verdictAmt)}
                      </span>
                    </summary>

                    <div className="mt-3 overflow-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
                      <table className="w-full min-w-[900px] text-left text-sm">
                        <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                          <tr>
                            <th className="px-4 py-3">Rep</th>
                            <th className="px-4 py-3 text-right">Sales Forecast (Total)</th>
                            <th className="px-4 py-3 text-right">Verdict (Total)</th>
                            <th className="px-4 py-3 text-right">Δ Total</th>
                            <th className="px-4 py-3 text-right">Δ # Opps</th>
                            <th className="px-4 py-3">Range</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                            <td className="px-4 py-3 font-semibold text-[color:var(--sf-text-primary)]">Manager total</td>
                            <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(crmAmt)}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(verdictAmt)}</td>
                            <td className={`px-4 py-3 text-right font-mono text-xs font-semibold ${deltaClass(da)}`}>
                              {da === 0 ? "—" : `${da > 0 ? "+" : ""}${fmtMoney(Math.abs(da)).replace("$", "$")}`}
                            </td>
                            <td className={`px-4 py-3 text-right font-mono text-xs font-semibold ${deltaClass(dc)}`}>
                              {dc === 0 ? "—" : `${dc > 0 ? "+" : ""}${fmtNum(Math.abs(dc))}`}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-[color:var(--sf-text-secondary)]">{rangeLabel(crmAmt, verdictAmt)}</td>
                          </tr>

                          {g.reps.map((r) => {
                            const rDa = (Number(r.verdict_total_amount || 0) || 0) - (Number(r.crm_total_amount || 0) || 0);
                            const rDc = (Number(r.verdict_total_count || 0) || 0) - (Number(r.crm_total_count || 0) || 0);
                            return (
                              <tr key={`rep:${g.manager_id}:${r.rep_id}`} className="border-t border-[color:var(--sf-border)]">
                                <td className="px-4 py-3 font-medium text-[color:var(--sf-text-primary)]">{r.rep_name}</td>
                                <td className="px-4 py-3 text-right font-mono text-xs text-[color:var(--sf-text-primary)]">
                                  {fmtMoney(r.crm_total_amount)}{" "}
                                  <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(r.crm_total_count)})</span>
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-xs text-[color:var(--sf-text-primary)]">
                                  {fmtMoney(r.verdict_total_amount)}{" "}
                                  <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(r.verdict_total_count)})</span>
                                </td>
                                <td className={`px-4 py-3 text-right font-mono text-xs ${deltaClass(rDa)}`}>
                                  {rDa === 0 ? "—" : `${rDa > 0 ? "+" : ""}${fmtMoney(Math.abs(rDa)).replace("$", "$")}`}
                                </td>
                                <td className={`px-4 py-3 text-right font-mono text-xs ${deltaClass(rDc)}`}>
                                  {rDc === 0 ? "—" : `${rDc > 0 ? "+" : ""}${fmtNum(Math.abs(rDc))}`}
                                </td>
                                <td className="px-4 py-3 font-mono text-xs text-[color:var(--sf-text-secondary)]">
                                  {rangeLabel(r.crm_total_amount, r.verdict_total_amount)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

