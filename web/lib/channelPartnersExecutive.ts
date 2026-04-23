import { pool } from "./pool";
import { crmBucketCaseSql } from "./crmBucketCaseSql";
import { partnerMotionCaseSql, partnerMotionPredicatesSql, type PartnerDealMotion } from "./partnerMotion";
import { channelDealScopeWhereMerged, channelDealScopeWhereStrict } from "./channelDealScope";

type MotionStatsRow = {
  motion: PartnerDealMotion;
  opps: number;
  won_opps: number;
  lost_opps: number;
  win_rate: number | null;
  aov: number | null;
  avg_days: number | null;
  avg_won_days: number | null;
  avg_health_score: number | null;
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
  avg_health_score: number | null;
  won_amount: number;
};

type OpenPipelineMotionRow = { motion: PartnerDealMotion; open_opps: number; open_amount: number };
type OpenPipelinePartnerRow = { partner_name: string; open_opps: number; open_amount: number };

function motionStatsByKey(rows: MotionStatsRow[]): Map<PartnerDealMotion, MotionStatsRow> {
  const m = new Map<PartnerDealMotion, MotionStatsRow>();
  const empty = (motion: PartnerDealMotion): MotionStatsRow => ({
    motion,
    opps: 0,
    won_opps: 0,
    lost_opps: 0,
    win_rate: null,
    aov: null,
    avg_days: null,
    avg_won_days: null,
    avg_health_score: null,
    won_amount: 0,
    lost_amount: 0,
  });
  for (const motion of ["direct", "partner_influenced", "partner_sourced"] as PartnerDealMotion[]) m.set(motion, empty(motion));
  for (const r of rows || []) {
    const key = String(r.motion) as PartnerDealMotion;
    if (m.has(key)) m.set(key, { ...r, motion: key });
  }
  return m;
}

function normalizePartnerNames(names: string[]): string[] {
  return Array.from(
    new Set(
      (names || [])
        .map((n) => String(n || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

/**
 * Channel-scoped equivalent of `partnersExecutive` (CEI/WIC/PQS inputs).
 * Visibility rules match channel deal scoping: when partnerNames are provided, scope by partner_name;
 * otherwise scope by territory rep ids.
 */
export async function loadChannelPartnersExecutive(args: {
  orgId: number;
  quotaPeriodId: string;
  prevQuotaPeriodId?: string | null;
  territoryRepIds: number[];
  directTerritoryRepIds?: number[];
  partnerNames: string[];
  scopeMode?: "strict" | "merged";
}) {
  const orgId = Number(args.orgId);
  const quotaPeriodId = String(args.quotaPeriodId || "").trim();
  const prevQpId = String(args.prevQuotaPeriodId || "").trim();
  const territoryRepIds = (args.territoryRepIds || []).filter((id) => Number.isFinite(id) && id > 0);
  const directTerritoryRepIds = (args.directTerritoryRepIds || args.territoryRepIds || []).filter(
    (id) => Number.isFinite(id) && id > 0
  );
  const partnerNames = normalizePartnerNames(args.partnerNames || []);
  const channelScopeWhere =
    args.scopeMode === "merged"
      ? channelDealScopeWhereMerged(3, 4)
      : channelDealScopeWhereStrict(3, 4);
  if (!quotaPeriodId) return null;

  const motionStats = await pool
    .query<MotionStatsRow>(
      `
      WITH qp AS (
        SELECT period_start::date AS period_start, period_end::date AS period_end
        FROM quota_periods
        WHERE org_id = $1::bigint
          AND id = $2::bigint
        LIMIT 1
      ),
      channel_deals AS (
        SELECT
          (${partnerMotionCaseSql("o")})::text AS motion,
          COALESCE(o.amount, 0)::float8 AS amount,
          o.health_score::float8 AS health_score,
          o.create_date::timestamptz AS create_date,
          o.close_date::date AS close_date,
          (${crmBucketCaseSql("o")}) AS crm_bucket
        FROM opportunities o
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = o.org_id
         AND stm.field = 'stage'
         AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
        JOIN qp ON TRUE
        WHERE o.org_id = $1
          AND o.close_date IS NOT NULL
          AND o.close_date >= qp.period_start
          AND o.close_date <= qp.period_end
          ${channelScopeWhere}
      ),
      direct_deals AS (
        SELECT
          'direct'::text AS motion,
          COALESCE(o.amount, 0)::float8 AS amount,
          o.health_score::float8 AS health_score,
          o.create_date::timestamptz AS create_date,
          o.close_date::date AS close_date,
          (${crmBucketCaseSql("o")}) AS crm_bucket
        FROM opportunities o
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = o.org_id
         AND stm.field = 'stage'
         AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
        JOIN qp ON TRUE
        WHERE o.org_id = $1
          AND o.close_date IS NOT NULL
          AND o.close_date >= qp.period_start
          AND o.close_date <= qp.period_end
          AND o.rep_id = ANY($5::bigint[])
          AND ${partnerMotionPredicatesSql.isDirect}
      ),
      base AS (
        SELECT
          motion,
          amount,
          health_score,
          crm_bucket,
          CASE WHEN create_date IS NOT NULL AND close_date IS NOT NULL THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0))::int ELSE NULL END AS age_days
        FROM channel_deals
        WHERE crm_bucket IN ('won', 'lost')
          AND motion IN ('partner_influenced', 'partner_sourced')
        UNION ALL
        SELECT
          motion,
          amount,
          health_score,
          crm_bucket,
          CASE WHEN create_date IS NOT NULL AND close_date IS NOT NULL THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0))::int ELSE NULL END AS age_days
        FROM direct_deals
        WHERE crm_bucket IN ('won', 'lost')
      )
      SELECT
        motion,
        COUNT(*)::int AS opps,
        COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::int AS won_opps,
        COALESCE(SUM(CASE WHEN crm_bucket = 'lost' THEN 1 ELSE 0 END), 0)::int AS lost_opps,
        CASE WHEN COUNT(*) > 0 THEN (COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::float8 / COUNT(*)::float8) ELSE NULL END AS win_rate,
        AVG(NULLIF(amount, 0))::float8 AS aov,
        AVG(age_days)::float8 AS avg_days,
        AVG(CASE WHEN crm_bucket = 'won' THEN age_days ELSE NULL END)::float8 AS avg_won_days,
        AVG(NULLIF(health_score, 0))::float8 AS avg_health_score,
        SUM(CASE WHEN crm_bucket = 'won' THEN amount ELSE 0 END)::float8 AS won_amount,
        SUM(CASE WHEN crm_bucket = 'lost' THEN amount ELSE 0 END)::float8 AS lost_amount
      FROM base
      GROUP BY motion
      ORDER BY motion ASC
      `,
      [orgId, quotaPeriodId, territoryRepIds, partnerNames, directTerritoryRepIds]
    )
    .then((r) => r.rows || [])
    .catch(() => []);

  const topPartners = await pool
    .query<PartnerRollupRow>(
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
          partner_name,
          amount,
          health_score,
          crm_bucket,
          CASE WHEN create_date IS NOT NULL AND close_date IS NOT NULL THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0))::int ELSE NULL END AS age_days
        FROM (
          SELECT
            btrim(o.partner_name) AS partner_name,
            COALESCE(o.amount, 0)::float8 AS amount,
            o.health_score::float8 AS health_score,
            o.create_date::timestamptz AS create_date,
            o.close_date::date AS close_date,
            (${crmBucketCaseSql("o")}) AS crm_bucket
          FROM opportunities o
          LEFT JOIN org_stage_mappings stm
            ON stm.org_id = o.org_id
           AND stm.field = 'stage'
           AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
          LEFT JOIN org_stage_mappings fcm
            ON fcm.org_id = o.org_id
           AND fcm.field = 'forecast_category'
           AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
          JOIN qp ON TRUE
          WHERE o.org_id = $1
            AND o.partner_name IS NOT NULL
            AND btrim(o.partner_name) <> ''
            AND (
              ${partnerMotionPredicatesSql.isPartnerInfluenced}
              OR ${partnerMotionPredicatesSql.isPartnerSourced}
            )
            AND o.close_date IS NOT NULL
            AND o.close_date >= qp.period_start
            AND o.close_date <= qp.period_end
            ${channelScopeWhere}
        ) base
        WHERE crm_bucket IN ('won', 'lost')
      )
      SELECT
        partner_name,
        COUNT(*)::int AS opps,
        COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::int AS won_opps,
        COALESCE(SUM(CASE WHEN crm_bucket = 'lost' THEN 1 ELSE 0 END), 0)::int AS lost_opps,
        CASE WHEN COUNT(*) > 0 THEN (COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::float8 / COUNT(*)::float8) ELSE NULL END AS win_rate,
        AVG(NULLIF(amount, 0))::float8 AS aov,
        AVG(age_days)::float8 AS avg_days,
        AVG(NULLIF(health_score, 0))::float8 AS avg_health_score,
        SUM(CASE WHEN crm_bucket = 'won' THEN amount ELSE 0 END)::float8 AS won_amount
      FROM base
      GROUP BY partner_name
      ORDER BY won_amount DESC NULLS LAST, opps DESC, partner_name ASC
      LIMIT 30
      `,
      [orgId, quotaPeriodId, territoryRepIds, partnerNames]
    )
    .then((r) => r.rows || [])
    .catch(() => []);

  const openByMotion = await pool
    .query<OpenPipelineMotionRow>(
      `
      WITH qp AS (
        SELECT period_start::date AS period_start, period_end::date AS period_end
        FROM quota_periods
        WHERE org_id = $1::bigint
          AND id = $2::bigint
        LIMIT 1
      ),
      channel_deals AS (
        SELECT
          (${partnerMotionCaseSql("o")})::text AS motion,
          COALESCE(o.amount, 0)::float8 AS amount,
          (${crmBucketCaseSql("o")}) AS crm_bucket
        FROM opportunities o
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = o.org_id
         AND stm.field = 'stage'
         AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
        JOIN qp ON TRUE
        WHERE o.org_id = $1
          AND o.close_date IS NOT NULL
          AND o.close_date >= qp.period_start
          AND o.close_date <= qp.period_end
          AND (${crmBucketCaseSql("o")}) NOT IN ('won', 'lost')
          ${channelScopeWhere}
      ),
      direct_deals AS (
        SELECT
          'direct'::text AS motion,
          COALESCE(o.amount, 0)::float8 AS amount,
          (${crmBucketCaseSql("o")}) AS crm_bucket
        FROM opportunities o
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = o.org_id
         AND stm.field = 'stage'
         AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
        JOIN qp ON TRUE
        WHERE o.org_id = $1
          AND o.close_date IS NOT NULL
          AND o.close_date >= qp.period_start
          AND o.close_date <= qp.period_end
          AND (${crmBucketCaseSql("o")}) NOT IN ('won', 'lost')
          AND o.rep_id = ANY($5::bigint[])
          AND ${partnerMotionPredicatesSql.isDirect}
      ),
      base AS (
        SELECT motion, amount
        FROM channel_deals
        WHERE motion IN ('partner_influenced', 'partner_sourced')
        UNION ALL
        SELECT motion, amount
        FROM direct_deals
      )
      SELECT
        motion,
        COUNT(*)::int AS open_opps,
        SUM(amount)::float8 AS open_amount
      FROM base
      GROUP BY motion
      ORDER BY motion ASC
      `,
      [orgId, quotaPeriodId, territoryRepIds, partnerNames, directTerritoryRepIds]
    )
    .then((r) => r.rows || [])
    .catch(() => []);

  const openByPartner = await pool
    .query<OpenPipelinePartnerRow>(
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
          (${crmBucketCaseSql("o")}) AS crm_bucket
        FROM opportunities o
        LEFT JOIN org_stage_mappings stm
          ON stm.org_id = o.org_id
         AND stm.field = 'stage'
         AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
        LEFT JOIN org_stage_mappings fcm
          ON fcm.org_id = o.org_id
         AND fcm.field = 'forecast_category'
         AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
        JOIN qp ON TRUE
        WHERE o.org_id = $1
          AND o.partner_name IS NOT NULL
          AND btrim(o.partner_name) <> ''
          AND (
            ${partnerMotionPredicatesSql.isPartnerInfluenced}
            OR ${partnerMotionPredicatesSql.isPartnerSourced}
          )
          AND o.close_date IS NOT NULL
          AND o.close_date >= qp.period_start
          AND o.close_date <= qp.period_end
          AND (${crmBucketCaseSql("o")}) NOT IN ('won', 'lost')
          ${channelScopeWhere}
      )
      SELECT
        partner_name,
        COUNT(*)::int AS open_opps,
        SUM(amount)::float8 AS open_amount
      FROM base
      GROUP BY partner_name
      ORDER BY open_amount DESC NULLS LAST, open_opps DESC, partner_name ASC
      LIMIT 120
      `,
      [orgId, quotaPeriodId, territoryRepIds, partnerNames]
    )
    .then((r) => r.rows || [])
    .catch(() => []);

  const curM = motionStatsByKey(motionStats || []);
  const direct = curM.get("direct")!;
  const partner_influenced = curM.get("partner_influenced")!;
  const partner_sourced = curM.get("partner_sourced")!;

  const openByMotionMap = new Map<string, OpenPipelineMotionRow>();
  for (const r of openByMotion || []) openByMotionMap.set(String(r.motion), r);
  const directOpen = Number(openByMotionMap.get("direct")?.open_amount || 0) || 0;
  const influencedOpen = Number(openByMotionMap.get("partner_influenced")?.open_amount || 0) || 0;
  const sourcedOpen = Number(openByMotionMap.get("partner_sourced")?.open_amount || 0) || 0;

  const openPartnerMap = new Map<string, number>();
  for (const r of openByPartner || []) openPartnerMap.set(String(r.partner_name || "").trim(), Number(r.open_amount || 0) || 0);

  const wonD = Number(direct.won_amount || 0) || 0;
  const wonI = Number(partner_influenced.won_amount || 0) || 0;
  const wonS = Number(partner_sourced.won_amount || 0) || 0;
  const denom = wonD + wonI + wonS;
  const revenue_mix_motion_pct01 =
    denom > 0
      ? { direct: wonD / denom, partner_influenced: wonI / denom, partner_sourced: wonS / denom }
      : { direct: null, partner_influenced: null, partner_sourced: null };

  const ceiPrevPartnerSourcedIndex = await (async () => {
    if (!prevQpId) return null;
    const prev = await loadChannelPartnersExecutive({
      orgId,
      quotaPeriodId: prevQpId,
      territoryRepIds,
      directTerritoryRepIds,
      partnerNames,
      scopeMode: args.scopeMode,
    }).catch(() => null);
    if (!prev) return null;
    const d0 = prev.direct;
    const s0 = prev.partner_sourced;
    const directDays = d0.avg_days == null ? null : Number(d0.avg_days);
    const sourcedDays = s0.avg_days == null ? null : Number(s0.avg_days);
    const directWon = Number(d0.won_amount || 0) || 0;
    const sourcedWon = Number(s0.won_amount || 0) || 0;
    const directWin = d0.win_rate == null ? null : Number(d0.win_rate);
    const sourcedWin = s0.win_rate == null ? null : Number(s0.win_rate);
    const directH = d0.avg_health_score == null ? null : Number(d0.avg_health_score) / 30;
    const sourcedH = s0.avg_health_score == null ? null : Number(s0.avg_health_score) / 30;
    const RV_direct = directDays && directDays > 0 ? directWon / directDays : 0;
    const RV_sourced = sourcedDays && sourcedDays > 0 ? sourcedWon / sourcedDays : 0;
    const QM_direct = directWin == null ? 0 : directH == null ? directWin : directWin * directH;
    const QM_sourced = sourcedWin == null ? 0 : sourcedH == null ? sourcedWin : sourcedWin * sourcedH;
    const CEI_raw_direct = RV_direct * QM_direct;
    const CEI_raw_sourced = RV_sourced * QM_sourced;
    if (!(CEI_raw_direct > 0)) return null;
    return (CEI_raw_sourced / CEI_raw_direct) * 100;
  })();

  return {
    direct: { ...direct, open_pipeline: directOpen },
    partner_influenced: { ...partner_influenced, open_pipeline: influencedOpen },
    partner_sourced: { ...partner_sourced, open_pipeline: sourcedOpen },
    revenue_mix_motion_pct01,
    cei_prev_partner_sourced_index: ceiPrevPartnerSourcedIndex,
    top_partners: (topPartners || []).map((p) => ({
      ...p,
      open_pipeline: Number(openPartnerMap.get(String(p.partner_name || "").trim()) || 0) || 0,
    })),
    previous: null,
  };
}

