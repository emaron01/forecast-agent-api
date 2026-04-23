import { pool } from "./pool";
import { crmBucketCaseSql } from "./crmBucketCaseSql";
import { partnerMotionCaseSql, type PartnerDealMotion } from "./partnerMotion";
import { channelDealScopeWhereMerged } from "./channelDealScope";

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

type OpenPipelineMotionRow = {
  motion: PartnerDealMotion;
  open_opps: number;
  open_amount: number;
};

type OpenPipelinePartnerRow = {
  partner_name: string;
  open_opps: number;
  open_amount: number;
};

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
  for (const motion of ["direct", "partner_influenced", "partner_sourced"] as PartnerDealMotion[]) {
    m.set(motion, empty(motion));
  }
  for (const row of rows || []) {
    const key = String(row.motion) as PartnerDealMotion;
    if (m.has(key)) m.set(key, { ...row, motion: key });
  }
  return m;
}

export async function loadExecutiveChannelTabPartners(args: {
  orgId: number;
  quotaPeriodId: string;
  prevQuotaPeriodId?: string | null;
  territoryRepIds: number[];
  partnerNames: string[];
}) {
  const orgId = Number(args.orgId);
  const quotaPeriodId = String(args.quotaPeriodId || "").trim();
  const prevQuotaPeriodId = String(args.prevQuotaPeriodId || "").trim();
  const territoryRepIds = Array.from(
    new Set((args.territoryRepIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
  );
  const partnerNames = Array.from(
    new Set((args.partnerNames || []).map((name) => String(name || "").trim().toLowerCase()).filter(Boolean))
  );
  if (!quotaPeriodId || (territoryRepIds.length === 0 && partnerNames.length === 0)) return null;

  const baseDealsSql = `
    WITH qp AS (
      SELECT period_start::date AS period_start, period_end::date AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = $2::bigint
      LIMIT 1
    ),
    deals AS (
      SELECT
        (${partnerMotionCaseSql("o")})::text AS motion,
        NULLIF(btrim(o.partner_name), '') AS partner_name,
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
      WHERE o.org_id = $1::bigint
        AND o.close_date IS NOT NULL
        AND o.close_date >= qp.period_start
        AND o.close_date <= qp.period_end
        ${channelDealScopeWhereMerged(3, 4)}
    )
  `;

  const motionStats = await pool
    .query<MotionStatsRow>(
      `
      ${baseDealsSql}
      SELECT
        motion,
        COUNT(*) FILTER (WHERE crm_bucket IN ('won', 'lost'))::int AS opps,
        COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::int AS won_opps,
        COALESCE(SUM(CASE WHEN crm_bucket = 'lost' THEN 1 ELSE 0 END), 0)::int AS lost_opps,
        CASE
          WHEN COUNT(*) FILTER (WHERE crm_bucket IN ('won', 'lost')) > 0
            THEN COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::float8
              / COUNT(*) FILTER (WHERE crm_bucket IN ('won', 'lost'))::float8
          ELSE NULL
        END AS win_rate,
        AVG(NULLIF(amount, 0)) FILTER (WHERE crm_bucket IN ('won', 'lost'))::float8 AS aov,
        AVG(
          CASE
            WHEN crm_bucket IN ('won', 'lost') AND create_date IS NOT NULL AND close_date IS NOT NULL
              THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0))::int
            ELSE NULL
          END
        )::float8 AS avg_days,
        AVG(
          CASE
            WHEN crm_bucket = 'won' AND create_date IS NOT NULL AND close_date IS NOT NULL
              THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0))::int
            ELSE NULL
          END
        )::float8 AS avg_won_days,
        AVG(NULLIF(health_score, 0)) FILTER (WHERE crm_bucket IN ('won', 'lost'))::float8 AS avg_health_score,
        SUM(CASE WHEN crm_bucket = 'won' THEN amount ELSE 0 END)::float8 AS won_amount,
        SUM(CASE WHEN crm_bucket = 'lost' THEN amount ELSE 0 END)::float8 AS lost_amount
      FROM deals
      WHERE crm_bucket IN ('won', 'lost')
      GROUP BY motion
      ORDER BY motion ASC
      `,
      [orgId, quotaPeriodId, territoryRepIds, partnerNames]
    )
    .then((res) => res.rows || [])
    .catch(() => []);

  const topPartners = await pool
    .query<PartnerRollupRow>(
      `
      ${baseDealsSql}
      SELECT
        partner_name,
        COUNT(*)::int AS opps,
        COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::int AS won_opps,
        COALESCE(SUM(CASE WHEN crm_bucket = 'lost' THEN 1 ELSE 0 END), 0)::int AS lost_opps,
        CASE
          WHEN COUNT(*) > 0
            THEN COALESCE(SUM(CASE WHEN crm_bucket = 'won' THEN 1 ELSE 0 END), 0)::float8 / COUNT(*)::float8
          ELSE NULL
        END AS win_rate,
        AVG(NULLIF(amount, 0))::float8 AS aov,
        AVG(
          CASE
            WHEN create_date IS NOT NULL AND close_date IS NOT NULL
              THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0))::int
            ELSE NULL
          END
        )::float8 AS avg_days,
        AVG(NULLIF(health_score, 0))::float8 AS avg_health_score,
        SUM(CASE WHEN crm_bucket = 'won' THEN amount ELSE 0 END)::float8 AS won_amount
      FROM deals
      WHERE crm_bucket IN ('won', 'lost')
        AND motion IN ('partner_influenced', 'partner_sourced')
        AND partner_name IS NOT NULL
      GROUP BY partner_name
      ORDER BY won_amount DESC NULLS LAST, opps DESC, partner_name ASC
      LIMIT 30
      `,
      [orgId, quotaPeriodId, territoryRepIds, partnerNames]
    )
    .then((res) => res.rows || [])
    .catch(() => []);

  const openByMotion = await pool
    .query<OpenPipelineMotionRow>(
      `
      ${baseDealsSql}
      SELECT
        motion,
        COUNT(*)::int AS open_opps,
        SUM(amount)::float8 AS open_amount
      FROM deals
      WHERE crm_bucket NOT IN ('won', 'lost')
      GROUP BY motion
      ORDER BY motion ASC
      `,
      [orgId, quotaPeriodId, territoryRepIds, partnerNames]
    )
    .then((res) => res.rows || [])
    .catch(() => []);

  const openByPartner = await pool
    .query<OpenPipelinePartnerRow>(
      `
      ${baseDealsSql}
      SELECT
        partner_name,
        COUNT(*)::int AS open_opps,
        SUM(amount)::float8 AS open_amount
      FROM deals
      WHERE crm_bucket NOT IN ('won', 'lost')
        AND motion IN ('partner_influenced', 'partner_sourced')
        AND partner_name IS NOT NULL
      GROUP BY partner_name
      ORDER BY open_amount DESC NULLS LAST, open_opps DESC, partner_name ASC
      LIMIT 120
      `,
      [orgId, quotaPeriodId, territoryRepIds, partnerNames]
    )
    .then((res) => res.rows || [])
    .catch(() => []);

  const curM = motionStatsByKey(motionStats);
  const direct = curM.get("direct")!;
  const partner_influenced = curM.get("partner_influenced")!;
  const partner_sourced = curM.get("partner_sourced")!;

  const openByMotionMap = new Map<string, OpenPipelineMotionRow>();
  for (const row of openByMotion || []) openByMotionMap.set(String(row.motion), row);

  const directOpen = Number(openByMotionMap.get("direct")?.open_amount || 0) || 0;
  const influencedOpen = Number(openByMotionMap.get("partner_influenced")?.open_amount || 0) || 0;
  const sourcedOpen = Number(openByMotionMap.get("partner_sourced")?.open_amount || 0) || 0;

  const openPartnerMap = new Map<string, number>();
  for (const row of openByPartner || []) {
    openPartnerMap.set(String(row.partner_name || "").trim(), Number(row.open_amount || 0) || 0);
  }

  const wonD = Number(direct.won_amount || 0) || 0;
  const wonI = Number(partner_influenced.won_amount || 0) || 0;
  const wonS = Number(partner_sourced.won_amount || 0) || 0;
  const denom = wonD + wonI + wonS;

  const ceiPrevPartnerSourcedIndex = await (async () => {
    if (!prevQuotaPeriodId) return null;
    const prev = await loadExecutiveChannelTabPartners({
      orgId,
      quotaPeriodId: prevQuotaPeriodId,
      territoryRepIds,
      partnerNames,
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
    const rvDirect = directDays && directDays > 0 ? directWon / directDays : 0;
    const rvSourced = sourcedDays && sourcedDays > 0 ? sourcedWon / sourcedDays : 0;
    const qmDirect = directWin == null ? 0 : directH == null ? directWin : directWin * directH;
    const qmSourced = sourcedWin == null ? 0 : sourcedH == null ? sourcedWin : sourcedWin * sourcedH;
    const ceiDirect = rvDirect * qmDirect;
    const ceiSourced = rvSourced * qmSourced;
    if (!(ceiDirect > 0)) return null;
    return (ceiSourced / ceiDirect) * 100;
  })();

  return {
    direct: { ...direct, open_pipeline: directOpen },
    partner_influenced: { ...partner_influenced, open_pipeline: influencedOpen },
    partner_sourced: { ...partner_sourced, open_pipeline: sourcedOpen },
    revenue_mix_motion_pct01:
      denom > 0
        ? {
            direct: wonD / denom,
            partner_influenced: wonI / denom,
            partner_sourced: wonS / denom,
          }
        : {
            direct: null,
            partner_influenced: null,
            partner_sourced: null,
          },
    cei_prev_partner_sourced_index: ceiPrevPartnerSourcedIndex,
    top_partners: (topPartners || []).map((partner) => ({
      ...partner,
      open_pipeline: Number(openPartnerMap.get(String(partner.partner_name || "").trim()) || 0) || 0,
    })),
    previous: null,
  };
}
