import "server-only";

import { pool } from "./pool";
import type { RepDirectoryRow } from "./repScope";

const LOG_PREFIX = "[getChannelDashboardSummary]";

export type QuotaPeriod = {
  id: string;
  fiscal_year: string;
  fiscal_quarter: string;
  period_name: string;
  period_start: string;
  period_end: string;
};

export type ChannelDeal = {
  id: string;
  deal_name: string;
  account_name: string;
  partner_name: string;
  rep_name: string;
  amount: number;
  close_date: string;
  forecast_stage: string;
  health_score: number | null;
  crm_bucket: string;
  period_name: string;
};

export type ChannelRepRow = {
  rep_id: string;
  rep_name: string;
  manager_name: string;
  quota: number;
  won_amount: number;
  won_count: number;
  pipeline_amount: number;
  attainment: number | null;
  partner_deals_won: number;
  partner_deals_pipeline: number;
  contribution_pct: number | null;
};

export type ChannelDashboardSummary = {
  periods: QuotaPeriod[];
  selectedPeriod: QuotaPeriod | null;
  selectedQuotaPeriodId: string;
  fiscalYear: string;
  channelQuota: number;
  channelClosedWon: number;
  channelClosedWonCount: number;
  channelCommit: number;
  channelBestCase: number;
  channelPipeline: number;
  channelPipelineCount: number;
  territoryClosedWon: number;
  contributionPct: number | null;
  channelGap: number;
  channelGapPct: number | null;
  partnerSummary: {
    partner_name: string;
    won_amount: number;
    won_count: number;
    pipeline_amount: number;
    pipeline_count: number;
    lost_amount: number;
    lost_count: number;
    win_rate: number | null;
    avg_health: number | null;
  }[];
  topPartnerDealsWon: ChannelDeal[];
  topPartnerDealsLost: ChannelDeal[];
  topPartnerDealsPipeline: ChannelDeal[];
  channelRepRows: ChannelRepRow[];
  productsViaPartner: {
    product_name: string;
    amount: number;
    count: number;
  }[];
  pipelineByQuarter: {
    period_id: string;
    period_name: string;
    commit: number;
    best_case: number;
    pipeline: number;
    total: number;
    count: number;
  }[];
  aiCachePrefix: string;
  repDirectory: RepDirectoryRow[];
};

type ChannelRevenueRow = {
  channel_closed_won: number;
  channel_closed_won_count: number;
  channel_commit: number;
  channel_best_case: number;
  channel_pipeline: number;
  channel_pipeline_count: number;
};

type TerritoryWonRow = {
  territory_closed_won: number;
};

type PartnerSummaryRow = {
  partner_name: string;
  won_amount: number;
  won_count: number;
  pipeline_amount: number;
  pipeline_count: number;
  lost_amount: number;
  lost_count: number;
  win_rate: number | null;
  avg_health: number | null;
};

type ProductViaPartnerRow = {
  product_name: string;
  amount: number;
  count: number;
};

type PipelineQuarterRow = {
  period_id: string;
  period_name: string;
  commit: number;
  best_case: number;
  pipeline: number;
  total: number;
  count: number;
};

function logError(scope: string, error: unknown) {
  console.error(`${LOG_PREFIX} ${scope}`, error);
}

function isoDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function intNum(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function nullableNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanText(v: unknown, fallback = "") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

function uniqIds(values: Array<number | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v > 0)
    )
  );
}

function quotaPct(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function crmBucketCaseSql(rowAlias: string) {
  return `
    CASE
      WHEN stm.bucket IS NOT NULL THEN stm.bucket
      WHEN fcm.bucket IS NOT NULL THEN fcm.bucket
      WHEN lower(btrim(COALESCE(${rowAlias}.forecast_stage, ''))) IN ('closed won', 'won') THEN 'won'
      WHEN lower(btrim(COALESCE(${rowAlias}.sales_stage, ''))) LIKE '%lost%' THEN 'lost'
      ELSE 'pipeline'
    END
  `.trim();
}

function parsedCloseDateSql(rowAlias: string) {
  return `
    CASE
      WHEN ${rowAlias}.close_date IS NULL THEN NULL
      WHEN (${rowAlias}.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}')
        THEN substring(${rowAlias}.close_date::text from 1 for 10)::date
      WHEN (${rowAlias}.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}')
        THEN to_date(
          substring(${rowAlias}.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'),
          'FMMM/FMDD/YYYY'
        )
      ELSE NULL
    END
  `.trim();
}

function emptySummary(selectedQuotaPeriodId: string): ChannelDashboardSummary {
  return {
    periods: [],
    selectedPeriod: null,
    selectedQuotaPeriodId,
    fiscalYear: "",
    channelQuota: 0,
    channelClosedWon: 0,
    channelClosedWonCount: 0,
    channelCommit: 0,
    channelBestCase: 0,
    channelPipeline: 0,
    channelPipelineCount: 0,
    territoryClosedWon: 0,
    contributionPct: null,
    channelGap: 0,
    channelGapPct: null,
    partnerSummary: [],
    topPartnerDealsWon: [],
    topPartnerDealsLost: [],
    topPartnerDealsPipeline: [],
    channelRepRows: [],
    productsViaPartner: [],
    pipelineByQuarter: [],
    aiCachePrefix: "",
    repDirectory: [],
  };
}

async function loadPeriods(orgId: number): Promise<QuotaPeriod[]> {
  try {
    const { rows } = await pool.query<QuotaPeriod>(
      `
      SELECT
        id::text AS id,
        COALESCE(NULLIF(btrim(fiscal_year), ''), substring(period_start::text from 1 for 4)) AS fiscal_year,
        COALESCE(NULLIF(btrim(fiscal_quarter), ''), '') AS fiscal_quarter,
        COALESCE(NULLIF(btrim(period_name), ''), period_start::text || ' -> ' || period_end::text) AS period_name,
        period_start::text AS period_start,
        period_end::text AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
      ORDER BY period_start ASC, id ASC
      `,
      [orgId]
    );
    return (rows || []).map((row) => ({
      id: cleanText(row.id),
      fiscal_year: cleanText(row.fiscal_year),
      fiscal_quarter: cleanText(row.fiscal_quarter),
      period_name: cleanText(row.period_name),
      period_start: cleanText(row.period_start),
      period_end: cleanText(row.period_end),
    }));
  } catch (error) {
    logError("loadPeriods", error);
    return [];
  }
}

async function loadChannelQuota(args: {
  orgId: number;
  selectedQuotaPeriodId: string;
  hierarchyLevel: number;
  viewerChannelRepId: number | null;
  viewerUserId: number;
}): Promise<number> {
  if (!args.selectedQuotaPeriodId) return 0;
  try {
    const { rows } = await pool.query<{ channel_quota: number }>(
      `
      SELECT COALESCE(SUM(q.quota_amount), 0)::float8 AS channel_quota
      FROM quotas q
      JOIN reps r
        ON r.id = q.rep_id
      LEFT JOIN users u
        ON u.org_id = q.org_id
       AND u.id = r.user_id
      WHERE q.org_id = $1::bigint
        AND q.quota_period_id = $2::bigint
        AND COALESCE(q.role_level, COALESCE(u.hierarchy_level, 99)) IN (6, 7, 8)
        AND (
          ($3::int = 8 AND $4::bigint IS NOT NULL AND q.rep_id = $4::bigint)
          OR ($3::int = 7 AND u.manager_user_id = $5::bigint)
          OR ($3::int = 6)
        )
      `,
      [
        args.orgId,
        args.selectedQuotaPeriodId,
        args.hierarchyLevel,
        args.viewerChannelRepId,
        args.viewerUserId,
      ]
    );
    return num(rows?.[0]?.channel_quota);
  } catch (error) {
    logError("loadChannelQuota", error);
    return 0;
  }
}

async function loadChannelRevenue(args: {
  orgId: number;
  selectedQuotaPeriodId: string;
  territoryRepIds: number[];
}): Promise<ChannelRevenueRow> {
  const empty: ChannelRevenueRow = {
    channel_closed_won: 0,
    channel_closed_won_count: 0,
    channel_commit: 0,
    channel_best_case: 0,
    channel_pipeline: 0,
    channel_pipeline_count: 0,
  };
  if (!args.selectedQuotaPeriodId || args.territoryRepIds.length === 0) return empty;
  try {
    const { rows } = await pool.query<ChannelRevenueRow>(
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
          ${parsedCloseDateSql("o")} AS close_d,
          o.forecast_stage,
          o.sales_stage,
          ${crmBucketCaseSql("o")} AS crm_bucket
        FROM opportunities o
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = o.org_id
         AND stm.field = 'stage'
         AND stm.stage_value = o.sales_stage
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND fcm.stage_value = o.forecast_stage
        WHERE o.org_id = $1::bigint
          AND o.rep_id = ANY($3::bigint[])
          AND o.partner_name IS NOT NULL
          AND btrim(o.partner_name) <> ''
      ),
      deals_in_period AS (
        SELECT d.*
        FROM deals d
        JOIN qp ON TRUE
        WHERE d.close_d IS NOT NULL
          AND d.close_d >= qp.period_start
          AND d.close_d <= qp.period_end
      )
      SELECT
        COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN amount ELSE 0 END), 0)::float8 AS channel_closed_won,
        COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::int AS channel_closed_won_count,
        COALESCE(SUM(CASE WHEN crm_bucket = 'commit' THEN amount ELSE 0 END), 0)::float8 AS channel_commit,
        COALESCE(SUM(CASE WHEN crm_bucket = 'best_case' THEN amount ELSE 0 END), 0)::float8 AS channel_best_case,
        COALESCE(SUM(CASE WHEN crm_bucket NOT IN ('won', 'lost', 'excluded') THEN amount ELSE 0 END), 0)::float8 AS channel_pipeline,
        COALESCE(SUM(CASE WHEN crm_bucket NOT IN ('won', 'lost', 'excluded') THEN 1 ELSE 0 END), 0)::int AS channel_pipeline_count
      FROM deals_in_period
      `,
      [args.orgId, args.selectedQuotaPeriodId, args.territoryRepIds]
    );
    const row = rows?.[0];
    return {
      channel_closed_won: num(row?.channel_closed_won),
      channel_closed_won_count: intNum(row?.channel_closed_won_count),
      channel_commit: num(row?.channel_commit),
      channel_best_case: num(row?.channel_best_case),
      channel_pipeline: num(row?.channel_pipeline),
      channel_pipeline_count: intNum(row?.channel_pipeline_count),
    };
  } catch (error) {
    logError("loadChannelRevenue", error);
    return empty;
  }
}

async function loadTerritoryClosedWon(args: {
  orgId: number;
  selectedQuotaPeriodId: string;
  territoryRepIds: number[];
}): Promise<number> {
  if (!args.selectedQuotaPeriodId || args.territoryRepIds.length === 0) return 0;
  try {
    const { rows } = await pool.query<TerritoryWonRow>(
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
          ${parsedCloseDateSql("o")} AS close_d,
          o.forecast_stage,
          o.sales_stage,
          ${crmBucketCaseSql("o")} AS crm_bucket
        FROM opportunities o
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = o.org_id
         AND stm.field = 'stage'
         AND stm.stage_value = o.sales_stage
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND fcm.stage_value = o.forecast_stage
        WHERE o.org_id = $1::bigint
          AND o.rep_id = ANY($3::bigint[])
      ),
      deals_in_period AS (
        SELECT d.*
        FROM deals d
        JOIN qp ON TRUE
        WHERE d.close_d IS NOT NULL
          AND d.close_d >= qp.period_start
          AND d.close_d <= qp.period_end
      )
      SELECT COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN amount ELSE 0 END), 0)::float8 AS territory_closed_won
      FROM deals_in_period
      `,
      [args.orgId, args.selectedQuotaPeriodId, args.territoryRepIds]
    );
    return num(rows?.[0]?.territory_closed_won);
  } catch (error) {
    logError("loadTerritoryClosedWon", error);
    return 0;
  }
}

async function loadPartnerSummary(args: {
  orgId: number;
  selectedQuotaPeriodId: string;
  territoryRepIds: number[];
}): Promise<PartnerSummaryRow[]> {
  if (!args.selectedQuotaPeriodId || args.territoryRepIds.length === 0) return [];
  try {
    const { rows } = await pool.query<PartnerSummaryRow>(
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
          btrim(o.partner_name) AS partner_name,
          COALESCE(o.amount, 0)::float8 AS amount,
          o.health_score::float8 AS health_score,
          ${parsedCloseDateSql("o")} AS close_d,
          o.forecast_stage,
          o.sales_stage,
          ${crmBucketCaseSql("o")} AS crm_bucket
        FROM opportunities o
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = o.org_id
         AND stm.field = 'stage'
         AND stm.stage_value = o.sales_stage
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND fcm.stage_value = o.forecast_stage
        WHERE o.org_id = $1::bigint
          AND o.rep_id = ANY($3::bigint[])
          AND o.partner_name IS NOT NULL
          AND btrim(o.partner_name) <> ''
      ),
      deals_in_period AS (
        SELECT d.*
        FROM deals d
        JOIN qp ON TRUE
        WHERE d.close_d IS NOT NULL
          AND d.close_d >= qp.period_start
          AND d.close_d <= qp.period_end
      )
      SELECT
        partner_name,
        COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN amount ELSE 0 END), 0)::float8 AS won_amount,
        COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::int AS won_count,
        COALESCE(SUM(CASE WHEN crm_bucket NOT IN ('won', 'lost', 'excluded') THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
        COALESCE(SUM(CASE WHEN crm_bucket NOT IN ('won', 'lost', 'excluded') THEN 1 ELSE 0 END), 0)::int AS pipeline_count,
        COALESCE(SUM(CASE WHEN crm_bucket = 'lost' THEN amount ELSE 0 END), 0)::float8 AS lost_amount,
        COALESCE(SUM(CASE WHEN crm_bucket = 'lost' THEN 1 ELSE 0 END), 0)::int AS lost_count,
        CASE
          WHEN COALESCE(SUM(CASE WHEN crm_bucket IN ('won', 'lost') THEN 1 ELSE 0 END), 0) = 0 THEN NULL
          ELSE
            COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::float8
            / NULLIF(COALESCE(SUM(CASE WHEN crm_bucket IN ('won', 'lost') THEN 1 ELSE 0 END), 0), 0)::float8
        END AS win_rate,
        AVG(NULLIF(health_score, 0))::float8 AS avg_health
      FROM deals_in_period
      GROUP BY partner_name
      ORDER BY won_amount DESC, partner_name ASC
      `,
      [args.orgId, args.selectedQuotaPeriodId, args.territoryRepIds]
    );
    return (rows || []).map((row) => ({
      partner_name: cleanText(row.partner_name, "(Unknown Partner)"),
      won_amount: num(row.won_amount),
      won_count: intNum(row.won_count),
      pipeline_amount: num(row.pipeline_amount),
      pipeline_count: intNum(row.pipeline_count),
      lost_amount: num(row.lost_amount),
      lost_count: intNum(row.lost_count),
      win_rate: row.win_rate == null ? null : num(row.win_rate),
      avg_health: nullableNum(row.avg_health),
    }));
  } catch (error) {
    logError("loadPartnerSummary", error);
    return [];
  }
}

async function loadTopPartnerDeals(args: {
  orgId: number;
  selectedQuotaPeriodId: string;
  territoryRepIds: number[];
  mode: "won" | "lost" | "pipeline";
}): Promise<ChannelDeal[]> {
  if (!args.selectedQuotaPeriodId || args.territoryRepIds.length === 0) return [];
  try {
    const { rows } = await pool.query<ChannelDeal>(
      `
      WITH qp AS (
        SELECT
          COALESCE(NULLIF(btrim(period_name), ''), period_start::text || ' -> ' || period_end::text) AS period_name,
          period_start::date AS period_start,
          period_end::date AS period_end
        FROM quota_periods
        WHERE org_id = $1::bigint
          AND id = $2::bigint
        LIMIT 1
      ),
      deals AS (
        SELECT
          COALESCE(o.public_id::text, o.id::text) AS id,
          COALESCE(NULLIF(btrim(o.opportunity_name), ''), '(Unnamed Deal)') AS deal_name,
          COALESCE(NULLIF(btrim(o.account_name), ''), '(Unnamed Account)') AS account_name,
          btrim(o.partner_name) AS partner_name,
          COALESCE(NULLIF(btrim(o.rep_name), ''), '(Unnamed Rep)') AS rep_name,
          COALESCE(o.amount, 0)::float8 AS amount,
          ${parsedCloseDateSql("o")} AS close_d,
          COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') AS forecast_stage,
          o.health_score::float8 AS health_score,
          o.forecast_stage AS forecast_stage_raw,
          o.sales_stage,
          ${crmBucketCaseSql("o")} AS crm_bucket
        FROM opportunities o
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = o.org_id
         AND stm.field = 'stage'
         AND stm.stage_value = o.sales_stage
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND fcm.stage_value = o.forecast_stage
        WHERE o.org_id = $1::bigint
          AND o.rep_id = ANY($3::bigint[])
          AND o.partner_name IS NOT NULL
          AND btrim(o.partner_name) <> ''
      )
      SELECT
        d.id,
        d.deal_name,
        d.account_name,
        d.partner_name,
        d.rep_name,
        d.amount,
        COALESCE(d.close_d::text, '') AS close_date,
        d.forecast_stage,
        d.health_score,
        d.crm_bucket,
        qp.period_name
      FROM deals d
      JOIN qp ON TRUE
      WHERE d.close_d IS NOT NULL
        AND d.close_d >= qp.period_start
        AND d.close_d <= qp.period_end
        AND (
          ($4::text = 'won' AND d.crm_bucket = 'won')
          OR ($4::text = 'lost' AND d.crm_bucket = 'lost')
          OR (
            $4::text = 'pipeline'
            AND d.crm_bucket NOT IN ('won', 'lost', 'excluded')
            AND d.close_d >= CURRENT_DATE
          )
        )
      ORDER BY d.amount DESC NULLS LAST, d.id DESC
      LIMIT 20
      `,
      [args.orgId, args.selectedQuotaPeriodId, args.territoryRepIds, args.mode]
    );
    return (rows || []).map((row) => ({
      id: cleanText(row.id),
      deal_name: cleanText(row.deal_name, "(Unnamed Deal)"),
      account_name: cleanText(row.account_name, "(Unnamed Account)"),
      partner_name: cleanText(row.partner_name),
      rep_name: cleanText(row.rep_name, "(Unnamed Rep)"),
      amount: num(row.amount),
      close_date: cleanText(row.close_date),
      forecast_stage: cleanText(row.forecast_stage),
      health_score: nullableNum(row.health_score),
      crm_bucket: cleanText(row.crm_bucket),
      period_name: cleanText(row.period_name),
    }));
  } catch (error) {
    logError(`loadTopPartnerDeals:${args.mode}`, error);
    return [];
  }
}

async function loadChannelRepRows(args: {
  orgId: number;
  selectedQuotaPeriodId: string;
  channelRepIds: number[];
  territoryRepIds: number[];
  channelClosedWon: number;
}): Promise<ChannelRepRow[]> {
  if (!args.selectedQuotaPeriodId || args.channelRepIds.length === 0) return [];
  try {
    const { rows } = await pool.query<{
      rep_id: string;
      rep_name: string;
      manager_name: string;
      quota: number;
      won_amount: number;
      won_count: number;
      pipeline_amount: number;
      partner_deals_won: number;
      partner_deals_pipeline: number;
    }>(
      `
      WITH qp AS (
        SELECT period_start::date AS period_start, period_end::date AS period_end
        FROM quota_periods
        WHERE org_id = $1::bigint
          AND id = $2::bigint
        LIMIT 1
      ),
      reps_scope AS (
        SELECT
          r.id::text AS rep_id,
          COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), '(Unnamed Rep)') AS rep_name,
          COALESCE(NULLIF(btrim(m.display_name), ''), NULLIF(btrim(m.rep_name), ''), '(No Manager)') AS manager_name
        FROM reps r
        LEFT JOIN reps m
          ON m.id = r.manager_rep_id
        WHERE r.organization_id = $1::bigint
          AND r.id = ANY($3::bigint[])
      ),
      quota_by_rep AS (
        SELECT q.rep_id::text AS rep_id, COALESCE(SUM(q.quota_amount), 0)::float8 AS quota
        FROM quotas q
        WHERE q.org_id = $1::bigint
          AND q.quota_period_id = $2::bigint
          AND q.rep_id = ANY($3::bigint[])
        GROUP BY q.rep_id::text
      ),
      deals AS (
        SELECT
          o.rep_id::text AS rep_id,
          COALESCE(o.amount, 0)::float8 AS amount,
          ${parsedCloseDateSql("o")} AS close_d,
          o.forecast_stage,
          o.sales_stage,
          ${crmBucketCaseSql("o")} AS crm_bucket
        FROM opportunities o
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = o.org_id
         AND stm.field = 'stage'
         AND stm.stage_value = o.sales_stage
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND fcm.stage_value = o.forecast_stage
        WHERE o.org_id = $1::bigint
          AND o.rep_id = ANY($4::bigint[])
          AND o.partner_name IS NOT NULL
          AND btrim(o.partner_name) <> ''
      ),
      deals_in_period AS (
        SELECT d.*
        FROM deals d
        JOIN qp ON TRUE
        WHERE d.close_d IS NOT NULL
          AND d.close_d >= qp.period_start
          AND d.close_d <= qp.period_end
      ),
      rollup AS (
        SELECT
          rep_id,
          COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN amount ELSE 0 END), 0)::float8 AS won_amount,
          COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::int AS won_count,
          COALESCE(SUM(CASE WHEN crm_bucket NOT IN ('won', 'lost', 'excluded') THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
          COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::int AS partner_deals_won,
          COALESCE(SUM(CASE WHEN crm_bucket NOT IN ('won', 'lost', 'excluded') THEN 1 ELSE 0 END), 0)::int AS partner_deals_pipeline
        FROM deals_in_period
        GROUP BY rep_id
      )
      SELECT
        rs.rep_id,
        rs.rep_name,
        rs.manager_name,
        COALESCE(qr.quota, 0)::float8 AS quota,
        COALESCE(rr.won_amount, 0)::float8 AS won_amount,
        COALESCE(rr.won_count, 0)::int AS won_count,
        COALESCE(rr.pipeline_amount, 0)::float8 AS pipeline_amount,
        COALESCE(rr.partner_deals_won, 0)::int AS partner_deals_won,
        COALESCE(rr.partner_deals_pipeline, 0)::int AS partner_deals_pipeline
      FROM reps_scope rs
      LEFT JOIN quota_by_rep qr
        ON qr.rep_id = rs.rep_id
      LEFT JOIN rollup rr
        ON rr.rep_id = rs.rep_id
      ORDER BY rs.rep_name ASC, rs.rep_id ASC
      `,
      [args.orgId, args.selectedQuotaPeriodId, args.channelRepIds, args.territoryRepIds]
    );
    return (rows || []).map((row) => {
      const quota = num(row.quota);
      const wonAmount = num(row.won_amount);
      return {
        rep_id: cleanText(row.rep_id),
        rep_name: cleanText(row.rep_name, "(Unnamed Rep)"),
        manager_name: cleanText(row.manager_name, "(No Manager)"),
        quota,
        won_amount: wonAmount,
        won_count: intNum(row.won_count),
        pipeline_amount: num(row.pipeline_amount),
        attainment: quotaPct(wonAmount, quota),
        partner_deals_won: intNum(row.partner_deals_won),
        partner_deals_pipeline: intNum(row.partner_deals_pipeline),
        contribution_pct: quotaPct(wonAmount, args.channelClosedWon),
      };
    });
  } catch (error) {
    logError("loadChannelRepRows", error);
    return [];
  }
}

async function loadProductsViaPartner(args: {
  orgId: number;
  selectedQuotaPeriodId: string;
  territoryRepIds: number[];
}): Promise<ProductViaPartnerRow[]> {
  if (!args.selectedQuotaPeriodId || args.territoryRepIds.length === 0) return [];
  try {
    const { rows } = await pool.query<ProductViaPartnerRow>(
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
          COALESCE(NULLIF(btrim(o.product), ''), '(Unspecified)') AS product_name,
          COALESCE(o.amount, 0)::float8 AS amount,
          ${parsedCloseDateSql("o")} AS close_d,
          o.forecast_stage,
          o.sales_stage,
          ${crmBucketCaseSql("o")} AS crm_bucket
        FROM opportunities o
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = o.org_id
         AND stm.field = 'stage'
         AND stm.stage_value = o.sales_stage
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND fcm.stage_value = o.forecast_stage
        WHERE o.org_id = $1::bigint
          AND o.rep_id = ANY($3::bigint[])
          AND o.partner_name IS NOT NULL
          AND btrim(o.partner_name) <> ''
      ),
      deals_in_period AS (
        SELECT d.*
        FROM deals d
        JOIN qp ON TRUE
        WHERE d.close_d IS NOT NULL
          AND d.close_d >= qp.period_start
          AND d.close_d <= qp.period_end
      )
      SELECT
        product_name,
        COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN amount ELSE 0 END), 0)::float8 AS amount,
        COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::int AS count
      FROM deals_in_period
      GROUP BY product_name
      HAVING COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN amount ELSE 0 END), 0) > 0
      ORDER BY amount DESC, product_name ASC
      `,
      [args.orgId, args.selectedQuotaPeriodId, args.territoryRepIds]
    );
    return (rows || []).map((row) => ({
      product_name: cleanText(row.product_name, "(Unspecified)"),
      amount: num(row.amount),
      count: intNum(row.count),
    }));
  } catch (error) {
    logError("loadProductsViaPartner", error);
    return [];
  }
}

async function loadPipelineByQuarter(args: {
  orgId: number;
  nextPeriodIds: string[];
  territoryRepIds: number[];
}): Promise<PipelineQuarterRow[]> {
  if (args.nextPeriodIds.length === 0 || args.territoryRepIds.length === 0) return [];
  try {
    const { rows } = await pool.query<PipelineQuarterRow>(
      `
      WITH qps AS (
        SELECT
          id::text AS period_id,
          COALESCE(NULLIF(btrim(period_name), ''), period_start::text || ' -> ' || period_end::text) AS period_name,
          period_start::date AS period_start,
          period_end::date AS period_end
        FROM quota_periods
        WHERE org_id = $1::bigint
          AND id::text = ANY($2::text[])
      ),
      deals AS (
        SELECT
          COALESCE(o.amount, 0)::float8 AS amount,
          ${parsedCloseDateSql("o")} AS close_d,
          o.forecast_stage,
          o.sales_stage,
          ${crmBucketCaseSql("o")} AS crm_bucket
        FROM opportunities o
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = o.org_id
         AND stm.field = 'stage'
         AND stm.stage_value = o.sales_stage
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND fcm.stage_value = o.forecast_stage
        WHERE o.org_id = $1::bigint
          AND o.rep_id = ANY($3::bigint[])
          AND o.partner_name IS NOT NULL
          AND btrim(o.partner_name) <> ''
      )
      SELECT
        qps.period_id,
        qps.period_name,
        COALESCE(SUM(CASE WHEN d.crm_bucket = 'commit' THEN d.amount ELSE 0 END), 0)::float8 AS commit,
        COALESCE(SUM(CASE WHEN d.crm_bucket = 'best_case' THEN d.amount ELSE 0 END), 0)::float8 AS best_case,
        COALESCE(SUM(CASE WHEN d.crm_bucket NOT IN ('won', 'lost', 'excluded') THEN d.amount ELSE 0 END), 0)::float8 AS pipeline,
        COALESCE(SUM(CASE WHEN d.crm_bucket NOT IN ('won', 'lost', 'excluded') THEN d.amount ELSE 0 END), 0)::float8 AS total,
        COALESCE(SUM(CASE WHEN d.crm_bucket NOT IN ('won', 'lost', 'excluded') THEN 1 ELSE 0 END), 0)::int AS count
      FROM qps
      LEFT JOIN deals d
        ON d.close_d IS NOT NULL
       AND d.close_d >= qps.period_start
       AND d.close_d <= qps.period_end
      GROUP BY qps.period_id, qps.period_name, qps.period_start
      ORDER BY qps.period_start ASC, qps.period_id ASC
      `,
      [args.orgId, args.nextPeriodIds, args.territoryRepIds]
    );
    return (rows || []).map((row) => ({
      period_id: cleanText(row.period_id),
      period_name: cleanText(row.period_name),
      commit: num(row.commit),
      best_case: num(row.best_case),
      pipeline: num(row.pipeline),
      total: num(row.total),
      count: intNum(row.count),
    }));
  } catch (error) {
    logError("loadPipelineByQuarter", error);
    return [];
  }
}

async function loadRepDirectory(args: {
  orgId: number;
  territoryRepIds: number[];
  channelRepIds: number[];
  viewerChannelRepId: number | null;
}): Promise<RepDirectoryRow[]> {
  const repIds = uniqIds([
    ...args.territoryRepIds,
    ...args.channelRepIds,
    args.viewerChannelRepId,
  ]);
  if (repIds.length === 0) return [];
  try {
    const { rows } = await pool.query<RepDirectoryRow>(
      `
      SELECT
        r.id,
        COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), '(Unnamed)') AS name,
        r.role,
        u.hierarchy_level,
        r.manager_rep_id,
        r.user_id,
        r.active
      FROM reps r
      LEFT JOIN users u
        ON u.org_id = $1::bigint
       AND u.id = r.user_id
      WHERE r.organization_id = $1::bigint
        AND r.id = ANY($2::bigint[])
      ORDER BY COALESCE(u.hierarchy_level, 99) ASC, name ASC, r.id ASC
      `,
      [args.orgId, repIds]
    );
    return (rows || []).map((row) => ({
      id: intNum(row.id),
      name: cleanText(row.name, "(Unnamed)"),
      role: row.role == null ? null : cleanText(row.role),
      hierarchy_level: row.hierarchy_level == null ? null : intNum(row.hierarchy_level),
      manager_rep_id: row.manager_rep_id == null ? null : intNum(row.manager_rep_id),
      user_id: row.user_id == null ? null : intNum(row.user_id),
      active: row.active == null ? null : !!row.active,
    }));
  } catch (error) {
    logError("loadRepDirectory", error);
    return [];
  }
}

export async function getChannelDashboardSummary(args: {
  orgId: number;
  userId: number;
  hierarchyLevel: number;
  selectedQuotaPeriodId: string;
  territoryRepIds: number[];
  channelRepIds: number[];
  viewerChannelRepId: number | null;
  viewerUserId: number;
}): Promise<ChannelDashboardSummary> {
  const selectedQuotaPeriodIdParam = cleanText(args.selectedQuotaPeriodId);
  const base = emptySummary(selectedQuotaPeriodIdParam);

  const periods = await loadPeriods(args.orgId);
  const todayIso = isoDateOnly(new Date());
  const containingToday =
    periods.find((period) => period.period_start <= todayIso && period.period_end >= todayIso) || null;
  const defaultPeriod = containingToday || periods[periods.length - 1] || null;
  const selectedPeriod =
    periods.find((period) => period.id === selectedQuotaPeriodIdParam) || defaultPeriod || null;
  const selectedQuotaPeriodId = cleanText(selectedPeriod?.id, selectedQuotaPeriodIdParam);
  const fiscalYear = cleanText(selectedPeriod?.fiscal_year);

  const territoryRepIds = uniqIds(args.territoryRepIds);
  const channelRepIds = uniqIds(args.channelRepIds);
  const periodIdx = periods.findIndex((period) => period.id === selectedQuotaPeriodId);
  const nextPeriodIds =
    periodIdx >= 0
      ? periods.slice(periodIdx + 1, periodIdx + 4).map((period) => period.id)
      : [];

  const aiCachePrefix = [
    "channel-dashboard",
    String(args.orgId),
    selectedQuotaPeriodId || "none",
    String(args.userId),
    String(args.viewerUserId),
    args.viewerChannelRepId == null ? "none" : String(args.viewerChannelRepId),
  ].join(":");

  const [channelQuota, channelRevenue, territoryClosedWon, partnerSummary, topPartnerDealsWon, topPartnerDealsLost, topPartnerDealsPipeline, productsViaPartner, pipelineByQuarter, repDirectory] =
    await Promise.all([
      loadChannelQuota({
        orgId: args.orgId,
        selectedQuotaPeriodId,
        hierarchyLevel: args.hierarchyLevel,
        viewerChannelRepId: args.viewerChannelRepId,
        viewerUserId: args.viewerUserId,
      }),
      loadChannelRevenue({
        orgId: args.orgId,
        selectedQuotaPeriodId,
        territoryRepIds,
      }),
      loadTerritoryClosedWon({
        orgId: args.orgId,
        selectedQuotaPeriodId,
        territoryRepIds,
      }),
      loadPartnerSummary({
        orgId: args.orgId,
        selectedQuotaPeriodId,
        territoryRepIds,
      }),
      loadTopPartnerDeals({
        orgId: args.orgId,
        selectedQuotaPeriodId,
        territoryRepIds,
        mode: "won",
      }),
      loadTopPartnerDeals({
        orgId: args.orgId,
        selectedQuotaPeriodId,
        territoryRepIds,
        mode: "lost",
      }),
      loadTopPartnerDeals({
        orgId: args.orgId,
        selectedQuotaPeriodId,
        territoryRepIds,
        mode: "pipeline",
      }),
      loadProductsViaPartner({
        orgId: args.orgId,
        selectedQuotaPeriodId,
        territoryRepIds,
      }),
      loadPipelineByQuarter({
        orgId: args.orgId,
        nextPeriodIds,
        territoryRepIds,
      }),
      loadRepDirectory({
        orgId: args.orgId,
        territoryRepIds,
        channelRepIds,
        viewerChannelRepId: args.viewerChannelRepId,
      }),
    ]);

  const channelRepRows = await loadChannelRepRows({
    orgId: args.orgId,
    selectedQuotaPeriodId,
    channelRepIds,
    territoryRepIds,
    channelClosedWon: channelRevenue.channel_closed_won,
  });

  const contributionPct = quotaPct(channelRevenue.channel_closed_won, territoryClosedWon);
  const channelGap = Math.max(0, channelQuota - channelRevenue.channel_closed_won);
  const channelGapPct = quotaPct(channelGap, channelQuota);

  return {
    ...base,
    periods,
    selectedPeriod,
    selectedQuotaPeriodId,
    fiscalYear,
    channelQuota,
    channelClosedWon: channelRevenue.channel_closed_won,
    channelClosedWonCount: channelRevenue.channel_closed_won_count,
    channelCommit: channelRevenue.channel_commit,
    channelBestCase: channelRevenue.channel_best_case,
    channelPipeline: channelRevenue.channel_pipeline,
    channelPipelineCount: channelRevenue.channel_pipeline_count,
    territoryClosedWon,
    contributionPct,
    channelGap,
    channelGapPct,
    partnerSummary,
    topPartnerDealsWon,
    topPartnerDealsLost,
    topPartnerDealsPipeline,
    channelRepRows,
    productsViaPartner,
    pipelineByQuarter,
    aiCachePrefix,
    repDirectory,
  };
}
