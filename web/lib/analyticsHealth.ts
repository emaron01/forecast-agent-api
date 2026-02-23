import { pool } from "./pool";

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
}) {
  if (!args.periodIds.length) return [] as HealthAveragesRow[];
  const useRepFilter = !!(args.repIds && args.repIds.length);
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
        lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs
      FROM periods p
      JOIN opportunities o
        ON o.org_id = $1
       AND o.close_date IS NOT NULL
       AND o.close_date >= p.range_start
       AND o.close_date <= p.range_end
       AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
    ),
    classified AS (
      SELECT
        *,
        ((' ' || fs || ' ') LIKE '% won %') AS is_won,
        (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %')) AS is_lost,
        (((' ' || fs || ' ') NOT LIKE '% won %') AND ((' ' || fs || ' ') NOT LIKE '% lost %') AND ((' ' || fs || ' ') NOT LIKE '% loss %')) AS is_active,
        CASE
          WHEN (((' ' || fs || ' ') NOT LIKE '% won %') AND ((' ' || fs || ' ') NOT LIKE '% lost %') AND ((' ' || fs || ' ') NOT LIKE '% loss %') AND fs LIKE '%commit%') THEN 'commit'
          WHEN (((' ' || fs || ' ') NOT LIKE '% won %') AND ((' ' || fs || ' ') NOT LIKE '% lost %') AND ((' ' || fs || ' ') NOT LIKE '% loss %') AND fs LIKE '%best%') THEN 'best'
          WHEN (((' ' || fs || ' ') NOT LIKE '% won %') AND ((' ' || fs || ' ') NOT LIKE '% lost %') AND ((' ' || fs || ' ') NOT LIKE '% loss %')) THEN 'pipeline'
          WHEN ((' ' || fs || ' ') LIKE '% won %') THEN 'won'
          WHEN (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %')) THEN 'lost'
          ELSE 'other'
        END AS bucket
      FROM base
    )
    SELECT
      quota_period_id,
      AVG(CASE WHEN health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_all,
      AVG(CASE WHEN bucket = 'commit' AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_commit,
      AVG(CASE WHEN bucket = 'best' AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_best,
      AVG(CASE WHEN bucket = 'pipeline' AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_pipeline,
      AVG(CASE WHEN is_won AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_won,
      AVG(CASE WHEN is_lost AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_lost,
      AVG(CASE WHEN (is_won OR is_lost) AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_closed
    FROM classified
    GROUP BY quota_period_id
    ORDER BY quota_period_id DESC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter, args.dateStart || null, args.dateEnd || null]
  );
  return (rows || []) as any[];
}

export async function getHealthAveragesByRepByPeriods(args: {
  orgId: number;
  periodIds: string[];
  repIds: number[] | null;
  dateStart?: string | null;
  dateEnd?: string | null;
}) {
  if (!args.periodIds.length) return [] as RepHealthAveragesRow[];
  const useRepFilter = !!(args.repIds && args.repIds.length);
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
        lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs
      FROM periods p
      JOIN opportunities o
        ON o.org_id = $1
       AND o.rep_id IS NOT NULL
       AND o.close_date IS NOT NULL
       AND o.close_date >= p.range_start
       AND o.close_date <= p.range_end
       AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
    ),
    classified AS (
      SELECT
        *,
        ((' ' || fs || ' ') LIKE '% won %') AS is_won,
        (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %')) AS is_lost,
        CASE
          WHEN (((' ' || fs || ' ') NOT LIKE '% won %') AND ((' ' || fs || ' ') NOT LIKE '% lost %') AND ((' ' || fs || ' ') NOT LIKE '% loss %') AND fs LIKE '%commit%') THEN 'commit'
          WHEN (((' ' || fs || ' ') NOT LIKE '% won %') AND ((' ' || fs || ' ') NOT LIKE '% lost %') AND ((' ' || fs || ' ') NOT LIKE '% loss %') AND fs LIKE '%best%') THEN 'best'
          WHEN (((' ' || fs || ' ') NOT LIKE '% won %') AND ((' ' || fs || ' ') NOT LIKE '% lost %') AND ((' ' || fs || ' ') NOT LIKE '% loss %')) THEN 'pipeline'
          WHEN ((' ' || fs || ' ') LIKE '% won %') THEN 'won'
          WHEN (((' ' || fs || ' ') LIKE '% lost %') OR ((' ' || fs || ' ') LIKE '% loss %')) THEN 'lost'
          ELSE 'other'
        END AS bucket
      FROM base
    )
    SELECT
      quota_period_id,
      rep_id,
      AVG(CASE WHEN health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_all,
      AVG(CASE WHEN bucket = 'commit' AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_commit,
      AVG(CASE WHEN bucket = 'best' AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_best,
      AVG(CASE WHEN bucket = 'pipeline' AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_pipeline,
      AVG(CASE WHEN is_won AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_won,
      AVG(CASE WHEN is_lost AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_lost,
      AVG(CASE WHEN (is_won OR is_lost) AND health_score > 0 THEN health_score ELSE NULL END)::float8 AS avg_health_closed
    FROM classified
    GROUP BY quota_period_id, rep_id
    ORDER BY quota_period_id DESC, rep_id ASC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter, args.dateStart || null, args.dateEnd || null]
  );
  return (rows || []) as any[];
}

