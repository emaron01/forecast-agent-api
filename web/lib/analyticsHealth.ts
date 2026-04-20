import { channelDealScopeIsEmpty, channelDealScopeWhereStrict } from "./channelDealScope";
import { pool } from "./pool";
import { crmBucketCaseSql } from "./crmBucketCaseSql";

export type HealthAveragesRow = {
  quota_period_id: string;
  avg_health_all: number | null; // 0-30 scale
  avg_health_commit: number | null;
  avg_health_best: number | null;
  avg_health_pipeline: number | null;
  avg_health_won: number | null;
  avg_health_lost: number | null;
  avg_health_closed: number | null; // won or lost
};

export type RepHealthAveragesRow = HealthAveragesRow & {
  rep_id: string;
};

export async function getHealthAveragesByPeriods(args: {
  orgId: number;
  periodIds: string[];
  repIds: number[] | null;
  dateStart?: string | null;
  dateEnd?: string | null;
  /** When true, only opportunities with a non-empty partner_name are included. */
  requirePartnerName?: boolean;
}) {
  if (!args.periodIds.length) return [] as HealthAveragesRow[];
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const requirePartner = !!args.requirePartnerName;
  const { rows } = await pool.query<HealthAveragesRow>(
    `
    WITH periods AS (
      SELECT
        id::bigint AS quota_period_id,
        period_start::date AS period_start,
        period_end::date AS period_end,
        GREATEST(period_start::date, COALESCE($5::date, period_start::date)) AS range_start,
        LEAST(period_end::date, COALESCE($6::date, period_end::date)) AS range_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = ANY($2::bigint[])
    ),
    base AS (
      SELECT
        p.quota_period_id::text AS quota_period_id,
        COALESCE(o.health_score, 0)::float8 AS health_score,
        o.forecast_stage,
        o.sales_stage
      FROM periods p
      JOIN opportunities o
        ON o.org_id = $1
       AND o.close_date IS NOT NULL
       AND o.close_date >= p.range_start
       AND o.close_date <= p.range_end
       AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
       AND (NOT $7::boolean OR (o.partner_name IS NOT NULL AND btrim(o.partner_name) <> ''))
    ),
    bucketed AS (
      SELECT
        b.*,
        (${crmBucketCaseSql("b")}) AS crm_bucket
      FROM base b
      LEFT JOIN org_stage_mappings stm
        ON stm.org_id = $1::bigint
       AND stm.field = 'stage'
       AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(b.sales_stage::text, '')))
      LEFT JOIN org_stage_mappings fcm
        ON fcm.org_id = $1::bigint
       AND fcm.field = 'forecast_category'
       AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(b.forecast_stage::text, '')))
    ),
    classified AS (
      SELECT
        *,
        (crm_bucket = 'won') AS is_won,
        (crm_bucket = 'lost') AS is_lost,
        (crm_bucket IN ('commit', 'best_case', 'pipeline')) AS is_active
      FROM bucketed
    )
    SELECT
      quota_period_id,
      AVG(CASE WHEN health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_all,
      AVG(CASE WHEN crm_bucket = 'commit' AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_commit,
      AVG(CASE WHEN crm_bucket = 'best_case' AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_best,
      AVG(CASE WHEN crm_bucket = 'pipeline' AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_pipeline,
      AVG(CASE WHEN is_won AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_won,
      AVG(CASE WHEN is_lost AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_lost,
      AVG(CASE WHEN (is_won OR is_lost) AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_closed
    FROM classified
    GROUP BY quota_period_id
    ORDER BY quota_period_id DESC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter, args.dateStart || null, args.dateEnd || null, requirePartner]
  );
  return (rows || []) as any[];
}

export async function getHealthAveragesByRepByPeriods(args: {
  orgId: number;
  periodIds: string[];
  repIds: number[] | null;
  dateStart?: string | null;
  dateEnd?: string | null;
  /** When true, only opportunities with a non-empty partner_name are included. */
  requirePartnerName?: boolean;
}) {
  if (!args.periodIds.length) return [] as RepHealthAveragesRow[];
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const requirePartner = !!args.requirePartnerName;
  const { rows } = await pool.query<RepHealthAveragesRow>(
    `
    WITH periods AS (
      SELECT
        id::bigint AS quota_period_id,
        period_start::date AS period_start,
        period_end::date AS period_end,
        GREATEST(period_start::date, COALESCE($5::date, period_start::date)) AS range_start,
        LEAST(period_end::date, COALESCE($6::date, period_end::date)) AS range_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = ANY($2::bigint[])
    ),
    base AS (
      SELECT
        p.quota_period_id::text AS quota_period_id,
        o.rep_id::text AS rep_id,
        COALESCE(o.health_score, 0)::float8 AS health_score,
        o.forecast_stage,
        o.sales_stage
      FROM periods p
      JOIN opportunities o
        ON o.org_id = $1
       AND o.rep_id IS NOT NULL
       AND o.close_date IS NOT NULL
       AND o.close_date >= p.range_start
       AND o.close_date <= p.range_end
       AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
       AND (NOT $7::boolean OR (o.partner_name IS NOT NULL AND btrim(o.partner_name) <> ''))
    ),
    bucketed AS (
      SELECT
        b.*,
        (${crmBucketCaseSql("b")}) AS crm_bucket
      FROM base b
      LEFT JOIN org_stage_mappings stm
        ON stm.org_id = $1::bigint
       AND stm.field = 'stage'
       AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(b.sales_stage::text, '')))
      LEFT JOIN org_stage_mappings fcm
        ON fcm.org_id = $1::bigint
       AND fcm.field = 'forecast_category'
       AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(b.forecast_stage::text, '')))
    ),
    classified AS (
      SELECT
        *,
        (crm_bucket = 'won') AS is_won,
        (crm_bucket = 'lost') AS is_lost
      FROM bucketed
    )
    SELECT
      quota_period_id,
      rep_id,
      AVG(CASE WHEN health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_all,
      AVG(CASE WHEN crm_bucket = 'commit' AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_commit,
      AVG(CASE WHEN crm_bucket = 'best_case' AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_best,
      AVG(CASE WHEN crm_bucket = 'pipeline' AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_pipeline,
      AVG(CASE WHEN is_won AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_won,
      AVG(CASE WHEN is_lost AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_lost,
      AVG(CASE WHEN (is_won OR is_lost) AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_closed
    FROM classified
    GROUP BY quota_period_id, rep_id
    ORDER BY quota_period_id DESC, rep_id ASC
    `,
    [
      args.orgId,
      args.periodIds,
      args.repIds || [],
      useRepFilter,
      args.dateStart || null,
      args.dateEnd || null,
      requirePartner,
    ]
  );
  return (rows || []) as any[];
}

/** Single aggregate health row for one channel deal scope (matches /api/forecast/deals). */
export async function getHealthAggregatedByChannelDealScope(args: {
  orgId: number;
  periodIds: string[];
  territoryRepIds: number[];
  partnerNames: string[];
  dateStart?: string | null;
  dateEnd?: string | null;
}): Promise<HealthAveragesRow | null> {
  if (!args.periodIds.length) return null;
  const tr = args.territoryRepIds.filter((id) => Number.isFinite(id) && id > 0);
  const pn = args.partnerNames.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  if (channelDealScopeIsEmpty(tr, pn)) return null;

  const scopeSql = channelDealScopeWhereStrict(3, 4);
  const { rows } = await pool.query<HealthAveragesRow>(
    `
    WITH periods AS (
      SELECT
        id::bigint AS quota_period_id,
        period_start::date AS period_start,
        period_end::date AS period_end,
        GREATEST(period_start::date, COALESCE($5::date, period_start::date)) AS range_start,
        LEAST(period_end::date, COALESCE($6::date, period_end::date)) AS range_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = ANY($2::bigint[])
    ),
    base AS (
      SELECT
        p.quota_period_id::text AS quota_period_id,
        COALESCE(o.health_score, 0)::float8 AS health_score,
        o.forecast_stage,
        o.sales_stage
      FROM periods p
      JOIN opportunities o
        ON o.org_id = $1
       AND o.rep_id IS NOT NULL
       AND o.close_date IS NOT NULL
       AND o.close_date >= p.range_start
       AND o.close_date <= p.range_end
       ${scopeSql}
    ),
    bucketed AS (
      SELECT
        b.*,
        (${crmBucketCaseSql("b")}) AS crm_bucket
      FROM base b
      LEFT JOIN org_stage_mappings stm
        ON stm.org_id = $1::bigint
       AND stm.field = 'stage'
       AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(b.sales_stage::text, '')))
      LEFT JOIN org_stage_mappings fcm
        ON fcm.org_id = $1::bigint
       AND fcm.field = 'forecast_category'
       AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(b.forecast_stage::text, '')))
    ),
    classified AS (
      SELECT
        *,
        (crm_bucket = 'won') AS is_won,
        (crm_bucket = 'lost') AS is_lost
      FROM bucketed
    )
    SELECT
      quota_period_id,
      AVG(CASE WHEN health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_all,
      AVG(CASE WHEN crm_bucket = 'commit' AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_commit,
      AVG(CASE WHEN crm_bucket = 'best_case' AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_best,
      AVG(CASE WHEN crm_bucket = 'pipeline' AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_pipeline,
      AVG(CASE WHEN is_won AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_won,
      AVG(CASE WHEN is_lost AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_lost,
      AVG(CASE WHEN (is_won OR is_lost) AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_closed
    FROM classified
    GROUP BY quota_period_id
    ORDER BY quota_period_id DESC
    LIMIT 1
    `,
    [args.orgId, args.periodIds, tr, pn, args.dateStart || null, args.dateEnd || null]
  );
  return (rows?.[0] as HealthAveragesRow) || null;
}

