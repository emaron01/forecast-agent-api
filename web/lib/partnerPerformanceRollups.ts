import { pool } from "./pool";
import { crmBucketCaseSql } from "./crmBucketCaseSql";

export type PartnerPerformanceRow = {
  partner_name: string;
  won: number;
  closed: number;
  avg_health: number | null;
  revenue: number;
};

/** Combined stage tokens; aligned with channel lost / won filters in channel dashboard and forecast deals. */
const FS_INNER = `lower(regexp_replace(
  COALESCE(NULLIF(btrim(o.forecast_stage),''),'') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage),''),''),
  '[^a-zA-Z]+', ' ', 'g'
))`;

const WON_COND = `(' ' || ${FS_INNER} || ' ') LIKE '% won %'`;

const CLOSED_COND = `(
  ${WON_COND}
  OR (
    NOT (${WON_COND})
    AND (
      (' ' || ${FS_INNER} || ' ') LIKE '% lost %'
      OR (' ' || ${FS_INNER} || ' ') LIKE '% closed %'
    )
  )
)`;

/**
 * Partner win rate / health / revenue for one sales rep (opportunities.rep_id).
 */
export async function loadRepScopedPartnerPerformance(args: {
  orgId: number;
  repId: number | null;
}): Promise<PartnerPerformanceRow[]> {
  if (args.repId == null || !Number.isFinite(args.repId) || args.repId <= 0) return [];
  const { rows } = await pool.query<PartnerPerformanceRow>(
    `
    WITH base AS (
      SELECT
        NULLIF(btrim(o.partner_name), '') AS partner_name,
        COALESCE(o.amount, 0)::float8 AS amount,
        o.health_score,
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
      WHERE o.org_id = $1::bigint
        AND o.rep_id = $2::bigint
        AND o.partner_name IS NOT NULL
        AND btrim(o.partner_name) <> ''
    )
    SELECT
      partner_name,
      COUNT(*) FILTER (WHERE crm_bucket = 'won')::int AS won,
      COUNT(*) FILTER (WHERE crm_bucket IN ('won', 'lost'))::int AS closed,
      AVG(NULLIF(health_score, 0))::float8 AS avg_health,
      COALESCE(SUM(amount) FILTER (WHERE crm_bucket = 'won'), 0)::float8 AS revenue
    FROM base
    WHERE partner_name IS NOT NULL
    GROUP BY partner_name
    ORDER BY
      (COUNT(*) FILTER (WHERE crm_bucket = 'won')::float
        / NULLIF(COUNT(*) FILTER (WHERE crm_bucket IN ('won', 'lost')), 0)) DESC NULLS LAST,
      partner_name ASC
    `,
    [args.orgId, args.repId]
  );
  return (rows || []).map((r) => ({
    partner_name: String(r.partner_name || "").trim(),
    won: Number(r.won) || 0,
    closed: Number(r.closed) || 0,
    avg_health: r.avg_health != null && Number.isFinite(Number(r.avg_health)) ? Number(r.avg_health) : null,
    revenue: Number(r.revenue) || 0,
  }));
}

/**
 * Same metrics as rep scope, but visibility matches /api/forecast/deals for channel roles:
 * partner_name required; partner assignments vs territory rep ids are mutually exclusive (same predicate as route).
 */
export async function loadChannelDealsScopedPartnerPerformance(args: {
  orgId: number;
  territoryRepIds: number[];
  partnerNames: string[];
}): Promise<PartnerPerformanceRow[]> {
  const territoryRepIds = (args.territoryRepIds || []).filter((id) => Number.isFinite(id) && id > 0);
  const partnerNames = args.partnerNames || [];
  const useScope = partnerNames.length > 0 || territoryRepIds.length > 0;
  if (!useScope) return [];

  const { rows } = await pool.query<PartnerPerformanceRow>(
    `
    WITH base AS (
      SELECT
        NULLIF(btrim(o.partner_name), '') AS partner_name,
        COALESCE(o.amount, 0)::float8 AS amount,
        o.health_score,
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
      WHERE o.org_id = $1::bigint
        AND o.partner_name IS NOT NULL
        AND btrim(o.partner_name) <> ''
        AND (
          (COALESCE(array_length($3::text[], 1), 0) > 0 AND lower(btrim(COALESCE(o.partner_name, ''))) = ANY($3::text[]))
          OR (
            COALESCE(array_length($3::text[], 1), 0) = 0
            AND COALESCE(array_length($2::bigint[], 1), 0) > 0
            AND o.rep_id IS NOT NULL
            AND o.rep_id = ANY($2::bigint[])
          )
        )
    )
    SELECT
      partner_name,
      COUNT(*) FILTER (WHERE crm_bucket = 'won')::int AS won,
      COUNT(*) FILTER (WHERE crm_bucket IN ('won', 'lost'))::int AS closed,
      AVG(NULLIF(health_score, 0))::float8 AS avg_health,
      COALESCE(SUM(amount) FILTER (WHERE crm_bucket = 'won'), 0)::float8 AS revenue
    FROM base
    WHERE partner_name IS NOT NULL
    GROUP BY partner_name
    ORDER BY
      (COUNT(*) FILTER (WHERE crm_bucket = 'won')::float
        / NULLIF(COUNT(*) FILTER (WHERE crm_bucket IN ('won', 'lost')), 0)) DESC NULLS LAST,
      partner_name ASC
    `,
    [args.orgId, territoryRepIds, partnerNames]
  );
  return (rows || []).map((r) => ({
    partner_name: String(r.partner_name || "").trim(),
    won: Number(r.won) || 0,
    closed: Number(r.closed) || 0,
    avg_health: r.avg_health != null && Number.isFinite(Number(r.avg_health)) ? Number(r.avg_health) : null,
    revenue: Number(r.revenue) || 0,
  }));
}
