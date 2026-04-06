import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { pool } from "../../../lib/pool";
import { getChannelTerritoryRepIds } from "../../../lib/channelTerritoryScope";
import { getScopedRepDirectory } from "../../../lib/repScope";
import { getChannelDashboardSummary, loadChannelRepFyQuarterRows } from "../../../lib/channelDashboard";
import { getRepKpisByPeriod, type RepPeriodKpisRow } from "../../../lib/executiveRepKpis";
import { UserTopNav } from "../../_components/UserTopNav";
import { ExecutiveTabsShellClient } from "../../components/dashboard/executive/ExecutiveTabsShellClient";
import { normalizeExecTab, type ExecTabKey } from "../../actions/execTabConstants";
import { setExecDefaultTabAction } from "../../actions/execTabPreferences";
import { ForecastPeriodFiltersClient } from "../../forecast/_components/ForecastPeriodFiltersClient";
import { getExecutiveForecastDashboardSummary } from "../../../lib/executiveForecastDashboard";
import { ExecutiveGapInsightsClient } from "../../../components/dashboard/executive/ExecutiveGapInsightsClient";
import { HIERARCHY, isChannelRep, isChannelRole } from "../../../lib/roleHelpers";
import { loadChannelLedFedRows, loadChannelPartnerHeroProps } from "../../../lib/channelPartnerHeroData";
import { ChannelTopPartnerDealsTablesClient, type TopPartnerDealRow } from "./ChannelTopPartnerDealsTablesClient";

export const runtime = "nodejs";

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

function aggregateTerritoryRepKpis(
  rows: RepPeriodKpisRow[],
  periodId: string,
  territorySalesRepIdSet: Set<string>
): RepPeriodKpisRow | null {
  const filtered = rows.filter(
    (r) => String(r.quota_period_id) === String(periodId) && territorySalesRepIdSet.has(String(r.rep_id))
  );
  if (!filtered.length) return null;

  const sumNum = (key: keyof RepPeriodKpisRow) =>
    filtered.reduce((acc, r) => acc + (Number((r as Record<string, unknown>)[key as string]) || 0), 0);

  const weightedAvg = (
    getVal: (r: RepPeriodKpisRow) => number | null | undefined,
    getWt: (r: RepPeriodKpisRow) => number
  ): number | null => {
    let wSum = 0;
    let wtTot = 0;
    for (const r of filtered) {
      const v = getVal(r);
      const wt = getWt(r);
      if (v != null && Number.isFinite(Number(v)) && wt > 0) {
        wSum += Number(v) * wt;
        wtTot += wt;
      }
    }
    return wtTot > 0 ? wSum / wtTot : null;
  };

  return {
    quota_period_id: String(periodId),
    rep_id: "",
    rep_name: "",
    total_count: sumNum("total_count"),
    won_count: sumNum("won_count"),
    lost_count: sumNum("lost_count"),
    active_count: sumNum("active_count"),
    won_amount: sumNum("won_amount"),
    active_amount: sumNum("active_amount"),
    commit_amount: sumNum("commit_amount"),
    best_amount: sumNum("best_amount"),
    pipeline_amount: sumNum("pipeline_amount"),
    partner_closed_amount: sumNum("partner_closed_amount"),
    closed_amount: sumNum("closed_amount"),
    partner_won_count: sumNum("partner_won_count"),
    partner_closed_count: sumNum("partner_closed_count"),
    avg_days_won: weightedAvg((r) => r.avg_days_won, (r) => Number(r.won_count) || 0),
    avg_days_lost: weightedAvg((r) => r.avg_days_lost, (r) => Number(r.lost_count) || 0),
    avg_days_active: weightedAvg((r) => r.avg_days_active, (r) => Number(r.active_count) || 0),
  };
}

type ChannelScopedProductRow = {
  product: string;
  won_amount: number;
  won_count: number;
  avg_order_value: number;
  avg_health_score: number | null;
};

async function loadPartnerScopedProductsForTerritory(args: {
  orgId: number;
  quotaPeriodId: string;
  territoryRepIds: number[];
  assignedPartnerNames: string[];
}): Promise<ChannelScopedProductRow[]> {
  if (!args.quotaPeriodId || !args.territoryRepIds.length) return [];
  const useRepFilter = true;
  const { rows } = await pool.query<ChannelScopedProductRow>(
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
        AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
        AND ${partnerScopeSql("o", 5)}
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
    [args.orgId, args.quotaPeriodId, args.territoryRepIds, useRepFilter, args.assignedPartnerNames]
  );
  return (rows || []) as ChannelScopedProductRow[];
}

async function listTopPartnerDealsChannel(args: {
  orgId: number;
  quotaPeriodId: string;
  outcome: "won" | "lost";
  limit: number;
  dateStart?: string | null;
  dateEnd?: string | null;
  repIds: number[] | null;
  assignedPartnerNames: string[];
}): Promise<TopPartnerDealRow[]> {
  const wantWon = args.outcome === "won";
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<TopPartnerDealRow>(
    `
    WITH qp AS (
      SELECT
        period_start::date AS period_start,
        period_end::date AS period_end,
        GREATEST(period_start::date, COALESCE($5::date, period_start::date)) AS range_start,
        LEAST(period_end::date, COALESCE($6::date, period_end::date)) AS range_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = $2::bigint
      LIMIT 1
    )
    SELECT
      o.public_id::text AS opportunity_public_id,
      btrim(o.partner_name) AS partner_name,
      o.deal_registration,
      o.account_name,
      o.opportunity_name,
      o.product,
      COALESCE(o.amount, 0)::float8 AS amount,
      o.create_date::timestamptz::text AS create_date,
      o.close_date::date::text AS close_date,
      o.baseline_health_score::float8 AS baseline_health_score,
      o.health_score::float8 AS health_score
    FROM opportunities o
    JOIN qp ON TRUE
    WHERE o.org_id = $1
      AND (NOT $8::boolean OR o.rep_id = ANY($7::bigint[]))
      AND ${partnerScopeSql("o", 9)}
      AND o.close_date IS NOT NULL
      AND o.close_date >= qp.range_start
      AND o.close_date <= qp.range_end
      AND (
        CASE
          WHEN $3::boolean THEN ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
          ELSE (
            ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
            OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% loss %')
          )
        END
      )
    ORDER BY amount DESC NULLS LAST, o.id DESC
    LIMIT $4
    `,
    [
      args.orgId,
      args.quotaPeriodId,
      wantWon,
      args.limit,
      args.dateStart || null,
      args.dateEnd || null,
      args.repIds || [],
      useRepFilter,
      args.assignedPartnerNames,
    ]
  );
  return rows || [];
}

type ChannelDashboardHeroMetrics = {
  channelQuota: number | null;
  channelClosedWon: number;
  channelCommit: number;
  channelBestCase: number;
  channelPipeline: number;
  salesTeamClosedWon: number;
};

function mapChannelHierarchyToQuotaRoleLevel(level: number | null | undefined): number | null {
  if (level == null) return null;
  const n = Number(level);
  if (!Number.isFinite(n)) return null;
  // Quota role_level now matches user hierarchy_level directly.
  return n;
}

async function getCurrentChannelUserId(args: {
  orgId: number;
  userId: number;
}): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    `
    SELECT u.id
    FROM reps r
    JOIN users u
      ON u.org_id = $1::bigint
     AND u.id = r.user_id
    WHERE r.organization_id = $1::bigint
      AND r.user_id = $2::bigint
      AND COALESCE(u.hierarchy_level, 99) BETWEEN $3::int AND $4::int
    ORDER BY r.id DESC
    LIMIT 1
    `,
    [args.orgId, args.userId, HIERARCHY.CHANNEL_EXEC, HIERARCHY.CHANNEL_REP]
  );
  const id = Number(rows?.[0]?.id);
  if (Number.isFinite(id) && id > 0) return id;
  return null;
}

async function getCurrentChannelRepsTableId(args: {
  orgId: number;
  userId: number;
}): Promise<number | null> {
  const { rows } = await pool.query<{ rep_id: number }>(
    `
    SELECT r.id AS rep_id
    FROM reps r
    WHERE r.user_id = $1::bigint
      AND r.organization_id = $2::bigint
      AND r.active = true
    LIMIT 1
    `,
    [args.userId, args.orgId]
  );
  const repId = Number(rows?.[0]?.rep_id);
  return Number.isFinite(repId) && repId > 0 ? repId : null;
}

async function listChannelScopedRepIds(args: {
  orgId: number;
  hierarchyLevel: number;
  viewerChannelRepId: number | null;
  viewerUserId: number;
}): Promise<number[]> {
  try {
    const { rows } = await pool.query<{ id: number }>(
      `
      SELECT r.id
      FROM reps r
      LEFT JOIN users u
        ON u.org_id = $1::bigint
       AND u.id = r.user_id
      WHERE r.organization_id = $1::bigint
        AND (r.active IS TRUE OR r.active IS NULL)
        AND COALESCE(u.hierarchy_level, 99) = $2::int
        AND (
          ($3::int = $2::int AND $4::bigint IS NOT NULL AND r.id = $4::bigint)
          OR ($3::int = $5::int AND u.manager_user_id = $6::bigint)
          OR ($3::int = $7::int)
        )
      ORDER BY r.id ASC
      `,
      [
        args.orgId,
        HIERARCHY.CHANNEL_REP,
        args.hierarchyLevel,
        args.viewerChannelRepId,
        HIERARCHY.CHANNEL_MANAGER,
        args.viewerUserId,
        HIERARCHY.CHANNEL_EXEC,
      ]
    );
    return (rows || [])
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id) && id > 0);
  } catch (error) {
    console.error("[channel page] listChannelScopedRepIds error", error);
    return [];
  }
}

async function listAssignedPartnerNames(args: {
  orgId: number;
  hierarchyLevel: number;
  channelRepId: number | null;
}): Promise<string[]> {
  const hierarchyLevel = Number(args.hierarchyLevel);
  if (
    hierarchyLevel === HIERARCHY.CHANNEL_EXEC ||
    hierarchyLevel === HIERARCHY.CHANNEL_MANAGER ||
    hierarchyLevel !== HIERARCHY.CHANNEL_REP ||
    args.channelRepId == null
  ) {
    return [];
  }

  try {
    const { rows } = await pool.query<{ partner_name: string | null }>(
      `
      SELECT lower(btrim(partner_name)) AS partner_name
      FROM partner_channel_assignments
      WHERE org_id = $1::bigint
        AND channel_rep_id = $2::int
      `,
      [args.orgId, args.channelRepId]
    );

    return Array.from(
      new Set(
        (rows || [])
          .map((row) => String(row.partner_name ?? "").trim().toLowerCase())
          .filter(Boolean)
      )
    );
  } catch (error) {
    console.error("[channel page] listAssignedPartnerNames error", error);
    return [];
  }
}

function mapChannelDealToTopDealRow(d: {
  id: string;
  deal_name: string;
  account_name: string;
  partner_name: string;
  rep_name: string;
  amount: number;
  close_date: string;
  health_score: number | null;
}) {
  return {
    opportunity_public_id: d.id,
    id: d.id,
    account_name: d.account_name,
    opportunity_name: d.deal_name,
    amount: d.amount,
    close_date: d.close_date,
    forecast_stage: "",
    rep_name: d.rep_name,
    health_score: d.health_score,
    partner_name: d.partner_name,
    product: "",
    create_date: null,
    baseline_health_score: null,
  };
}

async function getChannelDashboardHeroMetrics(args: {
  orgId: number;
  quotaPeriodId: string;
  territoryRepIds: number[];
  viewerHierarchyLevel: number;
  viewerChannelRepId: number;
  viewerChannelRepsTableId: number | null;
  viewerUserId: number;
  assignedPartnerNames: string[];
}): Promise<ChannelDashboardHeroMetrics> {
  const useTerritoryFilter = args.territoryRepIds.length > 0;
  const { rows } = await pool.query<{
    channel_quota: number | null;
    channel_closed_won: number | null;
    channel_commit: number | null;
    channel_best_case: number | null;
    channel_pipeline: number | null;
    sales_team_closed_won: number | null;
  }>(
    `
    WITH qp AS (
      SELECT
        id::bigint AS quota_period_id,
        period_start::date AS period_start,
        period_end::date AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = $2::bigint
      LIMIT 1
    ),
    channel_quota AS (
      SELECT COALESCE(SUM(q.quota_amount), 0)::float8 AS channel_quota
      FROM quotas q
      JOIN reps r
        ON r.id = q.rep_id
       AND r.organization_id = q.org_id
      JOIN users u
        ON u.id = r.user_id
       AND u.org_id = q.org_id
      WHERE q.org_id = $1::bigint
        AND q.quota_period_id = $2::bigint
        AND u.hierarchy_level = 8
        AND (
          ($5::int = 8 AND $6::bigint IS NOT NULL AND q.rep_id = $6::bigint)
          OR ($5::int = 7 AND u.manager_user_id = $7::bigint)
          OR ($5::int = 6)
        )
    ),
    channel_closed_won AS (
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN o.crm_bucket = 'won' THEN COALESCE(o.amount, 0)
              ELSE 0
            END
          ),
          0
        )::float8 AS channel_closed_won,
        COALESCE(
          SUM(
            CASE
              WHEN o.crm_bucket = 'commit'
                AND ${partnerScopeSql("o", 8)}
              THEN COALESCE(o.amount, 0)
              ELSE 0
            END
          ),
          0
        )::float8 AS channel_commit,
        COALESCE(
          SUM(
            CASE
              WHEN o.crm_bucket = 'best_case'
                AND ${partnerScopeSql("o", 8)}
              THEN COALESCE(o.amount, 0)
              ELSE 0
            END
          ),
          0
        )::float8 AS channel_best_case,
        COALESCE(
          SUM(
            CASE
              WHEN o.crm_bucket NOT IN ('won', 'lost', 'excluded')
                AND ${partnerScopeSql("o", 8)}
              THEN COALESCE(o.amount, 0)
              ELSE 0
            END
          ),
          0
        )::float8 AS channel_pipeline
      FROM (
        SELECT
          o.amount,
          o.partner_name,
          o.forecast_stage,
          o.sales_stage,
          CASE
            WHEN stm.bucket IS NOT NULL THEN stm.bucket
            WHEN fcm.bucket IS NOT NULL THEN fcm.bucket
            WHEN lower(btrim(COALESCE(o.forecast_stage, ''))) IN ('closed won', 'won') THEN 'won'
            WHEN lower(btrim(COALESCE(o.sales_stage, ''))) LIKE '%lost%' THEN 'lost'
            ELSE 'pipeline'
          END AS crm_bucket,
          CASE
            WHEN o.close_date IS NULL THEN NULL
            WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
            WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
              to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
            ELSE NULL
          END AS close_d
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
          AND $4::boolean
          AND o.rep_id = ANY($3::bigint[])
      ) o
      JOIN qp ON TRUE
      WHERE o.close_d IS NOT NULL
        AND o.close_d >= qp.period_start
        AND o.close_d <= qp.period_end
        AND ${partnerScopeSql("o", 8)}
    ),
    sales_team_closed_won AS (
      SELECT COALESCE(SUM(COALESCE(o.amount, 0)), 0)::float8 AS sales_team_closed_won
      FROM (
        SELECT
          o.amount,
          o.forecast_stage,
          o.sales_stage,
          CASE
            WHEN stm.bucket IS NOT NULL THEN stm.bucket
            WHEN fcm.bucket IS NOT NULL THEN fcm.bucket
            WHEN lower(btrim(COALESCE(o.forecast_stage, ''))) IN ('closed won', 'won') THEN 'won'
            WHEN lower(btrim(COALESCE(o.sales_stage, ''))) LIKE '%lost%' THEN 'lost'
            ELSE 'pipeline'
          END AS crm_bucket,
          CASE
            WHEN o.close_date IS NULL THEN NULL
            WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
            WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
              to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
            ELSE NULL
          END AS close_d
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
          AND $4::boolean
          AND o.rep_id = ANY($3::bigint[])
      ) o
      JOIN qp ON TRUE
      WHERE o.close_d IS NOT NULL
        AND o.close_d >= qp.period_start
        AND o.close_d <= qp.period_end
        AND o.crm_bucket = 'won'
    )
    SELECT
      cq.channel_quota::float8 AS channel_quota,
      COALESCE(ccw.channel_closed_won, 0)::float8 AS channel_closed_won,
      COALESCE(ccw.channel_commit, 0)::float8 AS channel_commit,
      COALESCE(ccw.channel_best_case, 0)::float8 AS channel_best_case,
      COALESCE(ccw.channel_pipeline, 0)::float8 AS channel_pipeline,
      COALESCE(stcw.sales_team_closed_won, 0)::float8 AS sales_team_closed_won
    FROM qp
    LEFT JOIN channel_quota cq ON TRUE
    LEFT JOIN channel_closed_won ccw ON TRUE
    LEFT JOIN sales_team_closed_won stcw ON TRUE
    LIMIT 1
    `,
    [
      args.orgId,
      args.quotaPeriodId,
      args.territoryRepIds,
      useTerritoryFilter,
      args.viewerHierarchyLevel,
      args.viewerChannelRepsTableId,
      args.viewerUserId,
      args.assignedPartnerNames,
    ]
  );

  const row = rows[0];
  return {
    channelQuota: row?.channel_quota == null ? null : Number(row.channel_quota) || 0,
    channelClosedWon: Number(row?.channel_closed_won || 0) || 0,
    channelCommit: Number(row?.channel_commit || 0) || 0,
    channelBestCase: Number(row?.channel_best_case || 0) || 0,
    channelPipeline: Number(row?.channel_pipeline || 0) || 0,
    salesTeamClosedWon: Number(row?.sales_team_closed_won || 0) || 0,
  };
}

export default async function ChannelDashboardPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (!isChannelRole(ctx.user)) {
    redirect("/dashboard");
  }

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const summary = await getExecutiveForecastDashboardSummary({
    orgId: ctx.user.org_id,
    user: ctx.user,
    searchParams,
  });

  const orgId = ctx.user.org_id;
  const selectedPeriod = summary.selectedPeriod;
  const selectedPeriodId = summary.selectedQuotaPeriodId
    ? String(summary.selectedQuotaPeriodId)
    : "";

  const territoryRepIds = await getChannelTerritoryRepIds({
    orgId,
    channelUserId: ctx.user.id,
  }).catch(() => []);

  const scope = await getScopedRepDirectory({
    orgId,
    user: ctx.user,
  }).catch(() => ({
    repDirectory: [],
    allowedRepIds: null as number[] | null,
    myRepId: null as number | null,
  }));

  const visibleRepIds: number[] = territoryRepIds;

  const periodIdx = summary.periods.findIndex((p) => String(p.id) === String(selectedPeriodId));
  const prevPeriod = periodIdx >= 0 ? summary.periods[periodIdx + 1] : null;
  const prevQpId = prevPeriod ? String(prevPeriod.id) : "";
  const comparePeriodIds = [selectedPeriodId, prevQpId].filter(Boolean);
  const fallbackScopedRepId = scope.myRepId ?? summary.myRepId ?? null;
  const currentChannelRepId =
    Number.isFinite(Number(fallbackScopedRepId)) && Number(fallbackScopedRepId) > 0
      ? Number(fallbackScopedRepId)
      : null;
  const currentChannelUserId =
    selectedPeriodId && ctx.kind === "user"
      ? await getCurrentChannelUserId({
          orgId: ctx.user.org_id,
          userId: ctx.user.id,
        }).catch(() => null)
      : null;
  const viewerChannelRepsTableId =
    selectedPeriodId && ctx.kind === "user"
      ? await getCurrentChannelRepsTableId({
          orgId: ctx.user.org_id,
          userId: ctx.user.id,
        }).catch(() => null)
      : null;
  const assignedPartnerNames = await listAssignedPartnerNames({
    orgId: ctx.user.org_id,
    hierarchyLevel: Number(ctx.user.hierarchy_level),
    channelRepId: currentChannelUserId,
  });

  let topPartnerWon: TopPartnerDealRow[] = [];
  let topPartnerLost: TopPartnerDealRow[] = [];
  let partnerHero: Awaited<ReturnType<typeof loadChannelPartnerHeroProps>> = null;
  let ledFedRows: Awaited<ReturnType<typeof loadChannelLedFedRows>> = [];
  try {
    if (selectedPeriod && visibleRepIds.length > 0 && selectedPeriodId) {
      const [won, lost, ph, lf] = await Promise.all([
        listTopPartnerDealsChannel({
          orgId: ctx.user.org_id,
          quotaPeriodId: selectedPeriodId,
          outcome: "won",
          limit: 10,
          dateStart: selectedPeriod.period_start,
          dateEnd: selectedPeriod.period_end,
          repIds: visibleRepIds,
          assignedPartnerNames,
        }),
        listTopPartnerDealsChannel({
          orgId: ctx.user.org_id,
          quotaPeriodId: selectedPeriodId,
          outcome: "lost",
          limit: 10,
          dateStart: selectedPeriod.period_start,
          dateEnd: selectedPeriod.period_end,
          repIds: visibleRepIds,
          assignedPartnerNames,
        }),
        loadChannelPartnerHeroProps({
          orgId: ctx.user.org_id,
          quotaPeriodId: selectedPeriodId,
          prevQuotaPeriodId: prevQpId,
          repIds: visibleRepIds,
        }),
        loadChannelLedFedRows({
          orgId: ctx.user.org_id,
          quotaPeriodId: selectedPeriodId,
          repIds: visibleRepIds,
        }),
      ]);
      topPartnerWon = won ?? [];
      topPartnerLost = lost ?? [];
      partnerHero = ph;
      ledFedRows = lf ?? [];
    }
  } catch {
    topPartnerWon = [];
    topPartnerLost = [];
    partnerHero = null;
    ledFedRows = [];
  }

  const fiscalYear =
    String(summary.selectedPeriod?.fiscal_year ?? summary.selectedFiscalYear ?? "")
      .trim() || "—";
  const fiscalQuarter =
    String(summary.selectedPeriod?.fiscal_quarter || "").trim() || "—";
  const channelScopedRepIds = await listChannelScopedRepIds({
    orgId: ctx.user.org_id,
    hierarchyLevel: Number(ctx.user.hierarchy_level),
    viewerChannelRepId: currentChannelRepId,
    viewerUserId: ctx.user.id,
  });
  const channelSummary = await getChannelDashboardSummary({
    orgId: ctx.user.org_id,
    userId: ctx.user.id,
    hierarchyLevel: Number(ctx.user.hierarchy_level),
    selectedQuotaPeriodId: selectedPeriodId ?? "",
    territoryRepIds,
    channelRepIds: channelScopedRepIds.length > 0 ? channelScopedRepIds : [],
    assignedPartnerNames,
    viewerChannelRepId: currentChannelRepId,
    viewerUserId: ctx.user.id,
  }).catch((err) => {
    console.error("[channel page] getChannelDashboardSummary error", err);
    return null;
  });
  const directorRepsId = viewerChannelRepsTableId;
  const fyYearKey =
    String(summary.selectedPeriod?.fiscal_year ?? summary.selectedFiscalYear ?? "")
      .trim() || "";
  const channelFyQuarterRows =
    fyYearKey && channelScopedRepIds.length > 0
      ? await loadChannelRepFyQuarterRows({
          orgId,
          fiscalYear: fyYearKey,
          channelRepIds: channelScopedRepIds,
        }).catch((err) => {
          console.error("[channel page] loadChannelRepFyQuarterRows error", err);
          return [];
        })
      : [];

  type ChannelProductWonByRepRow = {
    rep_name: string;
    product: string;
    won_amount: number;
    won_count: number;
    avg_order_value: number;
    avg_health_score: number | null;
  };

  let channelRepKpisRows: RepPeriodKpisRow[] = [];
  let channelProductsClosedWonByRep: ChannelProductWonByRepRow[] = [];
  let directorTerritoryLostAmount = 0;
  let directorTerritoryLostCount = 0;
  const territorySalesIdsByChannelRepId = new Map<number, Set<string>>();
  try {
    if (selectedPeriodId && comparePeriodIds.length && channelScopedRepIds.length > 0) {
      const { rows: repUserRows } = await pool.query<{ rep_id: number; user_id: number }>(
        `
        SELECT r.id AS rep_id, u.id AS user_id
        FROM reps r
        JOIN users u
          ON u.id = r.user_id
         AND u.org_id = $1::bigint
        WHERE r.organization_id = $1::bigint
          AND r.id = ANY($2::bigint[])
        `,
        [orgId, channelScopedRepIds]
      );
      const scopeList = repUserRows || [];
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
          [orgId, scopeList.map((r) => Number(r.user_id))]
        )
        .then((res) => res.rows || [])
        .catch(() => []);

      const partnerNamesByUserId = new Map<number, string[]>();
      for (const row of assignmentRows) {
        const uid = Number(row.channel_rep_id);
        if (!Number.isFinite(uid) || uid <= 0) continue;
        const pn = String(row.partner_name || "")
          .trim()
          .toLowerCase();
        const cur = partnerNamesByUserId.get(uid) || [];
        if (pn) cur.push(pn);
        partnerNamesByUserId.set(uid, cur);
      }
      for (const [uid, names] of partnerNamesByUserId.entries()) {
        partnerNamesByUserId.set(uid, Array.from(new Set(names.filter(Boolean))));
      }

      const territoryByChannelRepId = new Map<number, number[]>();
      const allTerritoryIds = new Set<number>();
      await Promise.all(
        scopeList.map(async (row) => {
          const repTableId = Number(row.rep_id);
          const userId = Number(row.user_id);
          const t = await getChannelTerritoryRepIds({ orgId, channelUserId: userId }).catch(() => []);
          territoryByChannelRepId.set(repTableId, t);
          territorySalesIdsByChannelRepId.set(repTableId, new Set(t.map((id) => String(id))));
          for (const id of t) allTerritoryIds.add(id);
        })
      );

      const territoryIdList = Array.from(allTerritoryIds);
      if (territoryIdList.length > 0) {
        channelRepKpisRows = await getRepKpisByPeriod({
          orgId,
          periodIds: comparePeriodIds,
          repIds: territoryIdList,
        });
      }

      if (territoryIdList.length > 0 && selectedPeriod?.period_start && selectedPeriod?.period_end) {
        const { rows } = await pool
          .query<{ lost_amount: number; lost_count: number }>(
            `
            SELECT
              COALESCE(SUM(o.amount), 0)::float8 AS lost_amount,
              COUNT(*)::int AS lost_count
            FROM opportunities o
            WHERE o.org_id = $1
              AND o.rep_id = ANY($2::bigint[])
              AND o.close_date >= $3::date
              AND o.close_date <= $4::date
              AND (
                lower(btrim(COALESCE(o.forecast_stage,''))) LIKE '%lost%'
                OR lower(btrim(COALESCE(o.sales_stage,''))) LIKE '%lost%'
              )
            `,
            [orgId, territoryIdList, selectedPeriod.period_start, selectedPeriod.period_end]
          )
          .then((r) => r.rows || [])
          .catch(() => []);
        const row0 = rows?.[0] as any;
        directorTerritoryLostAmount = Number(row0?.lost_amount || 0) || 0;
        directorTerritoryLostCount = Number(row0?.lost_count || 0) || 0;
      }

      const repNameByChannelRepId = new Map<string, string>(
        (channelSummary?.channelRepRows ?? []).map((r) => [String(r.rep_id), String(r.rep_name || "").trim()] as const)
      );

      const productRowsNested = await Promise.all(
        scopeList.map(async (row) => {
          const repTableId = Number(row.rep_id);
          const userId = Number(row.user_id);
          const territoryRepIds = territoryByChannelRepId.get(repTableId) || [];
          const assigned = partnerNamesByUserId.get(userId) || [];
          const repLabel =
            repNameByChannelRepId.get(String(repTableId))?.trim() ||
            `(Rep ${repTableId})`;
          if (!territoryRepIds.length) return [] as ChannelProductWonByRepRow[];
          const prows = await loadPartnerScopedProductsForTerritory({
            orgId,
            quotaPeriodId: selectedPeriodId,
            territoryRepIds,
            assignedPartnerNames: assigned,
          });
          return prows.map((p) => ({
            rep_name: repLabel,
            product: p.product,
            won_amount: Number(p.won_amount || 0) || 0,
            won_count: Number(p.won_count || 0) || 0,
            avg_order_value: Number(p.avg_order_value || 0) || 0,
            avg_health_score:
              p.avg_health_score == null || !Number.isFinite(Number(p.avg_health_score))
                ? null
                : Number(p.avg_health_score),
          }));
        })
      );
      channelProductsClosedWonByRep = productRowsNested.flat();
    }
  } catch (e) {
    console.error("[channel rep kpis / productsClosedWonByRep]", e);
    channelRepKpisRows = [];
    channelProductsClosedWonByRep = [];
  }
  const viewerQuotaRoleLevel = mapChannelHierarchyToQuotaRoleLevel(ctx.user.hierarchy_level);

  let channelHeroMetrics: ChannelDashboardHeroMetrics | null = null;
  if (selectedPeriodId && territoryRepIds.length > 0 && viewerQuotaRoleLevel != null) {
    channelHeroMetrics = await getChannelDashboardHeroMetrics({
      orgId: ctx.user.org_id,
      quotaPeriodId: selectedPeriodId,
      territoryRepIds,
      viewerHierarchyLevel: Number(ctx.user.hierarchy_level),
      viewerChannelRepId: ctx.user.id,
      viewerChannelRepsTableId,
      viewerUserId: ctx.user.id,
      assignedPartnerNames,
    })
      .catch((err) => {
        console.error("[channelHeroMetrics error]", err);
        return null;
      });
  }

  const channelQuota = channelHeroMetrics?.channelQuota ?? 0;
  const channelClosedWon = channelHeroMetrics?.channelClosedWon ?? 0;
  const channelCommit = channelHeroMetrics?.channelCommit ?? 0;
  const channelBestCase = channelHeroMetrics?.channelBestCase ?? 0;
  const channelPipeline = channelHeroMetrics?.channelPipeline ?? 0;
  const salesTeamClosedWon = channelHeroMetrics?.salesTeamClosedWon ?? 0;
  const contributionPct =
    salesTeamClosedWon > 0 ? (channelClosedWon / salesTeamClosedWon) * 100 : null;
  const channelGap = Math.max(0, channelQuota - channelClosedWon);
  const channelOutlook = channelQuota > 0 ? Math.min(1, (channelClosedWon + channelPipeline * 0.3) / channelQuota) : 0;
  const channelCrmForecast = channelClosedWon + channelPipeline;
  const channelCrmWeightedForecast =
    channelClosedWon +
    channelCommit * Number(summary.stageProbabilities?.commit ?? 0) +
    channelBestCase * Number(summary.stageProbabilities?.best_case ?? 0) +
    channelPipeline * Number(summary.stageProbabilities?.pipeline ?? 0);
  const channelAiWeightedForecast =
    channelClosedWon +
    channelCommit * Number(summary.stageProbabilities?.commit ?? 0) * Number(summary.healthModifiers?.commit_modifier ?? 1) +
    channelBestCase * Number(summary.stageProbabilities?.best_case ?? 0) * Number(summary.healthModifiers?.best_case_modifier ?? 1) +
    channelPipeline * Number(summary.stageProbabilities?.pipeline ?? 0) * Number(summary.healthModifiers?.pipeline_modifier ?? 1);
  const landingZone =
    summary.aiForecast?.weighted_forecast != null &&
    Number.isFinite(Number(summary.aiForecast.weighted_forecast))
      ? Number(summary.aiForecast.weighted_forecast)
      : null;

  const tabRaw = Array.isArray(searchParams?.tab) ? searchParams?.tab[0] : searchParams?.tab;
  const tabParam = normalizeExecTab(typeof tabRaw === "string" ? tabRaw : null);
  let prefTab: ExecTabKey | null = null;
  try {
    const prefRows = await pool.query<{ user_preferences: any }>(
      `SELECT user_preferences FROM users WHERE id = $1::bigint`,
      [ctx.user.id]
    );
    const prefs = (prefRows.rows?.[0]?.user_preferences as any) || {};
    prefTab = normalizeExecTab(prefs.exec_default_tab);
  } catch {
    prefTab = null;
  }
  const activeTab: ExecTabKey = tabParam || prefTab || "pipeline";

  const channelPartnerTopRows =
    channelSummary?.partnerSummary?.map((row) => ({
      partner_name: row.partner_name,
      opps: row.won_count + row.pipeline_count + row.lost_count,
      won_opps: row.won_count,
      lost_opps: row.lost_count,
      win_rate: row.win_rate,
      aov: row.won_count > 0 ? row.won_amount / row.won_count : null,
      avg_days: null,
      avg_health_score: row.avg_health,
      won_amount: row.won_amount,
      open_pipeline: row.pipeline_amount,
    })) ?? [];

  const channelPartnersExecutive =
    summary.partnersExecutive && channelSummary
      ? {
          ...summary.partnersExecutive,
          top_partners: channelPartnerTopRows,
        }
      : summary.partnersExecutive;

  const channelTopPartnerWon =
    channelSummary?.topPartnerDealsWon.map((d) => mapChannelDealToTopDealRow(d)) ?? topPartnerWon;
  const channelTopPartnerLost =
    channelSummary?.topPartnerDealsLost.map((d) => mapChannelDealToTopDealRow(d)) ?? topPartnerLost;
  const topDealsWonRows =
    channelSummary?.topPartnerDealsWon.map((d) => mapChannelDealToTopDealRow(d)) ?? [];
  const topDealsLostRows =
    channelSummary?.topPartnerDealsLost.map((d) => mapChannelDealToTopDealRow(d)) ?? [];

  const channelTabProps = {
    basePath: "/dashboard/channel",
    channelDashboardMode: true,
    viewerRole: ctx.user.role,
    periods: channelSummary?.periods ?? summary.periods,
    quotaPeriodId: selectedPeriodId ?? "",
    orgId: ctx.user.org_id,
    reps: summary.reps,
    fiscalYear,
    fiscalQuarter,
    stageProbabilities: summary.stageProbabilities,
    healthModifiers: summary.healthModifiers,
    repDirectory: summary.repDirectory,
    myRepId: summary.myRepId,
    repRollups: summary.repRollups,
    productsClosedWon: summary.productsClosedWon,
    productsClosedWonPrevSummary: summary.productsClosedWonPrevSummary,
    productsClosedWonByRep: channelProductsClosedWonByRep,
    quarterKpis: partnerHero?.quarterKpis ?? summary.quarterKpis,
    pipelineMomentum: partnerHero?.pipelineMomentum ?? summary.pipelineMomentum,
    crmTotals: {
      ...summary.crmForecast,
      commit_amount: channelCommit,
      best_case_amount: channelBestCase,
      pipeline_amount: channelPipeline,
      won_amount: channelClosedWon,
    },
    partnersExecutive: channelPartnersExecutive,
    quota: channelQuota,
    aiForecast: channelOutlook * channelQuota,
    crmForecast: channelCrmForecast,
    gap: channelGap,
    bucketDeltas: {
      commit: summary.bucketDeltas.commit,
      best_case: summary.bucketDeltas.best_case,
      pipeline: summary.bucketDeltas.pipeline,
    },
    aiPctToGoal: channelOutlook,
    leftToGo: channelGap,
    commitAdmission: summary.commitAdmission,
    commitDealPanels: summary.commitDealPanels,
    defaultTopN: 5,
    topPartnerWon: channelTopPartnerWon,
    topPartnerLost: channelTopPartnerLost,
    periodName: selectedPeriod?.period_name ?? "",
    channelTopPartnerDealsOnPage: false,
  };

  const emptyPipelineHygiene = {
    coverageRows: [],
    assessmentRows: [],
    velocitySummaries: [],
    progressionSummaries: [],
  };

  const channelKpisByRepId = new Map<string, RepPeriodKpisRow>();
  const channelKpisPrevByRepId = new Map<string, RepPeriodKpisRow>();
  for (const crId of channelScopedRepIds) {
    const salesSet = territorySalesIdsByChannelRepId.get(crId) ?? new Set<string>();
    const cur = aggregateTerritoryRepKpis(channelRepKpisRows, selectedPeriodId, salesSet);
    const prev = prevQpId ? aggregateTerritoryRepKpis(channelRepKpisRows, prevQpId, salesSet) : null;
    if (cur) channelKpisByRepId.set(String(crId), cur);
    if (prev) channelKpisPrevByRepId.set(String(crId), prev);
  }

  function safeDivChannel(n: number, d: number): number | null {
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
    return n / d;
  }

  const channelTeamRepRows =
    channelSummary?.channelRepRows.map((r) => {
      const c = channelKpisByRepId.get(String(r.rep_id)) ?? null;
      const p = prevQpId ? channelKpisPrevByRepId.get(String(r.rep_id)) ?? null : null;
      const quota = Number(r.quota) || 0;
      const won_amount = Number(r.won_amount) || 0;
      const won_count = Number(r.won_count) || 0;
      const total_count = c
        ? Number(c.total_count || 0) || 0
        : (Number(r.partner_deals_won) || 0) + (Number(r.partner_deals_pipeline) || 0);
      const lost_count = 0;
      const lost_amount = 0;
      const commit_amount = c ? Number(c.commit_amount || 0) || 0 : 0;
      const best_amount = c ? Number(c.best_amount || 0) || 0 : 0;
      const pipeline_amount = c ? Number(c.pipeline_amount || 0) || 0 : Number(r.pipeline_amount) || 0;
      const active_amount = c ? Number(c.active_amount || 0) || 0 : Number(r.pipeline_amount) || 0;
      const win_rate = c
        ? safeDivChannel(Number(c.won_count || 0) || 0, (Number(c.won_count || 0) || 0) + (Number(c.lost_count || 0) || 0))
        : null;
      const opp_to_win = c ? safeDivChannel(Number(c.won_count || 0) || 0, Number(c.total_count || 0) || 0) : null;
      const aov = c ? safeDivChannel(Number(c.won_amount || 0) || 0, Number(c.won_count || 0) || 0) : null;
      const attainment = c ? safeDivChannel(Number(c.won_amount || 0) || 0, quota) : r.attainment;
      const commit_coverage = c ? safeDivChannel(Number(c.commit_amount || 0) || 0, quota) : null;
      const best_coverage = c ? safeDivChannel(Number(c.best_amount || 0) || 0, quota) : null;
      const partner_contribution = c
        ? safeDivChannel(Number(c.partner_closed_amount || 0) || 0, Number(c.closed_amount || 0) || 0)
        : r.contribution_pct;
      const partner_win_rate = c
        ? safeDivChannel(Number(c.partner_won_count || 0) || 0, Number(c.partner_closed_count || 0) || 0)
        : null;
      const currAtt = c ? safeDivChannel(Number(c.won_amount || 0) || 0, quota) : null;
      const prevAtt = p ? safeDivChannel(Number(p.won_amount || 0) || 0, quota) : null;
      const mixDen = pipeline_amount + best_amount + commit_amount + won_amount;
      return {
        rep_id: r.rep_id,
        rep_name: r.rep_name,
        manager_id: directorRepsId ? String(directorRepsId) : "",
        manager_name: r.manager_name,
        quota: r.quota,
        total_count,
        won_amount,
        won_count,
        lost_count,
        lost_amount,
        active_amount,
        commit_amount,
        best_amount,
        pipeline_amount,
        created_amount: 0,
        created_count: 0,
        win_rate,
        opp_to_win,
        aov,
        attainment: attainment ?? r.attainment,
        commit_coverage,
        best_coverage,
        partner_contribution,
        partner_win_rate,
        avg_days_won: c?.avg_days_won ?? null,
        avg_days_lost: c?.avg_days_lost ?? null,
        avg_days_active: c?.avg_days_active ?? null,
        mix_pipeline: safeDivChannel(pipeline_amount, mixDen),
        mix_best: safeDivChannel(best_amount, mixDen),
        mix_commit: safeDivChannel(commit_amount, mixDen),
        mix_won: safeDivChannel(won_amount, mixDen),
        qoq_attainment_delta: currAtt != null && prevAtt != null ? currAtt - prevAtt : null,
      };
    }) ?? [];

  const channelManagerRows =
    directorRepsId && channelTeamRepRows.length > 0
      ? [
          {
            manager_id: String(directorRepsId),
            manager_name: String(ctx.user.display_name || ctx.user.email || "Channel Director").trim() || "Channel Director",
            quota: channelTeamRepRows.reduce((sum, row) => sum + (Number(row.quota) || 0), 0),
            won_amount: channelTeamRepRows.reduce((sum, row) => sum + (Number(row.won_amount) || 0), 0),
            lost_amount: directorTerritoryLostAmount,
            lost_count: directorTerritoryLostCount,
            active_amount: channelTeamRepRows.reduce((sum, row) => sum + (Number(row.pipeline_amount) || 0), 0),
            attainment: (() => {
              const quota = channelTeamRepRows.reduce((sum, row) => sum + (Number(row.quota) || 0), 0);
              const won = channelTeamRepRows.reduce((sum, row) => sum + (Number(row.won_amount) || 0), 0);
              return quota > 0 ? won / quota : null;
            })(),
            win_rate: null,
            partner_contribution: null,
          },
        ]
      : [];

  const emptyTeamPayload = {
    repRows: channelTeamRepRows,
    managerRows: channelManagerRows,
    periodName: selectedPeriod?.period_name ?? "",
    periodStart: selectedPeriod?.period_start ?? "",
    periodEnd: selectedPeriod?.period_end ?? "",
    repFyQuarterRows: channelFyQuarterRows,
  };

  const scopedDirectory = summary.repDirectory.map((r) => ({
    id: r.id,
    name: r.name,
    manager_rep_id: r.manager_rep_id ?? null,
    role: r.role ?? "REP",
  }));

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex items-end justify-between gap-4 mb-4">
          <h1 className="text-pageTitle text-[color:var(--sf-text-primary)]">
            {ctx.user.display_name} Dashboard
          </h1>
        </div>
        <ForecastPeriodFiltersClient
          basePath="/dashboard/channel"
          fiscalYears={summary.fiscalYearsSorted}
          periods={summary.periods}
          selectedFiscalYear={summary.selectedFiscalYear}
          selectedPeriodId={summary.selectedQuotaPeriodId}
        />
        <div className="mt-4">
          <ExecutiveGapInsightsClient
            basePath="/dashboard/channel"
            heroOnly={true}
            viewerRole={ctx.user.role}
            periods={summary.periods}
            quotaPeriodId={summary.selectedQuotaPeriodId}
            orgId={ctx.user.org_id}
            reps={summary.reps}
            fiscalYear={fiscalYear}
            fiscalQuarter={fiscalQuarter}
            stageProbabilities={summary.stageProbabilities}
            healthModifiers={partnerHero?.healthModifiers ?? summary.healthModifiers}
            repDirectory={summary.repDirectory}
            myRepId={summary.myRepId}
            repRollups={summary.repRollups}
            productsClosedWon={partnerHero?.productsClosedWon ?? summary.productsClosedWon}
            productsClosedWonPrevSummary={partnerHero?.productsClosedWonPrevSummary ?? summary.productsClosedWonPrevSummary}
            productsClosedWonByRep={channelProductsClosedWonByRep}
            quarterKpis={partnerHero?.quarterKpis ?? summary.quarterKpis}
            pipelineMomentum={partnerHero?.pipelineMomentum ?? summary.pipelineMomentum}
            crmTotals={{
              ...summary.crmForecast,
              commit_amount: channelCommit,
              best_case_amount: channelBestCase,
              pipeline_amount: channelPipeline,
              won_amount: channelClosedWon,
            }}
            partnersExecutive={summary.partnersExecutive}
            quota={channelQuota}
            heroQuotaOverride={channelQuota}
            heroGapToQuotaOverride={channelGap}
            heroContributionPct={contributionPct}
            aiForecast={channelAiWeightedForecast}
            crmForecast={channelCrmWeightedForecast}
            gap={channelGap}
            bucketDeltas={{
              commit: partnerHero?.bucketDeltas.commit ?? summary.bucketDeltas.commit,
              best_case: partnerHero?.bucketDeltas.best_case ?? summary.bucketDeltas.best_case,
              pipeline: partnerHero?.bucketDeltas.pipeline ?? summary.bucketDeltas.pipeline,
            }}
            aiPctToGoal={channelOutlook}
            leftToGo={channelGap}
            commitAdmission={partnerHero?.commitAdmission ?? summary.commitAdmission}
            commitDealPanels={partnerHero?.commitDealPanels ?? summary.commitDealPanels}
            defaultTopN={5}
          />
        </div>
        {!isChannelRep(ctx.user) ? (
          <div className="mt-4">
            <div className="channel-tabs-shell" data-channel-top-deals={activeTab === "top_deals" ? "true" : "false"}>
              <ExecutiveTabsShellClient
                basePath="/dashboard/channel"
                initialTab={activeTab}
                setDefaultTab={setExecDefaultTabAction}
                orgId={ctx.user.org_id}
                orgName={orgName}
                viewerRole={ctx.user.role}
                forecastTabProps={channelTabProps}
                pipelineTabProps={channelTabProps}
                pipelineHygiene={emptyPipelineHygiene}
                teamTabProps={channelTabProps}
                teamRepManagerPayload={emptyTeamPayload}
                reviewQueueDeals={[]}
                currentUserId={ctx.user.id}
                showManagerReviewQueue={false}
                revenueTabProps={channelTabProps}
                topPartnerWon={channelTopPartnerWon}
                topPartnerLost={channelTopPartnerLost}
                topDealsWon={topDealsWonRows}
                topDealsLost={topDealsLostRows}
                reportBuilderRepRows={[]}
                reportBuilderSavedReports={[]}
                reportBuilderPeriodLabel={selectedPeriod?.period_name ?? ""}
                reportBuilderRepDirectory={scopedDirectory}
                reportBuilderQuotaPeriods={(channelSummary?.periods ?? summary.periods).map((p) => ({
                  id: String(p.id),
                  name: p.period_name ? `${p.period_name}` : String(p.id),
                }))}
                reportBuilderOrgId={orgId}
                reportBuilderInitialPeriodId={selectedPeriodId}
                revenueIntelligenceOrgId={orgId}
                revenueIntelligenceQuotaPeriods={(channelSummary?.periods ?? summary.periods).map((p) => ({
                  id: String(p.id),
                  name: p.period_name,
                  fiscal_year: String(p.fiscal_year ?? ""),
                }))}
                revenueIntelligenceRepDirectory={scopedDirectory}
                showChannelContribution={ledFedRows.length > 0}
                channelContributionHero={partnerHero}
                channelContributionRows={ledFedRows}
              />
            </div>
            {activeTab === "top_deals" ? (
              <ChannelTopPartnerDealsTablesClient
                won={topPartnerWon}
                lost={topPartnerLost}
                periodStart={selectedPeriod?.period_start}
                periodEnd={selectedPeriod?.period_end}
              />
            ) : null}
            {activeTab === "top_deals" ? (
              <style
                dangerouslySetInnerHTML={{
                  __html:
                    '.channel-tabs-shell[data-channel-top-deals="true"] > section > div.mt-4.rounded-lg { display: none; }',
                }}
              />
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}

