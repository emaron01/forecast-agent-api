import "server-only";

import { pool } from "./pool";
import type { AuthUser } from "./auth";
import { getVisibleUsers } from "./db";
import { getScopedRepDirectory, type RepDirectoryRow } from "./repScope";
import { getForecastStageProbabilities } from "./forecastStageProbabilities";
import { computeSalesVsVerdictForecastSummary } from "./forecastSummary";
import { getQuarterKpisSnapshot, type QuarterKpisSnapshot } from "./quarterKpisSnapshot";
import type { PipelineMomentumData } from "./pipelineMomentum";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function isoDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function normalizeNameKey(s: any) {
  // Must match the Postgres normalization used in queries.
  // - trim
  // - collapse whitespace
  // - lowercase
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function pct01Qoq(cur: number | null, prev: number | null) {
  if (cur == null || prev == null) return null;
  const c = Number(cur);
  const p = Number(prev);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p <= 0) return null;
  return (c - p) / p;
}

function healthPctFrom30(score: any) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((n / 30) * 100)));
}

async function listActiveRepsForOrg(orgId: number): Promise<RepDirectoryRow[]> {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(rep_name), ''), '(Unnamed)') AS name,
      role,
      manager_rep_id,
      user_id,
      active
    FROM reps
    WHERE organization_id = $1::bigint
      AND (active IS TRUE OR active IS NULL)
    ORDER BY
      CASE
        WHEN role = 'EXEC_MANAGER' THEN 0
        WHEN role = 'MANAGER' THEN 1
        WHEN role = 'REP' THEN 2
        ELSE 9
      END,
      name ASC,
      id ASC
    `,
    [orgId]
  );
  return (rows || []).map((r: any) => ({
    id: Number(r.id),
    name: String(r.name || "").trim() || "(Unnamed)",
    role: r.role == null ? null : String(r.role),
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    user_id: r.user_id == null ? null : Number(r.user_id),
    active: r.active == null ? null : !!r.active,
  }));
}

export type ExecQuotaPeriodLite = {
  id: string;
  fiscal_year: string;
  fiscal_quarter: string;
  period_name: string;
  period_start: string;
  period_end: string;
};

export type ExecRepOption = { public_id: string; name: string };

export type ExecutiveForecastSummary = {
  periods: ExecQuotaPeriodLite[];
  fiscalYearsSorted: string[];
  selectedFiscalYear: string;
  selectedQuotaPeriodId: string;
  selectedPeriod: ExecQuotaPeriodLite | null;
  reps: ExecRepOption[];
  scopeLabel: string;
  repDirectory: RepDirectoryRow[];
  myRepId: number | null;
  stageProbabilities: { commit: number; best_case: number; pipeline: number };
  healthModifiers: { commit_modifier: number; best_case_modifier: number; pipeline_modifier: number };
  repRollups: Array<{
    rep_id: string;
    rep_name: string;
    commit_amount: number;
    best_case_amount: number;
    pipeline_amount: number;
    won_amount: number;
    won_count: number;
  }>;
  productsClosedWon: Array<{
    product: string;
    won_amount: number;
    won_count: number;
    avg_order_value: number;
    avg_health_score: number | null;
  }>;
  productsClosedWonPrevSummary: { total_revenue: number; total_orders: number; blended_acv: number } | null;
  productsClosedWonByRep: Array<{
    rep_name: string;
    product: string;
    won_amount: number;
    won_count: number;
    avg_order_value: number;
    avg_health_score: number | null;
  }>;
  quarterKpis: QuarterKpisSnapshot | null;
  pipelineMomentum: PipelineMomentumData | null;
  quota: number;
  crmForecast: {
    commit_amount: number;
    best_case_amount: number;
    pipeline_amount: number;
    won_amount: number;
    weighted_forecast: number;
  };
  aiForecast: {
    commit_amount: number;
    best_case_amount: number;
    pipeline_amount: number;
    weighted_forecast: number;
  };
  forecastGap: number; // AI - CRM (weighted)
  pctToGoal: number | null; // AI weighted / quota
  leftToGo: number; // quota - AI weighted
  bucketDeltas: { commit: number; best_case: number; pipeline: number; total: number }; // (AI - CRM) per bucket + total
  partnersExecutive: {
    direct: {
      opps: number;
      won_opps: number;
      lost_opps: number;
      win_rate: number | null;
      aov: number | null;
      avg_days: number | null;
      avg_health_score: number | null; // raw 0..30
      won_amount: number;
      lost_amount: number;
      open_pipeline: number;
    } | null;
    partner: {
      opps: number;
      won_opps: number;
      lost_opps: number;
      win_rate: number | null;
      aov: number | null;
      avg_days: number | null;
      avg_health_score: number | null; // raw 0..30
      won_amount: number;
      lost_amount: number;
      open_pipeline: number;
    } | null;
    revenue_mix_partner_pct01: number | null; // closed-won only
    cei_prev_partner_index: number | null; // partner CEI index in previous quarter (Direct=100), if available
    top_partners: Array<{
      partner_name: string;
      opps: number;
      won_opps: number;
      lost_opps: number;
      win_rate: number | null;
      aov: number | null;
      avg_days: number | null;
      avg_health_score: number | null; // raw 0..30
      won_amount: number;
      open_pipeline: number;
    }>;
  } | null;
};

type MotionStatsRow = {
  motion: "direct" | "partner";
  opps: number;
  won_opps: number;
  lost_opps: number;
  win_rate: number | null;
  aov: number | null;
  avg_days: number | null;
  avg_health_score: number | null; // raw 0..30
  won_amount: number;
  lost_amount: number;
};

type PartnerRollupRow = {
  partner_name: string;
  opps: number;
  won_opps: number;
  lost_opps: number;
  win_rate: number | null;
  aov: number | null;
  avg_days: number | null;
  avg_health_score: number | null; // raw 0..30
  won_amount: number;
};

type OpenPipelineMotionRow = { motion: "direct" | "partner"; open_opps: number; open_amount: number };
type OpenPipelinePartnerRow = { partner_name: string; open_opps: number; open_amount: number };

async function loadMotionStatsForPartners(args: { orgId: number; quotaPeriodId: string; repIds: number[] | null }): Promise<MotionStatsRow[]> {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<MotionStatsRow>(
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
        CASE
          WHEN o.partner_name IS NOT NULL AND btrim(o.partner_name) <> '' THEN 'partner'
          ELSE 'direct'
        END AS motion,
        COALESCE(o.amount, 0)::float8 AS amount,
        o.health_score::float8 AS health_score,
        o.create_date::timestamptz AS create_date,
        o.close_date::date AS close_date,
        lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs
      FROM opportunities o
      JOIN qp ON TRUE
      WHERE o.org_id = $1
        AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
        AND o.close_date IS NOT NULL
        AND o.close_date >= qp.period_start
        AND o.close_date <= qp.period_end
        AND (
          ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% loss %')
        )
    ),
    scored AS (
      SELECT
        motion,
        amount,
        health_score,
        CASE WHEN ((' ' || fs || ' ') LIKE '% won %') THEN 1 ELSE 0 END AS is_won,
        CASE WHEN ((' ' || fs || ' ') LIKE '% lost %' OR (' ' || fs || ' ') LIKE '% loss %') THEN 1 ELSE 0 END AS is_lost,
        CASE WHEN create_date IS NOT NULL AND close_date IS NOT NULL THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0))::int ELSE NULL END AS age_days
      FROM base
    )
    SELECT
      motion,
      COUNT(*)::int AS opps,
      SUM(is_won)::int AS won_opps,
      SUM(is_lost)::int AS lost_opps,
      CASE WHEN COUNT(*) > 0 THEN (SUM(is_won)::float8 / COUNT(*)::float8) ELSE NULL END AS win_rate,
      AVG(NULLIF(amount, 0))::float8 AS aov,
      AVG(age_days)::float8 AS avg_days,
      AVG(NULLIF(health_score, 0))::float8 AS avg_health_score,
      SUM(CASE WHEN is_won = 1 THEN amount ELSE 0 END)::float8 AS won_amount,
      SUM(CASE WHEN is_lost = 1 THEN amount ELSE 0 END)::float8 AS lost_amount
    FROM scored
    GROUP BY motion
    ORDER BY motion ASC
    `,
    [args.orgId, args.quotaPeriodId, args.repIds || [], useRepFilter]
  );
  return rows || [];
}

async function listPartnerRollupForExecutive(args: { orgId: number; quotaPeriodId: string; repIds: number[] | null; limit: number }): Promise<PartnerRollupRow[]> {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const limit = Math.max(1, Math.min(200, Number(args.limit || 30) || 30));
  const { rows } = await pool.query<PartnerRollupRow>(
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
        btrim(o.partner_name) AS partner_name,
        COALESCE(o.amount, 0)::float8 AS amount,
        o.health_score::float8 AS health_score,
        o.create_date::timestamptz AS create_date,
        o.close_date::date AS close_date,
        lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs
      FROM opportunities o
      JOIN qp ON TRUE
      WHERE o.org_id = $1
        AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
        AND o.partner_name IS NOT NULL
        AND btrim(o.partner_name) <> ''
        AND o.close_date IS NOT NULL
        AND o.close_date >= qp.period_start
        AND o.close_date <= qp.period_end
        AND (
          ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% loss %')
        )
    ),
    scored AS (
      SELECT
        partner_name,
        amount,
        health_score,
        CASE WHEN ((' ' || fs || ' ') LIKE '% won %') THEN 1 ELSE 0 END AS is_won,
        CASE WHEN ((' ' || fs || ' ') LIKE '% lost %' OR (' ' || fs || ' ') LIKE '% loss %') THEN 1 ELSE 0 END AS is_lost,
        CASE WHEN create_date IS NOT NULL AND close_date IS NOT NULL THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0))::int ELSE NULL END AS age_days
      FROM base
    )
    SELECT
      partner_name,
      COUNT(*)::int AS opps,
      SUM(is_won)::int AS won_opps,
      SUM(is_lost)::int AS lost_opps,
      CASE WHEN COUNT(*) > 0 THEN (SUM(is_won)::float8 / COUNT(*)::float8) ELSE NULL END AS win_rate,
      AVG(NULLIF(amount, 0))::float8 AS aov,
      AVG(age_days)::float8 AS avg_days,
      AVG(NULLIF(health_score, 0))::float8 AS avg_health_score,
      SUM(CASE WHEN is_won = 1 THEN amount ELSE 0 END)::float8 AS won_amount
    FROM scored
    GROUP BY partner_name
    ORDER BY won_amount DESC NULLS LAST, opps DESC, partner_name ASC
    LIMIT $5::int
    `,
    [args.orgId, args.quotaPeriodId, args.repIds || [], useRepFilter, limit]
  );
  return rows || [];
}

async function loadOpenPipelineByMotionForExecutive(args: { orgId: number; quotaPeriodId: string; repIds: number[] | null }): Promise<OpenPipelineMotionRow[]> {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<OpenPipelineMotionRow>(
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
        CASE
          WHEN o.partner_name IS NOT NULL AND btrim(o.partner_name) <> '' THEN 'partner'
          ELSE 'direct'
        END AS motion,
        COALESCE(o.amount, 0)::float8 AS amount,
        lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs
      FROM opportunities o
      JOIN qp ON TRUE
      WHERE o.org_id = $1
        AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
        AND o.close_date IS NOT NULL
        AND o.close_date >= qp.period_start
        AND o.close_date <= qp.period_end
        AND NOT (
          ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% loss %')
        )
    )
    SELECT
      motion,
      COUNT(*)::int AS open_opps,
      SUM(amount)::float8 AS open_amount
    FROM base
    GROUP BY motion
    ORDER BY motion ASC
    `,
    [args.orgId, args.quotaPeriodId, args.repIds || [], useRepFilter]
  );
  return rows || [];
}

async function listOpenPipelineByPartnerForExecutive(args: { orgId: number; quotaPeriodId: string; repIds: number[] | null; limit: number }): Promise<OpenPipelinePartnerRow[]> {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const limit = Math.max(1, Math.min(500, Number(args.limit || 100) || 100));
  const { rows } = await pool.query<OpenPipelinePartnerRow>(
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
        btrim(o.partner_name) AS partner_name,
        COALESCE(o.amount, 0)::float8 AS amount,
        lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs
      FROM opportunities o
      JOIN qp ON TRUE
      WHERE o.org_id = $1
        AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
        AND o.partner_name IS NOT NULL
        AND btrim(o.partner_name) <> ''
        AND o.close_date IS NOT NULL
        AND o.close_date >= qp.period_start
        AND o.close_date <= qp.period_end
        AND NOT (
          ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
          OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% loss %')
        )
    )
    SELECT
      partner_name,
      COUNT(*)::int AS open_opps,
      SUM(amount)::float8 AS open_amount
    FROM base
    GROUP BY partner_name
    ORDER BY open_amount DESC NULLS LAST, open_opps DESC, partner_name ASC
    LIMIT $5::int
    `,
    [args.orgId, args.quotaPeriodId, args.repIds || [], useRepFilter, limit]
  );
  return rows || [];
}

type OpenPipelineSnapshot = {
  commit_amount: number;
  commit_count: number;
  best_case_amount: number;
  best_case_count: number;
  pipeline_amount: number;
  pipeline_count: number;
  total_amount: number;
  total_count: number;
};

async function getOpenPipelineSnapshot(args: {
  orgId: number;
  quotaPeriodId: string;
  useRepFilter: boolean;
  repIds: number[];
  repNameKeys: string[];
}): Promise<OpenPipelineSnapshot> {
  const empty: OpenPipelineSnapshot = {
    commit_amount: 0,
    commit_count: 0,
    best_case_amount: 0,
    best_case_count: 0,
    pipeline_amount: 0,
    pipeline_count: 0,
    total_amount: 0,
    total_count: 0,
  };

  const qpId = String(args.quotaPeriodId || "").trim();
  if (!qpId) return empty;

  const repIds = Array.isArray(args.repIds) ? args.repIds : [];
  const repNameKeys = Array.isArray(args.repNameKeys) ? args.repNameKeys : [];

  const { rows } = await pool
    .query<OpenPipelineSnapshot>(
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
          lower(
            regexp_replace(
              COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
              '[^a-zA-Z]+',
              ' ',
              'g'
            )
          ) AS fs,
          o.close_date::date AS close_d
        FROM opportunities o
        WHERE o.org_id = $1
          AND (
            NOT $5::boolean
            OR (
              (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
              OR (
                COALESCE(array_length($4::text[], 1), 0) > 0
                AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
              )
            )
          )
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
      )
      SELECT
        COALESCE(SUM(CASE WHEN fs LIKE '%commit%' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
        COALESCE(SUM(CASE WHEN fs LIKE '%commit%' THEN 1 ELSE 0 END), 0)::int AS commit_count,
        COALESCE(SUM(CASE WHEN fs LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS best_case_amount,
        COALESCE(SUM(CASE WHEN fs LIKE '%best%' THEN 1 ELSE 0 END), 0)::int AS best_case_count,
        COALESCE(SUM(CASE WHEN fs NOT LIKE '%commit%' AND fs NOT LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
        COALESCE(SUM(CASE WHEN fs NOT LIKE '%commit%' AND fs NOT LIKE '%best%' THEN 1 ELSE 0 END), 0)::int AS pipeline_count,
        COALESCE(SUM(amount), 0)::float8 AS total_amount,
        COUNT(*)::int AS total_count
      FROM open_deals
      `,
      [args.orgId, qpId, repIds, repNameKeys, args.useRepFilter]
    )
    .then((r) => r.rows || [])
    .catch(() => []);

  return (rows?.[0] as any) || empty;
}

type CreatedPipelineProductRow = {
  product: string;
  amount: number;
  opps: number;
  avg_health_score: number | null;
};

async function getCreatedPipelineByProduct(args: {
  orgId: number;
  quotaPeriodId: string;
  useRepFilter: boolean;
  repIds: number[];
  repNameKeys: string[];
  limit: number;
}): Promise<CreatedPipelineProductRow[]> {
  const qpId = String(args.quotaPeriodId || "").trim();
  if (!qpId) return [];
  const repIds = Array.isArray(args.repIds) ? args.repIds : [];
  const repNameKeys = Array.isArray(args.repNameKeys) ? args.repNameKeys : [];
  const limit = Math.max(1, Math.min(200, Number(args.limit || 15) || 15));

  const { rows } = await pool
    .query<CreatedPipelineProductRow>(
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
          COALESCE(NULLIF(btrim(o.product), ''), '(Unspecified)') AS product,
          COALESCE(o.amount, 0)::float8 AS amount,
          o.health_score,
          o.create_date::timestamptz AS create_ts,
          CASE
            WHEN o.close_date IS NULL THEN NULL
            WHEN (o.close_date::text ~ '^\\d{4}-\\d{1,2}-\\d{1,2}') THEN substring(o.close_date::text from 1 for 10)::date
            WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
              to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
            ELSE NULL
          END AS close_d
        FROM opportunities o
        JOIN qp ON TRUE
        WHERE o.org_id = $1
          AND o.create_date IS NOT NULL
          AND o.create_date::date >= qp.period_start
          AND o.create_date::date <= qp.period_end
          AND (
            NOT $5::boolean
            OR (
              (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
              OR (
                COALESCE(array_length($4::text[], 1), 0) > 0
                AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
              )
            )
          )
      ),
      active_created AS (
        SELECT *
          FROM base b
          JOIN qp ON TRUE
         WHERE NOT (b.close_d IS NOT NULL AND b.close_d >= qp.period_start AND b.close_d <= qp.period_end)
      )
      SELECT
        product,
        COALESCE(SUM(amount), 0)::float8 AS amount,
        COUNT(*)::int AS opps,
        AVG(NULLIF(health_score, 0))::float8 AS avg_health_score
      FROM active_created
      GROUP BY product
      ORDER BY amount DESC, opps DESC, product ASC
      LIMIT $6::int
      `,
      [args.orgId, qpId, repIds, repNameKeys, args.useRepFilter, limit]
    )
    .then((r) => r.rows || [])
    .catch(() => []);
  return rows || [];
}

type CreatedPipelineAgeBandRow = { band: "0-30" | "31-60" | "61+"; opps: number; amount: number; avg_age_days: number | null };

async function getCreatedPipelineAgeMix(args: {
  orgId: number;
  quotaPeriodId: string;
  useRepFilter: boolean;
  repIds: number[];
  repNameKeys: string[];
}): Promise<{ avg_age_days: number | null; bands: Array<{ band: "0-30" | "31-60" | "61+"; opps: number; amount: number }> }> {
  const qpId = String(args.quotaPeriodId || "").trim();
  if (!qpId) return { avg_age_days: null, bands: [] };
  const repIds = Array.isArray(args.repIds) ? args.repIds : [];
  const repNameKeys = Array.isArray(args.repNameKeys) ? args.repNameKeys : [];

  const rows = await pool
    .query<CreatedPipelineAgeBandRow>(
      `
      WITH qp AS (
        SELECT period_start::date AS period_start, period_end::date AS period_end, period_end::timestamptz AS period_end_ts
          FROM quota_periods
         WHERE org_id = $1::bigint
           AND id = $2::bigint
         LIMIT 1
      ),
      base AS (
        SELECT
          COALESCE(o.amount, 0)::float8 AS amount,
          o.create_date::timestamptz AS create_ts,
          CASE
            WHEN o.close_date IS NULL THEN NULL
            WHEN (o.close_date::text ~ '^\\d{4}-\\d{1,2}-\\d{1,2}') THEN substring(o.close_date::text from 1 for 10)::date
            WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
              to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
            ELSE NULL
          END AS close_d
        FROM opportunities o
        JOIN qp ON TRUE
        WHERE o.org_id = $1
          AND o.create_date IS NOT NULL
          AND o.create_date::date >= qp.period_start
          AND o.create_date::date <= qp.period_end
          AND (
            NOT $5::boolean
            OR (
              (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
              OR (
                COALESCE(array_length($4::text[], 1), 0) > 0
                AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
              )
            )
          )
      ),
      active_created AS (
        SELECT
          b.*,
          qp.period_start,
          qp.period_end,
          LEAST(NOW(), qp.period_end_ts) AS asof_ts
        FROM base b
        JOIN qp ON TRUE
        WHERE NOT (b.close_d IS NOT NULL AND b.close_d >= qp.period_start AND b.close_d <= qp.period_end)
      ),
      aged AS (
        SELECT
          amount,
          GREATEST(0, ROUND(EXTRACT(EPOCH FROM (asof_ts - create_ts)) / 86400.0))::int AS age_days
        FROM active_created
        WHERE create_ts IS NOT NULL
      )
      SELECT
        CASE
          WHEN age_days <= 30 THEN '0-30'
          WHEN age_days <= 60 THEN '31-60'
          ELSE '61+'
        END AS band,
        COUNT(*)::int AS opps,
        COALESCE(SUM(amount), 0)::float8 AS amount,
        AVG(age_days)::float8 AS avg_age_days
      FROM aged
      GROUP BY band
      ORDER BY
        CASE
          WHEN band = '0-30' THEN 0
          WHEN band = '31-60' THEN 1
          ELSE 2
        END ASC
      `,
      [args.orgId, qpId, repIds, repNameKeys, args.useRepFilter]
    )
    .then((r) => r.rows || [])
    .catch(() => []);

  const bands = (rows || []).map((r) => ({
    band: r.band,
    opps: Number(r.opps || 0) || 0,
    amount: Number(r.amount || 0) || 0,
    avg_age_days: r.avg_age_days == null ? null : Number(r.avg_age_days),
  }));
  const avg_age_days = bands.length
    ? (() => {
        let sum = 0;
        let cnt = 0;
        for (const b of bands) {
          if (b.avg_age_days != null && Number.isFinite(b.avg_age_days) && b.opps > 0) {
            sum += b.avg_age_days * b.opps;
            cnt += b.opps;
          }
        }
        return cnt ? sum / cnt : null;
      })()
    : null;

  return {
    avg_age_days,
    bands: bands.map((b) => ({ band: b.band, opps: b.opps, amount: b.amount })),
  };
}

type PartnerSpeedRow = {
  motion: "direct" | "partner";
  partner_name: string | null;
  closed_opps: number;
  won_opps: number;
  win_rate: number | null;
  avg_days: number | null;
  won_amount: number;
  aov: number | null;
};

async function getPartnerSpeedSignals(args: {
  orgId: number;
  quotaPeriodId: string;
  useRepFilter: boolean;
  repIds: number[];
  repNameKeys: string[];
  limit: number;
}): Promise<{ direct: PartnerSpeedRow | null; partners: PartnerSpeedRow[] }> {
  const qpId = String(args.quotaPeriodId || "").trim();
  if (!qpId) return { direct: null, partners: [] };
  const repIds = Array.isArray(args.repIds) ? args.repIds : [];
  const repNameKeys = Array.isArray(args.repNameKeys) ? args.repNameKeys : [];
  const limit = Math.max(1, Math.min(50, Number(args.limit || 10) || 10));

  const { rows } = await pool
    .query<PartnerSpeedRow>(
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
          CASE
            WHEN o.partner_name IS NOT NULL AND btrim(o.partner_name) <> '' THEN 'partner'
            ELSE 'direct'
          END AS motion,
          NULLIF(btrim(o.partner_name), '') AS partner_name,
          COALESCE(o.amount, 0)::float8 AS amount,
          o.create_date::timestamptz AS create_ts,
          o.close_date::timestamptz AS close_ts,
          lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs
        FROM opportunities o
        JOIN qp ON TRUE
        WHERE o.org_id = $1
          AND o.close_date IS NOT NULL
          AND o.close_date::date >= qp.period_start
          AND o.close_date::date <= qp.period_end
          AND (
            NOT $5::boolean
            OR (
              (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
              OR (
                COALESCE(array_length($4::text[], 1), 0) > 0
                AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
              )
            )
          )
          AND (
            ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
            OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
            OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% loss %')
          )
      ),
      scored AS (
        SELECT
          motion,
          partner_name,
          amount,
          CASE WHEN ((' ' || fs || ' ') LIKE '% won %') THEN 1 ELSE 0 END AS is_won,
          CASE WHEN create_ts IS NOT NULL AND close_ts IS NOT NULL THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (close_ts - create_ts)) / 86400.0))::int ELSE NULL END AS age_days
        FROM base
      )
      SELECT
        motion,
        CASE WHEN motion = 'partner' THEN partner_name ELSE NULL END AS partner_name,
        COUNT(*)::int AS closed_opps,
        SUM(is_won)::int AS won_opps,
        CASE WHEN COUNT(*) > 0 THEN (SUM(is_won)::float8 / COUNT(*)::float8) ELSE NULL END AS win_rate,
        AVG(age_days)::float8 AS avg_days,
        SUM(CASE WHEN is_won = 1 THEN amount ELSE 0 END)::float8 AS won_amount,
        CASE WHEN SUM(is_won) > 0 THEN (SUM(CASE WHEN is_won = 1 THEN amount ELSE 0 END)::float8 / SUM(is_won)::float8) ELSE NULL END AS aov
      FROM scored
      GROUP BY motion, CASE WHEN motion = 'partner' THEN partner_name ELSE NULL END
      ORDER BY
        CASE WHEN motion = 'direct' THEN 0 ELSE 1 END ASC,
        won_amount DESC NULLS LAST,
        closed_opps DESC,
        partner_name ASC
      `,
      [args.orgId, qpId, repIds, repNameKeys, args.useRepFilter]
    )
    .then((r) => r.rows || [])
    .catch(() => []);

  const direct = (rows || []).find((r) => r.motion === "direct") || null;
  const partners = (rows || []).filter((r) => r.motion === "partner" && String(r.partner_name || "").trim()).slice(0, 200);
  // We'll filter/sort further in JS once we know the direct baseline.
  const directAvg = direct?.avg_days == null ? null : Number(direct.avg_days);
  const outPartners = partners
    .map((p) => {
      const avg = p.avg_days == null ? null : Number(p.avg_days);
      const delta = directAvg != null && avg != null && Number.isFinite(directAvg) && Number.isFinite(avg) ? avg - directAvg : null;
      return { ...p, avg_days: avg, win_rate: p.win_rate == null ? null : Number(p.win_rate), aov: p.aov == null ? null : Number(p.aov), delta_days_vs_direct: delta };
    })
    .filter((p) => (Number(p.closed_opps || 0) || 0) >= 3)
    .sort((a, b) => {
      const ad = a.delta_days_vs_direct;
      const bd = b.delta_days_vs_direct;
      if (ad != null && bd != null && ad !== bd) return ad - bd; // more negative = faster than direct
      const aw = Number(a.won_amount || 0) || 0;
      const bw = Number(b.won_amount || 0) || 0;
      return bw - aw;
    })
    .slice(0, limit);

  return { direct: direct ? ({ ...direct, avg_days: direct.avg_days == null ? null : Number(direct.avg_days), win_rate: direct.win_rate == null ? null : Number(direct.win_rate), aov: direct.aov == null ? null : Number(direct.aov) } as any) : null, partners: outPartners as any };
}

export async function getExecutiveForecastDashboardSummary(args: {
  orgId: number;
  user: AuthUser;
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<ExecutiveForecastSummary> {
  const selectedQuotaPeriodIdParam = String(sp(args.searchParams?.quota_period_id) || "").trim();
  const selectedFiscalYearParam = String(sp(args.searchParams?.fiscal_year) || "").trim();

  const periods: ExecQuotaPeriodLite[] = await pool
    .query<ExecQuotaPeriodLite>(
      `
      SELECT
        id::text AS id,
        COALESCE(NULLIF(btrim(fiscal_year), ''), substring(period_start::text from 1 for 4)) AS fiscal_year,
        fiscal_quarter::text AS fiscal_quarter,
        COALESCE(NULLIF(btrim(period_name), ''), (period_start::text || ' → ' || period_end::text)) AS period_name,
        period_start::text AS period_start,
        period_end::text AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
      ORDER BY period_start DESC, id DESC
      `,
      [args.orgId]
    )
    .then((r) => (r.rows || []) as any[])
    .catch(() => []);

  const fiscalYearsSorted = Array.from(new Set(periods.map((p) => String(p.fiscal_year || "").trim()).filter(Boolean))).sort((a, b) => b.localeCompare(a));

  const todayIso = isoDateOnly(new Date());
  const containingToday = periods.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;
  const defaultQuotaPeriodId = String(containingToday?.id || periods?.[0]?.id || "").trim();

  const selectedQuotaPeriodId = selectedQuotaPeriodIdParam || defaultQuotaPeriodId;
  const selectedPeriod = selectedQuotaPeriodId ? periods.find((p) => String(p.id) === selectedQuotaPeriodId) || null : null;

  const selectedFiscalYear =
    selectedFiscalYearParam ||
    String(selectedPeriod?.fiscal_year || "").trim() ||
    String(containingToday?.fiscal_year || "").trim() ||
    fiscalYearsSorted[0] ||
    "";

  const roleRaw = String(args.user.role || "").trim();
  const scopedRole =
    roleRaw === "ADMIN" || roleRaw === "EXEC_MANAGER" || roleRaw === "MANAGER" || roleRaw === "REP"
      ? (roleRaw as "ADMIN" | "EXEC_MANAGER" | "MANAGER" | "REP")
      : ("REP" as const);

  const visibleUsers = await getVisibleUsers({
    currentUserId: args.user.id,
    orgId: args.orgId,
    role: scopedRole,
    hierarchy_level: (args.user as any).hierarchy_level,
    see_all_visibility: (args.user as any).see_all_visibility,
  }).catch(() => []);

  const visibleRepUsers = (visibleUsers || []).filter((u: any) => u && u.role === "REP" && u.active);
  const visibleRepUserIds = Array.from(new Set(visibleRepUsers.map((u: any) => Number(u.id)).filter((n: number) => Number.isFinite(n) && n > 0)));
  const visibleRepNameKeys = Array.from(
    new Set(
      visibleRepUsers
        .flatMap((u: any) => [normalizeNameKey(u.account_owner_name || ""), normalizeNameKey(u.display_name || ""), normalizeNameKey(u.email || "")])
        .filter(Boolean)
    )
  );

  // Map visible REP users -> rep ids when possible (opportunities.rep_id is reps.id).
  let repIdsToUse =
    visibleRepUserIds.length || visibleRepNameKeys.length
      ? await pool
          .query<{ id: number }>(
            `
            SELECT DISTINCT r.id
              FROM reps r
             WHERE COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
               AND (
                 (COALESCE(array_length($2::int[], 1), 0) > 0 AND r.user_id = ANY($2::int[]))
                 OR (
                   COALESCE(array_length($3::text[], 1), 0) > 0
                   AND (
                     lower(regexp_replace(btrim(COALESCE(r.crm_owner_name, '')), '\\s+', ' ', 'g')) = ANY($3::text[])
                     OR lower(regexp_replace(btrim(COALESCE(r.rep_name, '')), '\\s+', ' ', 'g')) = ANY($3::text[])
                     OR lower(regexp_replace(btrim(COALESCE(r.display_name, '')), '\\s+', ' ', 'g')) = ANY($3::text[])
                   )
                 )
               )
            `,
            [args.orgId, visibleRepUserIds, visibleRepNameKeys]
          )
          .then((r) => (r.rows || []).map((x) => Number(x.id)).filter((n) => Number.isFinite(n) && n > 0))
          .catch(() => [] as number[])
      : ([] as number[]);

  let scope = await getScopedRepDirectory({ orgId: args.orgId, userId: args.user.id, role: scopedRole }).catch(() => ({
    repDirectory: [],
    allowedRepIds: scopedRole === "ADMIN" ? (null as number[] | null) : ([0] as number[]),
    myRepId: null as number | null,
  }));

  const seeAllVisibility = !!(args.user as any)?.see_all_visibility;
  if (scopedRole === "EXEC_MANAGER" && seeAllVisibility) {
    const all = await listActiveRepsForOrg(args.orgId).catch(() => []);
    // Treat execs with global visibility as "company-wide" scope for rollups + dropdowns.
    scope = { repDirectory: all, allowedRepIds: null, myRepId: scope.myRepId ?? null };
  }

  const scopeLabel = scope.allowedRepIds ? "Team" : "Company";

  const useScoped = scope.allowedRepIds !== null;
  const allowedRepIds = scope.allowedRepIds ?? [];

  const reps: ExecRepOption[] = await pool
    .query<ExecRepOption>(
      `
      SELECT
        public_id::text AS public_id,
        COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(rep_name), ''), NULLIF(btrim(crm_owner_name), ''), '(Unnamed)') AS name
      FROM reps
      WHERE COALESCE(organization_id, org_id::bigint) = $1::bigint
        AND (active IS TRUE OR active IS NULL)
        AND role = 'REP'
        AND (NOT $2::boolean OR id = ANY($3::bigint[]))
      ORDER BY name ASC, id ASC
      `,
      [args.orgId, useScoped, Array.isArray(allowedRepIds) ? allowedRepIds : []]
    )
    .then((r) => (r.rows || []).map((x: any) => ({ public_id: String(x.public_id), name: String(x.name || "").trim() || "(Unnamed)" })))
    .catch(() => []);

  const qpId = selectedQuotaPeriodId;
  const periodIdx = periods.findIndex((p) => String(p.id) === String(qpId));
  const prevPeriod = periodIdx >= 0 ? periods[periodIdx + 1] || null : null;
  const prevQpId = String(prevPeriod?.id || "").trim();

  // If we can't resolve any scope for a non-admin, fail closed (align with other dashboards).
  const useScopedRepIds = scopedRole !== "ADMIN";
  if (useScopedRepIds && repIdsToUse.length === 0 && visibleRepNameKeys.length === 0) {
    return {
      periods,
      fiscalYearsSorted,
      selectedFiscalYear,
      selectedQuotaPeriodId: qpId,
      selectedPeriod,
      reps,
      scopeLabel,
      repDirectory: scope.repDirectory || [],
      myRepId: scope.myRepId ?? null,
      stageProbabilities: { commit: 0.8, best_case: 0.325, pipeline: 0.1 },
      healthModifiers: { commit_modifier: 1, best_case_modifier: 1, pipeline_modifier: 1 },
      repRollups: [],
      productsClosedWon: [],
      productsClosedWonPrevSummary: null,
      productsClosedWonByRep: [],
      quarterKpis: null,
      pipelineMomentum: null,
      quota: 0,
      crmForecast: { commit_amount: 0, best_case_amount: 0, pipeline_amount: 0, won_amount: 0, weighted_forecast: 0 },
      aiForecast: { commit_amount: 0, best_case_amount: 0, pipeline_amount: 0, weighted_forecast: 0 },
      forecastGap: 0,
      pctToGoal: null,
      leftToGo: 0,
      bucketDeltas: { commit: 0, best_case: 0, pipeline: 0, total: 0 },
      partnersExecutive: null,
    };
  }

  // --- CRM totals (unweighted) + Won amount (quarter scoped) ---
  type TotalsRow = {
    commit_amount: number;
    best_case_amount: number;
    pipeline_amount: number;
    won_amount: number;
  };

  const totals: TotalsRow =
    qpId && (repIdsToUse.length || visibleRepNameKeys.length)
      ? await pool
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
                lower(
                  regexp_replace(
                    COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
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
                AND (
                  (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
                  OR (
                    COALESCE(array_length($4::text[], 1), 0) > 0
                    AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
                  )
                )
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
            )
            SELECT
              COALESCE(SUM(CASE WHEN fs LIKE '%commit%' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
              COALESCE(SUM(CASE WHEN fs LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS best_case_amount,
              COALESCE(SUM(CASE WHEN fs NOT LIKE '%commit%' AND fs NOT LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
              COALESCE(SUM(CASE WHEN ((' ' || fs || ' ') LIKE '% won %') THEN amount ELSE 0 END), 0)::float8 AS won_amount
            FROM deals_in_qtr
            `,
            [args.orgId, qpId, repIdsToUse, visibleRepNameKeys]
          )
          .then((r) => (r.rows?.[0] as any) || { commit_amount: 0, best_case_amount: 0, pipeline_amount: 0, won_amount: 0 })
          .catch(() => ({ commit_amount: 0, best_case_amount: 0, pipeline_amount: 0, won_amount: 0 }))
      : { commit_amount: 0, best_case_amount: 0, pipeline_amount: 0, won_amount: 0 };

  const canCompute = !!qpId && (repIdsToUse.length > 0 || visibleRepNameKeys.length > 0);

  type RepQuarterRollupRow = {
    rep_id: string; // may be '' when unknown
    rep_name: string;
    commit_amount: number;
    best_case_amount: number;
    pipeline_amount: number;
    won_amount: number;
    won_count: number;
  };

  const repRollups: RepQuarterRollupRow[] = canCompute
    ? await pool
        .query<RepQuarterRollupRow>(
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
              COALESCE(o.amount, 0) AS amount,
              o.rep_id,
              o.rep_name,
              lower(
                regexp_replace(
                  COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
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
              AND (
                (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
                OR (
                  COALESCE(array_length($4::text[], 1), 0) > 0
                  AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
                )
              )
          ),
          deals_in_qtr AS (
            SELECT d.*
              FROM deals d
              JOIN qp ON TRUE
             WHERE d.close_d IS NOT NULL
               AND d.close_d >= qp.period_start
               AND d.close_d <= qp.period_end
          )
          SELECT
            COALESCE(d.rep_id::text, '') AS rep_id,
            COALESCE(
              NULLIF(btrim(r.display_name), ''),
              NULLIF(btrim(r.rep_name), ''),
              NULLIF(btrim(r.crm_owner_name), ''),
              NULLIF(btrim(d.rep_name), ''),
              '(Unknown rep)'
            ) AS rep_name,
            COALESCE(SUM(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %')
                OR ((' ' || d.fs || ' ') LIKE '% lost %')
                OR ((' ' || d.fs || ' ') LIKE '% closed %')
              THEN 0
              WHEN d.fs LIKE '%commit%' THEN d.amount
              ELSE 0
            END), 0)::float8 AS commit_amount,
            COALESCE(SUM(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %')
                OR ((' ' || d.fs || ' ') LIKE '% lost %')
                OR ((' ' || d.fs || ' ') LIKE '% closed %')
              THEN 0
              WHEN d.fs LIKE '%best%' THEN d.amount
              ELSE 0
            END), 0)::float8 AS best_case_amount,
            COALESCE(SUM(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %')
                OR ((' ' || d.fs || ' ') LIKE '% lost %')
                OR ((' ' || d.fs || ' ') LIKE '% closed %')
              THEN 0
              WHEN d.fs LIKE '%commit%' THEN 0
              WHEN d.fs LIKE '%best%' THEN 0
              ELSE d.amount
            END), 0)::float8 AS pipeline_amount,
            COALESCE(SUM(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %') THEN d.amount
              ELSE 0
            END), 0)::float8 AS won_amount
            ,
            COALESCE(SUM(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %') THEN 1
              ELSE 0
            END), 0)::int AS won_count
          FROM deals_in_qtr d
          LEFT JOIN reps r
            ON r.id = d.rep_id
           AND COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
          GROUP BY
            COALESCE(d.rep_id::text, ''),
            COALESCE(
              NULLIF(btrim(r.display_name), ''),
              NULLIF(btrim(r.rep_name), ''),
              NULLIF(btrim(r.crm_owner_name), ''),
              NULLIF(btrim(d.rep_name), ''),
              '(Unknown rep)'
            )
          ORDER BY rep_name ASC, rep_id ASC
          `,
          [args.orgId, qpId, repIdsToUse, visibleRepNameKeys]
        )
        .then((r) => (r.rows || []) as any[])
        .catch(() => [])
    : [];

  type ProductWonRow = {
    product: string;
    won_amount: number;
    won_count: number;
    avg_order_value: number;
    avg_health_score: number | null;
  };

  async function getProductsClosedWonForPeriod(qpIdInput: string): Promise<ProductWonRow[]> {
    const qpid = String(qpIdInput || "").trim();
    if (!qpid) return [];
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
                  COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
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
              AND (
                (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
                OR (
                  COALESCE(array_length($4::text[], 1), 0) > 0
                  AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
                )
              )
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
        [args.orgId, qpid, repIdsToUse, visibleRepNameKeys]
      )
      .then((r) => (r.rows || []) as any[])
      .catch(() => []);
  }

  const productsClosedWon: ProductWonRow[] = canCompute ? await getProductsClosedWonForPeriod(qpId) : [];

  const prevProductsClosedWonRows: ProductWonRow[] = canCompute && prevQpId ? await getProductsClosedWonForPeriod(prevQpId) : [];
  const productsClosedWonPrevSummaryFinal =
    prevQpId && prevProductsClosedWonRows.length
      ? (() => {
          const totalRevenue = prevProductsClosedWonRows.reduce((acc, r) => acc + (Number((r as any).won_amount || 0) || 0), 0);
          const totalOrders = prevProductsClosedWonRows.reduce((acc, r) => acc + (Number((r as any).won_count || 0) || 0), 0);
          const blendedAcv = totalOrders > 0 ? totalRevenue / totalOrders : 0;
          return { total_revenue: totalRevenue, total_orders: totalOrders, blended_acv: blendedAcv };
        })()
      : prevQpId
        ? { total_revenue: 0, total_orders: 0, blended_acv: 0 }
        : null;

  type ProductWonByRepRow = {
    rep_name: string;
    product: string;
    won_amount: number;
    won_count: number;
    avg_order_value: number;
    avg_health_score: number | null;
  };

  const productsClosedWonByRep: ProductWonByRepRow[] = canCompute
    ? await pool
        .query<ProductWonByRepRow>(
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
              o.rep_id,
              o.rep_name,
              lower(
                regexp_replace(
                  COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
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
              AND (
                (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
                OR (
                  COALESCE(array_length($4::text[], 1), 0) > 0
                  AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
                )
              )
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
            COALESCE(
              NULLIF(btrim(r.display_name), ''),
              NULLIF(btrim(r.rep_name), ''),
              NULLIF(btrim(r.crm_owner_name), ''),
              NULLIF(btrim(d.rep_name), ''),
              '(Unknown rep)'
            ) AS rep_name,
            d.product,
            COALESCE(SUM(d.amount), 0)::float8 AS won_amount,
            COUNT(*)::int AS won_count,
            CASE WHEN COUNT(*) > 0 THEN (COALESCE(SUM(d.amount), 0)::float8 / COUNT(*)::float8) ELSE 0 END AS avg_order_value,
            AVG(NULLIF(d.health_score, 0))::float8 AS avg_health_score
          FROM won_deals d
          LEFT JOIN reps r
            ON r.id = d.rep_id
           AND COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
          GROUP BY
            COALESCE(
              NULLIF(btrim(r.display_name), ''),
              NULLIF(btrim(r.rep_name), ''),
              NULLIF(btrim(r.crm_owner_name), ''),
              NULLIF(btrim(d.rep_name), ''),
              '(Unknown rep)'
            ),
            d.product
          ORDER BY won_amount DESC, rep_name ASC, product ASC
          LIMIT 200
          `,
          [args.orgId, qpId, repIdsToUse, visibleRepNameKeys]
        )
        .then((r) => (r.rows || []) as any[])
        .catch(() => [])
    : [];

  const stageProbabilities = await getForecastStageProbabilities({ orgId: args.orgId }).catch(() => ({
    commit: 0.8,
    best_case: 0.325,
    pipeline: 0.1,
  }));

  // --- Health modifiers derived from AI vs CRM bucket sums (quarter scoped) ---
  type VerdictAggRow = {
    commit_crm: number;
    commit_verdict: number;
    best_case_crm: number;
    best_case_verdict: number;
    pipeline_crm: number;
    pipeline_verdict: number;
  };

  const verdictAgg: VerdictAggRow =
    qpId && (repIdsToUse.length || visibleRepNameKeys.length)
      ? await (async () => {
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
                        COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
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
                    AND (
                      (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
                      OR (
                        COALESCE(array_length($4::text[], 1), 0) > 0
                        AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
                      )
                    )
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
                [args.orgId, qpId, repIdsToUse, visibleRepNameKeys]
              )
              .then((r) => r.rows?.[0] || empty);
            return row;
          } catch (e: any) {
            const code = String(e?.code || "");
            if (code === "42P01") return empty;
            throw e;
          }
        })()
      : {
          commit_crm: 0,
          commit_verdict: 0,
          best_case_crm: 0,
          best_case_verdict: 0,
          pipeline_crm: 0,
          pipeline_verdict: 0,
        };

  const healthModifiers = {
    commit_modifier: verdictAgg.commit_crm > 0 ? verdictAgg.commit_verdict / verdictAgg.commit_crm : 1,
    best_case_modifier: verdictAgg.best_case_crm > 0 ? verdictAgg.best_case_verdict / verdictAgg.best_case_crm : 1,
    pipeline_modifier: verdictAgg.pipeline_crm > 0 ? verdictAgg.pipeline_verdict / verdictAgg.pipeline_crm : 1,
  };

  const quota = qpId
    ? await (async () => {
        const repFilter = scope.allowedRepIds;
        const useFilter = Array.isArray(repFilter) && repFilter.length > 0;
        return pool
          .query<{ quota_amount: number }>(
            `
            SELECT COALESCE(SUM(quota_amount), 0)::float8 AS quota_amount
              FROM quotas
             WHERE org_id = $1::bigint
               AND role_level = 3
               AND quota_period_id = $2::bigint
               AND (NOT $4::boolean OR rep_id = ANY($3::bigint[]))
            `,
            [args.orgId, qpId, repFilter || [], useFilter]
          )
          .then((r) => Number(r.rows?.[0]?.quota_amount || 0) || 0)
          .catch(() => 0);
      })()
    : 0;

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

  const quarterKpis = qpId
    ? await getQuarterKpisSnapshot({
        orgId: args.orgId,
        quotaPeriodId: qpId,
        repIds: scope.allowedRepIds === null ? null : scope.allowedRepIds ?? [],
      }).catch(() => null)
    : null;

  // IMPORTANT:
  // Pipeline Momentum must respect user visibility.
  //
  // - `scope.allowedRepIds === null` means company-wide (ADMIN or EXEC with global visibility) → no filter
  // - otherwise, we are in a scoped/team view. If `allowedRepIds` is unexpectedly empty,
  //   fall back to visibility-derived rep ids or REP ids from the scoped rep directory (NOT company-wide).
  const isCompanyScopeForMomentum = scope.allowedRepIds === null;

  const repIdsFromDirectory =
    !isCompanyScopeForMomentum && Array.isArray(scope.repDirectory)
      ? Array.from(
          new Set(
            (scope.repDirectory as any[])
              .filter((r) => String((r as any)?.role || "").toUpperCase() === "REP")
              .map((r) => Number((r as any)?.id))
              .filter((n) => Number.isFinite(n) && n > 0)
          )
        )
      : [];

  // Build a robust in-scope rep_id set.
  // We intentionally union multiple sources because some environments have partial hierarchy wiring:
  // - `scope.allowedRepIds` from repScope (hierarchy)
  // - `repIdsToUse` from user-visibility resolution
  // - `repIdsFromDirectory` from the scoped rep directory
  const repIdsForMomentum = !isCompanyScopeForMomentum
    ? Array.from(
        new Set(
          [
            ...((Array.isArray(scope.allowedRepIds) ? scope.allowedRepIds : []) as number[]),
            ...(Array.isArray(repIdsToUse) ? repIdsToUse : []),
            ...(Array.isArray(repIdsFromDirectory) ? repIdsFromDirectory : []),
          ]
            .map((n) => Number(n))
            .filter((n) => Number.isFinite(n) && n > 0)
        )
      )
    : [];

  // Scoping:
  // - For company scope: no filter
  // - For scoped roles: filter by rep_id when available, and *also* allow rep_name matching using the
  //   CRM owner name stored on the user record (account_owner_name). This avoids relying on first/last display names.
  //
  // IMPORTANT: if both rep_ids and rep_name keys are empty for a scoped role, fail closed (return 0s)
  // rather than widening to company-wide.
  const visibleCrmOwnerNameKeys = Array.from(
    new Set((visibleRepUsers || []).map((u: any) => normalizeNameKey(u?.account_owner_name || "")).filter(Boolean))
  );
  const repNameKeysForMomentum = !isCompanyScopeForMomentum ? visibleCrmOwnerNameKeys : [];
  const useRepFilterForMomentum =
    !isCompanyScopeForMomentum && (repIdsForMomentum.length > 0 || repNameKeysForMomentum.length > 0);

  const prevQuarterKpis =
    prevQpId && qpId
      ? await getQuarterKpisSnapshot({
          orgId: args.orgId,
          quotaPeriodId: prevQpId,
          repIds: scope.allowedRepIds === null ? null : scope.allowedRepIds ?? [],
        }).catch(() => null)
      : null;

  const curSnap = qpId
    ? await getOpenPipelineSnapshot({
        orgId: args.orgId,
        quotaPeriodId: qpId,
        useRepFilter: useRepFilterForMomentum,
        repIds: repIdsForMomentum,
        repNameKeys: repNameKeysForMomentum,
      }).catch(() => null)
    : null;
  const prevSnap = prevQpId
    ? await getOpenPipelineSnapshot({
        orgId: args.orgId,
        quotaPeriodId: prevQpId,
        useRepFilter: useRepFilterForMomentum,
        repIds: repIdsForMomentum,
        repNameKeys: repNameKeysForMomentum,
      }).catch(() => null)
    : null;

  const qoqPct = (cur: number, prev: number) => {
    if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
    return ((cur - prev) / prev) * 100;
  };

  const pipelineMomentum: PipelineMomentumData | null =
    curSnap && Number.isFinite(Number(curSnap.total_amount))
      ? {
          quota_target: Math.max(0, quota - (Number(totals.won_amount || 0) || 0)),
          current_quarter: {
            total_pipeline: Number(curSnap.total_amount || 0) || 0,
            total_opps: Number(curSnap.total_count || 0) || 0,
            mix: {
              commit: {
                value: Number(curSnap.commit_amount || 0) || 0,
                opps: Number(curSnap.commit_count || 0) || 0,
                qoq_change_pct: prevSnap ? qoqPct(Number(curSnap.commit_amount || 0) || 0, Number(prevSnap.commit_amount || 0) || 0) : null,
              },
              best_case: {
                value: Number(curSnap.best_case_amount || 0) || 0,
                opps: Number(curSnap.best_case_count || 0) || 0,
                qoq_change_pct: prevSnap
                  ? qoqPct(Number(curSnap.best_case_amount || 0) || 0, Number(prevSnap.best_case_amount || 0) || 0)
                  : null,
              },
              pipeline: {
                value: Number(curSnap.pipeline_amount || 0) || 0,
                opps: Number(curSnap.pipeline_count || 0) || 0,
                qoq_change_pct: prevSnap ? qoqPct(Number(curSnap.pipeline_amount || 0) || 0, Number(prevSnap.pipeline_amount || 0) || 0) : null,
              },
            },
          },
          previous_quarter: {
            total_pipeline: prevSnap ? (Number(prevSnap.total_amount || 0) || 0) : null,
          },
          predictive: await (async () => {
            const curCreated = quarterKpis?.createdPipeline || null;
            const prevCreated = prevQuarterKpis?.createdPipeline || null;

            const createdCurrentTotalAmt = curCreated ? Number(curCreated.totalAmount || 0) || 0 : 0;
            const createdPrevTotalAmt = prevCreated ? Number(prevCreated.totalAmount || 0) || 0 : null;
            const createdCurrentTotalCnt = curCreated ? Number(curCreated.totalCount || 0) || 0 : 0;
            const createdPrevTotalCnt = prevCreated ? Number(prevCreated.totalCount || 0) || 0 : null;

            const loadCreatedClosedOutcomesInQuarter = async (quotaPeriodId: string) => {
              const qpid = String(quotaPeriodId || "").trim();
              if (!qpid) return null;
              return await pool
                .query<{
                  created_won_amount: number;
                  created_won_opps: number;
                  created_lost_amount: number;
                  created_lost_opps: number;
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
                      lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs,
                      o.create_date::date AS create_d,
                      CASE
                        WHEN o.close_date IS NULL THEN NULL
                        WHEN (o.close_date::text ~ '^\\d{4}-\\d{1,2}-\\d{1,2}') THEN substring(o.close_date::text from 1 for 10)::date
                        WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
                          to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
                        ELSE NULL
                      END AS close_d
                    FROM opportunities o
                    JOIN qp ON TRUE
                    WHERE o.org_id = $1
                      AND o.create_date IS NOT NULL
                      AND o.create_date::date >= qp.period_start
                      AND o.create_date::date <= qp.period_end
                      AND (
                        NOT $5::boolean
                        OR (
                          (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
                          OR (
                            COALESCE(array_length($4::text[], 1), 0) > 0
                            AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
                          )
                        )
                      )
                  ),
                  closed_in_q AS (
                    SELECT *
                      FROM base b
                      JOIN qp ON TRUE
                     WHERE b.close_d IS NOT NULL
                       AND b.close_d >= qp.period_start
                       AND b.close_d <= qp.period_end
                  )
                  SELECT
                    COALESCE(SUM(CASE WHEN ((' ' || fs || ' ') LIKE '% won %') THEN amount ELSE 0 END), 0)::float8 AS created_won_amount,
                    COALESCE(SUM(CASE WHEN ((' ' || fs || ' ') LIKE '% won %') THEN 1 ELSE 0 END), 0)::int AS created_won_opps,
                    COALESCE(SUM(CASE WHEN ((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %') THEN amount ELSE 0 END), 0)::float8 AS created_lost_amount,
                    COALESCE(SUM(CASE WHEN ((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %') THEN 1 ELSE 0 END), 0)::int AS created_lost_opps
                  FROM closed_in_q
                  `,
                  [args.orgId, qpid, repIdsToUse, visibleRepNameKeys, useRepFilterForMomentum]
                )
                .then((r) => r.rows?.[0] || null)
                .catch(() => null);
            };

            const [createdOutcomes, createdOutcomesPrev] = await Promise.all([
              qpId ? loadCreatedClosedOutcomesInQuarter(qpId) : Promise.resolve(null),
              prevQpId ? loadCreatedClosedOutcomesInQuarter(prevQpId) : Promise.resolve(null),
            ]);

            const createdCurWonAmt = createdOutcomes ? Number(createdOutcomes.created_won_amount || 0) || 0 : 0;
            const createdCurWonCnt = createdOutcomes ? Number(createdOutcomes.created_won_opps || 0) || 0 : 0;
            const createdCurLostAmt = createdOutcomes ? Number(createdOutcomes.created_lost_amount || 0) || 0 : 0;
            const createdCurLostCnt = createdOutcomes ? Number(createdOutcomes.created_lost_opps || 0) || 0 : 0;

            const createdPrevWonAmt = createdOutcomesPrev ? Number(createdOutcomesPrev.created_won_amount || 0) || 0 : 0;
            const createdPrevWonCnt = createdOutcomesPrev ? Number(createdOutcomesPrev.created_won_opps || 0) || 0 : 0;
            const createdPrevLostAmt = createdOutcomesPrev ? Number(createdOutcomesPrev.created_lost_amount || 0) || 0 : 0;
            const createdPrevLostCnt = createdOutcomesPrev ? Number(createdOutcomesPrev.created_lost_opps || 0) || 0 : 0;

            const createdCurrentAllAmt = createdCurrentTotalAmt + createdCurWonAmt + createdCurLostAmt;
            const createdCurrentAllCnt = createdCurrentTotalCnt + createdCurWonCnt + createdCurLostCnt;
            const createdPrevAllAmt =
              createdPrevTotalAmt == null ? null : (Number(createdPrevTotalAmt || 0) || 0) + createdPrevWonAmt + createdPrevLostAmt;
            const createdPrevAllCnt =
              createdPrevTotalCnt == null ? null : (Number(createdPrevTotalCnt || 0) || 0) + createdPrevWonCnt + createdPrevLostCnt;

            const productsCur = qpId
              ? await getCreatedPipelineByProduct({
                  orgId: args.orgId,
                  quotaPeriodId: qpId,
                  useRepFilter: useRepFilterForMomentum,
                  repIds: repIdsToUse,
                  repNameKeys: visibleRepNameKeys,
                  limit: 12,
                }).catch(() => [])
              : [];
            const productsPrev = prevQpId
              ? await getCreatedPipelineByProduct({
                  orgId: args.orgId,
                  quotaPeriodId: prevQpId,
                  useRepFilter: useRepFilterForMomentum,
                  repIds: repIdsToUse,
                  repNameKeys: visibleRepNameKeys,
                  limit: 50,
                }).catch(() => [])
              : [];
            const prevByProduct = new Map<string, number>();
            for (const r of productsPrev) prevByProduct.set(String(r.product || "").trim(), Number(r.amount || 0) || 0);

            const ageMix = qpId
              ? await getCreatedPipelineAgeMix({
                  orgId: args.orgId,
                  quotaPeriodId: qpId,
                  useRepFilter: useRepFilterForMomentum,
                  repIds: repIdsToUse,
                  repNameKeys: visibleRepNameKeys,
                }).catch(() => ({ avg_age_days: null, bands: [] as any[] }))
              : { avg_age_days: null, bands: [] as any[] };

            const speed = qpId
              ? await getPartnerSpeedSignals({
                  orgId: args.orgId,
                  quotaPeriodId: qpId,
                  useRepFilter: useRepFilterForMomentum,
                  repIds: repIdsToUse,
                  repNameKeys: visibleRepNameKeys,
                  limit: 8,
                }).catch(() => ({ direct: null, partners: [] as any[] }))
              : { direct: null, partners: [] as any[] };

            const directBaseline = {
              avg_days: speed.direct?.avg_days == null ? null : Number(speed.direct.avg_days),
              win_rate: speed.direct?.win_rate == null ? null : Number(speed.direct.win_rate),
              aov: speed.direct?.aov == null ? null : Number(speed.direct.aov),
            };

            const partners = (speed.partners || []).map((p: any) => ({
              partner_name: String(p.partner_name || "").trim(),
              closed_opps: Number(p.closed_opps || 0) || 0,
              win_rate: p.win_rate == null ? null : Number(p.win_rate),
              avg_days: p.avg_days == null ? null : Number(p.avg_days),
              aov: p.aov == null ? null : Number(p.aov),
              won_amount: Number(p.won_amount || 0) || 0,
              delta_days_vs_direct: p.delta_days_vs_direct == null ? null : Number(p.delta_days_vs_direct),
            }));

            return {
              created_pipeline: {
                current: {
                  total_amount: createdCurrentTotalAmt,
                  total_opps: createdCurrentTotalCnt,
                  created_won_amount: createdCurWonAmt,
                  created_won_opps: createdCurWonCnt,
                  created_lost_amount: createdCurLostAmt,
                  created_lost_opps: createdCurLostCnt,
                  total_amount_all: createdCurrentAllAmt,
                  total_opps_all: createdCurrentAllCnt,
                  mix: {
                    commit: {
                      value: curCreated ? Number(curCreated.commitAmount || 0) || 0 : 0,
                      opps: curCreated ? Number(curCreated.commitCount || 0) || 0 : 0,
                      health_pct: curCreated?.commitHealthPct ?? null,
                    },
                    best_case: {
                      value: curCreated ? Number(curCreated.bestAmount || 0) || 0 : 0,
                      opps: curCreated ? Number(curCreated.bestCount || 0) || 0 : 0,
                      health_pct: curCreated?.bestHealthPct ?? null,
                    },
                    pipeline: {
                      value: curCreated ? Number(curCreated.pipelineAmount || 0) || 0 : 0,
                      opps: curCreated ? Number(curCreated.pipelineCount || 0) || 0 : 0,
                      health_pct: curCreated?.pipelineHealthPct ?? null,
                    },
                  },
                },
                previous: {
                  total_amount: createdPrevTotalAmt,
                  total_opps: createdPrevTotalCnt,
                  total_amount_all: createdPrevAllAmt,
                  total_opps_all: createdPrevAllCnt,
                },
                qoq_total_amount_pct01: pct01Qoq(createdCurrentTotalAmt, createdPrevTotalAmt),
                qoq_total_opps_pct01: pct01Qoq(createdCurrentTotalCnt, createdPrevTotalCnt),
                qoq_total_amount_all_pct01: pct01Qoq(createdCurrentAllAmt, createdPrevAllAmt),
                qoq_total_opps_all_pct01: pct01Qoq(createdCurrentAllCnt, createdPrevAllCnt),
              },
              products_created_pipeline_top: (productsCur || []).map((r) => {
                const prod = String(r.product || "").trim() || "(Unspecified)";
                const amt = Number(r.amount || 0) || 0;
                const prevAmt = prevByProduct.get(prod);
                return {
                  product: prod,
                  amount: amt,
                  opps: Number(r.opps || 0) || 0,
                  avg_health_pct: healthPctFrom30(r.avg_health_score),
                  qoq_amount_pct01: prevAmt == null ? null : pct01Qoq(amt, prevAmt),
                };
              }),
              cycle_mix_created_pipeline: {
                avg_age_days: ageMix.avg_age_days == null ? null : Number(ageMix.avg_age_days),
                bands: (ageMix.bands || []) as any,
              },
              partners_showing_promise: partners,
              direct_baseline: directBaseline,
            };
          })(),
        }
      : null;

  const partnersExecutive: ExecutiveForecastSummary["partnersExecutive"] = qpId
    ? await (async () => {
        try {
          const [motionStats, topPartners, openByMotion, openByPartner] = await Promise.all([
            loadMotionStatsForPartners({ orgId: args.orgId, quotaPeriodId: qpId, repIds: scope.allowedRepIds }),
            listPartnerRollupForExecutive({ orgId: args.orgId, quotaPeriodId: qpId, repIds: scope.allowedRepIds, limit: 30 }),
            loadOpenPipelineByMotionForExecutive({ orgId: args.orgId, quotaPeriodId: qpId, repIds: scope.allowedRepIds }),
            listOpenPipelineByPartnerForExecutive({ orgId: args.orgId, quotaPeriodId: qpId, repIds: scope.allowedRepIds, limit: 120 }),
          ]);

          const statsByMotion = new Map<string, MotionStatsRow>();
          for (const r of motionStats || []) statsByMotion.set(String(r.motion), r);
          const direct = statsByMotion.get("direct") || null;
          const partner = statsByMotion.get("partner") || null;

          const openByMotionMap = new Map<string, OpenPipelineMotionRow>();
          for (const r of openByMotion || []) openByMotionMap.set(String(r.motion), r);
          const directOpen = Number(openByMotionMap.get("direct")?.open_amount || 0) || 0;
          const partnerOpen = Number(openByMotionMap.get("partner")?.open_amount || 0) || 0;

          const openPartnerMap = new Map<string, number>();
          for (const r of openByPartner || []) openPartnerMap.set(String(r.partner_name || "").trim(), Number(r.open_amount || 0) || 0);

          const denom = (direct ? Number(direct.won_amount || 0) || 0 : 0) + (partner ? Number(partner.won_amount || 0) || 0 : 0);
          const revenue_mix_partner_pct01 = denom > 0 && partner ? (Number(partner.won_amount || 0) || 0) / denom : null;

          const ceiPrevPartnerIndex = await (async () => {
            if (!prevQpId) return null;
            const prevRows = await loadMotionStatsForPartners({ orgId: args.orgId, quotaPeriodId: prevQpId, repIds: scope.allowedRepIds }).catch(() => []);
            const prevByMotion = new Map<string, MotionStatsRow>();
            for (const r of prevRows || []) prevByMotion.set(String(r.motion), r);
            const d0 = prevByMotion.get("direct") || null;
            const p0 = prevByMotion.get("partner") || null;
            if (!d0 || !p0) return null;

            const directDays = d0.avg_days == null ? null : Number(d0.avg_days);
            const partnerDays = p0.avg_days == null ? null : Number(p0.avg_days);
            const directWon = Number(d0.won_amount || 0) || 0;
            const partnerWon = Number(p0.won_amount || 0) || 0;
            const directWin = d0.win_rate == null ? null : Number(d0.win_rate);
            const partnerWin = p0.win_rate == null ? null : Number(p0.win_rate);
            const directH = d0.avg_health_score == null ? null : Number(d0.avg_health_score) / 30;
            const partnerH = p0.avg_health_score == null ? null : Number(p0.avg_health_score) / 30;

            const RV_direct = directDays && directDays > 0 ? directWon / directDays : 0;
            const RV_partner = partnerDays && partnerDays > 0 ? partnerWon / partnerDays : 0;
            const QM_direct = directWin == null ? 0 : directH == null ? directWin : directWin * directH;
            const QM_partner = partnerWin == null ? 0 : partnerH == null ? partnerWin : partnerWin * partnerH;
            const CEI_raw_direct = RV_direct * QM_direct;
            const CEI_raw_partner = RV_partner * QM_partner;
            if (!(CEI_raw_direct > 0)) return null;
            return (CEI_raw_partner / CEI_raw_direct) * 100;
          })();

          return {
            direct: direct
              ? {
                  ...direct,
                  open_pipeline: directOpen,
                }
              : null,
            partner: partner
              ? {
                  ...partner,
                  open_pipeline: partnerOpen,
                }
              : null,
            revenue_mix_partner_pct01,
            cei_prev_partner_index: ceiPrevPartnerIndex,
            top_partners: (topPartners || []).map((p) => ({
              ...p,
              open_pipeline: Number(openPartnerMap.get(String(p.partner_name || "").trim()) || 0) || 0,
            })),
          };
        } catch {
          return null;
        }
      })()
    : null;

  return {
    periods,
    fiscalYearsSorted,
    selectedFiscalYear,
    selectedQuotaPeriodId: qpId,
    selectedPeriod,
    reps: reps,
    scopeLabel,
    repDirectory: scope.repDirectory || [],
    myRepId: scope.myRepId ?? null,
    stageProbabilities,
    healthModifiers,
    repRollups,
    productsClosedWon,
    productsClosedWonPrevSummary: productsClosedWonPrevSummaryFinal,
    productsClosedWonByRep,
    quarterKpis,
    pipelineMomentum,
    quota,
    crmForecast: {
      commit_amount: Number(totals.commit_amount || 0) || 0,
      best_case_amount: Number(totals.best_case_amount || 0) || 0,
      pipeline_amount: Number(totals.pipeline_amount || 0) || 0,
      won_amount: Number(totals.won_amount || 0) || 0,
      weighted_forecast: weightedCrm,
    },
    aiForecast: {
      commit_amount: Number(totals.commit_amount || 0) * (healthModifiers.commit_modifier || 1),
      best_case_amount: Number(totals.best_case_amount || 0) * (healthModifiers.best_case_modifier || 1),
      pipeline_amount: Number(totals.pipeline_amount || 0) * (healthModifiers.pipeline_modifier || 1),
      weighted_forecast: weightedAi,
    },
    forecastGap,
    pctToGoal,
    leftToGo,
    bucketDeltas: {
      commit: commitDelta,
      best_case: bestDelta,
      pipeline: pipeDelta,
      total: forecastGap,
    },
    partnersExecutive,
  };
}

