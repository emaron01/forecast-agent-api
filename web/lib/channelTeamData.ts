import "server-only";

import type { RepManagerManagerRow, RepManagerRepRow } from "../app/components/dashboard/executive/RepManagerComparisonPanel";
import {
  deduplicateWonDeals,
  getChannelDashboardSummary,
  loadChannelRepFyQuarterRows,
  loadChannelRepWonDeals,
  type ChannelDashboardSummary,
  type ChannelRepFyQuarterRow,
} from "./channelDashboard";
import { getChannelTerritoryRepIds } from "./channelTerritoryScope";
import { getQuotaByRepPeriod, getRepKpisByPeriod, type RepPeriodKpisRow } from "./executiveRepKpis";
import { pool } from "./pool";
import type { RepDirectoryRow } from "./repScope";
import { HIERARCHY, isChannelRoleLevel } from "./roleHelpers";

export async function getCurrentChannelRepsTableId(args: { orgId: number; userId: number }): Promise<number | null> {
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

export function aggregateTerritoryRepKpis(
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

export async function listChannelScopedRepIds(args: {
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
    console.error("[buildChannelTeamPayload] listChannelScopedRepIds error", error);
    return [];
  }
}

async function getCurrentChannelUserId(args: { orgId: number; userId: number }): Promise<number | null> {
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
    console.error("[buildChannelTeamPayload] listAssignedPartnerNames error", error);
    return [];
  }
}

export type ChannelLostDealRow = {
  id: string;
  amount: number;
  rep_id: number;
  partner_name: string | null;
};

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

export type ChannelProductWonByRepRow = {
  rep_id?: string;
  rep_name: string;
  product: string;
  won_amount: number;
  won_count: number;
  avg_order_value: number;
  avg_health_score: number | null;
};

export type OrgLevelProductRow = {
  product: string;
  won_amount: number;
  won_count: number;
};

function mergeOrgLevelProductRows(rowsList: OrgLevelProductRow[][]): OrgLevelProductRow[] {
  const byProduct = new Map<string, OrgLevelProductRow>();
  for (const rows of rowsList) {
    for (const r of rows) {
      const key = r.product;
      const prev = byProduct.get(key);
      const wonAmount = Number(r.won_amount || 0) || 0;
      const wonCount = Number(r.won_count || 0) || 0;
      if (prev) {
        prev.won_amount += wonAmount;
        prev.won_count += wonCount;
      } else {
        byProduct.set(key, { product: r.product, won_amount: wonAmount, won_count: wonCount });
      }
    }
  }
  return Array.from(byProduct.values())
    .sort((a, b) => b.won_amount - a.won_amount)
    .slice(0, 30);
}

/**
 * Single-query product rollup for the union of all channel rep scopes, deduping wins by opportunity id.
 */
export async function loadDedupedChannelProductsForScope(args: {
  orgId: number;
  quotaPeriodId: string;
  allTerritoryRepIds: number[];
  allPartnerNames: string[];
}): Promise<OrgLevelProductRow[]> {
  if (!args.quotaPeriodId || (args.allTerritoryRepIds.length === 0 && args.allPartnerNames.length === 0)) {
    return [];
  }
  const repLen = args.allTerritoryRepIds.length;
  const pn = Array.from(new Set(args.allPartnerNames.map((s) => s.trim().toLowerCase()).filter(Boolean)));
  const partnerLen = pn.length;

  const { rows } = await pool.query<{ product: string; won_amount: number; won_count: number }>(
    `
    WITH qp AS (
      SELECT period_start::date AS period_start, period_end::date AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint AND id = $2::bigint
      LIMIT 1
    ),
    won_deals AS (
      SELECT DISTINCT ON (o.id)
        o.id,
        COALESCE(NULLIF(btrim(o.product), ''), '(Unspecified)') AS product,
        COALESCE(o.amount, 0)::float8 AS amount
      FROM opportunities o
      JOIN qp ON TRUE
      WHERE o.org_id = $1
        AND o.partner_name IS NOT NULL
        AND btrim(o.partner_name) <> ''
        AND o.close_date::date >= qp.period_start
        AND o.close_date::date <= qp.period_end
        AND (
          ($5::bigint > 0 AND o.rep_id = ANY($3::bigint[]))
          OR ($6::bigint > 0 AND lower(btrim(COALESCE(o.partner_name,''))) = ANY($4::text[]))
        )
        AND ((' ' || lower(regexp_replace(
          COALESCE(NULLIF(btrim(o.forecast_stage),''),'') || ' ' ||
          COALESCE(NULLIF(btrim(o.sales_stage),''),''),
          '[^a-zA-Z]+', ' ', 'g'
        )) || ' ') LIKE '% won %')
      ORDER BY o.id
    )
    SELECT
      product,
      SUM(amount)::float8 AS won_amount,
      COUNT(*)::int AS won_count
    FROM won_deals
    GROUP BY product
    ORDER BY won_amount DESC
    LIMIT 30
    `,
    [args.orgId, args.quotaPeriodId, args.allTerritoryRepIds, pn, Number(repLen), Number(partnerLen)]
  );
  return (rows || []).map((r) => ({
    product: r.product,
    won_amount: Number(r.won_amount || 0) || 0,
    won_count: Number(r.won_count || 0) || 0,
  }));
}

type PartnerScopedProductAggRow = {
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
}): Promise<PartnerScopedProductAggRow[]> {
  const repLen = args.territoryRepIds.length;
  const scopePn = Array.from(
    new Set((args.scopePartnerNames || []).map((n) => String(n || "").trim().toLowerCase()).filter(Boolean))
  );
  const partnerLen = scopePn.length;
  if (!args.quotaPeriodId || (repLen === 0 && partnerLen === 0)) return [];
  const { rows } = await pool.query<PartnerScopedProductAggRow>(
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
        o.close_date::date AS close_d
      FROM opportunities o
      WHERE o.org_id = $1
        AND (
          ($6::bigint > 0 AND o.rep_id = ANY($3::bigint[]))
          OR ($7::bigint > 0 AND lower(btrim(COALESCE(o.partner_name, ''))) = ANY($4::text[]))
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
    [
      args.orgId,
      args.quotaPeriodId,
      args.territoryRepIds,
      scopePn,
      args.assignedPartnerNames,
      Number(repLen),
      Number(partnerLen),
    ]
  );
  return (rows || []).map((r) => ({
    product: r.product,
    won_amount: Number(r.won_amount || 0) || 0,
    won_count: Number(r.won_count || 0) || 0,
    avg_order_value: Number(r.avg_order_value || 0) || 0,
    avg_health_score:
      r.avg_health_score == null || !Number.isFinite(Number(r.avg_health_score)) ? null : Number(r.avg_health_score),
  }));
}

export type BuildChannelTeamPayloadArgs = {
  orgId: number;
  userId: number;
  hierarchyLevel: number;
  selectedQuotaPeriodId: string;
  fiscalYear: string;
  comparePeriodIds: string[];
  /** Same as channel dashboard `scope.myRepId ?? summary.myRepId`. */
  myRepIdFallback: number | null;
  viewerDisplayName: string;
  selectedPeriod: { period_start: string; period_end: string } | null;
  /** `periods.filter(p => fiscal_year === fiscalYear).map(p => String(p.id))` */
  fyQuotaPeriodIds: string[];
  /** Previous quota period id for QoQ deltas (channel uses `prevQpId`). */
  prevQuotaPeriodId: string;
  /** When set (e.g. channel dashboard), skips a second `listChannelScopedRepIds` query. */
  channelScopedRepIds?: number[];
  /** For sales leadership viewers: rep table ids of channel reps (hierarchy 8) from scoped `repDirectory` when `listChannelScopedRepIds` returns []. */
  channelRepIdsFromDirectory?: number[];
  /** Scoped rep directory rows (for sales viewers: channel exec rollup + territory fallback user ids). */
  repDirectoryForRollup?: Array<{
    id: number;
    name: string;
    hierarchy_level: number | null;
    user_id: number | null;
  }>;
};

export type BuildChannelTeamPayloadResult = {
  channelTeamRepRows: RepManagerRepRow[];
  channelManagerRows: RepManagerManagerRow[];
  channelFyQuarterRows: ChannelRepFyQuarterRow[];
  channelViewerRepId: number | null;
  /** Same object as `getChannelDashboardSummary` inside this build (for channel page reuse). */
  channelDashboardSummary: ChannelDashboardSummary | null;
  productsClosedWonByRep: ChannelProductWonByRepRow[];
  productsClosedWonByRepYtd: ChannelProductWonByRepRow[];
  /** Deduplicated across channel scopes (Indirect manager cards). */
  orgLevelProductsCurrentQ: OrgLevelProductRow[];
  orgLevelProductsYtd: OrgLevelProductRow[];
  managerLostAmountOverride?: number;
  managerLostCountOverride?: number;
  managerWonAmountOverride?: number;
  managerWonCountOverride?: number;
};

function safeDivChannel(n: number, d: number): number | null {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

export type AssembleChannelTeamLeaderboardFromStateArgs = {
  orgId: number;
  channelSummary: ChannelDashboardSummary | null;
  channelScopedRepIds: number[];
  channelRepKpisRows: RepPeriodKpisRow[];
  lostDealsByRole8RepId: Map<number, ChannelLostDealRow[]>;
  territorySalesIdsByChannelRepId: Map<number, Set<string>>;
  prevQuotaPeriodId: string;
  selectedQuotaPeriodId: string;
  channelFyQuarterRows: ChannelRepFyQuarterRow[];
  channelViewerRepId: number | null;
  viewerDisplayName: string;
  directorTerritoryLostAmount: number;
  directorTerritoryLostCount: number;
  directorWonAmount: number;
  directorWonCount: number;
  repDirectoryForRollup?: Array<{
    id: number;
    name: string;
    hierarchy_level: number | null;
    user_id: number | null;
  }>;
};

export type ChannelTeamLeaderboardSlice = Pick<
  BuildChannelTeamPayloadResult,
  | "channelTeamRepRows"
  | "channelManagerRows"
  | "channelFyQuarterRows"
  | "channelViewerRepId"
  | "managerLostAmountOverride"
  | "managerLostCountOverride"
  | "managerWonAmountOverride"
  | "managerWonCountOverride"
>;

/**
 * Builds rep + manager leaderboard rows from KPI / lost-deal state (used by channel dashboard
 * when there is no full `buildChannelTeamPayload` result, e.g. zero scoped channel reps).
 */
export async function assembleChannelTeamLeaderboardFromState(
  args: AssembleChannelTeamLeaderboardFromStateArgs
): Promise<ChannelTeamLeaderboardSlice> {
  const {
    orgId,
    channelSummary,
    channelScopedRepIds,
    channelRepKpisRows,
    lostDealsByRole8RepId,
    territorySalesIdsByChannelRepId,
    prevQuotaPeriodId,
    selectedQuotaPeriodId,
    channelFyQuarterRows,
    channelViewerRepId,
    viewerDisplayName,
    directorTerritoryLostAmount,
    directorTerritoryLostCount,
    directorWonAmount,
    directorWonCount,
    repDirectoryForRollup,
  } = args;

  const channelKpisByRepId = new Map<string, RepPeriodKpisRow>();
  const channelKpisPrevByRepId = new Map<string, RepPeriodKpisRow>();
  for (const crId of channelScopedRepIds) {
    const salesSet = territorySalesIdsByChannelRepId.get(crId) ?? new Set<string>();
    const cur = aggregateTerritoryRepKpis(channelRepKpisRows, selectedQuotaPeriodId, salesSet);
    const prev = prevQuotaPeriodId
      ? aggregateTerritoryRepKpis(channelRepKpisRows, prevQuotaPeriodId, salesSet)
      : null;
    if (cur) channelKpisByRepId.set(String(crId), cur);
    if (prev) channelKpisPrevByRepId.set(String(crId), prev);
  }

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
        args.repDirectoryForRollup?.find((r) => r.id === channelViewerRepId)?.name ||
        String(viewerDisplayName || "").trim() ||
        `Rep ${channelViewerRepId}`
      : "";

  const rowsSource = channelSummary?.channelRepRows ?? [];
  const channelTeamRepRows: RepManagerRepRow[] = rowsSource.map((r) => {
    const c = channelKpisByRepId.get(String(r.rep_id)) ?? null;
    const p = prevQuotaPeriodId ? channelKpisPrevByRepId.get(String(r.rep_id)) ?? null : null;
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
    const directorRepId = Number.isFinite(crTableId) ? channelDirectorRepIdByChannelRepId.get(crTableId) : undefined;
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
  });

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
          const mgrRows: RepManagerManagerRow[] = [];
          for (const [key, a] of agg.entries()) {
            const manager_id = key;
            const quota = a.quota;
            const won = a.won_amount;
            mgrRows.push({
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
          mgrRows.sort(
            (x, y) =>
              (Number(y.attainment ?? -1) - Number(x.attainment ?? -1)) ||
              y.won_amount - x.won_amount ||
              x.manager_name.localeCompare(y.manager_name)
          );
          return mgrRows;
        })()
      : [];

  const directorRepIds = channelDirectorManagerRows
    .filter((r) => r.manager_id !== "__unassigned__")
    .map((r) => Number(r.manager_id))
    .filter((id) => Number.isFinite(id) && id > 0);

  const repIdsForQuota = Array.from(
    new Set([
      ...directorRepIds,
      ...(channelViewerRepId != null && Number.isFinite(channelViewerRepId) && channelViewerRepId > 0
        ? [channelViewerRepId]
        : []),
    ])
  );

  let quotaRows: Awaited<ReturnType<typeof getQuotaByRepPeriod>> = [];
  if (repIdsForQuota.length > 0 && selectedQuotaPeriodId) {
    quotaRows = await getQuotaByRepPeriod({
      orgId,
      quotaPeriodIds: [selectedQuotaPeriodId],
      repIds: repIdsForQuota,
    });
  }

  const periodIdStr = String(selectedQuotaPeriodId || "");
  for (const row of channelDirectorManagerRows) {
    if (row.manager_id === "__unassigned__") continue;
    const dbQuota = quotaRows.find(
      (q) => String(q.rep_id) === row.manager_id && String(q.quota_period_id) === periodIdStr
    );
    if (dbQuota != null) {
      row.quota = Number(dbQuota.quota_amount) || 0;
      row.attainment = safeDivChannel(row.won_amount, row.quota);
    }
  }

  let channelManagerRows: RepManagerManagerRow[] = channelDirectorManagerRows;
  if (channelViewerRepId != null) {
    const totalWon = channelDirectorManagerRows.reduce((s, r) => s + (Number(r.won_amount) || 0), 0);
    const totalActive = channelDirectorManagerRows.reduce((s, r) => s + (Number(r.active_amount) || 0), 0);
    const viewerQuotaRow = quotaRows.find(
      (q) => String(q.rep_id) === String(channelViewerRepId) && String(q.quota_period_id) === periodIdStr
    );
    const viewerQuota = viewerQuotaRow
      ? Number(viewerQuotaRow.quota_amount) || 0
      : channelDirectorManagerRows.reduce((s, r) => s + (Number(r.quota) || 0), 0);
    const viewerRow: RepManagerManagerRow = {
      manager_id: String(channelViewerRepId),
      manager_name: channelViewerName || `Rep ${channelViewerRepId}`,
      parent_manager_id: "",
      quota: viewerQuota,
      won_amount: totalWon,
      active_amount: totalActive,
      attainment: viewerQuota > 0 ? totalWon / viewerQuota : null,
      win_rate: null,
      partner_contribution: null,
    };
    channelManagerRows = [viewerRow, ...channelDirectorManagerRows];
  } else if (
    channelViewerRepId == null &&
    channelDirectorManagerRows.length > 0 &&
    repDirectoryForRollup?.length
  ) {
    const topChannelLeader = repDirectoryForRollup.find((r) => Number(r.hierarchy_level) === HIERARCHY.CHANNEL_EXEC);
    if (topChannelLeader) {
      const totalWon = channelDirectorManagerRows.reduce((s, r) => s + (Number(r.won_amount) || 0), 0);
      const totalActive = channelDirectorManagerRows.reduce((s, r) => s + (Number(r.active_amount) || 0), 0);
      const totalQuota = channelDirectorManagerRows.reduce((s, r) => s + (Number(r.quota) || 0), 0);
      const rollupRow: RepManagerManagerRow = {
        manager_id: String(topChannelLeader.id),
        manager_name: topChannelLeader.name,
        parent_manager_id: "",
        quota: totalQuota,
        won_amount: totalWon,
        active_amount: totalActive,
        attainment: totalQuota > 0 ? totalWon / totalQuota : null,
        win_rate: null,
        partner_contribution: null,
      };
      channelManagerRows = [
        rollupRow,
        ...channelDirectorManagerRows.map((r) => ({
          ...r,
          parent_manager_id: String(topChannelLeader.id),
        })),
      ];
    }
  }

  const channelDirectorCardCount = new Set(
    channelTeamRepRows.map((row) => String(row.manager_id || "").trim()).filter(Boolean)
  ).size;
  const channelRollupMultiDirectorCards = channelDirectorCardCount > 1;

  // Won/lost overrides only apply for channel viewers — for sales viewers the
  // manager card aggregates correctly from channelTeamRepRows won amounts.
  const applyOverrides = directorWonAmount > 0 || directorTerritoryLostAmount > 0;

  return {
    channelTeamRepRows,
    channelManagerRows,
    channelFyQuarterRows,
    channelViewerRepId,
    managerLostAmountOverride:
      applyOverrides && !channelRollupMultiDirectorCards ? directorTerritoryLostAmount : undefined,
    managerLostCountOverride:
      applyOverrides && !channelRollupMultiDirectorCards ? directorTerritoryLostCount : undefined,
    managerWonAmountOverride: applyOverrides && !channelRollupMultiDirectorCards ? directorWonAmount : undefined,
    managerWonCountOverride: applyOverrides && !channelRollupMultiDirectorCards ? directorWonCount : undefined,
  };
}

/**
 * Full channel Team tab + products payload (same as channel dashboard inline build).
 * Returns null when no channel reps are in scope.
 */
export async function buildChannelTeamPayload(
  args: BuildChannelTeamPayloadArgs
): Promise<BuildChannelTeamPayloadResult | null> {
  const {
    orgId,
    userId,
    hierarchyLevel,
    selectedQuotaPeriodId,
    fiscalYear: fyYearKeyRaw,
    comparePeriodIds,
    myRepIdFallback,
    viewerDisplayName,
    selectedPeriod,
    fyQuotaPeriodIds: fyPeriodIds,
    prevQuotaPeriodId,
    channelScopedRepIds: scopedRepIdsArg,
  } = args;

  let territoryRepIds = (
    await getChannelTerritoryRepIds({
      orgId,
      channelUserId: userId,
    }).catch(() => ({ repIds: [] as number[], partnerNames: [] as string[] }))
  ).repIds;

  const currentChannelRepId =
    Number.isFinite(Number(myRepIdFallback)) && Number(myRepIdFallback) > 0 ? Number(myRepIdFallback) : null;
  const currentChannelUserId =
    selectedQuotaPeriodId ? await getCurrentChannelUserId({ orgId, userId }).catch(() => null) : null;
  const viewerChannelRepsTableId = selectedQuotaPeriodId
    ? await getCurrentChannelRepsTableId({ orgId, userId }).catch(() => null)
    : null;
  let channelViewerRepId =
    viewerChannelRepsTableId != null &&
    Number.isFinite(Number(viewerChannelRepsTableId)) &&
    Number(viewerChannelRepsTableId) > 0
      ? Number(viewerChannelRepsTableId)
      : currentChannelRepId != null && Number.isFinite(Number(currentChannelRepId)) && Number(currentChannelRepId) > 0
        ? Number(currentChannelRepId)
        : null;

  const isChannelViewer = isChannelRoleLevel(hierarchyLevel);
  // For non-channel viewers, channelViewerRepId should be the top channel leader
  // in scope (level 6), not the sales viewer's own rep id.
  if (!isChannelViewer && args.repDirectoryForRollup) {
    const topChannelLeader =
      args.repDirectoryForRollup
        .filter((r) => Number(r.hierarchy_level) === HIERARCHY.CHANNEL_EXEC)
        .sort((a, b) => a.id - b.id)[0] ?? null;
    if (topChannelLeader) {
      channelViewerRepId = topChannelLeader.id;
    } else {
      const topChannelManager =
        args.repDirectoryForRollup
          .filter((r) => Number(r.hierarchy_level) === HIERARCHY.CHANNEL_MANAGER)
          .sort((a, b) => a.id - b.id)[0] ?? null;
      channelViewerRepId = topChannelManager?.id ?? null;
    }
  }

  let assignedPartnerNames = await listAssignedPartnerNames({
    orgId,
    hierarchyLevel: Number(hierarchyLevel),
    channelRepId: currentChannelUserId,
  });

  let channelScopedRepIds =
    scopedRepIdsArg ??
    (await listChannelScopedRepIds({
      orgId,
      hierarchyLevel: Number(hierarchyLevel),
      viewerChannelRepId: currentChannelRepId,
      viewerUserId: userId,
    }));

  // For non-channel viewers (sales leadership), listChannelScopedRepIds returns []
  // because it scopes by channel role relationships. Fall back to using channel rep
  // ids from the rep directory that was passed in.
  if (channelScopedRepIds.length === 0 && args.channelRepIdsFromDirectory?.length) {
    channelScopedRepIds = args.channelRepIdsFromDirectory;
  }

  if (!channelScopedRepIds.length) {
    return null;
  }

  if (!isChannelViewer && args.repDirectoryForRollup && channelScopedRepIds.length > 0) {
    const channelRep8Rows = args.repDirectoryForRollup.filter(
      (r) =>
        Number(r.hierarchy_level) === HIERARCHY.CHANNEL_REP &&
        channelScopedRepIds.includes(r.id) &&
        r.user_id != null
    );
    const territoryResults = await Promise.all(
      channelRep8Rows.map((r) =>
        getChannelTerritoryRepIds({ orgId, channelUserId: Number(r.user_id) }).catch(() => ({
          repIds: [] as number[],
          partnerNames: [] as string[],
        }))
      )
    );
    territoryRepIds = [];
    const mergedPartners: string[] = [];
    for (const result of territoryResults) {
      territoryRepIds.push(...result.repIds);
      mergedPartners.push(...result.partnerNames);
    }
    territoryRepIds = [...new Set(territoryRepIds)];
    assignedPartnerNames = Array.from(
      new Set(mergedPartners.map((p) => String(p || "").trim().toLowerCase()).filter(Boolean))
    );
  }

  const channelSummary: ChannelDashboardSummary | null = await getChannelDashboardSummary({
    orgId,
    userId,
    hierarchyLevel: Number(hierarchyLevel),
    selectedQuotaPeriodId: selectedQuotaPeriodId ?? "",
    territoryRepIds,
    channelRepIds: channelScopedRepIds,
    assignedPartnerNames,
    viewerChannelRepId: currentChannelRepId,
    viewerUserId: userId,
  }).catch((err) => {
    console.error("[buildChannelTeamPayload] getChannelDashboardSummary error", err);
    return null;
  });

  const fyYearKey = String(fyYearKeyRaw || "").trim();
  const channelFyQuarterRows: ChannelRepFyQuarterRow[] =
    fyYearKey && channelScopedRepIds.length > 0
      ? await loadChannelRepFyQuarterRows({
          orgId,
          fiscalYear: fyYearKey,
          channelRepIds: channelScopedRepIds,
        }).catch((err) => {
          console.error("[buildChannelTeamPayload] loadChannelRepFyQuarterRows error", err);
          return [] as ChannelRepFyQuarterRow[];
        })
      : [];

  let channelRepKpisRows: RepPeriodKpisRow[] = [];
  let channelProductsClosedWonByRep: ChannelProductWonByRepRow[] = [];
  let channelProductsClosedWonByRepYtd: ChannelProductWonByRepRow[] = [];
  let orgLevelProductsCurrentQ: OrgLevelProductRow[] = [];
  let orgLevelProductsYtd: OrgLevelProductRow[] = [];
  let directorTerritoryLostAmount = 0;
  let directorTerritoryLostCount = 0;
  let directorWonAmount = 0;
  let directorWonCount = 0;
  let lostDealsByRole8RepId = new Map<number, ChannelLostDealRow[]>();
  const territorySalesIdsByChannelRepId = new Map<number, Set<string>>();

  try {
    if (selectedQuotaPeriodId && comparePeriodIds.length && channelScopedRepIds.length > 0) {
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
          const chUserId = Number(row.user_id);
          const sc = await getChannelTerritoryRepIds({ orgId, channelUserId: chUserId }).catch(() => ({
            repIds: [] as number[],
            partnerNames: [] as string[],
          }));
          territoryByChannelRepId.set(repTableId, sc.repIds);
          scopePartnerNamesByChannelRepId.set(repTableId, sc.partnerNames);
          territorySalesIdsByChannelRepId.set(repTableId, new Set(sc.repIds.map((id) => String(id))));
          for (const id of sc.repIds) allTerritoryIds.add(id);
        })
      );

      const allTerritoryRepIdsUnion = Array.from(allTerritoryIds);
      const allPartnerNamesUnion = Array.from(
        new Set(
          [
            ...[...scopePartnerNamesByChannelRepId.values()].flat(),
            ...[...partnerNamesByUserId.values()].flat(),
          ]
            .map((s) => String(s || "").trim().toLowerCase())
            .filter(Boolean)
        )
      );

      orgLevelProductsCurrentQ = await loadDedupedChannelProductsForScope({
        orgId,
        quotaPeriodId: selectedQuotaPeriodId,
        allTerritoryRepIds: allTerritoryRepIdsUnion,
        allPartnerNames: allPartnerNamesUnion,
      });

      if (fyPeriodIds.length > 1) {
        const ytdPerPeriod = await Promise.all(
          fyPeriodIds.map((pid) =>
            loadDedupedChannelProductsForScope({
              orgId,
              quotaPeriodId: pid,
              allTerritoryRepIds: allTerritoryRepIdsUnion,
              allPartnerNames: allPartnerNamesUnion,
            })
          )
        );
        orgLevelProductsYtd = mergeOrgLevelProductRows(ytdPerPeriod);
      } else {
        orgLevelProductsYtd = [...orgLevelProductsCurrentQ];
      }

      const territoryIdList = allTerritoryRepIdsUnion;
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

        const hl = Number(hierarchyLevel);
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

        const wonDealsByRep = await loadChannelRepWonDeals({
          orgId,
          selectedQuotaPeriodId,
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
          const uId = Number(row.user_id);
          const tRepIds = territoryByChannelRepId.get(repTableId) || [];
          const scopePn = scopePartnerNamesByChannelRepId.get(repTableId) || [];
          const assigned = partnerNamesByUserId.get(uId) || [];
          const repLabel = repNameByChannelRepId.get(String(repTableId))?.trim() || `(Rep ${repTableId})`;
          if (!tRepIds.length && !scopePn.length) return [] as ChannelProductWonByRepRow[];
          const prows = await loadPartnerScopedProductsForTerritory({
            orgId,
            quotaPeriodId: selectedQuotaPeriodId,
            territoryRepIds: tRepIds,
            scopePartnerNames: scopePn,
            assignedPartnerNames: assigned,
          });
          return prows.map((p) => ({
            rep_id: String(repTableId),
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

      if (fyPeriodIds.length > 1) {
        const ytdProductRowsNested = await Promise.all(
          scopeList.map(async (row) => {
            const repTableId = Number(row.rep_id);
            const uId = Number(row.user_id);
            const territoryRepIdsL = territoryByChannelRepId.get(repTableId) || [];
            const scopePn = scopePartnerNamesByChannelRepId.get(repTableId) || [];
            const assigned = partnerNamesByUserId.get(uId) || [];
            const repLabel = repNameByChannelRepId.get(String(repTableId))?.trim() || `(Rep ${repTableId})`;
            if (!territoryRepIdsL.length && !scopePn.length) return [] as ChannelProductWonByRepRow[];
            const periodRows = await Promise.all(
              fyPeriodIds
                .filter((pid) => pid !== selectedQuotaPeriodId)
                .map((pid) =>
                  loadPartnerScopedProductsForTerritory({
                    orgId,
                    quotaPeriodId: pid,
                    territoryRepIds: territoryRepIdsL,
                    scopePartnerNames: scopePn,
                    assignedPartnerNames: assigned,
                  }).catch(() => [])
                )
            );
            return periodRows.flat().map((p) => ({
              rep_id: String(repTableId),
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
        channelProductsClosedWonByRepYtd = [...channelProductsClosedWonByRep, ...ytdProductRowsNested.flat()];
      } else {
        channelProductsClosedWonByRepYtd = [...channelProductsClosedWonByRep];
      }
    }
  } catch (e) {
    console.error("[buildChannelTeamPayload] channel rep kpis / productsClosedWonByRep", e);
    channelRepKpisRows = [];
    channelProductsClosedWonByRep = [];
    channelProductsClosedWonByRepYtd = [];
    orgLevelProductsCurrentQ = [];
    orgLevelProductsYtd = [];
    lostDealsByRole8RepId = new Map();
    directorTerritoryLostAmount = 0;
    directorTerritoryLostCount = 0;
    directorWonAmount = 0;
    directorWonCount = 0;
  }

  const assembled = await assembleChannelTeamLeaderboardFromState({
    orgId,
    channelSummary,
    channelScopedRepIds,
    channelRepKpisRows,
    lostDealsByRole8RepId,
    territorySalesIdsByChannelRepId,
    prevQuotaPeriodId,
    selectedQuotaPeriodId,
    channelFyQuarterRows,
    channelViewerRepId,
    viewerDisplayName,
    directorTerritoryLostAmount,
    directorTerritoryLostCount,
    directorWonAmount,
    directorWonCount,
    repDirectoryForRollup: args.repDirectoryForRollup,
  });

  return {
    ...assembled,
    channelDashboardSummary: channelSummary,
    productsClosedWonByRep: channelProductsClosedWonByRep,
    productsClosedWonByRepYtd: channelProductsClosedWonByRepYtd,
    orgLevelProductsCurrentQ,
    orgLevelProductsYtd,
  };
}
