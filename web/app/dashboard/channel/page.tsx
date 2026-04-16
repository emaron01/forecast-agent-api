import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { pool } from "../../../lib/pool";
import { fetchChannelOrgDirectoryForViewer } from "../../../lib/channelOrgDirectory";
import { getChannelTerritoryRepIds } from "../../../lib/channelTerritoryScope";
import { getScopedRepDirectory } from "../../../lib/repScope";
import type { ChannelProductWonByRepRow, ChannelTeamLeaderboardSlice } from "../../../lib/channelTeamData";
import { getChannelDashboardSummary, loadChannelRepFyQuarterRows, type ChannelRepFyQuarterRow } from "../../../lib/channelDashboard";
import {
  assembleChannelTeamLeaderboardFromState,
  buildChannelTeamPayload,
  getCurrentChannelRepsTableId,
  listChannelScopedRepIds,
} from "../../../lib/channelTeamData";
import { UserTopNav } from "../../_components/UserTopNav";
import { ExecutiveTabsShellClient } from "../../components/dashboard/executive/ExecutiveTabsShellClient";
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
  const fyYearKey =
    String(summary.selectedPeriod?.fiscal_year ?? summary.selectedFiscalYear ?? "")
      .trim() || "";
  const fyPeriodIds = fyYearKey
    ? summary.periods
        .filter((p) => String(p.fiscal_year).trim() === fyYearKey)
        .map((p) => String(p.id))
    : [];

  const teamPayload =
    selectedPeriodId && channelScopedRepIds.length > 0
      ? await buildChannelTeamPayload({
          orgId: ctx.user.org_id,
          userId: ctx.user.id,
          hierarchyLevel: Number(ctx.user.hierarchy_level),
          selectedQuotaPeriodId: selectedPeriodId,
          fiscalYear: fyYearKey,
          comparePeriodIds,
          myRepIdFallback: currentChannelRepId,
          viewerDisplayName: String(ctx.user.display_name || "").trim(),
          selectedPeriod: selectedPeriod
            ? { period_start: selectedPeriod.period_start, period_end: selectedPeriod.period_end }
            : null,
          fyQuotaPeriodIds: fyPeriodIds,
          prevQuotaPeriodId: prevQpId,
          channelScopedRepIds,
        }).catch((err) => {
          console.error("[channel page] buildChannelTeamPayload error", err);
          return null;
        })
      : null;

  let channelSummary = teamPayload?.channelDashboardSummary ?? null;
  if (!channelSummary) {
    channelSummary = await getChannelDashboardSummary({
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
  }

  const channelProductsClosedWonByRep: ChannelProductWonByRepRow[] = teamPayload?.productsClosedWonByRep ?? [];
  const channelProductsClosedWonByRepYtd: ChannelProductWonByRepRow[] =
    teamPayload?.productsClosedWonByRepYtd ?? [];

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

  const channelFyQuarterRows: ChannelRepFyQuarterRow[] =
    teamPayload?.channelFyQuarterRows ??
    (fyYearKey && channelScopedRepIds.length > 0
      ? await loadChannelRepFyQuarterRows({
          orgId,
          fiscalYear: fyYearKey,
          channelRepIds: channelScopedRepIds,
        }).catch((err) => {
          console.error("[channel page] loadChannelRepFyQuarterRows error", err);
          return [] as ChannelRepFyQuarterRow[];
        })
      : []);

  const teamForLeaderboard: ChannelTeamLeaderboardSlice = teamPayload
    ? {
        channelTeamRepRows: teamPayload.channelTeamRepRows,
        channelManagerRows: teamPayload.channelManagerRows,
        channelFyQuarterRows: teamPayload.channelFyQuarterRows,
        channelViewerRepId: teamPayload.channelViewerRepId,
        managerLostAmountOverride: teamPayload.managerLostAmountOverride,
        managerLostCountOverride: teamPayload.managerLostCountOverride,
        managerWonAmountOverride: teamPayload.managerWonAmountOverride,
        managerWonCountOverride: teamPayload.managerWonCountOverride,
      }
    : await assembleChannelTeamLeaderboardFromState({
        orgId: ctx.user.org_id,
        channelSummary,
        channelScopedRepIds,
        channelRepKpisRows: [],
        lostDealsByRole8RepId: new Map(),
        territorySalesIdsByChannelRepId: new Map(),
        prevQuotaPeriodId: prevQpId,
        selectedQuotaPeriodId: selectedPeriodId ?? "",
        channelFyQuarterRows,
        channelViewerRepId,
        viewerDisplayName: String(ctx.user.display_name || "").trim(),
        directorTerritoryLostAmount: 0,
        directorTerritoryLostCount: 0,
        directorWonAmount: 0,
        directorWonCount: 0,
      });

  const emptyTeamPayload = {
    repRows: teamForLeaderboard.channelTeamRepRows,
    managerRows: teamForLeaderboard.channelManagerRows,
    teamViewerRepId:
      teamForLeaderboard.channelViewerRepId != null ? String(teamForLeaderboard.channelViewerRepId) : null,
    managerLostAmountOverride: teamForLeaderboard.managerLostAmountOverride,
    managerLostCountOverride: teamForLeaderboard.managerLostCountOverride,
    managerWonAmountOverride: teamForLeaderboard.managerWonAmountOverride,
    managerWonCountOverride: teamForLeaderboard.managerWonCountOverride,
    managerLevelProducts: teamPayload?.orgLevelProductsCurrentQ ?? [],
    managerLevelProductsYtd: teamPayload?.orgLevelProductsYtd ?? [],
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

