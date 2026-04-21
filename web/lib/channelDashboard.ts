import "server-only";

import { pool } from "./pool";
import { getChannelTerritoryRepIds } from "./channelTerritoryScope";
import type { RepDirectoryRow } from "./repScope";
import { crmBucketCaseSql as crmBucketCaseSqlExpr } from "./crmBucketCaseSql";

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
  /** Linked user account active; omit or non-`false` = active. */
  active?: boolean;
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

export type ChannelRepFyQuarterRow = {
  rep_id: string;
  rep_int_id: string;
  period_id: string;
  period_name: string;
  fiscal_quarter: string;
  won_amount: number;
  quota: number;
  attainment: number | null;
  won_count: number;
  lost_amount: number;
  lost_count: number;
  pipeline_amount: number;
  active_count: number;
  avg_days_won: number | null;
  avg_days_lost: number | null;
  avg_days_active: number | null;
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
  return crmBucketCaseSqlExpr(rowAlias);
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

function partnerScopeSql(rowAlias: string, parameterIndex: number) {
  return `(
    CASE
      WHEN $${parameterIndex}::text[] = '{}'::text[]
      THEN (
        ${rowAlias}.partner_name IS NOT NULL
        AND btrim(${rowAlias}.partner_name) <> ''
      )
      ELSE lower(btrim(${rowAlias}.partner_name)) = ANY($${parameterIndex}::text[])
    END
  )`;
}

function normalizePartnerNames(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => cleanText(value).trim().toLowerCase())
        .filter(Boolean)
    )
  );
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
        COALESCE(fiscal_quarter::text, '') AS fiscal_quarter,
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
  assignedPartnerNames: string[];
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
         AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
        WHERE o.org_id = $1::bigint
          AND o.rep_id = ANY($3::bigint[])
          AND ${partnerScopeSql("o", 4)}
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
      [args.orgId, args.selectedQuotaPeriodId, args.territoryRepIds, args.assignedPartnerNames]
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
         AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
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

/**
 * Same contribution definition as `/dashboard/channel` hero: partner-scoped channel closed-won
 * vs all closed-won on the territory reps (sales team). Percent is 0–100 scale for display.
 */
export async function loadChannelContributionForTerritory(args: {
  orgId: number;
  quotaPeriodId: string;
  territoryRepIds: number[];
  assignedPartnerNames: string[];
}): Promise<{ channelClosedWon: number; salesTeamClosedWon: number; contributionPct: number | null }> {
  const empty = { channelClosedWon: 0, salesTeamClosedWon: 0, contributionPct: null as number | null };
  if (!args.quotaPeriodId || args.territoryRepIds.length === 0) return empty;
  try {
    const [rev, salesTeamClosedWon] = await Promise.all([
      loadChannelRevenue({
        orgId: args.orgId,
        selectedQuotaPeriodId: args.quotaPeriodId,
        territoryRepIds: args.territoryRepIds,
        assignedPartnerNames: args.assignedPartnerNames,
      }),
      loadTerritoryClosedWon({
        orgId: args.orgId,
        selectedQuotaPeriodId: args.quotaPeriodId,
        territoryRepIds: args.territoryRepIds,
      }),
    ]);
    const channelClosedWon = rev.channel_closed_won;
    const contributionPct =
      salesTeamClosedWon > 0 ? (channelClosedWon / salesTeamClosedWon) * 100 : null;
    return { channelClosedWon, salesTeamClosedWon, contributionPct };
  } catch (error) {
    logError("loadChannelContributionForTerritory", error);
    return empty;
  }
}

async function loadPartnerSummary(args: {
  orgId: number;
  selectedQuotaPeriodId: string;
  territoryRepIds: number[];
  assignedPartnerNames: string[];
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
         AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
        WHERE o.org_id = $1::bigint
          AND o.rep_id = ANY($3::bigint[])
          AND ${partnerScopeSql("o", 4)}
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
      [args.orgId, args.selectedQuotaPeriodId, args.territoryRepIds, args.assignedPartnerNames]
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
  assignedPartnerNames: string[];
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
          COALESCE(
            NULLIF(btrim(r.rep_name), ''),
            NULLIF(btrim(r.display_name), ''),
            NULLIF(btrim(o.rep_name), ''),
            '(Unnamed Rep)'
          ) AS rep_name,
          COALESCE(o.amount, 0)::float8 AS amount,
          ${parsedCloseDateSql("o")} AS close_d,
          COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') AS forecast_stage,
          o.health_score::float8 AS health_score,
          o.forecast_stage AS forecast_stage_raw,
          o.sales_stage,
          ${crmBucketCaseSql("o")} AS crm_bucket
        FROM opportunities o
        LEFT JOIN reps r
          ON r.id = o.rep_id
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = o.org_id
         AND stm.field = 'stage'
         AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
        WHERE o.org_id = $1::bigint
          AND o.rep_id = ANY($3::bigint[])
          AND ${partnerScopeSql("o", 4)}
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
          ($5::text = 'won' AND d.crm_bucket = 'won')
          OR ($5::text = 'lost' AND d.crm_bucket = 'lost')
          OR (
            $5::text = 'pipeline'
            AND d.crm_bucket NOT IN ('won', 'lost', 'excluded')
            AND d.close_d >= CURRENT_DATE
          )
        )
      ORDER BY d.amount DESC NULLS LAST, d.id DESC
      LIMIT 10
      `,
      [args.orgId, args.selectedQuotaPeriodId, args.territoryRepIds, args.assignedPartnerNames, args.mode]
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
  assignedPartnerNames: string[];
  channelClosedWon: number;
}): Promise<ChannelRepRow[]> {
  if (!args.selectedQuotaPeriodId || args.channelRepIds.length === 0) return [];
  try {
    type ChannelRepMetricRow = {
      repId: number;
      won_amount: number;
      won_count: number;
      pipeline_amount: number;
      partner_deals_won: number;
      partner_deals_pipeline: number;
    };

    const [repScopeRes, quotaRes] = await Promise.all([
      pool.query<{
        rep_id: number;
        user_id: number;
        rep_name: string;
        manager_name: string;
        user_active: boolean | null;
      }>(
        `
        SELECT
          r.id AS rep_id,
          u.id AS user_id,
          COALESCE(NULLIF(btrim(r.rep_name), ''), NULLIF(btrim(r.display_name), ''), '(Unnamed Rep)') AS rep_name,
          COALESCE(NULLIF(btrim(m.display_name), ''), NULLIF(btrim(m.rep_name), ''), '(No Manager)') AS manager_name,
          u.active AS user_active
        FROM reps r
        JOIN users u
          ON u.id = r.user_id
         AND u.org_id = $1::bigint
        LEFT JOIN reps m
          ON m.id = r.manager_rep_id
        WHERE r.organization_id = $1::bigint
          AND r.id = ANY($2::bigint[])
          AND COALESCE(u.hierarchy_level, 99) = 8
        ORDER BY rep_name ASC, r.id ASC
        `,
        [args.orgId, args.channelRepIds]
      ),
      pool.query<{ rep_id: number; quota: number }>(
        `
        SELECT
          q.rep_id,
          COALESCE(SUM(q.quota_amount), 0)::float8 AS quota
        FROM quotas q
        WHERE q.org_id = $1::bigint
          AND q.quota_period_id = $2::bigint
          AND q.rep_id = ANY($3::bigint[])
        GROUP BY q.rep_id
        `,
        [args.orgId, args.selectedQuotaPeriodId, args.channelRepIds]
      ),
    ]);

    const repScopeRows = repScopeRes.rows || [];
    if (!repScopeRows.length) return [];

    const quotaByRepId = new Map<number, number>();
    for (const row of quotaRes.rows || []) {
      const repId = Number(row.rep_id);
      if (Number.isFinite(repId) && repId > 0) {
        quotaByRepId.set(repId, num(row.quota));
      }
    }

    const assignmentRows = await pool
      .query<{ channel_rep_id: number; partner_name: string | null }>(
        `
        SELECT
          channel_rep_id,
          lower(btrim(partner_name)) AS partner_name
        FROM partner_channel_assignments
        WHERE org_id = $1::bigint
          AND channel_rep_id = ANY($2::int[])
        `,
        [args.orgId, repScopeRows.map((row) => Number(row.user_id))]
      )
      .then((res) => res.rows || [])
      .catch(() => []);

    const partnerNamesByUserId = new Map<number, string[]>();
    for (const row of assignmentRows) {
      const userId = Number(row.channel_rep_id);
      if (!Number.isFinite(userId) || userId <= 0) continue;
      const current = partnerNamesByUserId.get(userId) || [];
      const partnerName = cleanText(row.partner_name).toLowerCase();
      if (partnerName) current.push(partnerName);
      partnerNamesByUserId.set(userId, current);
    }
    for (const [userId, values] of partnerNamesByUserId.entries()) {
      partnerNamesByUserId.set(userId, Array.from(new Set(values.filter(Boolean))));
    }

    const metricRows: ChannelRepMetricRow[] = await Promise.all(
      repScopeRows.map(async (row) => {
        const repId = Number(row.rep_id);
        const userId = Number(row.user_id);
        const territoryScope = await getChannelTerritoryRepIds({
          orgId: args.orgId,
          channelUserId: userId,
        }).catch(() => ({ repIds: [] as number[], partnerNames: [] as string[] }));
        const territoryRepIds = territoryScope.repIds;
        const assignedPartnerNames = partnerNamesByUserId.get(userId) || [];

        if (!territoryRepIds.length && !assignedPartnerNames.length) {
          return {
            repId,
            won_amount: 0,
            won_count: 0,
            pipeline_amount: 0,
            partner_deals_won: 0,
            partner_deals_pipeline: 0,
          };
        }

        const effectiveTerritoryRepIds = territoryRepIds.length > 0 ? territoryRepIds : [-1];
        const { rows } = await pool.query<{
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
          deals AS (
            SELECT
              COALESCE(o.amount, 0)::float8 AS amount,
              ${parsedCloseDateSql("o")} AS close_d,
              ${crmBucketCaseSql("o")} AS crm_bucket
            FROM opportunities o
            LEFT JOIN org_stage_mappings stm
              ON stm.org_id = o.org_id
             AND stm.field = 'stage'
             AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
            LEFT JOIN org_stage_mappings fcm
              ON fcm.org_id = o.org_id
             AND fcm.field = 'forecast_category'
             AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
            WHERE o.org_id = $1::bigint
              AND o.rep_id = ANY($3::bigint[])
              AND ${partnerScopeSql("o", 4)}
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
            COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN amount ELSE 0 END), 0)::float8 AS won_amount,
            COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::int AS won_count,
            COALESCE(SUM(CASE WHEN crm_bucket NOT IN ('won', 'lost', 'excluded') THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
            COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::int AS partner_deals_won,
            COALESCE(SUM(CASE WHEN crm_bucket NOT IN ('won', 'lost', 'excluded') THEN 1 ELSE 0 END), 0)::int AS partner_deals_pipeline
          FROM deals_in_period
          `,
          [args.orgId, args.selectedQuotaPeriodId, effectiveTerritoryRepIds, assignedPartnerNames]
        );

        return {
          repId,
          won_amount: num(rows?.[0]?.won_amount),
          won_count: intNum(rows?.[0]?.won_count),
          pipeline_amount: num(rows?.[0]?.pipeline_amount),
          partner_deals_won: intNum(rows?.[0]?.partner_deals_won),
          partner_deals_pipeline: intNum(rows?.[0]?.partner_deals_pipeline),
        };
      })
    );

    const metricsByRepId = new Map<number, ChannelRepMetricRow>(
      metricRows.map((row) => [row.repId, row] as const)
    );

    return repScopeRows.map((row) => {
      const repId = Number(row.rep_id);
      const quota = quotaByRepId.get(repId) || 0;
      const metrics = metricsByRepId.get(repId);
      const wonAmount = num(metrics?.won_amount);
      return {
        rep_id: cleanText(row.rep_id),
        rep_name: cleanText(row.rep_name, "(Unnamed Rep)"),
        active: row.user_active !== false,
        manager_name: cleanText(row.manager_name, "(No Manager)"),
        quota,
        won_amount: wonAmount,
        won_count: intNum(metrics?.won_count),
        pipeline_amount: num(metrics?.pipeline_amount),
        attainment: quotaPct(wonAmount, quota),
        partner_deals_won: intNum(metrics?.partner_deals_won),
        partner_deals_pipeline: intNum(metrics?.partner_deals_pipeline),
        contribution_pct: quotaPct(wonAmount, args.channelClosedWon),
      };
    });
  } catch (error) {
    logError("loadChannelRepRows", error);
    return [];
  }
}

export async function loadChannelRepWonDeals(args: {
  orgId: number;
  selectedQuotaPeriodId: string;
  channelRepIds: number[]; // role-8 rep INTEGER IDs
}): Promise<Map<number, Array<{ opp_id: number; amount: number }>>> {
  const out = new Map<number, Array<{ opp_id: number; amount: number }>>();
  if (!args.selectedQuotaPeriodId || args.channelRepIds.length === 0) return out;

  try {
    const { rows: repScopeRows } = await pool.query<{
      rep_id: number;
      user_id: number;
    }>(
      `
      SELECT
        r.id AS rep_id,
        u.id AS user_id
      FROM reps r
      JOIN users u
        ON u.id = r.user_id
       AND u.org_id = $1::bigint
      WHERE r.organization_id = $1::bigint
        AND r.id = ANY($2::bigint[])
        AND COALESCE(u.hierarchy_level, 99) = 8
      ORDER BY r.id ASC
      `,
      [args.orgId, args.channelRepIds]
    );

    const scopeList = repScopeRows || [];
    if (!scopeList.length) return out;

    const assignmentRows = await pool
      .query<{ channel_rep_id: number; partner_name: string | null }>(
        `
        SELECT
          channel_rep_id,
          lower(btrim(partner_name)) AS partner_name
        FROM partner_channel_assignments
        WHERE org_id = $1::bigint
          AND channel_rep_id = ANY($2::int[])
        `,
        [args.orgId, scopeList.map((r) => Number(r.user_id))]
      )
      .then((res) => res.rows || [])
      .catch(() => []);

    const partnerNamesByUserId = new Map<number, string[]>();
    for (const row of assignmentRows) {
      const userId = Number(row.channel_rep_id);
      if (!Number.isFinite(userId) || userId <= 0) continue;
      const current = partnerNamesByUserId.get(userId) || [];
      const partnerName = cleanText(row.partner_name).toLowerCase();
      if (partnerName) current.push(partnerName);
      partnerNamesByUserId.set(userId, current);
    }
    for (const [userId, values] of partnerNamesByUserId.entries()) {
      partnerNamesByUserId.set(userId, Array.from(new Set(values.filter(Boolean))));
    }

    await Promise.all(
      scopeList.map(async (row) => {
        const repIntId = Number(row.rep_id);
        const userId = Number(row.user_id);
        if (!Number.isFinite(repIntId) || repIntId <= 0) {
          return;
        }

        const territoryScope = await getChannelTerritoryRepIds({
          orgId: args.orgId,
          channelUserId: userId,
        }).catch(() => ({ repIds: [] as number[], partnerNames: [] as string[] }));

        const repIds = territoryScope.repIds;
        const assignedPartnerNames = partnerNamesByUserId.get(userId) || [];

        if (!repIds.length && !assignedPartnerNames.length) {
          out.set(repIntId, []);
          return;
        }

        const effectiveTerritoryRepIds = repIds.length > 0 ? repIds : [-1];

        const { rows: deals } = await pool.query<{ opp_id: number; amount: number }>(
          `
          WITH qp AS (
            SELECT period_start::date AS period_start, period_end::date AS period_end
            FROM quota_periods
            WHERE org_id = $1::bigint AND id = $2::bigint
            LIMIT 1
          ),
          deals AS (
            SELECT
              o.id AS opp_id,
              COALESCE(o.amount, 0)::float8 AS amount,
              ${parsedCloseDateSql("o")} AS close_d,
              ${crmBucketCaseSql("o")} AS crm_bucket
            FROM opportunities o
            LEFT JOIN org_stage_mappings stm
              ON stm.org_id = o.org_id
             AND stm.field = 'stage'
             AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
            LEFT JOIN org_stage_mappings fcm
              ON fcm.org_id = o.org_id
             AND fcm.field = 'forecast_category'
             AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
            WHERE o.org_id = $1::bigint
              AND o.rep_id = ANY($3::bigint[])
              AND ${partnerScopeSql("o", 4)}
          )
          SELECT d.opp_id, d.amount
          FROM deals d
          JOIN qp ON TRUE
          WHERE d.close_d IS NOT NULL
            AND d.close_d >= qp.period_start
            AND d.close_d <= qp.period_end
            AND d.crm_bucket = 'won'
          `,
          [args.orgId, args.selectedQuotaPeriodId, effectiveTerritoryRepIds, assignedPartnerNames]
        );

        out.set(
          repIntId,
          (deals || []).map((d) => ({
            opp_id: Number(d.opp_id),
            amount: Number(d.amount || 0) || 0,
          }))
        );
      })
    );

    return out;
  } catch (error) {
    logError("loadChannelRepWonDeals", error);
    return out;
  }
}

export function deduplicateWonDeals(
  wonDealsByRep: Map<number, Array<{ opp_id: number; amount: number }>>
): { wonAmount: number; wonCount: number } {
  const byOppId = new Map<number, number>();
  for (const deals of wonDealsByRep.values()) {
    for (const d of deals || []) {
      const id = Number(d.opp_id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const amt = Number(d.amount || 0) || 0;
      const prev = byOppId.get(id);
      byOppId.set(id, prev == null ? amt : Math.max(prev, amt));
    }
  }
  let wonAmount = 0;
  for (const v of byOppId.values()) wonAmount += v;
  return { wonAmount, wonCount: byOppId.size };
}

export async function loadChannelRepFyQuarterRows(args: {
  orgId: number;
  fiscalYear: string;
  channelRepIds: number[];
}): Promise<ChannelRepFyQuarterRow[]> {
  if (!args.fiscalYear || args.channelRepIds.length === 0) return [];

  try {
    const [repScopeRes, periodRes] = await Promise.all([
      pool.query<{
        rep_id: number;
        rep_public_id: string;
        user_id: number;
      }>(
        `
        SELECT
          r.id AS rep_id,
          r.public_id::text AS rep_public_id,
          u.id AS user_id
        FROM reps r
        JOIN users u
          ON u.id = r.user_id
         AND u.org_id = $1::bigint
        WHERE r.organization_id = $1::bigint
          AND r.id = ANY($2::bigint[])
          AND COALESCE(u.hierarchy_level, 99) = 8
        ORDER BY r.id ASC
        `,
        [args.orgId, args.channelRepIds]
      ),
      pool.query<{
        id: number;
        period_name: string;
        fiscal_quarter: string;
        period_start: string;
        period_end: string;
      }>(
        `
        SELECT
          id,
          period_name,
          fiscal_quarter::text AS fiscal_quarter,
          period_start::text AS period_start,
          period_end::text AS period_end
        FROM quota_periods
        WHERE org_id = $1::bigint
          AND fiscal_year::text = $2::text
        ORDER BY period_start ASC, id ASC
        `,
        [args.orgId, args.fiscalYear]
      ),
    ]);

    const repScopeRows = repScopeRes.rows || [];
    const periods = periodRes.rows || [];
    if (!repScopeRows.length || !periods.length) return [];

    const periodIds = periods
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (!periodIds.length) return [];

    const quotaRows = await pool
      .query<{ rep_id: number; period_id: number; quota: number }>(
        `
        SELECT
          q.rep_id,
          q.quota_period_id AS period_id,
          COALESCE(SUM(q.quota_amount), 0)::float8 AS quota
        FROM quotas q
        WHERE q.org_id = $1::bigint
          AND q.rep_id = ANY($2::bigint[])
          AND q.quota_period_id = ANY($3::bigint[])
        GROUP BY q.rep_id, q.quota_period_id
        `,
        [args.orgId, args.channelRepIds, periodIds]
      )
      .then((res) => res.rows || [])
      .catch(() => []);

    const quotaByRepPeriod = new Map<string, number>();
    for (const row of quotaRows) {
      const repId = Number(row.rep_id);
      const periodId = Number(row.period_id);
      if (!Number.isFinite(repId) || repId <= 0 || !Number.isFinite(periodId) || periodId <= 0) continue;
      quotaByRepPeriod.set(`${repId}:${periodId}`, num(row.quota));
    }

    const assignmentRows = await pool
      .query<{ channel_rep_id: number; partner_name: string | null }>(
        `
        SELECT
          channel_rep_id,
          lower(btrim(partner_name)) AS partner_name
        FROM partner_channel_assignments
        WHERE org_id = $1::bigint
          AND channel_rep_id = ANY($2::int[])
        `,
        [args.orgId, repScopeRows.map((row) => Number(row.user_id))]
      )
      .then((res) => res.rows || [])
      .catch(() => []);

    const partnerNamesByUserId = new Map<number, string[]>();
    for (const row of assignmentRows) {
      const userId = Number(row.channel_rep_id);
      if (!Number.isFinite(userId) || userId <= 0) continue;
      const current = partnerNamesByUserId.get(userId) || [];
      const partnerName = cleanText(row.partner_name).toLowerCase();
      if (partnerName) current.push(partnerName);
      partnerNamesByUserId.set(userId, current);
    }
    for (const [userId, values] of partnerNamesByUserId.entries()) {
      partnerNamesByUserId.set(userId, Array.from(new Set(values.filter(Boolean))));
    }

    const perRepTerritoryIds = new Map<number, number[]>();
    const allTerritoryIds = new Set<number>();
    const overlayPartnerNames = new Set<string>();

    const metricsByRepPeriod = new Map<
      string,
      {
        won_amount: number;
        won_count: number;
        lost_amount: number;
        lost_count: number;
        pipeline_amount: number;
        active_count: number;
      }
    >();
    await Promise.all(
      repScopeRows.map(async (row) => {
        const repId = Number(row.rep_id);
        const userId = Number(row.user_id);
        const territoryScope = await getChannelTerritoryRepIds({
          orgId: args.orgId,
          channelUserId: userId,
        }).catch(() => ({ repIds: [] as number[], partnerNames: [] as string[] }));
        const territoryRepIds = territoryScope.repIds;
        if (!territoryRepIds.length) return;

        const assignedPartnerNames = partnerNamesByUserId.get(userId) || [];
        perRepTerritoryIds.set(repId, territoryRepIds);
        for (const id of territoryRepIds) allTerritoryIds.add(id);
        for (const pn of assignedPartnerNames) {
          const key = String(pn || "").trim().toLowerCase();
          if (key) overlayPartnerNames.add(key);
        }

        const { rows } = await pool.query<{
          period_id: number;
          won_amount: number;
          won_count: number;
          lost_amount: number;
          lost_count: number;
          pipeline_amount: number;
          active_count: number;
        }>(
          `
          WITH qp AS (
            SELECT
              id,
              period_start::date AS period_start,
              period_end::date AS period_end
            FROM quota_periods
            WHERE org_id = $1::bigint
              AND id = ANY($2::bigint[])
          ),
          deals AS (
            SELECT
              qp.id AS period_id,
              COALESCE(o.amount, 0)::float8 AS amount,
              ${crmBucketCaseSql("o")} AS crm_bucket
            FROM opportunities o
            JOIN qp
              ON ${parsedCloseDateSql("o")} IS NOT NULL
             AND ${parsedCloseDateSql("o")} >= qp.period_start
             AND ${parsedCloseDateSql("o")} <= qp.period_end
            LEFT JOIN org_stage_mappings stm
              ON stm.org_id = o.org_id
             AND stm.field = 'stage'
             AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
            LEFT JOIN org_stage_mappings fcm
              ON fcm.org_id = o.org_id
             AND fcm.field = 'forecast_category'
             AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
            WHERE o.org_id = $1::bigint
              AND o.rep_id = ANY($3::bigint[])
              AND ${partnerScopeSql("o", 4)}
          )
          SELECT
            period_id,
            COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN amount ELSE 0 END), 0)::float8 AS won_amount,
            COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::int AS won_count,
            COALESCE(SUM(CASE WHEN crm_bucket = 'lost' THEN amount ELSE 0 END), 0)::float8 AS lost_amount,
            COALESCE(SUM(CASE WHEN crm_bucket = 'lost' THEN 1 ELSE 0 END), 0)::int AS lost_count,
            COALESCE(SUM(CASE WHEN crm_bucket NOT IN ('won','lost','excluded') THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
            COALESCE(SUM(CASE WHEN crm_bucket NOT IN ('won','lost','excluded') THEN 1 ELSE 0 END), 0)::int AS active_count
          FROM deals
          GROUP BY period_id
          `,
          [args.orgId, periodIds, territoryRepIds, assignedPartnerNames]
        );

        for (const wonRow of rows || []) {
          const periodId = Number(wonRow.period_id);
          if (!Number.isFinite(periodId) || periodId <= 0) continue;
          metricsByRepPeriod.set(`${repId}:${periodId}`, {
            won_amount: num(wonRow.won_amount),
            won_count: intNum(wonRow.won_count),
            lost_amount: num(wonRow.lost_amount),
            lost_count: intNum(wonRow.lost_count),
            pipeline_amount: num(wonRow.pipeline_amount),
            active_count: intNum(wonRow.active_count),
          });
        }
      })
    );

    // Deduped rollup across all channel rep scopes (used by leader cards).
    // Deduped by opportunity id per quota period id.
    const rollupTerritoryIds = Array.from(allTerritoryIds);
    const rollupOverlayPartnerNames = Array.from(overlayPartnerNames);
    const rollupRows = rollupTerritoryIds.length > 0 || rollupOverlayPartnerNames.length > 0
      ? await pool
          .query<{
            period_id: number;
            won_amount: number;
            won_count: number;
            lost_amount: number;
            lost_count: number;
            pipeline_amount: number;
            active_count: number;
          }>(
            `
            WITH qp AS (
              SELECT
                id,
                period_start::date AS period_start,
                period_end::date AS period_end
              FROM quota_periods
              WHERE org_id = $1::bigint
                AND id = ANY($2::bigint[])
            ),
            all_deals AS (
              SELECT DISTINCT ON (o.id, qp.id)
                o.id,
                qp.id AS period_id,
                COALESCE(o.amount, 0)::float8 AS amount,
                ${crmBucketCaseSql("o")} AS crm_bucket,
                o.rep_id::bigint AS rep_id,
                lower(btrim(COALESCE(o.partner_name, ''))) AS partner_name
              FROM opportunities o
              JOIN qp
                ON ${parsedCloseDateSql("o")} IS NOT NULL
               AND ${parsedCloseDateSql("o")} >= qp.period_start
               AND ${parsedCloseDateSql("o")} <= qp.period_end
              LEFT JOIN org_stage_mappings stm
                ON stm.org_id = o.org_id
               AND stm.field = 'stage'
               AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
              LEFT JOIN org_stage_mappings fcm
                ON fcm.org_id = o.org_id
               AND fcm.field = 'forecast_category'
               AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
              WHERE o.org_id = $1::bigint
                AND o.partner_name IS NOT NULL
                AND btrim(o.partner_name) <> ''
                AND (
                  (
                    COALESCE(array_length($3::bigint[], 1), 0) > 0
                    AND o.rep_id = ANY($3::bigint[])
                  )
                  OR (
                    COALESCE(array_length($4::text[], 1), 0) > 0
                    AND lower(btrim(COALESCE(o.partner_name, ''))) = ANY($4::text[])
                    AND NOT (
                      COALESCE(array_length($3::bigint[], 1), 0) > 0
                      AND o.rep_id = ANY($3::bigint[])
                    )
                  )
                )
              ORDER BY o.id, qp.id
            )
            SELECT
              period_id,
              COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN amount ELSE 0 END), 0)::float8 AS won_amount,
              COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::int AS won_count,
              COALESCE(SUM(CASE WHEN crm_bucket = 'lost' THEN amount ELSE 0 END), 0)::float8 AS lost_amount,
              COALESCE(SUM(CASE WHEN crm_bucket = 'lost' THEN 1 ELSE 0 END), 0)::int AS lost_count,
              COALESCE(SUM(CASE WHEN crm_bucket NOT IN ('won','lost','excluded') THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
              COALESCE(SUM(CASE WHEN crm_bucket NOT IN ('won','lost','excluded') THEN 1 ELSE 0 END), 0)::int AS active_count
            FROM all_deals
            GROUP BY period_id
            `,
            [args.orgId, periodIds, rollupTerritoryIds, rollupOverlayPartnerNames]
          )
          .then((r) => r.rows || [])
          .catch(() => [])
      : [];

    const out: ChannelRepFyQuarterRow[] = [];
    for (const rep of repScopeRows) {
      const repId = Number(rep.rep_id);
      if (!Number.isFinite(repId) || repId <= 0) continue;
      for (const period of periods) {
        const periodId = Number(period.id);
        if (!Number.isFinite(periodId) || periodId <= 0) continue;
        const m = metricsByRepPeriod.get(`${repId}:${periodId}`);
        const wonAmount = m?.won_amount ?? 0;
        const quota = quotaByRepPeriod.get(`${repId}:${periodId}`) || 0;
        out.push({
          rep_id: cleanText(rep.rep_public_id, String(repId)),
          rep_int_id: String(repId),
          period_id: String(periodId),
          period_name: cleanText(period.period_name),
          fiscal_quarter: cleanText(period.fiscal_quarter),
          won_amount: wonAmount,
          won_count: m?.won_count ?? 0,
          lost_amount: m?.lost_amount ?? 0,
          lost_count: m?.lost_count ?? 0,
          pipeline_amount: m?.pipeline_amount ?? 0,
          active_count: m?.active_count ?? 0,
          avg_days_won: null,
          avg_days_lost: null,
          avg_days_active: null,
          quota,
          attainment: quota > 0 ? wonAmount / quota : null,
        });
      }
    }

    // Append leader rollup rows with a sentinel rep_int_id.
    for (const period of periods) {
      const periodId = Number(period.id);
      if (!Number.isFinite(periodId) || periodId <= 0) continue;
      const m = (rollupRows || []).find((r) => Number(r.period_id) === periodId) ?? null;
      const wonAmount = m?.won_amount ?? 0;
      out.push({
        rep_id: "__DEDUPED_CHANNEL_ROLLUP__",
        rep_int_id: "__DEDUPED_CHANNEL_ROLLUP__",
        period_id: String(periodId),
        period_name: cleanText(period.period_name),
        fiscal_quarter: cleanText(period.fiscal_quarter),
        won_amount: wonAmount,
        won_count: m?.won_count ?? 0,
        lost_amount: m?.lost_amount ?? 0,
        lost_count: m?.lost_count ?? 0,
        pipeline_amount: m?.pipeline_amount ?? 0,
        active_count: m?.active_count ?? 0,
        avg_days_won: null,
        avg_days_lost: null,
        avg_days_active: null,
        quota: 0,
        attainment: null,
      });
    }

    return out.sort((a, b) => {
      const aq = Number(a.fiscal_quarter);
      const bq = Number(b.fiscal_quarter);
      if (Number.isFinite(aq) && Number.isFinite(bq) && aq !== bq) return aq - bq;
      const ap = Number(a.period_id);
      const bp = Number(b.period_id);
      if (Number.isFinite(ap) && Number.isFinite(bp) && ap !== bp) return ap - bp;
      const ar = Number(a.rep_int_id);
      const br = Number(b.rep_int_id);
      return (Number.isFinite(ar) ? ar : 0) - (Number.isFinite(br) ? br : 0);
    });
  } catch (error) {
    logError("loadChannelRepFyQuarterRows", error);
    return [];
  }
}

async function loadProductsViaPartner(args: {
  orgId: number;
  selectedQuotaPeriodId: string;
  territoryRepIds: number[];
  assignedPartnerNames: string[];
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
         AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
        WHERE o.org_id = $1::bigint
          AND o.rep_id = ANY($3::bigint[])
          AND ${partnerScopeSql("o", 4)}
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
      [args.orgId, args.selectedQuotaPeriodId, args.territoryRepIds, args.assignedPartnerNames]
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
  assignedPartnerNames: string[];
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
         AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
        WHERE o.org_id = $1::bigint
          AND o.rep_id = ANY($3::bigint[])
          AND ${partnerScopeSql("o", 4)}
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
      [args.orgId, args.nextPeriodIds, args.territoryRepIds, args.assignedPartnerNames]
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
      WITH input_ids AS (
        SELECT DISTINCT unnest($2::bigint[])::bigint AS id
      ),
      expanded_ids AS (
        SELECT id FROM input_ids
        UNION
        SELECT DISTINCT r.manager_rep_id::bigint AS id
          FROM reps r
          JOIN input_ids i ON i.id = r.id
         WHERE r.manager_rep_id IS NOT NULL
           AND r.manager_rep_id > 0
      )
      SELECT
        r.id,
        COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), '(Unnamed)') AS name,
        r.role,
        u.hierarchy_level,
        r.manager_rep_id,
        r.user_id,
        r.active
      FROM expanded_ids e
      JOIN reps r
        ON r.id = e.id
       AND r.organization_id = $1::bigint
      LEFT JOIN users u
        ON u.org_id = $1::bigint
       AND u.id = r.user_id
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
  assignedPartnerNames: string[];
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
  const assignedPartnerNames = normalizePartnerNames(args.assignedPartnerNames);
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
    assignedPartnerNames.length > 0 ? assignedPartnerNames.join("|") : "all-partners",
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
        assignedPartnerNames,
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
        assignedPartnerNames,
      }),
      loadTopPartnerDeals({
        orgId: args.orgId,
        selectedQuotaPeriodId,
        territoryRepIds,
        assignedPartnerNames,
        mode: "won",
      }),
      loadTopPartnerDeals({
        orgId: args.orgId,
        selectedQuotaPeriodId,
        territoryRepIds,
        assignedPartnerNames,
        mode: "lost",
      }),
      loadTopPartnerDeals({
        orgId: args.orgId,
        selectedQuotaPeriodId,
        territoryRepIds,
        assignedPartnerNames,
        mode: "pipeline",
      }),
      loadProductsViaPartner({
        orgId: args.orgId,
        selectedQuotaPeriodId,
        territoryRepIds,
        assignedPartnerNames,
      }),
      loadPipelineByQuarter({
        orgId: args.orgId,
        nextPeriodIds,
        territoryRepIds,
        assignedPartnerNames,
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
    assignedPartnerNames,
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
