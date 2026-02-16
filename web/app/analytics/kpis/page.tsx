import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { pool } from "../../../lib/pool";
import { UserTopNav } from "../../_components/UserTopNav";
import { ExportToExcelButton } from "../../_components/ExportToExcelButton";
import { getHealthAveragesByPeriods } from "../../../lib/analyticsHealth";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function fmtNum(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString();
}

function healthPctFrom30(score: any) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((n / 30) * 100)));
}

function healthColorClass(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-disabled)]";
  if (pct >= 80) return "text-[#2ECC71]";
  if (pct >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

function safeDiv(n: number, d: number) {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

type QuotaPeriodLite = {
  id: string;
  period_name: string;
  period_start: string;
  period_end: string;
  fiscal_year: string;
  fiscal_quarter: string; // text
};

type RepLite = {
  id: number;
  rep_name: string | null;
  display_name: string | null;
  manager_rep_id: number | null;
  active: boolean | null;
};

type RepPeriodKpisRow = {
  quota_period_id: string;
  period_start: string;
  period_end: string;
  rep_id: string;
  rep_name: string;
  manager_rep_id: string | null;
  manager_name: string | null;
  total_count: number;
  won_count: number;
  lost_count: number;
  active_count: number;
  won_amount: number;
  lost_amount: number;
  active_amount: number;
  commit_count: number;
  best_count: number;
  pipeline_count: number;
  commit_amount: number;
  best_amount: number;
  pipeline_amount: number;
  partner_closed_amount: number;
  partner_won_amount: number;
  closed_amount: number;
  partner_won_count: number;
  partner_closed_count: number;
  partner_closed_days_sum: number;
  partner_closed_days_count: number;
  direct_closed_days_sum: number;
  direct_closed_days_count: number;
  avg_days_won: number | null;
  avg_days_lost: number | null;
  avg_days_active: number | null;
};

type CreatedByRepRow = { quota_period_id: string; rep_id: string; created_amount: number; created_count: number };
type QuotaByRepRow = { quota_period_id: string; rep_id: string; quota_amount: number };
type CreatedPipelineAggRow = {
  quota_period_id: string;
  commit_amount: number;
  commit_count: number;
  commit_health_score: number | null;
  best_amount: number;
  best_count: number;
  best_health_score: number | null;
  pipeline_amount: number;
  pipeline_count: number;
  pipeline_health_score: number | null;
  total_pipeline_health_score: number | null;
  won_count: number;
  won_health_score: number | null;
  lost_count: number;
  lost_health_score: number | null;
};

type CreatedPipelineByRepRow = {
  quota_period_id: string;
  rep_id: string;
  rep_name: string;
  manager_rep_id: string | null;
  manager_name: string | null;
  commit_amount: number;
  commit_count: number;
  best_amount: number;
  best_count: number;
  pipeline_amount: number;
  pipeline_count: number;
  won_amount: number;
  won_count: number;
  lost_amount: number;
  lost_count: number;
};

async function listQuotaPeriodsForOrg(orgId: number): Promise<QuotaPeriodLite[]> {
  const { rows } = await pool.query<QuotaPeriodLite>(
    `
    SELECT
      id::text AS id,
      period_name,
      period_start::text AS period_start,
      period_end::text AS period_end,
      fiscal_year,
      fiscal_quarter::text AS fiscal_quarter
    FROM quota_periods
    WHERE org_id = $1::bigint
    ORDER BY period_start DESC, id DESC
    `,
    [orgId]
  );
  return (rows || []) as any[];
}

async function listRepsForOrg(orgId: number): Promise<RepLite[]> {
  const { rows } = await pool.query<RepLite>(
    `
    SELECT
      id,
      rep_name,
      display_name,
      manager_rep_id,
      active
    FROM reps
    WHERE organization_id = $1
    ORDER BY COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(rep_name), ''), id::text) ASC, id ASC
    `,
    [orgId]
  );
  return (rows || []) as any[];
}

async function managerRepIdForUser(args: { orgId: number; userId: number }) {
  const { rows } = await pool.query<{ id: number }>(
    `
    SELECT r.id
      FROM reps r
     WHERE r.organization_id = $1
       AND r.user_id = $2
     LIMIT 1
    `,
    [args.orgId, args.userId]
  );
  const id = rows?.[0]?.id;
  return Number.isFinite(id) ? Number(id) : null;
}

async function listDirectRepIds(args: { orgId: number; managerRepId: number }): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(
    `
    SELECT r.id
      FROM reps r
     WHERE r.organization_id = $1
       AND r.manager_rep_id = $2
       AND r.active IS TRUE
     ORDER BY r.id ASC
    `,
    [args.orgId, args.managerRepId]
  );
  return (rows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
}

async function getRepKpisByPeriods(args: { orgId: number; periodIds: string[]; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<RepPeriodKpisRow>(
    `
    WITH periods AS (
      SELECT
        id::bigint AS quota_period_id,
        period_start::date AS period_start,
        period_end::date AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = ANY($2::bigint[])
    ),
    base AS (
      SELECT
        p.quota_period_id::text AS quota_period_id,
        p.period_start::text AS period_start,
        p.period_end::text AS period_end,
        o.rep_id::text AS rep_id,
        COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), NULLIF(btrim(o.rep_name), ''), '(Unknown rep)') AS rep_name,
        r.manager_rep_id::text AS manager_rep_id,
        COALESCE(NULLIF(btrim(m.display_name), ''), NULLIF(btrim(m.rep_name), ''), NULL) AS manager_name,
        COALESCE(o.amount, 0)::float8 AS amount,
        o.partner_name,
        o.create_date,
        o.close_date,
        lower(
          regexp_replace(
            COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
            '[^a-zA-Z]+',
            ' ',
            'g'
          )
        ) AS fs,
        p.period_end::timestamptz AS period_end_ts
      FROM periods p
      JOIN opportunities o
        ON o.org_id = $1
       AND o.rep_id IS NOT NULL
       AND o.close_date IS NOT NULL
       AND o.close_date >= p.period_start
       AND o.close_date <= p.period_end
       AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
      LEFT JOIN reps r
        ON r.organization_id = $1
       AND r.id = o.rep_id
      LEFT JOIN reps m
        ON m.organization_id = $1
       AND m.id = r.manager_rep_id
    ),
    classified AS (
      SELECT
        *,
        ((' ' || fs || ' ') LIKE '% won %') AS is_won,
        ((' ' || fs || ' ') LIKE '% lost %') AS is_lost,
        (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) AS is_active,
        CASE
          WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) AND fs LIKE '%commit%' THEN 'commit'
          WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) AND fs LIKE '%best%' THEN 'best'
          WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) THEN 'pipeline'
          WHEN ((' ' || fs || ' ') LIKE '% won %') THEN 'won'
          WHEN ((' ' || fs || ' ') LIKE '% lost %') THEN 'lost'
          ELSE 'other'
        END AS bucket
      FROM base
    )
    SELECT
      quota_period_id,
      period_start,
      period_end,
      rep_id,
      rep_name,
      manager_rep_id,
      manager_name,
      COUNT(*)::int AS total_count,
      COALESCE(SUM(CASE WHEN is_won THEN 1 ELSE 0 END), 0)::int AS won_count,
      COALESCE(SUM(CASE WHEN is_lost THEN 1 ELSE 0 END), 0)::int AS lost_count,
      COALESCE(SUM(CASE WHEN is_active THEN 1 ELSE 0 END), 0)::int AS active_count,
      COALESCE(SUM(CASE WHEN is_won THEN amount ELSE 0 END), 0)::float8 AS won_amount,
      COALESCE(SUM(CASE WHEN is_lost THEN amount ELSE 0 END), 0)::float8 AS lost_amount,
      COALESCE(SUM(CASE WHEN is_active THEN amount ELSE 0 END), 0)::float8 AS active_amount,
      COALESCE(SUM(CASE WHEN bucket = 'commit' THEN 1 ELSE 0 END), 0)::int AS commit_count,
      COALESCE(SUM(CASE WHEN bucket = 'best' THEN 1 ELSE 0 END), 0)::int AS best_count,
      COALESCE(SUM(CASE WHEN bucket = 'pipeline' THEN 1 ELSE 0 END), 0)::int AS pipeline_count,
      COALESCE(SUM(CASE WHEN bucket = 'commit' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
      COALESCE(SUM(CASE WHEN bucket = 'best' THEN amount ELSE 0 END), 0)::float8 AS best_amount,
      COALESCE(SUM(CASE WHEN bucket = 'pipeline' THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
      COALESCE(SUM(CASE WHEN (is_won OR is_lost) AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN amount ELSE 0 END), 0)::float8 AS partner_closed_amount,
      COALESCE(SUM(CASE WHEN is_won AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN amount ELSE 0 END), 0)::float8 AS partner_won_amount,
      COALESCE(SUM(CASE WHEN (is_won OR is_lost) THEN amount ELSE 0 END), 0)::float8 AS closed_amount,
      COALESCE(SUM(CASE WHEN is_won AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN 1 ELSE 0 END), 0)::int AS partner_won_count,
      COALESCE(SUM(CASE WHEN (is_won OR is_lost) AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN 1 ELSE 0 END), 0)::int AS partner_closed_count,
      COALESCE(SUM(
        CASE
          WHEN (is_won OR is_lost) AND partner_name IS NOT NULL AND btrim(partner_name) <> '' AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0
          ELSE 0
        END
      ), 0)::float8 AS partner_closed_days_sum,
      COALESCE(SUM(
        CASE
          WHEN (is_won OR is_lost) AND partner_name IS NOT NULL AND btrim(partner_name) <> '' AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN 1
          ELSE 0
        END
      ), 0)::int AS partner_closed_days_count,
      COALESCE(SUM(
        CASE
          WHEN (is_won OR is_lost) AND (partner_name IS NULL OR btrim(partner_name) = '') AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0
          ELSE 0
        END
      ), 0)::float8 AS direct_closed_days_sum,
      COALESCE(SUM(
        CASE
          WHEN (is_won OR is_lost) AND (partner_name IS NULL OR btrim(partner_name) = '') AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN 1
          ELSE 0
        END
      ), 0)::int AS direct_closed_days_count,
      AVG(
        CASE
          WHEN is_won AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0
          ELSE NULL
        END
      )::float8 AS avg_days_won,
      AVG(
        CASE
          WHEN is_lost AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0
          ELSE NULL
        END
      )::float8 AS avg_days_lost,
      AVG(
        CASE
          WHEN is_active AND create_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (LEAST(NOW(), period_end_ts) - create_date)) / 86400.0
          ELSE NULL
        END
      )::float8 AS avg_days_active
    FROM classified
    GROUP BY
      quota_period_id,
      period_start,
      period_end,
      rep_id,
      rep_name,
      manager_rep_id,
      manager_name
    ORDER BY period_start DESC, won_amount DESC, rep_name ASC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

async function getCreatedByRep(args: { orgId: number; periodIds: string[]; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<CreatedByRepRow>(
    `
    WITH periods AS (
      SELECT
        id::bigint AS quota_period_id,
        period_start::date AS period_start,
        period_end::date AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = ANY($2::bigint[])
    )
    SELECT
      p.quota_period_id::text AS quota_period_id,
      o.rep_id::text AS rep_id,
      COALESCE(SUM(COALESCE(o.amount, 0)), 0)::float8 AS created_amount,
      COUNT(*)::int AS created_count
    FROM periods p
    JOIN opportunities o
      ON o.org_id = $1
     AND o.rep_id IS NOT NULL
     AND o.create_date IS NOT NULL
     AND o.create_date::date >= p.period_start
     AND o.create_date::date <= p.period_end
     AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
    GROUP BY p.quota_period_id, o.rep_id
    ORDER BY p.quota_period_id DESC, created_amount DESC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

async function getCreatedPipelineAggByPeriods(args: { orgId: number; periodIds: string[]; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<CreatedPipelineAggRow>(
    `
    WITH periods AS (
      SELECT
        id::bigint AS quota_period_id,
        period_start::date AS period_start,
        period_end::date AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = ANY($2::bigint[])
    ),
    base AS (
      SELECT
        p.quota_period_id::text AS quota_period_id,
        COALESCE(o.amount, 0)::float8 AS amount,
        o.health_score,
        CASE
          WHEN o.close_date IS NULL THEN NULL
          WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
          WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
            to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'MM/DD/YYYY')
          ELSE NULL
        END AS close_d,
        p.period_start,
        p.period_end,
        lower(
          regexp_replace(
            COALESCE(NULLIF(btrim(o.forecast_stage), ''), NULLIF(btrim(o.sales_stage), ''), ''),
            '[^a-zA-Z]+',
            ' ',
            'g'
          )
        ) AS fs
      FROM periods p
      JOIN opportunities o
        ON o.org_id = $1
       AND o.rep_id IS NOT NULL
       AND o.create_date IS NOT NULL
       AND o.create_date::date >= p.period_start
       AND o.create_date::date <= p.period_end
       AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
    ),
    classified AS (
      SELECT
        *,
        (close_d IS NOT NULL AND close_d >= period_start AND close_d <= period_end) AS closed_in_qtr,
        ((' ' || fs || ' ') LIKE '% won %') AS is_won_word,
        ((' ' || fs || ' ') LIKE '% lost %') AS is_lost_word,
        CASE
          WHEN (close_d IS NOT NULL AND close_d >= period_start AND close_d <= period_end) AND ((' ' || fs || ' ') LIKE '% won %') THEN 'won'
          WHEN (close_d IS NOT NULL AND close_d >= period_start AND close_d <= period_end) AND ((' ' || fs || ' ') LIKE '% lost %') THEN 'lost'
          WHEN NOT (close_d IS NOT NULL AND close_d >= period_start AND close_d <= period_end) AND fs LIKE '%commit%' THEN 'commit'
          WHEN NOT (close_d IS NOT NULL AND close_d >= period_start AND close_d <= period_end) AND fs LIKE '%best%' THEN 'best'
          WHEN NOT (close_d IS NOT NULL AND close_d >= period_start AND close_d <= period_end) THEN 'pipeline'
          ELSE 'other'
        END AS bucket,
        (NOT ((close_d IS NOT NULL AND close_d >= period_start AND close_d <= period_end) AND ((' ' || fs || ' ') LIKE '% won %'))
          AND NOT ((close_d IS NOT NULL AND close_d >= period_start AND close_d <= period_end) AND ((' ' || fs || ' ') LIKE '% lost %'))
        ) AS is_active
      FROM base
    )
    SELECT
      quota_period_id,
      COALESCE(SUM(CASE WHEN is_active AND bucket = 'commit' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
      COALESCE(SUM(CASE WHEN is_active AND bucket = 'commit' THEN 1 ELSE 0 END), 0)::int AS commit_count,
      AVG(CASE WHEN is_active AND bucket = 'commit' THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS commit_health_score,
      COALESCE(SUM(CASE WHEN is_active AND bucket = 'best' THEN amount ELSE 0 END), 0)::float8 AS best_amount,
      COALESCE(SUM(CASE WHEN is_active AND bucket = 'best' THEN 1 ELSE 0 END), 0)::int AS best_count,
      AVG(CASE WHEN is_active AND bucket = 'best' THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS best_health_score,
      COALESCE(SUM(CASE WHEN is_active AND bucket = 'pipeline' THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
      COALESCE(SUM(CASE WHEN is_active AND bucket = 'pipeline' THEN 1 ELSE 0 END), 0)::int AS pipeline_count,
      AVG(CASE WHEN is_active AND bucket = 'pipeline' THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS pipeline_health_score,
      AVG(CASE WHEN is_active THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS total_pipeline_health_score,
      COALESCE(SUM(CASE WHEN bucket = 'won' THEN 1 ELSE 0 END), 0)::int AS won_count,
      AVG(CASE WHEN bucket = 'won' THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS won_health_score,
      COALESCE(SUM(CASE WHEN bucket = 'lost' THEN 1 ELSE 0 END), 0)::int AS lost_count,
      AVG(CASE WHEN bucket = 'lost' THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS lost_health_score
    FROM classified
    GROUP BY quota_period_id
    ORDER BY quota_period_id DESC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

async function getCreatedPipelineByRepByPeriods(args: { orgId: number; periodIds: string[]; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<CreatedPipelineByRepRow>(
    `
    WITH periods AS (
      SELECT
        id::bigint AS quota_period_id,
        period_start::date AS period_start,
        period_end::date AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = ANY($2::bigint[])
    ),
    base AS (
      SELECT
        p.quota_period_id::text AS quota_period_id,
        o.rep_id::text AS rep_id,
        COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), NULLIF(btrim(o.rep_name), ''), '(Unknown rep)') AS rep_name,
        r.manager_rep_id::text AS manager_rep_id,
        COALESCE(NULLIF(btrim(m.display_name), ''), NULLIF(btrim(m.rep_name), ''), NULL) AS manager_name,
        COALESCE(o.amount, 0)::float8 AS amount,
        lower(
          regexp_replace(
            COALESCE(NULLIF(btrim(o.forecast_stage), ''), NULLIF(btrim(o.sales_stage), ''), ''),
            '[^a-zA-Z]+',
            ' ',
            'g'
          )
        ) AS fs,
        CASE
          WHEN o.close_date IS NULL THEN NULL
          WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
          WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
            to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'MM/DD/YYYY')
          ELSE NULL
        END AS close_d,
        p.period_start,
        p.period_end
      FROM periods p
      JOIN opportunities o
        ON o.org_id = $1
       AND o.rep_id IS NOT NULL
       AND o.create_date IS NOT NULL
       AND o.create_date::date >= p.period_start
       AND o.create_date::date <= p.period_end
       AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
      LEFT JOIN reps r
        ON r.organization_id = $1
       AND r.id = o.rep_id
      LEFT JOIN reps m
        ON m.organization_id = $1
       AND m.id = r.manager_rep_id
    ),
    classified AS (
      SELECT
        *,
        (close_d IS NOT NULL AND close_d >= period_start AND close_d <= period_end) AS closed_in_qtr,
        ((' ' || fs || ' ') LIKE '% won %') AS is_won_word,
        ((' ' || fs || ' ') LIKE '% lost %') AS is_lost_word
      FROM base
    )
    SELECT
      quota_period_id,
      rep_id,
      rep_name,
      manager_rep_id,
      manager_name,
      COALESCE(SUM(CASE WHEN NOT closed_in_qtr AND fs LIKE '%commit%' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
      COALESCE(SUM(CASE WHEN NOT closed_in_qtr AND fs LIKE '%commit%' THEN 1 ELSE 0 END), 0)::int AS commit_count,
      COALESCE(SUM(CASE WHEN NOT closed_in_qtr AND fs LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS best_amount,
      COALESCE(SUM(CASE WHEN NOT closed_in_qtr AND fs LIKE '%best%' THEN 1 ELSE 0 END), 0)::int AS best_count,
      COALESCE(SUM(CASE WHEN NOT closed_in_qtr AND NOT (fs LIKE '%commit%') AND NOT (fs LIKE '%best%') THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
      COALESCE(SUM(CASE WHEN NOT closed_in_qtr AND NOT (fs LIKE '%commit%') AND NOT (fs LIKE '%best%') THEN 1 ELSE 0 END), 0)::int AS pipeline_count,
      COALESCE(SUM(CASE WHEN closed_in_qtr AND is_won_word THEN amount ELSE 0 END), 0)::float8 AS won_amount,
      COALESCE(SUM(CASE WHEN closed_in_qtr AND is_won_word THEN 1 ELSE 0 END), 0)::int AS won_count,
      COALESCE(SUM(CASE WHEN closed_in_qtr AND is_lost_word THEN amount ELSE 0 END), 0)::float8 AS lost_amount,
      COALESCE(SUM(CASE WHEN closed_in_qtr AND is_lost_word THEN 1 ELSE 0 END), 0)::int AS lost_count
    FROM classified
    GROUP BY
      quota_period_id,
      rep_id,
      rep_name,
      manager_rep_id,
      manager_name
    ORDER BY quota_period_id DESC, manager_name ASC, rep_name ASC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

async function getQuotaByRep(args: { orgId: number; periodIds: string[]; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<QuotaByRepRow>(
    `
    SELECT
      quota_period_id::text AS quota_period_id,
      rep_id::text AS rep_id,
      COALESCE(SUM(quota_amount), 0)::float8 AS quota_amount
    FROM quotas
    WHERE org_id = $1::bigint
      AND role_level = 3
      AND rep_id IS NOT NULL
      AND quota_period_id = ANY($2::bigint[])
      AND (NOT $4::boolean OR rep_id = ANY($3::bigint[]))
    GROUP BY quota_period_id, rep_id
    ORDER BY quota_period_id DESC, quota_amount DESC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

function dateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function QuarterlyKpisPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "REP") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const yearParam = String(sp(searchParams.fiscal_year) || "").trim();

  const allPeriods = await listQuotaPeriodsForOrg(ctx.user.org_id).catch(() => []);
  const fiscalYears = Array.from(new Set(allPeriods.map((p) => String(p.fiscal_year || "").trim()).filter(Boolean))).sort((a, b) =>
    b.localeCompare(a)
  );

  const today = new Date();
  const todayIso = dateOnly(today);
  const periodContainingToday =
    allPeriods.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;

  const defaultYear = periodContainingToday ? String(periodContainingToday.fiscal_year) : fiscalYears[0] || "";
  const yearToUse = yearParam || defaultYear;

  // Some orgs have quota periods with missing/blank fiscal_year; fall back to calendar year from period_start.
  const periodsForYear = yearToUse
    ? allPeriods.filter((p) => {
        const fy = String((p as any).fiscal_year || "").trim();
        if (fy) return fy === yearToUse;
        const startYear = String((p as any).period_start || "").slice(0, 4);
        return startYear === yearToUse;
      })
    : allPeriods;
  const currentForYear =
    periodsForYear.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;

  const periodsSortedDesc = periodsForYear
    .slice()
    .sort((a, b) => new Date(b.period_start).getTime() - new Date(a.period_start).getTime());

  // Show quarters up through the CURRENT quarter only (no future quarters),
  // and always list the current quarter first.
  const visiblePeriods = (() => {
    if (!periodsSortedDesc.length) return [] as typeof periodsSortedDesc;
    const cur = currentForYear;
    if (!cur) {
      // Fallback: show only periods that have started (by today's date), newest → oldest.
      const todayIso = dateOnly(new Date());
      return periodsSortedDesc.filter((p) => String(p.period_start) <= todayIso);
    }
    const curStart = new Date(cur.period_start).getTime();
    const pastAndCurrent = periodsSortedDesc.filter((p) => new Date(p.period_start).getTime() <= curStart);
    // Ensure current quarter is first, then remaining past quarters newest → oldest.
    const rest = pastAndCurrent
      .filter((p) => String(p.id) !== String(cur.id))
      .sort((a, b) => new Date(b.period_start).getTime() - new Date(a.period_start).getTime());
    return [cur, ...rest];
  })();

  // Scope: Exec/Admin see org; Manager sees direct reports (via reps.manager_rep_id); other non-rep roles treated as org.
  let scopeRepIds: number[] | null = null;
  if (ctx.user.role === "MANAGER") {
    const mgrRepId = await managerRepIdForUser({ orgId: ctx.user.org_id, userId: ctx.user.id });
    scopeRepIds = mgrRepId ? await listDirectRepIds({ orgId: ctx.user.org_id, managerRepId: mgrRepId }).catch(() => []) : [];
  } else {
    scopeRepIds = null;
  }

  const periodIds = visiblePeriods.map((p) => String(p.id)).filter(Boolean);

  const [repKpisRows, createdRows, createdPipelineAggRows, createdPipelineByRepRows, quotaRows, reps, healthAvgRows] = periodIds.length
    ? await Promise.all([
        getRepKpisByPeriods({ orgId: ctx.user.org_id, periodIds, repIds: scopeRepIds }),
        getCreatedByRep({ orgId: ctx.user.org_id, periodIds, repIds: scopeRepIds }),
        getCreatedPipelineAggByPeriods({ orgId: ctx.user.org_id, periodIds, repIds: scopeRepIds }),
        getCreatedPipelineByRepByPeriods({ orgId: ctx.user.org_id, periodIds, repIds: scopeRepIds }),
        getQuotaByRep({ orgId: ctx.user.org_id, periodIds, repIds: scopeRepIds }),
        listRepsForOrg(ctx.user.org_id).catch(() => []),
        getHealthAveragesByPeriods({ orgId: ctx.user.org_id, periodIds, repIds: scopeRepIds }).catch(() => []),
      ])
    : [[], [], [], [], [], [], []];

  const healthByPeriod = new Map<string, any>();
  for (const r of healthAvgRows || []) healthByPeriod.set(String((r as any).quota_period_id), r);

  const partnerWonAmountByPeriod = new Map<string, number>();
  const partnerClosedDaysSumByPeriod = new Map<string, number>();
  const partnerClosedDaysCntByPeriod = new Map<string, number>();
  const directClosedDaysSumByPeriod = new Map<string, number>();
  const directClosedDaysCntByPeriod = new Map<string, number>();
  for (const rr of repKpisRows || []) {
    const pid = String((rr as any).quota_period_id || "");
    if (!pid) continue;
    partnerWonAmountByPeriod.set(pid, (partnerWonAmountByPeriod.get(pid) || 0) + (Number((rr as any).partner_won_amount || 0) || 0));
    partnerClosedDaysSumByPeriod.set(pid, (partnerClosedDaysSumByPeriod.get(pid) || 0) + (Number((rr as any).partner_closed_days_sum || 0) || 0));
    partnerClosedDaysCntByPeriod.set(pid, (partnerClosedDaysCntByPeriod.get(pid) || 0) + (Number((rr as any).partner_closed_days_count || 0) || 0));
    directClosedDaysSumByPeriod.set(pid, (directClosedDaysSumByPeriod.get(pid) || 0) + (Number((rr as any).direct_closed_days_sum || 0) || 0));
    directClosedDaysCntByPeriod.set(pid, (directClosedDaysCntByPeriod.get(pid) || 0) + (Number((rr as any).direct_closed_days_count || 0) || 0));
  }

  const repIdToManagerId = new Map<string, string>();
  const repIdToManagerName = new Map<string, string>();
  const repIdToRepName = new Map<string, string>();
  for (const r of reps) {
    const id = Number(r.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const repName = String(r.display_name || "").trim() || String(r.rep_name || "").trim() || `Rep ${id}`;
    repIdToRepName.set(String(id), repName);
    const mid = r.manager_rep_id == null ? "" : String(r.manager_rep_id);
    repIdToManagerId.set(String(id), mid);
  }

  // Index maps
  const createdByKey = new Map<string, { amount: number; count: number }>();
  for (const r of createdRows) {
    const k = `${String(r.quota_period_id)}|${String(r.rep_id)}`;
    createdByKey.set(k, { amount: Number(r.created_amount || 0) || 0, count: Number(r.created_count || 0) || 0 });
  }

  const createdPipelineAggByPeriod = new Map<string, CreatedPipelineAggRow>();
  for (const r of createdPipelineAggRows || []) {
    const pid = String((r as any).quota_period_id || "");
    if (!pid) continue;
    createdPipelineAggByPeriod.set(pid, r as any);
  }

  const createdPipelineByRepByPeriod = new Map<string, CreatedPipelineByRepRow[]>();
  for (const r of createdPipelineByRepRows || []) {
    const pid = String((r as any).quota_period_id || "");
    if (!pid) continue;
    const list = createdPipelineByRepByPeriod.get(pid) || [];
    list.push(r as any);
    createdPipelineByRepByPeriod.set(pid, list);
  }
  const quotaByKey = new Map<string, number>();
  for (const r of quotaRows) {
    const k = `${String(r.quota_period_id)}|${String(r.rep_id)}`;
    quotaByKey.set(k, Number(r.quota_amount || 0) || 0);
  }

  // Structure: period -> manager -> reps
  type RepRow = {
    rep_id: string;
    rep_name: string;
    quota: number;
    total_count: number;
    won_amount: number;
    won_count: number;
    lost_count: number;
    active_count: number;
    commit_count: number;
    best_count: number;
    pipeline_count: number;
    commit_amount: number;
    best_amount: number;
    pipeline_amount: number;
    active_amount: number;
    win_rate: number | null;
    opp_to_win: number | null;
    attainment: number | null;
    commit_coverage: number | null;
    best_coverage: number | null;
    aov: number | null;
    partner_contribution: number | null;
    partner_win_rate: number | null;
    avg_days_won: number | null;
    avg_days_lost: number | null;
    avg_days_active: number | null;
    created_amount: number;
    created_count: number;
    mix_pipeline: number | null;
    mix_best: number | null;
    mix_commit: number | null;
    mix_won: number | null;
  };
  type ManagerRow = {
    manager_id: string;
    manager_name: string;
    quota: number;
    total_count: number;
    won_amount: number;
    won_count: number;
    lost_count: number;
    pipeline_amount: number;
    active_amount: number;
    commit_amount: number;
    best_amount: number;
    created_amount: number;
    created_count: number;
    partner_closed_amount: number;
    closed_amount: number;
    partner_won_count: number;
    partner_closed_count: number;
    attainment: number | null;
    win_rate: number | null;
    opp_to_win: number | null;
    commit_coverage: number | null;
    best_coverage: number | null;
    aov: number | null;
    partner_contribution: number | null;
    partner_win_rate: number | null;
    mix_pipeline: number | null;
    mix_best: number | null;
    mix_commit: number | null;
    mix_won: number | null;
    avg_days_won: number | null;
    avg_days_lost: number | null;
    avg_days_active: number | null;
    reps: RepRow[];
  };
  type PeriodBlock = {
    period: QuotaPeriodLite;
    is_current: boolean;
    quota_total: number;
    won_amount: number;
    pipeline_value: number;
    win_rate: number | null;
    attainment: number | null;
    aov: number | null;
    created_amount: number;
    managers: ManagerRow[];
  };

  const periodBlocks = new Map<string, PeriodBlock>();

  // Initialize period blocks
  for (const p of visiblePeriods) {
    periodBlocks.set(String(p.id), {
      period: p,
      is_current: !!currentForYear && String(p.id) === String(currentForYear.id),
      quota_total: 0,
      won_amount: 0,
      pipeline_value: 0,
      win_rate: null,
      attainment: null,
      aov: null,
      created_amount: 0,
      managers: [],
    });
  }

  // Aggregation maps
  const mgrAgg = new Map<string, ManagerRow>(); // key: period|manager
  const mgrToReps = new Map<string, RepRow[]>(); // key: period|manager
  const mgrMetaName = new Map<string, string>(); // manager_id->name

  for (const rr of repKpisRows) {
    const pid = String(rr.quota_period_id);
    const rep_id = String(rr.rep_id || "");
    if (!pid || !rep_id) continue;

    const manager_id = rr.manager_rep_id ? String(rr.manager_rep_id) : repIdToManagerId.get(rep_id) || "";
    const manager_name =
      String(rr.manager_name || "").trim() ||
      (manager_id ? repIdToRepName.get(manager_id) || `Manager ${manager_id}` : "(Unassigned)");
    if (manager_id) mgrMetaName.set(manager_id, manager_name);

    const k = `${pid}|${rep_id}`;
    const created = createdByKey.get(k) || { amount: 0, count: 0 };
    const quota = quotaByKey.get(k) || 0;

    const total_count = Number(rr.total_count || 0) || 0;
    const won_amount = Number(rr.won_amount || 0) || 0;
    const won_count = Number(rr.won_count || 0) || 0;
    const lost_count = Number(rr.lost_count || 0) || 0;
    const active_count = Number(rr.active_count || 0) || 0;
    const active_amount = Number(rr.active_amount || 0) || 0;
    const pipeline_amount = Number(rr.pipeline_amount || 0) || 0;
    const commit_count = Number((rr as any).commit_count || 0) || 0;
    const best_count = Number((rr as any).best_count || 0) || 0;
    const pipeline_count = Number((rr as any).pipeline_count || 0) || 0;
    const commit_amount = Number(rr.commit_amount || 0) || 0;
    const best_amount = Number(rr.best_amount || 0) || 0;
    const partner_closed_amount = Number(rr.partner_closed_amount || 0) || 0;
    const closed_amount = Number(rr.closed_amount || 0) || 0;
    const partner_won_count = Number((rr as any).partner_won_count || 0) || 0;
    const partner_closed_count = Number((rr as any).partner_closed_count || 0) || 0;

    const rep_name = String(rr.rep_name || "").trim() || repIdToRepName.get(rep_id) || `Rep ${rep_id}`;
    const win_rate = safeDiv(won_count, won_count + lost_count);
    const opp_to_win = safeDiv(won_count, total_count);
    const attainment = safeDiv(won_amount, quota);
    const commit_coverage = safeDiv(commit_amount, quota);
    const best_coverage = safeDiv(best_amount, quota);
    const aov = safeDiv(won_amount, won_count);
    const partner_contribution = safeDiv(partner_closed_amount, closed_amount);
    const partner_win_rate = safeDiv(partner_won_count, partner_closed_count);
    const mixDen = pipeline_amount + best_amount + commit_amount + won_amount;
    const mix_pipeline = safeDiv(pipeline_amount, mixDen);
    const mix_best = safeDiv(best_amount, mixDen);
    const mix_commit = safeDiv(commit_amount, mixDen);
    const mix_won = safeDiv(won_amount, mixDen);

    const repRow: RepRow = {
      rep_id,
      rep_name,
      quota,
      total_count,
      won_amount,
      won_count,
      lost_count,
      active_count,
      commit_count,
      best_count,
      pipeline_count,
      commit_amount,
      best_amount,
      pipeline_amount,
      active_amount,
      win_rate,
      opp_to_win,
      attainment,
      commit_coverage,
      best_coverage,
      aov,
      partner_contribution,
      partner_win_rate,
      avg_days_won: rr.avg_days_won == null ? null : Number(rr.avg_days_won),
      avg_days_lost: rr.avg_days_lost == null ? null : Number(rr.avg_days_lost),
      avg_days_active: rr.avg_days_active == null ? null : Number(rr.avg_days_active),
      created_amount: created.amount,
      created_count: created.count,
      mix_pipeline,
      mix_best,
      mix_commit,
      mix_won,
    };

    const mgrKey = `${pid}|${manager_id}`;
    const repList = mgrToReps.get(mgrKey) || [];
    repList.push(repRow);
    mgrToReps.set(mgrKey, repList);

    const m = mgrAgg.get(mgrKey) || {
      manager_id,
      manager_name,
      quota: 0,
      total_count: 0,
      won_amount: 0,
      won_count: 0,
      lost_count: 0,
      pipeline_amount: 0,
      active_amount: 0,
      commit_amount: 0,
      best_amount: 0,
      created_amount: 0,
      created_count: 0,
      partner_closed_amount: 0,
      closed_amount: 0,
      partner_won_count: 0,
      partner_closed_count: 0,
      attainment: null,
      win_rate: null,
      opp_to_win: null,
      commit_coverage: null,
      best_coverage: null,
      aov: null,
      partner_contribution: null,
      partner_win_rate: null,
      mix_pipeline: null,
      mix_best: null,
      mix_commit: null,
      mix_won: null,
      avg_days_won: null,
      avg_days_lost: null,
      avg_days_active: null,
      reps: [],
    };
    m.manager_name = manager_name;
    m.quota += quota;
    m.total_count += total_count;
    m.won_amount += won_amount;
    m.won_count += won_count;
    m.lost_count += lost_count;
    m.pipeline_amount += pipeline_amount;
    m.active_amount += active_amount;
    m.commit_amount += commit_amount;
    m.best_amount += best_amount;
    m.created_amount += created.amount;
    m.created_count += created.count;
    m.partner_closed_amount += partner_closed_amount;
    m.closed_amount += closed_amount;
    m.partner_won_count += partner_won_count;
    m.partner_closed_count += partner_closed_count;
    mgrAgg.set(mgrKey, m);
  }

  // Add quota/created-only reps that had no close_date-in-quarter rows (still should appear with quota/created)
  for (const pid of periodIds) {
    // Collect rep_ids from quota and created maps for this period.
    const repIds = new Set<string>();
    for (const k of quotaByKey.keys()) {
      const [p, rid] = k.split("|");
      if (p === pid) repIds.add(rid);
    }
    for (const k of createdByKey.keys()) {
      const [p, rid] = k.split("|");
      if (p === pid) repIds.add(rid);
    }
    for (const rep_id of repIds) {
      // Already included?
      const already = repKpisRows.some((r) => String(r.quota_period_id) === pid && String(r.rep_id) === rep_id);
      if (already) continue;

      const manager_id = repIdToManagerId.get(rep_id) || "";
      const manager_name = manager_id ? repIdToRepName.get(manager_id) || `Manager ${manager_id}` : "(Unassigned)";
      const k = `${pid}|${rep_id}`;
      const created = createdByKey.get(k) || { amount: 0, count: 0 };
      const quota = quotaByKey.get(k) || 0;
      if (created.amount === 0 && quota === 0) continue;

      const rep_name = repIdToRepName.get(rep_id) || `Rep ${rep_id}`;
      const repRow: RepRow = {
        rep_id,
        rep_name,
        quota,
        total_count: 0,
        won_amount: 0,
        won_count: 0,
        lost_count: 0,
        active_count: 0,
        commit_count: 0,
        best_count: 0,
        pipeline_count: 0,
        commit_amount: 0,
        best_amount: 0,
        pipeline_amount: 0,
        active_amount: 0,
        win_rate: null,
        opp_to_win: null,
        attainment: null,
        commit_coverage: null,
        best_coverage: null,
        aov: null,
        partner_contribution: null,
        partner_win_rate: null,
        avg_days_won: null,
        avg_days_lost: null,
        avg_days_active: null,
        created_amount: created.amount,
        created_count: created.count,
        mix_pipeline: null,
        mix_best: null,
        mix_commit: null,
        mix_won: null,
      };
      const mgrKey = `${pid}|${manager_id}`;
      const repList = mgrToReps.get(mgrKey) || [];
      repList.push(repRow);
      mgrToReps.set(mgrKey, repList);

      const m = mgrAgg.get(mgrKey) || {
        manager_id,
        manager_name,
        quota: 0,
        total_count: 0,
        won_amount: 0,
        won_count: 0,
        lost_count: 0,
        pipeline_amount: 0,
        active_amount: 0,
        commit_amount: 0,
        best_amount: 0,
        created_amount: 0,
        created_count: 0,
        partner_closed_amount: 0,
        closed_amount: 0,
        partner_won_count: 0,
        partner_closed_count: 0,
        attainment: null,
        win_rate: null,
        opp_to_win: null,
        commit_coverage: null,
        best_coverage: null,
        aov: null,
        partner_contribution: null,
        partner_win_rate: null,
        mix_pipeline: null,
        mix_best: null,
        mix_commit: null,
        mix_won: null,
        avg_days_won: null,
        avg_days_lost: null,
        avg_days_active: null,
        reps: [],
      };
      m.manager_name = manager_name;
      m.quota += quota;
      m.created_amount += created.amount;
      m.created_count += created.count;
      mgrAgg.set(mgrKey, m);
    }
  }

  // Finalize blocks: compute manager rows, sort reps by closed won, then managers.
  for (const pid of periodIds) {
    const block = periodBlocks.get(pid);
    if (!block) continue;
    const managers: ManagerRow[] = [];
    for (const [mgrKey, m] of mgrAgg.entries()) {
      const [p] = mgrKey.split("|");
      if (p !== pid) continue;

      const reps = (mgrToReps.get(mgrKey) || []).slice().sort((a, b) => b.won_amount - a.won_amount || a.rep_name.localeCompare(b.rep_name));
      m.reps = reps;
      m.attainment = safeDiv(m.won_amount, m.quota);
      m.win_rate = safeDiv(m.won_count, m.won_count + m.lost_count);
      m.opp_to_win = safeDiv(m.won_count, m.total_count);
      m.commit_coverage = safeDiv(m.commit_amount, m.quota);
      m.best_coverage = safeDiv(m.best_amount, m.quota);
      m.aov = safeDiv(m.won_amount, m.won_count);
      m.partner_contribution = safeDiv(m.partner_closed_amount, m.closed_amount);
      m.partner_win_rate = safeDiv(m.partner_won_count, m.partner_closed_count);
      const mixDen = m.pipeline_amount + m.best_amount + m.commit_amount + m.won_amount;
      m.mix_pipeline = safeDiv(m.pipeline_amount, mixDen);
      m.mix_best = safeDiv(m.best_amount, mixDen);
      m.mix_commit = safeDiv(m.commit_amount, mixDen);
      m.mix_won = safeDiv(m.won_amount, mixDen);

      // Weighted cycle metrics from rep rows (approximate but stable).
      let wonDaysSum = 0;
      let wonCnt = 0;
      let lostDaysSum = 0;
      let lostCnt = 0;
      let activeDaysSum = 0;
      let activeCnt = 0;
      for (const r of reps) {
        if (r.avg_days_won != null && r.won_count > 0) {
          wonDaysSum += r.avg_days_won * r.won_count;
          wonCnt += r.won_count;
        }
        if (r.avg_days_lost != null && r.lost_count > 0) {
          lostDaysSum += r.avg_days_lost * r.lost_count;
          lostCnt += r.lost_count;
        }
        if (r.avg_days_active != null && r.active_count > 0) {
          activeDaysSum += r.avg_days_active * r.active_count;
          activeCnt += r.active_count;
        }
      }
      m.avg_days_won = wonCnt ? wonDaysSum / wonCnt : null;
      m.avg_days_lost = lostCnt ? lostDaysSum / lostCnt : null;
      m.avg_days_active = activeCnt ? activeDaysSum / activeCnt : null;
      managers.push(m);
    }
    managers.sort((a, b) => b.won_amount - a.won_amount || (Number(b.attainment ?? -1) - Number(a.attainment ?? -1)) || a.manager_name.localeCompare(b.manager_name));

    // Compute period totals from manager totals.
    const quota_total = managers.reduce((acc, m) => acc + (Number(m.quota || 0) || 0), 0);
    const won_amount = managers.reduce((acc, m) => acc + (Number(m.won_amount || 0) || 0), 0);
    const won_count = managers.reduce((acc, m) => acc + (Number(m.won_count || 0) || 0), 0);
    const lost_count = managers.reduce((acc, m) => acc + (Number(m.lost_count || 0) || 0), 0);
    const pipeline_value = managers.reduce((acc, m) => acc + (Number(m.active_amount || 0) || 0), 0);
    const created_amount = managers.reduce((acc, m) => acc + (Number(m.created_amount || 0) || 0), 0);

    block.quota_total = quota_total;
    block.won_amount = won_amount;
    block.pipeline_value = pipeline_value;
    block.win_rate = safeDiv(won_count, won_count + lost_count);
    block.attainment = safeDiv(won_amount, quota_total);
    block.aov = safeDiv(won_amount, won_count);
    block.created_amount = created_amount;
    block.managers = managers;
  }

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">KPIs by quarter</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Select a fiscal year to see the current quarter first, then prior quarters. Reps are always sorted by Closed Won (desc).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/analytics" className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
              Analytics home
            </Link>
          </div>
        </div>

        <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Filters</h2>
          <form method="GET" action="/analytics/kpis" className="mt-3 flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Fiscal Year</label>
              <select
                name="fiscal_year"
                defaultValue={yearToUse}
                className="w-[180px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                {fiscalYears.map((fy) => (
                  <option key={fy} value={fy}>
                    {fy}
                  </option>
                ))}
              </select>
            </div>
            <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
              Apply
            </button>
          </form>
        </section>

        {!visiblePeriods.length ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <p className="text-sm text-[color:var(--sf-text-secondary)]">No quota periods found for this fiscal year.</p>
          </section>
        ) : (
          <div className="mt-5 grid gap-4">
            {visiblePeriods.map((p) => {
              const block = periodBlocks.get(String(p.id))!;
              const summaryLabel = `${p.period_name} (FY${p.fiscal_year} Q${p.fiscal_quarter})`;
              const quotaTotal = block.managers.reduce((acc, m) => acc + (Number(m.quota || 0) || 0), 0);
              const wonAmountTotal = block.managers.reduce((acc, m) => acc + (Number(m.won_amount || 0) || 0), 0);
              const wonCountTotal = block.managers.reduce((acc, m) => acc + (Number(m.won_count || 0) || 0), 0);
              const lostCountTotal = block.managers.reduce((acc, m) => acc + (Number(m.lost_count || 0) || 0), 0);
              const totalCountTotal = block.managers.reduce((acc, m) => acc + (Number(m.total_count || 0) || 0), 0);
              const commitTotal = block.managers.reduce((acc, m) => acc + (Number(m.commit_amount || 0) || 0), 0);
              const bestTotal = block.managers.reduce((acc, m) => acc + (Number(m.best_amount || 0) || 0), 0);
              const pipelineTotal = block.managers.reduce((acc, m) => acc + (Number(m.pipeline_amount || 0) || 0), 0);
              const partnerClosedAmtTotal = block.managers.reduce((acc, m) => acc + (Number(m.partner_closed_amount || 0) || 0), 0);
              const closedAmtTotal = block.managers.reduce((acc, m) => acc + (Number(m.closed_amount || 0) || 0), 0);
              const partnerWonCountTotal = block.managers.reduce((acc, m) => acc + (Number(m.partner_won_count || 0) || 0), 0);
              const partnerClosedCountTotal = block.managers.reduce((acc, m) => acc + (Number(m.partner_closed_count || 0) || 0), 0);

              const quotaAttainment = safeDiv(wonAmountTotal, quotaTotal);
              const winRate = safeDiv(wonCountTotal, wonCountTotal + lostCountTotal);
              const oppToWin = safeDiv(wonCountTotal, totalCountTotal);
              const commitCov = safeDiv(commitTotal, quotaTotal);
              const bestCov = safeDiv(bestTotal, quotaTotal);
              const partnerPct = safeDiv(partnerClosedAmtTotal, closedAmtTotal);
              const partnerWin = safeDiv(partnerWonCountTotal, partnerClosedCountTotal);
              const mixDen = pipelineTotal + bestTotal + commitTotal + wonAmountTotal;
              const mixStr = `${fmtPct(safeDiv(pipelineTotal, mixDen))} / ${fmtPct(safeDiv(bestTotal, mixDen))} / ${fmtPct(
                safeDiv(commitTotal, mixDen)
              )} / ${fmtPct(safeDiv(wonAmountTotal, mixDen))}`;

              // Aging (avg deal age): weighted avg of rep active-age by active deal count.
              let agingDaysSum = 0;
              let agingCnt = 0;
              for (const m of block.managers) {
                for (const r of m.reps || []) {
                  if (r.avg_days_active != null && r.active_count > 0) {
                    agingDaysSum += r.avg_days_active * r.active_count;
                    agingCnt += r.active_count;
                  }
                }
              }
              const agingAvgDays = agingCnt ? agingDaysSum / agingCnt : null;

              const health = healthByPeriod.get(String(p.id)) || null;
              const hAll = healthPctFrom30(health?.avg_health_all);
              const hCommit = healthPctFrom30(health?.avg_health_commit);
              const hBest = healthPctFrom30(health?.avg_health_best);
              const hPipe = healthPctFrom30(health?.avg_health_pipeline);
              const hWon = healthPctFrom30(health?.avg_health_won);
              const hLost = healthPctFrom30(health?.avg_health_lost);
              const hClosed = healthPctFrom30(health?.avg_health_closed);

              const managerExportRows = block.managers.map((m) => ({
                manager: m.manager_name,
                quota: m.quota,
                won_amount: m.won_amount,
                won_count: m.won_count,
                attainment_pct: m.attainment == null ? "" : Math.round(m.attainment * 100),
                commit_coverage_pct: m.commit_coverage == null ? "" : Math.round(m.commit_coverage * 100),
                best_coverage_pct: m.best_coverage == null ? "" : Math.round(m.best_coverage * 100),
                pipeline_amount: m.active_amount,
                win_rate_pct: m.win_rate == null ? "" : Math.round(m.win_rate * 100),
                opp_to_win_pct: m.opp_to_win == null ? "" : Math.round(m.opp_to_win * 100),
                aov: m.aov == null ? "" : m.aov,
                partner_contribution_pct: m.partner_contribution == null ? "" : Math.round(m.partner_contribution * 100),
                partner_win_rate_pct: m.partner_win_rate == null ? "" : Math.round(m.partner_win_rate * 100),
                new_pipeline_amount: m.created_amount,
                new_pipeline_count: m.created_count,
                cycle_won_days: m.avg_days_won == null ? "" : Math.round(m.avg_days_won),
                cycle_lost_days: m.avg_days_lost == null ? "" : Math.round(m.avg_days_lost),
                aging_days: m.avg_days_active == null ? "" : Math.round(m.avg_days_active),
                mix: `${fmtPct(m.mix_pipeline)} / ${fmtPct(m.mix_best)} / ${fmtPct(m.mix_commit)} / ${fmtPct(m.mix_won)}`,
              }));
              const repExportRows = block.managers.flatMap((m) =>
                (m.reps || []).map((r) => ({
                  manager: m.manager_name,
                  rep: r.rep_name,
                  quota: r.quota,
                  won_amount: r.won_amount,
                  won_count: r.won_count,
                  attainment_pct: r.attainment == null ? "" : Math.round(r.attainment * 100),
                  commit_coverage_pct: r.commit_coverage == null ? "" : Math.round(r.commit_coverage * 100),
                  best_coverage_pct: r.best_coverage == null ? "" : Math.round(r.best_coverage * 100),
                  pipeline_amount: r.active_amount,
                  win_rate_pct: r.win_rate == null ? "" : Math.round(r.win_rate * 100),
                  opp_to_win_pct: r.opp_to_win == null ? "" : Math.round(r.opp_to_win * 100),
                  aov: r.aov == null ? "" : r.aov,
                  partner_contribution_pct: r.partner_contribution == null ? "" : Math.round(r.partner_contribution * 100),
                  partner_win_rate_pct: r.partner_win_rate == null ? "" : Math.round(r.partner_win_rate * 100),
                  new_pipeline_amount: r.created_amount,
                  new_pipeline_count: r.created_count,
                  cycle_won_days: r.avg_days_won == null ? "" : Math.round(r.avg_days_won),
                  cycle_lost_days: r.avg_days_lost == null ? "" : Math.round(r.avg_days_lost),
                  aging_days: r.avg_days_active == null ? "" : Math.round(r.avg_days_active),
                  mix: `${fmtPct(r.mix_pipeline)} / ${fmtPct(r.mix_best)} / ${fmtPct(r.mix_commit)} / ${fmtPct(r.mix_won)}`,
                }))
              );
              return (
                <section key={p.id} className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
                        {summaryLabel}{" "}
                        {block.is_current ? <span className="ml-2 rounded bg-[color:var(--sf-surface-alt)] px-2 py-0.5 text-xs">Current</span> : null}
                      </div>
                      <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                        {p.period_start} → {p.period_end}
                      </div>
                    </div>
                  </div>

                  {(() => {
                    const closedCount = wonCountTotal + lostCountTotal;
                    const directClosedCount = Math.max(0, closedCount - partnerClosedCountTotal);
                    const directWonCount = Math.max(0, wonCountTotal - partnerWonCountTotal);

                    const directClosedAmt = closedAmtTotal - partnerClosedAmtTotal;

                    const partnerWonAmt = partnerWonAmountByPeriod.get(String(p.id)) || 0;
                    const directWonAmt = wonAmountTotal - partnerWonAmt;

                    const directAov = safeDiv(directWonAmt, directWonCount);
                    const partnerAov = safeDiv(partnerWonAmt, partnerWonCountTotal);

                    const partnerAge = safeDiv(partnerClosedDaysSumByPeriod.get(String(p.id)) || 0, partnerClosedDaysCntByPeriod.get(String(p.id)) || 0);
                    const directAge = safeDiv(directClosedDaysSumByPeriod.get(String(p.id)) || 0, directClosedDaysCntByPeriod.get(String(p.id)) || 0);

                    const mixDenCBP = commitTotal + bestTotal + pipelineTotal;
                    const mixCBP = `${fmtPct(safeDiv(commitTotal, mixDenCBP))} / ${fmtPct(safeDiv(bestTotal, mixDenCBP))} / ${fmtPct(safeDiv(pipelineTotal, mixDenCBP))}`;
                    const healthByBuckets = `C ${hCommit == null ? "—" : `${hCommit}%`} · B ${hBest == null ? "—" : `${hBest}%`} · P ${hPipe == null ? "—" : `${hPipe}%`} · W ${hWon == null ? "—" : `${hWon}%`} · Cl ${hClosed == null ? "—" : `${hClosed}%`}`;

                    const Chip = (props: { label: string; value: ReactNode; sub?: ReactNode }) => (
                      <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                        <div className="text-[color:var(--sf-text-secondary)]">{props.label}</div>
                        <div className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{props.value}</div>
                        {props.sub ? <div className="mt-0.5 text-[11px] text-[color:var(--sf-text-secondary)]">{props.sub}</div> : null}
                      </div>
                    );

                    return (
                      <div className="mt-4 grid gap-3">
                        <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                          <div className="text-xs font-semibold text-[color:var(--sf-text-primary)]">Sales Forecast</div>
                          {(() => {
                            let commitCount = 0;
                            let bestCount = 0;
                            let pipelineCount = 0;
                            for (const m of block.managers) {
                              for (const r of m.reps || []) {
                                commitCount += Number((r as any).commit_count || 0) || 0;
                                bestCount += Number((r as any).best_count || 0) || 0;
                                pipelineCount += Number((r as any).pipeline_count || 0) || 0;
                              }
                            }
                            const totalPipelineCount = commitCount + bestCount + pipelineCount;
                            const totalPipelineAmt = commitTotal + bestTotal + pipelineTotal;
                            const pctToGoal = quotaTotal > 0 ? wonAmountTotal / quotaTotal : null;

                            const boxClass =
                              "min-w-0 overflow-hidden rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-2";

                            const cards = [
                              { key: "commit", label: "Commit", amount: commitTotal, count: commitCount },
                              { key: "best", label: "Best Case", amount: bestTotal, count: bestCount },
                              { key: "pipe", label: "Pipeline", amount: pipelineTotal, count: pipelineCount },
                              { key: "total", label: "Total Pipeline", amount: totalPipelineAmt, count: totalPipelineCount },
                              { key: "won", label: "Closed Won", amount: wonAmountTotal, count: wonCountTotal },
                            ].filter((c) => !(Number(c.amount || 0) === 0 && Number(c.count || 0) === 0));

                            return (
                              <div className="mt-2 grid w-full max-w-full gap-2 text-sm grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
                                {cards.map((c) => (
                                  <div key={c.key} className={boxClass}>
                                    <div className="text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">{c.label}</div>
                                    <div className="mt-0.5 truncate font-mono text-xs font-semibold leading-tight text-[color:var(--sf-text-primary)]">
                                      {fmtMoney(c.amount)}
                                    </div>
                                    <div className="mt-0.5 text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">
                                      # Opps: {fmtNum(c.count)}
                                    </div>
                                  </div>
                                ))}
                                <div className={boxClass}>
                                  <div className="text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">Quarterly Quota</div>
                                  <div className="mt-0.5 truncate font-mono text-xs font-semibold leading-tight text-[color:var(--sf-text-primary)]">
                                    {fmtMoney(quotaTotal)}
                                  </div>
                                  <div className="mt-0.5 text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">&nbsp;</div>
                                </div>
                                <div className={boxClass}>
                                  <div className="text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">% To Goal</div>
                                  <div className="mt-0.5 truncate font-mono text-xs font-semibold leading-tight text-[color:var(--sf-text-primary)]">
                                    {fmtPct(pctToGoal)}
                                  </div>
                                  <div className="mt-0.5 text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">&nbsp;</div>
                                </div>

                                <div className="col-span-full">
                                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                    <Chip label="Win Rate" value={fmtPct(winRate)} />
                                    <Chip label="Average Order Value" value={fmtMoney(block.aov)} />
                                    <Chip
                                      label="Avg Health Closed Won"
                                      value={<span className={healthColorClass(hWon)}>{hWon == null ? "—" : `${hWon}%`}</span>}
                                    />
                                    <Chip
                                      label="Avg Health Closed Loss"
                                      value={<span className={healthColorClass(hLost)}>{hLost == null ? "—" : `${hLost}%`}</span>}
                                    />
                                    <Chip label="Opp→Win Conversion" value={fmtPct(oppToWin)} />
                                    <Chip label="Aging (avg deal age)" value={agingAvgDays == null ? "—" : `${Math.round(agingAvgDays)}d`} />
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                          <div className="text-xs font-semibold text-[color:var(--sf-text-primary)]">Core KPIs</div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <Chip label="Win Loss" value={`${fmtNum(wonCountTotal)} / ${fmtNum(lostCountTotal)}`} sub="Won / Lost (count)" />
                            <Chip label="Quota Attainment" value={fmtPct(quotaAttainment)} />
                            <Chip label="Closed Won" value={fmtMoney(block.won_amount)} sub={`Deals: ${fmtNum(wonCountTotal)}`} />
                            <Chip label="Direct Vs. Partner" value={`${fmtMoney(directClosedAmt)} / ${fmtMoney(partnerClosedAmtTotal)}`} sub="Direct / Partner (closed $)" />
                          </div>
                        </div>

                        <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                          <div className="text-xs font-semibold text-[color:var(--sf-text-primary)]">Direct vs Partner</div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <Chip label="# Direct Deals" value={fmtNum(directClosedCount)} />
                            <Chip label="Direct AOV" value={directAov == null ? "—" : fmtMoney(directAov)} />
                            <Chip label="Direct Average Age" value={directAge == null ? "—" : `${Math.round(directAge)}d`} />
                            <Chip label="Partner Contribution %" value={fmtPct(partnerPct)} />
                            <Chip label="# Partner Deals" value={fmtNum(partnerClosedCountTotal)} />
                            <Chip label="Partner AOV" value={partnerAov == null ? "—" : fmtMoney(partnerAov)} />
                            <Chip label="Partner Average Age" value={partnerAge == null ? "—" : `${Math.round(partnerAge)}d`} />
                            <Chip label="Partner Win Rate" value={fmtPct(partnerWin)} />
                          </div>
                        </div>

                        <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                          <div className="text-xs font-semibold text-[color:var(--sf-text-primary)]">Pipeline created in quarter</div>
                          {(() => {
                            const createdAgg =
                              createdPipelineAggByPeriod.get(String(p.id)) ||
                              ({
                                quota_period_id: String(p.id),
                                commit_amount: 0,
                                commit_count: 0,
                                commit_health_score: null,
                                best_amount: 0,
                                best_count: 0,
                                best_health_score: null,
                                pipeline_amount: 0,
                                pipeline_count: 0,
                                pipeline_health_score: null,
                                total_pipeline_health_score: null,
                                won_count: 0,
                                won_health_score: null,
                                lost_count: 0,
                                lost_health_score: null,
                              } as CreatedPipelineAggRow);

                            const cAmt = Number(createdAgg.commit_amount || 0) || 0;
                            const bAmt = Number(createdAgg.best_amount || 0) || 0;
                            const pAmt = Number(createdAgg.pipeline_amount || 0) || 0;
                            const tAmt = cAmt + bAmt + pAmt;

                            const cCnt = Number(createdAgg.commit_count || 0) || 0;
                            const bCnt = Number(createdAgg.best_count || 0) || 0;
                            const pCnt = Number(createdAgg.pipeline_count || 0) || 0;
                            const tCnt = cCnt + bCnt + pCnt;

                            const mixCommit = safeDiv(cAmt, tAmt);
                            const mixBest = safeDiv(bAmt, tAmt);
                            const mixPipeline = safeDiv(pAmt, tAmt);

                            const hc = healthPctFrom30(createdAgg.commit_health_score);
                            const hb = healthPctFrom30(createdAgg.best_health_score);
                            const hp = healthPctFrom30(createdAgg.pipeline_health_score);
                            const ht = healthPctFrom30(createdAgg.total_pipeline_health_score);
                            const hw = healthPctFrom30(createdAgg.won_health_score);
                            const hl = healthPctFrom30(createdAgg.lost_health_score);

                            const Card = (props: { label: string; value: ReactNode; sub?: ReactNode }) => (
                              <div className="min-w-0 overflow-hidden rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-2">
                                <div className="text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">{props.label}</div>
                                <div className="mt-0.5 truncate font-mono text-xs font-semibold leading-tight text-[color:var(--sf-text-primary)]">
                                  {props.value}
                                </div>
                                {props.sub ? <div className="mt-0.5 text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">{props.sub}</div> : null}
                              </div>
                            );

                            return (
                              <div className="mt-2 grid w-full max-w-full gap-2">
                                <div className="text-[11px] font-semibold text-[color:var(--sf-text-primary)]">Forecast Mix</div>
                                <div className="grid w-full max-w-full gap-2 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                                  <Card
                                    label={`Commit (${fmtPct(mixCommit)})`}
                                    value={fmtMoney(cAmt)}
                                    sub={
                                      <>
                                        <div># Opps: {fmtNum(cCnt)}</div>
                                        <div>
                                          Health: <span className={healthColorClass(hc)}>{hc == null ? "—" : `${hc}%`}</span>
                                        </div>
                                      </>
                                    }
                                  />
                                  <Card
                                    label={`Best Case (${fmtPct(mixBest)})`}
                                    value={fmtMoney(bAmt)}
                                    sub={
                                      <>
                                        <div># Opps: {fmtNum(bCnt)}</div>
                                        <div>
                                          Health: <span className={healthColorClass(hb)}>{hb == null ? "—" : `${hb}%`}</span>
                                        </div>
                                      </>
                                    }
                                  />
                                  <Card
                                    label={`Pipeline (${fmtPct(mixPipeline)})`}
                                    value={fmtMoney(pAmt)}
                                    sub={
                                      <>
                                        <div># Opps: {fmtNum(pCnt)}</div>
                                        <div>
                                          Health: <span className={healthColorClass(hp)}>{hp == null ? "—" : `${hp}%`}</span>
                                        </div>
                                      </>
                                    }
                                  />
                                  <Card
                                    label="Total Pipeline"
                                    value={fmtMoney(tAmt)}
                                    sub={
                                      <>
                                        <div># Opps: {fmtNum(tCnt)}</div>
                                        <div>
                                          Health: <span className={healthColorClass(ht)}>{ht == null ? "—" : `${ht}%`}</span>
                                        </div>
                                      </>
                                    }
                                  />
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })()}

                  <details open={block.is_current} className="mt-4 flex flex-col">
                    <summary className="order-2 mt-3 cursor-pointer rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-medium text-[color:var(--sf-text-primary)]">
                      New Pipeline Created In Quarter (show / hide)
                    </summary>
                    {(() => {
                      const rows = createdPipelineByRepByPeriod.get(String(p.id)) || [];
                      const byManager = new Map<string, { managerName: string; reps: CreatedPipelineByRepRow[] }>();
                      for (const r of rows) {
                        const mid = String(r.manager_rep_id || "");
                        const mname = String(r.manager_name || "").trim() || (mid ? `Manager ${mid}` : "(Unassigned)");
                        const key = mid || "(unassigned)";
                        const cur = byManager.get(key) || { managerName: mname, reps: [] };
                        cur.managerName = mname;
                        cur.reps.push(r);
                        byManager.set(key, cur);
                      }

                      const managers = Array.from(byManager.entries())
                        .map(([managerId, v]) => ({ managerId, managerName: v.managerName, reps: v.reps }))
                        .sort((a, b) => a.managerName.localeCompare(b.managerName));

                      const sumMoney = (list: CreatedPipelineByRepRow[], key: keyof CreatedPipelineByRepRow) =>
                        list.reduce((acc, r) => acc + (Number((r as any)[key] || 0) || 0), 0);
                      const sumCount = (list: CreatedPipelineByRepRow[], key: keyof CreatedPipelineByRepRow) =>
                        list.reduce((acc, r) => acc + (Number((r as any)[key] || 0) || 0), 0);

                      return (
                        <div className="order-1 mt-3 max-w-full overflow-x-auto rounded-md border border-[color:var(--sf-border)]">
                          <table className="w-full table-fixed text-left text-[11px] text-[color:var(--sf-text-primary)]">
                            <thead className="bg-[color:var(--sf-surface-alt)] text-[11px] text-[color:var(--sf-text-secondary)]">
                              <tr>
                                <th className="w-[220px] px-2 py-2">manager</th>
                                <th className="px-2 py-2 text-right">commit</th>
                                <th className="px-2 py-2 text-right">best</th>
                                <th className="px-2 py-2 text-right">pipeline</th>
                                <th className="px-2 py-2 text-right">total</th>
                                <th className="px-2 py-2 text-right">won</th>
                                <th className="px-2 py-2 text-right">lost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {managers.length ? (
                                managers.map((m) => {
                                  const reps = m.reps.slice().sort((a, b) => a.rep_name.localeCompare(b.rep_name));
                                  const cAmt = sumMoney(reps, "commit_amount");
                                  const bAmt = sumMoney(reps, "best_amount");
                                  const pAmt = sumMoney(reps, "pipeline_amount");
                                  const tAmt = cAmt + bAmt + pAmt;
                                  const cCnt = sumCount(reps, "commit_count");
                                  const bCnt = sumCount(reps, "best_count");
                                  const pCnt = sumCount(reps, "pipeline_count");
                                  const tCnt = cCnt + bCnt + pCnt;
                                  const wAmt = sumMoney(reps, "won_amount");
                                  const wCnt = sumCount(reps, "won_count");
                                  const lAmt = sumMoney(reps, "lost_amount");
                                  const lCnt = sumCount(reps, "lost_count");

                                  return (
                                    <Fragment key={`${p.id}:${m.managerId}`}>
                                      <tr className="border-t border-[color:var(--sf-border)] align-top">
                                        <td className="w-[220px] max-w-[220px] truncate px-2 py-2 font-medium">{m.managerName}</td>
                                        <td className="px-2 py-2 text-right font-mono text-[11px] whitespace-nowrap">
                                          {fmtMoney(cAmt)} <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(cCnt)})</span>
                                        </td>
                                        <td className="px-2 py-2 text-right font-mono text-[11px] whitespace-nowrap">
                                          {fmtMoney(bAmt)} <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(bCnt)})</span>
                                        </td>
                                        <td className="px-2 py-2 text-right font-mono text-[11px] whitespace-nowrap">
                                          {fmtMoney(pAmt)} <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(pCnt)})</span>
                                        </td>
                                        <td className="px-2 py-2 text-right font-mono text-[11px] whitespace-nowrap">
                                          {fmtMoney(tAmt)} <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(tCnt)})</span>
                                        </td>
                                        <td className="px-2 py-2 text-right font-mono text-[11px] whitespace-nowrap">
                                          {fmtMoney(wAmt)} <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(wCnt)})</span>
                                        </td>
                                        <td className="px-2 py-2 text-right font-mono text-[11px] whitespace-nowrap">
                                          {fmtMoney(lAmt)} <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(lCnt)})</span>
                                        </td>
                                      </tr>
                                      <tr className="border-t border-[color:var(--sf-border)]">
                                        <td colSpan={7} className="px-2 py-2">
                                          <details className="flex flex-col">
                                            <summary className="order-2 mt-2 cursor-pointer rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-2 py-1.5 text-xs text-[color:var(--sf-text-primary)]">
                                              Show / hide reps (created in quarter)
                                            </summary>
                                            <div className="order-1 mt-2 max-w-full overflow-x-auto rounded-md border border-[color:var(--sf-border)]">
                                              <table className="w-full table-fixed text-left text-[11px] text-[color:var(--sf-text-primary)]">
                                                <thead className="bg-[color:var(--sf-surface-alt)] text-[11px] text-[color:var(--sf-text-secondary)]">
                                                  <tr>
                                                    <th className="w-[220px] px-2 py-2">rep</th>
                                                    <th className="px-2 py-2 text-right">commit</th>
                                                    <th className="px-2 py-2 text-right">best</th>
                                                    <th className="px-2 py-2 text-right">pipeline</th>
                                                    <th className="px-2 py-2 text-right">total</th>
                                                    <th className="px-2 py-2 text-right">won</th>
                                                    <th className="px-2 py-2 text-right">lost</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {reps.map((r) => {
                                                    const rc = Number(r.commit_amount || 0) || 0;
                                                    const rb = Number(r.best_amount || 0) || 0;
                                                    const rp = Number(r.pipeline_amount || 0) || 0;
                                                    const rt = rc + rb + rp;
                                                    const rcc = Number(r.commit_count || 0) || 0;
                                                    const rbc = Number(r.best_count || 0) || 0;
                                                    const rpc = Number(r.pipeline_count || 0) || 0;
                                                    const rtc = rcc + rbc + rpc;

                                                    return (
                                                      <tr key={`${p.id}:${m.managerId}:${r.rep_id}`} className="border-t border-[color:var(--sf-border)]">
                                                        <td className="w-[220px] max-w-[220px] truncate px-2 py-2 font-medium">{r.rep_name}</td>
                                                        <td className="px-2 py-2 text-right font-mono text-[11px] whitespace-nowrap">
                                                          {fmtMoney(rc)}{" "}
                                                          <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(rcc)})</span>
                                                        </td>
                                                        <td className="px-2 py-2 text-right font-mono text-[11px] whitespace-nowrap">
                                                          {fmtMoney(rb)}{" "}
                                                          <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(rbc)})</span>
                                                        </td>
                                                        <td className="px-2 py-2 text-right font-mono text-[11px] whitespace-nowrap">
                                                          {fmtMoney(rp)}{" "}
                                                          <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(rpc)})</span>
                                                        </td>
                                                        <td className="px-2 py-2 text-right font-mono text-[11px] whitespace-nowrap">
                                                          {fmtMoney(rt)}{" "}
                                                          <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(rtc)})</span>
                                                        </td>
                                                        <td className="px-2 py-2 text-right font-mono text-[11px] whitespace-nowrap">
                                                          {fmtMoney(r.won_amount)}{" "}
                                                          <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(r.won_count)})</span>
                                                        </td>
                                                        <td className="px-2 py-2 text-right font-mono text-[11px] whitespace-nowrap">
                                                          {fmtMoney(r.lost_amount)}{" "}
                                                          <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(r.lost_count)})</span>
                                                        </td>
                                                      </tr>
                                                    );
                                                  })}
                                                </tbody>
                                              </table>
                                            </div>
                                          </details>
                                        </td>
                                      </tr>
                                    </Fragment>
                                  );
                                })
                              ) : (
                                <tr>
                                  <td colSpan={7} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                                    No created-in-quarter pipeline found for this period.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </details>

                  <div className="mt-3 flex items-center justify-end">
                    <ExportToExcelButton
                      fileName={`KPIs by quarter - ${summaryLabel}`}
                      sheets={[
                        { name: "Managers", rows: managerExportRows as any },
                        { name: "Reps", rows: repExportRows as any },
                      ]}
                    />
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

