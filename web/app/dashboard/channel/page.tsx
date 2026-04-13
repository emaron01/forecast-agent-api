import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { pool } from "../../../lib/pool";
import { fetchChannelOrgDirectoryForViewer } from "../../../lib/channelOrgDirectory";
import { getChannelTerritoryRepIds } from "../../../lib/channelTerritoryScope";
import { getScopedRepDirectory, type RepDirectoryRow } from "../../../lib/repScope";
import { getChannelDashboardSummary, loadChannelRepFyQuarterRows, loadChannelRepWonDeals, deduplicateWonDeals, type ChannelRepFyQuarterRow } from "../../../lib/channelDashboard";
import { getRepKpisByPeriod, type RepPeriodKpisRow } from "../../../lib/executiveRepKpis";
import { UserTopNav } from "../../_components/UserTopNav";
import { ExecutiveTabsShellClient } from "../../components/dashboard/executive/ExecutiveTabsShellClient";
import type { RepManagerManagerRow } from "../../components/dashboard/executive/RepManagerComparisonPanel";
import { normalizeExecTab, resolveDashboardTab, type ExecTabKey } from "../../actions/execTabConstants";
import { setExecDefaultTabAction } from "../../actions/execTabPreferences";
import { ForecastPeriodFiltersClient } from "../../forecast/_components/ForecastPeriodFiltersClient";
import { getExecutiveForecastDashboardSummary } from "../../../lib/executiveForecastDashboard";
import { ExecutiveGapInsightsClient } from "../../../components/dashboard/executive/ExecutiveGapInsightsClient";
import { HIERARCHY, isChannelRep, isChannelRole, isSalesRep } from "../../../lib/roleHelpers";
import { loadChannelLedFedRows, loadChannelPartnerHeroProps } from "../../../lib/channelPartnerHeroData";
import { listTopPartnerDealsChannelHeroScope } from "../../../lib/channelHeroTopPartnerDeals";
import { ChannelTopPartnerDealsTablesClient, type TopPartnerDealRow } from "./ChannelTopPartnerDealsTablesClient";
import { ScopedDashboardTabsClient } from "../../components/dashboard/ScopedDashboardTabsClient";
import { ChannelTabPanelClient } from "../../components/dashboard/ChannelTabPanelClient";
import { SimpleForecastDashboardClient } from "../../forecast/simple/simpleClient";

export const runtime = "nodejs";

function periodToOption(p: {
  id: string | number;
  fiscal_year: string | number;
  fiscal_quarter: string | number;
  period_name: string;
  period_start: string;
  period_end: string;
}) {
  const q = Number.parseInt(String(p.fiscal_quarter || "").trim(), 10);
  const y = String(p.fiscal_year || "").trim();
  const ord =
    q === 1 ? "1st Quarter" : q === 2 ? "2nd Quarter" : q === 3 ? "3rd Quarter" : q === 4 ? "4th Quarter" : `Q${q}`;
  const label =
    Number.isFinite(q) && q > 0 && y ? `${ord} ${y}` : String(p.period_name || "").trim() || `${p.period_start} → ${p.period_end}`;
  return { id: String(p.id), label };
}

const CHANNEL_DASHBOARD_LEADER_TABS: ExecTabKey[] = [
  "pipeline",
  "sales_opportunities",
  "coaching",
  "team",
  "channel",
  "revenue_mix",
  "revenue_intelligence",
  "top_deals",
  "report_builder",
  "reports",
];

const CHANNEL_REP_DASHBOARD_TABS: ExecTabKey[] = ["sales_opportunities", "channel_partners"];

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
    lost_amount: sumNum("lost_amount"),
    partner_won_count: sumNum("partner_won_count"),
    partner_closed_count: sumNum("partner_closed_count"),
    avg_days_won: weightedAvg((r) => r.avg_days_won, (r) => Number(r.won_count) || 0),
    avg_days_lost: weightedAvg((r) => r.avg_days_lost, (r) => Number(r.lost_count) || 0),
    avg_days_active: weightedAvg((r) => r.avg_days_active, (r) => Number(r.active_count) || 0),
  };
}

type ChannelLostDealRow = {
  id: string;
  amount: number;
  rep_id: number;
  partner_name: string | null;
};

async function queryChannelLostDealsByScope(args: {
  orgId: number;
  repIds: number[];
  partnerNames: string[];
  periodStart: string;
  periodEnd: string;
}): Promise<ChannelLostDealRow[]> {
  const repLen = args.repIds.length;
  const names = Array.from(
    new Set((args.partnerNames || []).map((n) => String(n || "").trim().toLowerCase()).filter(Boolean))
  );
  const partnerLen = names.length;
  if (repLen === 0 && partnerLen === 0) return [];
  const { rows } = await pool
    .query<ChannelLostDealRow>(
      `
      SELECT
        o.id::text AS id,
        COALESCE(o.amount, 0)::float8 AS amount,
        o.rep_id::int AS rep_id,
        o.partner_name
      FROM opportunities o
      WHERE o.org_id = $1::bigint
        AND o.partner_name IS NOT NULL
        AND btrim(o.partner_name) <> ''
        AND (
          ($6::int > 0 AND o.rep_id = ANY($2::bigint[]))
          OR ($7::int > 0 AND lower(btrim(COALESCE(o.partner_name, ''))) = ANY($3::text[]))
        )
        AND o.close_date >= $4::date
        AND o.close_date <= $5::date
        AND (
          (' ' || lower(
            regexp_replace(
              COALESCE(NULLIF(btrim(o.forecast_stage),''),'')
              || ' ' ||
              COALESCE(NULLIF(btrim(o.sales_stage),''),''),
              '[^a-zA-Z]+', ' ', 'g'
            )
          ) || ' ') LIKE '% lost %'
        )
      `,
      [args.orgId, args.repIds, names, args.periodStart, args.periodEnd, repLen, partnerLen]
    )
    .catch(() => ({ rows: [] as ChannelLostDealRow[] }));
  return rows || [];
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
  scopePartnerNames: string[];
  assignedPartnerNames: string[];
}): Promise<ChannelScopedProductRow[]> {
  const repLen = args.territoryRepIds.length;
  const scopePn = Array.from(
    new Set((args.scopePartnerNames || []).map((n) => String(n || "").trim().toLowerCase()).filter(Boolean))
  );
  const partnerLen = scopePn.length;
  if (!args.quotaPeriodId || (repLen === 0 && partnerLen === 0)) return [];
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
        AND (
          ($6::int > 0 AND o.rep_id = ANY($3::bigint[]))
          OR ($7::int > 0 AND lower(btrim(COALESCE(o.partner_name, ''))) = ANY($4::text[]))
        )
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
    [args.orgId, args.quotaPeriodId, args.territoryRepIds, scopePn, args.assignedPartnerNames, repLen, partnerLen]
  );
  return (rows || []) as ChannelScopedProductRow[];
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
  scopePartnerNames: string[];
  viewerHierarchyLevel: number;
  viewerChannelRepId: number;
  viewerChannelRepsTableId: number | null;
  viewerUserId: number;
  assignedPartnerNames: string[];
}): Promise<ChannelDashboardHeroMetrics> {
  const repLen = args.territoryRepIds.length;
  const scopePn = Array.from(
    new Set((args.scopePartnerNames || []).map((n) => String(n || "").trim().toLowerCase()).filter(Boolean))
  );
  const partnerLen = scopePn.length;
  if (repLen === 0 && partnerLen === 0) {
    return {
      channelQuota: null,
      channelClosedWon: 0,
      channelCommit: 0,
      channelBestCase: 0,
      channelPipeline: 0,
      salesTeamClosedWon: 0,
    };
  }
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
          ($4::int = 8 AND $5::bigint IS NOT NULL AND q.rep_id = $5::bigint)
          OR ($4::int = 7 AND u.manager_user_id = $6::bigint)
          OR ($4::int = 6)
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
                AND ${partnerScopeSql("o", 7)}
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
                AND ${partnerScopeSql("o", 7)}
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
                AND ${partnerScopeSql("o", 7)}
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
          AND (
            ($9::int > 0 AND o.rep_id = ANY($3::bigint[]))
            OR ($10::int > 0 AND lower(btrim(COALESCE(o.partner_name, ''))) = ANY($8::text[]))
          )
      ) o
      JOIN qp ON TRUE
      WHERE o.close_d IS NOT NULL
        AND o.close_d >= qp.period_start
        AND o.close_d <= qp.period_end
        AND ${partnerScopeSql("o", 7)}
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
          AND (
            ($9::int > 0 AND o.rep_id = ANY($3::bigint[]))
            OR ($10::int > 0 AND lower(btrim(COALESCE(o.partner_name, ''))) = ANY($8::text[]))
          )
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
      args.viewerHierarchyLevel,
      args.viewerChannelRepsTableId,
      args.viewerUserId,
      args.assignedPartnerNames,
      scopePn,
      repLen,
      partnerLen,
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

  const viewerChannelTerritoryScope = await getChannelTerritoryRepIds({
    orgId,
    channelUserId: ctx.user.id,
  }).catch(() => ({ repIds: [] as number[], partnerNames: [] as string[] }));

  const territoryRepIds = viewerChannelTerritoryScope.repIds;
  const viewerChannelScopePartnerNames = viewerChannelTerritoryScope.partnerNames;

  const scope = await getScopedRepDirectory({
    orgId,
    user: ctx.user,
  }).catch(() => ({
    repDirectory: [],
    allowedRepIds: null as number[] | null,
    myRepId: null as number | null,
  }));

  const visibleRepIds: number[] = territoryRepIds;
  const channelViewerHasDataScope =
    visibleRepIds.length > 0 || viewerChannelScopePartnerNames.length > 0;

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
  const channelViewerRepId =
    viewerChannelRepsTableId != null &&
    Number.isFinite(Number(viewerChannelRepsTableId)) &&
    Number(viewerChannelRepsTableId) > 0
      ? Number(viewerChannelRepsTableId)
      : currentChannelRepId != null &&
          Number.isFinite(Number(currentChannelRepId)) &&
          Number(currentChannelRepId) > 0
        ? Number(currentChannelRepId)
        : null;
  const assignedPartnerNames = await listAssignedPartnerNames({
    orgId: ctx.user.org_id,
    hierarchyLevel: Number(ctx.user.hierarchy_level),
    channelRepId: currentChannelUserId,
  });

  // For role-7/6 viewers: union all partner names across role-8 reps in their scope.
  // getChannelTerritoryRepIds for the viewer returns repIds but empty partnerNames for directors,
  // so we must walk their role-8 reps to collect the full partner name scope for hero queries.
  let heroScopePartnerNames: string[] = viewerChannelScopePartnerNames;
  if (
    viewerChannelScopePartnerNames.length === 0 &&
    visibleRepIds.length > 0 &&
    Number(ctx.user.hierarchy_level) !== 8
  ) {
    try {
      const role8UserRows = await pool
        .query<{ user_id: number }>(
          `SELECT u.id AS user_id
           FROM reps r
           JOIN users u ON u.id = r.user_id AND u.org_id = $1::bigint
           WHERE r.organization_id = $1::bigint
             AND r.manager_rep_id IN (
               SELECT id FROM reps
               WHERE organization_id = $1::bigint
                 AND user_id = $2::bigint
             )
             AND COALESCE(u.hierarchy_level, 99) = 8`,
          [orgId, ctx.user.id]
        )
        .then((res) => res.rows || [])
        .catch(() => []);

      if (role8UserRows.length > 0) {
        const partnerNameSets = await Promise.all(
          role8UserRows.map((row) =>
            getChannelTerritoryRepIds({ orgId, channelUserId: Number(row.user_id) })
              .then((sc) => sc.partnerNames)
              .catch(() => [] as string[])
          )
        );
        const union: string[] = Array.from(
          new Set(
            partnerNameSets
              .flat()
              .map((n) => n.toLowerCase().trim())
              .filter(Boolean)
          )
        );
        if (union.length > 0) heroScopePartnerNames = union;
      }
    } catch {
      // fall back to viewerChannelScopePartnerNames (already set above)
    }
  }

  let topPartnerWon: TopPartnerDealRow[] = [];
  let topPartnerLost: TopPartnerDealRow[] = [];
  let partnerHero: Awaited<ReturnType<typeof loadChannelPartnerHeroProps>> = null;
  let ledFedRows: Awaited<ReturnType<typeof loadChannelLedFedRows>> = [];
  console.log("[channel hero scope]", {
    visibleRepIds,
    viewerChannelScopePartnerNames,
    heroScopePartnerNames,
    hl: Number(ctx.user.hierarchy_level),
  });
  try {
    if (selectedPeriod && channelViewerHasDataScope && selectedPeriodId) {
      const [won, lost, ph, lf] = await Promise.all([
        listTopPartnerDealsChannelHeroScope({
          orgId: ctx.user.org_id,
          quotaPeriodId: selectedPeriodId,
          outcome: "won",
          limit: 10,
          dateStart: selectedPeriod.period_start,
          dateEnd: selectedPeriod.period_end,
          scopeRepIds: visibleRepIds,
          scopePartnerNames: heroScopePartnerNames,
          assignedPartnerNames,
        }),
        listTopPartnerDealsChannelHeroScope({
          orgId: ctx.user.org_id,
          quotaPeriodId: selectedPeriodId,
          outcome: "lost",
          limit: 10,
          dateStart: selectedPeriod.period_start,
          dateEnd: selectedPeriod.period_end,
          scopeRepIds: visibleRepIds,
          scopePartnerNames: heroScopePartnerNames,
          assignedPartnerNames,
        }),
        loadChannelPartnerHeroProps({
          orgId: ctx.user.org_id,
          quotaPeriodId: selectedPeriodId,
          prevQuotaPeriodId: prevQpId,
          repIds: visibleRepIds,
          partnerNames: heroScopePartnerNames,
        }),
        loadChannelLedFedRows({
          orgId: ctx.user.org_id,
          quotaPeriodId: selectedPeriodId,
          repIds: visibleRepIds,
          partnerNames: heroScopePartnerNames,
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
  const fyYearKey =
    String(summary.selectedPeriod?.fiscal_year ?? summary.selectedFiscalYear ?? "")
      .trim() || "";
  const fyPeriodIds = fyYearKey
    ? summary.periods
        .filter((p) => String(p.fiscal_year).trim() === fyYearKey)
        .map((p) => String(p.id))
    : [];
  const channelFyQuarterRows: ChannelRepFyQuarterRow[] =
    fyYearKey && channelScopedRepIds.length > 0
      ? await loadChannelRepFyQuarterRows({
          orgId,
          fiscalYear: fyYearKey,
          channelRepIds: channelScopedRepIds,
        }).catch((err) => {
          console.error("[channel page] loadChannelRepFyQuarterRows error", err);
          return [] as ChannelRepFyQuarterRow[];
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
  let channelProductsClosedWonByRepYtd: ChannelProductWonByRepRow[] = [];
  let directorTerritoryLostAmount = 0;
  let directorTerritoryLostCount = 0;
  let directorWonAmount = 0;
  let directorWonCount = 0;
  let lostDealsByRole8RepId = new Map<number, ChannelLostDealRow[]>();
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
      const scopePartnerNamesByChannelRepId = new Map<number, string[]>();
      const allTerritoryIds = new Set<number>();
      await Promise.all(
        scopeList.map(async (row) => {
          const repTableId = Number(row.rep_id);
          const userId = Number(row.user_id);
          const sc = await getChannelTerritoryRepIds({ orgId, channelUserId: userId }).catch(() => ({
            repIds: [] as number[],
            partnerNames: [] as string[],
          }));
          territoryByChannelRepId.set(repTableId, sc.repIds);
          scopePartnerNamesByChannelRepId.set(repTableId, sc.partnerNames);
          territorySalesIdsByChannelRepId.set(repTableId, new Set(sc.repIds.map((id) => String(id))));
          for (const id of sc.repIds) allTerritoryIds.add(id);
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

      const repDirById = new Map<number, RepDirectoryRow>(
        (channelSummary?.repDirectory ?? []).map((d) => [d.id, d] as const)
      );

      if (selectedPeriod?.period_start && selectedPeriod?.period_end) {
        const ps = selectedPeriod.period_start;
        const pe = selectedPeriod.period_end;
        directorTerritoryLostAmount = 0;
        directorTerritoryLostCount = 0;

        const role8ScopeRows = scopeList.filter((row) => {
          const meta = repDirById.get(Number(row.rep_id));
          return meta?.hierarchy_level === HIERARCHY.CHANNEL_REP;
        });

        const lostResultList = await Promise.all(
          role8ScopeRows.map(async (row) => {
            const rid = Number(row.rep_id);
            const territory = territoryByChannelRepId.get(rid) || [];
            const scopePn = scopePartnerNamesByChannelRepId.get(rid) || [];
            const r = await queryChannelLostDealsByScope({
              orgId,
              repIds: territory,
              partnerNames: scopePn,
              periodStart: ps,
              periodEnd: pe,
            });
            return { rid, rows: r };
          })
        );

        lostDealsByRole8RepId = new Map(lostResultList.map(({ rid, rows }) => [rid, rows]));

        const directorDealMaps = new Map<number, Map<string, number>>();
        for (const [rep8Id, deals] of lostDealsByRole8RepId) {
          const meta = repDirById.get(rep8Id);
          const mgrId = meta?.manager_rep_id;
          if (mgrId == null || !Number.isFinite(mgrId) || mgrId <= 0) continue;
          let dm = directorDealMaps.get(mgrId);
          if (!dm) {
            dm = new Map();
            directorDealMaps.set(mgrId, dm);
          }
          for (const d of deals) {
            dm.set(String(d.id), Number(d.amount) || 0);
          }
        }

        function sumDedupedChannelLost(m: Map<string, number>) {
          let amount = 0;
          for (const v of m.values()) amount += v;
          return { amount, count: m.size };
        }

        const hl = Number(ctx.user.hierarchy_level);
        const viewerRid =
          viewerChannelRepsTableId != null && Number.isFinite(Number(viewerChannelRepsTableId))
            ? Number(viewerChannelRepsTableId)
            : NaN;

        if (hl === HIERARCHY.CHANNEL_MANAGER && Number.isFinite(viewerRid) && viewerRid > 0) {
          const m = directorDealMaps.get(viewerRid);
          if (m) {
            const s = sumDedupedChannelLost(m);
            directorTerritoryLostAmount = s.amount;
            directorTerritoryLostCount = s.count;
          }
        } else if (hl === HIERARCHY.CHANNEL_EXEC && Number.isFinite(viewerRid) && viewerRid > 0) {
          const merged = new Map<string, number>();
          for (const d of channelSummary?.repDirectory ?? []) {
            if (Number(d.hierarchy_level) !== HIERARCHY.CHANNEL_MANAGER) continue;
            const execId = d.manager_rep_id == null ? NaN : Number(d.manager_rep_id);
            if (execId !== viewerRid) continue;
            const sub = directorDealMaps.get(d.id);
            if (!sub) continue;
            for (const [kid, amt] of sub) merged.set(kid, amt);
          }
          const s = sumDedupedChannelLost(merged);
          directorTerritoryLostAmount = s.amount;
          directorTerritoryLostCount = s.count;
        }

        // Won deal dedup — mirrors lost dedup pattern above
        const wonDealsByRep = await loadChannelRepWonDeals({
          orgId,
          selectedQuotaPeriodId: selectedPeriodId,
          channelRepIds: role8ScopeRows.map((r) => Number(r.rep_id)),
        });
        const dedupedWon = deduplicateWonDeals(wonDealsByRep);
        if (hl === HIERARCHY.CHANNEL_MANAGER && Number.isFinite(viewerRid) && viewerRid > 0) {
          directorWonAmount = dedupedWon.wonAmount;
          directorWonCount = dedupedWon.wonCount;
        } else if (hl === HIERARCHY.CHANNEL_EXEC && Number.isFinite(viewerRid) && viewerRid > 0) {
          directorWonAmount = dedupedWon.wonAmount;
          directorWonCount = dedupedWon.wonCount;
        }
      }

      const repNameByChannelRepId = new Map<string, string>(
        (channelSummary?.channelRepRows ?? []).map((r) => [String(r.rep_id), String(r.rep_name || "").trim()] as const)
      );

      const productRowsNested = await Promise.all(
        scopeList.map(async (row) => {
          const repTableId = Number(row.rep_id);
          const userId = Number(row.user_id);
          const territoryRepIds = territoryByChannelRepId.get(repTableId) || [];
          const scopePn = scopePartnerNamesByChannelRepId.get(repTableId) || [];
          const assigned = partnerNamesByUserId.get(userId) || [];
          const repLabel =
            repNameByChannelRepId.get(String(repTableId))?.trim() ||
            `(Rep ${repTableId})`;
          if (!territoryRepIds.length && !scopePn.length) return [] as ChannelProductWonByRepRow[];
          const prows = await loadPartnerScopedProductsForTerritory({
            orgId,
            quotaPeriodId: selectedPeriodId,
            territoryRepIds,
            scopePartnerNames: scopePn,
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

      // YTD products — same query per rep but across all FY periods
      if (fyPeriodIds.length > 1) {
        const ytdProductRowsNested = await Promise.all(
          scopeList.map(async (row) => {
            const repTableId = Number(row.rep_id);
            const userId = Number(row.user_id);
            const territoryRepIds = territoryByChannelRepId.get(repTableId) || [];
            const scopePn = scopePartnerNamesByChannelRepId.get(repTableId) || [];
            const assigned = partnerNamesByUserId.get(userId) || [];
            const repLabel =
              repNameByChannelRepId.get(String(repTableId))?.trim() ||
              `(Rep ${repTableId})`;
            if (!territoryRepIds.length && !scopePn.length) return [] as ChannelProductWonByRepRow[];
            const periodRows = await Promise.all(
              fyPeriodIds
                .filter((pid) => pid !== selectedPeriodId)
                .map((pid) =>
                  loadPartnerScopedProductsForTerritory({
                    orgId,
                    quotaPeriodId: pid,
                    territoryRepIds,
                    scopePartnerNames: scopePn,
                    assignedPartnerNames: assigned,
                  }).catch(() => [])
                )
            );
            return periodRows.flat().map((p) => ({
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
        // Combine current quarter + prior quarters = full YTD
        channelProductsClosedWonByRepYtd = [
          ...channelProductsClosedWonByRep,
          ...ytdProductRowsNested.flat(),
        ];
      } else {
        channelProductsClosedWonByRepYtd = [...channelProductsClosedWonByRep];
      }
    }
  } catch (e) {
    console.error("[channel rep kpis / productsClosedWonByRep]", e);
    channelRepKpisRows = [];
    channelProductsClosedWonByRep = [];
    channelProductsClosedWonByRepYtd = [];
    lostDealsByRole8RepId = new Map();
    directorTerritoryLostAmount = 0;
    directorTerritoryLostCount = 0;
    directorWonAmount = 0;
    directorWonCount = 0;
  }
  const viewerQuotaRoleLevel = mapChannelHierarchyToQuotaRoleLevel(ctx.user.hierarchy_level);

  let channelHeroMetrics: ChannelDashboardHeroMetrics | null = null;
  if (selectedPeriodId && channelViewerHasDataScope && viewerQuotaRoleLevel != null) {
    channelHeroMetrics = await getChannelDashboardHeroMetrics({
      orgId: ctx.user.org_id,
      quotaPeriodId: selectedPeriodId,
      territoryRepIds,
      scopePartnerNames: viewerChannelScopePartnerNames,
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
  const channelTabAllowed = isChannelRep(ctx.user) ? CHANNEL_REP_DASHBOARD_TABS : CHANNEL_DASHBOARD_LEADER_TABS;
  const channelTabFallback: ExecTabKey = isChannelRep(ctx.user) ? "sales_opportunities" : "pipeline";
  const activeTab: ExecTabKey = resolveDashboardTab({
    tabParam,
    prefTab,
    allowed: channelTabAllowed,
    fallback: channelTabFallback,
  });

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
    productsClosedWonPrevSummary: partnerHero?.productsClosedWonPrevSummary ?? summary.productsClosedWonPrevSummary,
    productsClosedWonByRep: channelProductsClosedWonByRep,
    quarterKpis: partnerHero?.quarterKpis ?? summary.quarterKpis,
    pipelineMomentum: partnerHero?.pipelineMomentum ?? summary.pipelineMomentum,
    closedWonFyYtd: summary.closedWonFyYtd,
    crmTotals: {
      ...summary.crmForecast,
      commit_amount: channelCommit,
      best_case_amount: channelBestCase,
      pipeline_amount: channelPipeline,
      won_amount: channelClosedWon,
      lost_amount:
        partnerHero != null ? partnerHero.crmForecast.lost_amount : summary.crmForecast.lost_amount,
      lost_count:
        partnerHero != null ? partnerHero.crmForecast.lost_count : summary.crmForecast.lost_count,
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

  /** Same props as `/forecast/simple` — `/api/forecast/deals` scopes by channel for isChannelRole users. */
  const repFilterLocked = isSalesRep(ctx.user) || ctx.user.hierarchy_level === HIERARCHY.CHANNEL_REP;
  const defaultRepNameForForecast = repFilterLocked ? String(ctx.user.account_owner_name || "") : "";
  const simpleForecastQuotaPeriodRows =
    repFilterLocked
      ? await pool
          .query<{
            id: string;
            fiscal_year: string;
            fiscal_quarter: string;
            period_name: string;
            period_start: string;
            period_end: string;
          }>(
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
              AND period_end >= CURRENT_DATE
            ORDER BY period_start DESC, id DESC
            `,
            [ctx.user.org_id]
          )
          .then((r) => r.rows || [])
          .catch(() => [])
      : [];
  const simpleForecastDefaultQuotaPeriodId =
    repFilterLocked && simpleForecastQuotaPeriodRows.length
      ? await pool
          .query<{ id: string }>(
            `
            SELECT id::text AS id
              FROM quota_periods
             WHERE org_id = $1::bigint
               AND period_start <= CURRENT_DATE
               AND period_end >= CURRENT_DATE
             ORDER BY period_start DESC, id DESC
             LIMIT 1
            `,
            [ctx.user.org_id]
          )
          .then((r) => String(r.rows?.[0]?.id || "").trim() || String(simpleForecastQuotaPeriodRows[0]?.id || ""))
          .catch(() => String(simpleForecastQuotaPeriodRows[0]?.id || ""))
      : "";
  const salesOpportunitiesSimpleProps = {
    defaultRepName: defaultRepNameForForecast,
    repFilterLocked,
    quotaPeriods: simpleForecastQuotaPeriodRows.map(periodToOption),
    defaultQuotaPeriodId: simpleForecastDefaultQuotaPeriodId,
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

  /** Map role-8 channel rep (reps.id) → their Channel Director's reps.id (reps.manager_rep_id), for Team rollup grouping (mirrors sales manager_id on rep rows). */
  const channelRepDirectory = channelSummary?.repDirectory ?? [];
  const channelDirectorRepIdByChannelRepId = new Map<number, number>();
  const repDisplayNameByRepId = new Map<number, string>();
  for (const d of channelRepDirectory) {
    repDisplayNameByRepId.set(d.id, String(d.name || "").trim() || `(Rep ${d.id})`);
    if (Number(d.hierarchy_level) === HIERARCHY.CHANNEL_REP && d.manager_rep_id != null) {
      const mid = Number(d.manager_rep_id);
      if (Number.isFinite(mid) && mid > 0) channelDirectorRepIdByChannelRepId.set(d.id, mid);
    }
  }

  const channelViewerName =
    channelViewerRepId != null
      ? repDisplayNameByRepId.get(channelViewerRepId) ||
        String(ctx.user.display_name || "").trim() ||
        `Rep ${channelViewerRepId}`
      : "";

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
      const lostRows = lostDealsByRole8RepId.get(Number(r.rep_id)) ?? [];
      const lost_count = lostRows.length;
      const lost_amount = lostRows.reduce((s, d) => s + (Number(d.amount) || 0), 0);
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
      const crTableId = Number(r.rep_id);
      const directorRepId = Number.isFinite(crTableId)
        ? channelDirectorRepIdByChannelRepId.get(crTableId)
        : undefined;
      const manager_id =
        directorRepId != null && Number.isFinite(directorRepId) && directorRepId > 0 ? String(directorRepId) : "";
      const manager_name =
        directorRepId != null && Number.isFinite(directorRepId) && directorRepId > 0
          ? repDisplayNameByRepId.get(directorRepId) ?? r.manager_name
          : r.manager_name;
      return {
        rep_id: r.rep_id,
        rep_name: r.rep_name,
        manager_id,
        manager_name,
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

  const channelDirectorManagerRows: RepManagerManagerRow[] =
    channelTeamRepRows.length > 0
      ? (() => {
          const agg = new Map<string, { quota: number; won_amount: number; active_amount: number; manager_name: string }>();
          for (const row of channelTeamRepRows) {
            const mid = String(row.manager_id || "").trim();
            const key = mid || "__unassigned__";
            const prev = agg.get(key) || { quota: 0, won_amount: 0, active_amount: 0, manager_name: row.manager_name };
            prev.quota += Number(row.quota) || 0;
            prev.won_amount += Number(row.won_amount) || 0;
            prev.active_amount += Number(row.pipeline_amount) || 0;
            if (mid && row.manager_name) prev.manager_name = row.manager_name;
            agg.set(key, prev);
          }
          const rows: RepManagerManagerRow[] = [];
          for (const [key, a] of agg.entries()) {
            const manager_id = key;
            const quota = a.quota;
            const won = a.won_amount;
            rows.push({
              manager_id,
              manager_name:
                key === "__unassigned__"
                  ? "(Unassigned)"
                  : manager_id && a.manager_name
                    ? a.manager_name
                    : repDisplayNameByRepId.get(Number(manager_id)) || a.manager_name || `Manager ${manager_id}`,
              parent_manager_id:
                key === "__unassigned__"
                  ? ""
                  : channelViewerRepId != null && key === String(channelViewerRepId)
                    ? ""
                    : channelViewerRepId != null
                      ? String(channelViewerRepId)
                      : "",
              quota,
              won_amount: won,
              active_amount: a.active_amount,
              attainment: safeDivChannel(won, quota),
              win_rate: null,
              partner_contribution: null,
            });
          }
          rows.sort(
            (x, y) =>
              (Number(y.attainment ?? -1) - Number(x.attainment ?? -1)) ||
              y.won_amount - x.won_amount ||
              x.manager_name.localeCompare(y.manager_name)
          );
          return rows;
        })()
      : [];

  let channelManagerRows: RepManagerManagerRow[] = channelDirectorManagerRows;
  if (channelViewerRepId != null) {
    const totalQuota = channelDirectorManagerRows.reduce((s, r) => s + (Number(r.quota) || 0), 0);
    const totalWon = channelDirectorManagerRows.reduce((s, r) => s + (Number(r.won_amount) || 0), 0);
    const totalActive = channelDirectorManagerRows.reduce((s, r) => s + (Number(r.active_amount) || 0), 0);
    const viewerRow: RepManagerManagerRow = {
      manager_id: String(channelViewerRepId),
      manager_name: channelViewerName || `Rep ${channelViewerRepId}`,
      parent_manager_id: "",
      quota: totalQuota,
      won_amount: totalWon,
      active_amount: totalActive,
      attainment: totalQuota > 0 ? totalWon / totalQuota : null,
      win_rate: null,
      partner_contribution: null,
    };
    channelManagerRows = [viewerRow, ...channelDirectorManagerRows];
  }

  const channelDirectorCardCount = new Set(
    channelTeamRepRows.map((row) => String(row.manager_id || "").trim()).filter(Boolean)
  ).size;
  const channelRollupMultiDirectorCards = channelDirectorCardCount > 1;

  const emptyTeamPayload = {
    repRows: channelTeamRepRows,
    managerRows: channelManagerRows,
    teamViewerRepId: channelViewerRepId != null ? String(channelViewerRepId) : null,
    managerLostAmountOverride: channelRollupMultiDirectorCards ? undefined : directorTerritoryLostAmount,
    managerLostCountOverride: channelRollupMultiDirectorCards ? undefined : directorTerritoryLostCount,
    managerWonAmountOverride: channelRollupMultiDirectorCards ? undefined : directorWonAmount,
    managerWonCountOverride: channelRollupMultiDirectorCards ? undefined : directorWonCount,
    productsClosedWonByRepYtd: channelProductsClosedWonByRepYtd,
    periodName: selectedPeriod?.period_name ?? "",
    periodStart: selectedPeriod?.period_start ?? "",
    periodEnd: selectedPeriod?.period_end ?? "",
    repFyQuarterRows: channelFyQuarterRows,
  };

  // Report Builder + RI: channel org tree (users.id) — same subtree as SQL spec; data scope is per-user getChannelTerritoryRepIds on the server.
  const channelOrgDirectory = (await fetchChannelOrgDirectoryForViewer({ orgId, viewerUserId: ctx.user.id })).map(
    (r) => ({
      id: r.id,
      name: r.name,
      manager_rep_id: r.manager_rep_id ?? null,
      role: r.role ?? "CHANNEL_REP",
      hierarchy_level: r.hierarchy_level ?? null,
    })
  );

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
            closedWonFyYtd={summary.closedWonFyYtd}
            crmTotals={{
              ...summary.crmForecast,
              commit_amount: channelCommit,
              best_case_amount: channelBestCase,
              pipeline_amount: channelPipeline,
              won_amount: channelClosedWon,
              lost_amount:
                partnerHero != null ? partnerHero.crmForecast.lost_amount : summary.crmForecast.lost_amount,
              lost_count:
                partnerHero != null ? partnerHero.crmForecast.lost_count : summary.crmForecast.lost_count,
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
                allowedTabKeys={CHANNEL_DASHBOARD_LEADER_TABS}
                setDefaultTab={setExecDefaultTabAction}
                orgId={ctx.user.org_id}
                orgName={orgName}
                viewerRole={ctx.user.role}
                salesOpportunitiesSimpleProps={salesOpportunitiesSimpleProps}
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
                reportBuilderRepDirectory={channelOrgDirectory}
                reportBuilderQuotaPeriods={(channelSummary?.periods ?? summary.periods).map((p) => ({
                  id: String(p.id),
                  name: p.period_name ?? String(p.id),
                  fiscal_year: String(p.fiscal_year ?? ""),
                }))}
                reportBuilderOrgId={orgId}
                reportBuilderInitialPeriodId={selectedPeriodId}
                revenueIntelligenceOrgId={orgId}
                revenueIntelligenceQuotaPeriods={(channelSummary?.periods ?? summary.periods).map((p) => ({
                  id: String(p.id),
                  name: p.period_name,
                  fiscal_year: String(p.fiscal_year ?? ""),
                }))}
                revenueIntelligenceRepDirectory={channelOrgDirectory}
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
        ) : (
          <div className="mt-4">
            <ScopedDashboardTabsClient
              initialTab={activeTab}
              allowedTabKeys={CHANNEL_REP_DASHBOARD_TABS}
              tabLabels={{
                sales_opportunities: "Sales Opportunities",
                channel_partners: "Channel Partners",
              }}
              setDefaultTab={setExecDefaultTabAction}
              panels={{
                sales_opportunities: (
                  <div className="-mx-4 -mt-4">
                    <SimpleForecastDashboardClient {...salesOpportunitiesSimpleProps} />
                  </div>
                ),
                channel_partners: (
                  <ChannelTabPanelClient
                    revenueTabProps={channelTabProps}
                    viewerRole={ctx.user.role}
                    showChannelContribution={ledFedRows.length > 0}
                    channelContributionHero={partnerHero}
                    channelContributionRows={ledFedRows}
                    topPartnerWon={channelTopPartnerWon}
                    topPartnerLost={channelTopPartnerLost}
                  />
                ),
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}

