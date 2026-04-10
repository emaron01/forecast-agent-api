import { pool } from "./pool";

export type QuotaByRepPeriodRow = { quota_period_id: string; rep_id: string; quota_amount: number };

export type RepPeriodKpisRow = {
  quota_period_id: string;
  rep_id: string;
  rep_name: string;
  total_count: number;
  won_count: number;
  lost_count: number;
  active_count: number;
  won_amount: number;
  active_amount: number;
  commit_amount: number;
  best_amount: number;
  pipeline_amount: number;
  partner_closed_amount: number;
  closed_amount: number;
  lost_amount: number;
  partner_won_count: number;
  partner_closed_count: number;
  avg_days_won: number | null;
  avg_days_lost: number | null;
  avg_days_active: number | null;
};

export type CreatedByRepRow = {
  quota_period_id: string;
  rep_id: string;
  created_amount: number;
  created_count: number;
};

export async function getQuotaByRepPeriod(args: {
  orgId: number;
  quotaPeriodIds: string[];
  repIds: number[] | null;
}) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<QuotaByRepPeriodRow>(
    `
    SELECT
      q.quota_period_id::text AS quota_period_id,
      q.rep_id::text AS rep_id,
      COALESCE(SUM(q.quota_amount), 0)::float8 AS quota_amount
    FROM quotas q
    JOIN reps r
      ON r.id = q.rep_id
    JOIN users u
      ON u.id = r.user_id
     AND u.org_id = q.org_id
    WHERE q.org_id = $1::bigint
      AND u.hierarchy_level IN (1, 2, 3)
      AND q.rep_id IS NOT NULL
      AND q.quota_period_id = ANY($2::bigint[])
      AND (NOT $4::boolean OR q.rep_id = ANY($3::bigint[]))
    GROUP BY q.quota_period_id, q.rep_id
    ORDER BY quota_period_id DESC, rep_id ASC
    `,
    [args.orgId, args.quotaPeriodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as QuotaByRepPeriodRow[];
}

export async function getRepKpisByPeriod(args: {
  orgId: number;
  periodIds: string[];
  repIds: number[] | null;
  /** When true, only opportunities with a non-empty partner_name are included. */
  requirePartnerName?: boolean;
}) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const requirePartner = !!args.requirePartnerName;
  const { rows } = await pool.query<RepPeriodKpisRow>(
    `
    WITH periods AS (
      SELECT
        id::bigint AS quota_period_id,
        period_start::date AS period_start,
        period_end::date AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = ANY($2::bigint[])
    ),
    base AS (
      SELECT
        p.quota_period_id::text AS quota_period_id,
        o.rep_id::text AS rep_id,
        COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), NULLIF(btrim(o.rep_name), ''), '(Unknown rep)') AS rep_name,
        COALESCE(o.amount, 0)::float8 AS amount,
        o.partner_name,
        o.create_date,
        o.close_date,
        lower(
          regexp_replace(
            COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''),
            '[^a-zA-Z]+',
            ' ',
            'g'
          )
        ) AS fs,
        p.period_end::timestamptz AS period_end_ts
      FROM periods p
      JOIN opportunities o
        ON o.org_id = $1
       AND o.rep_id IS NOT NULL
       AND o.close_date IS NOT NULL
       AND o.close_date >= p.period_start
       AND o.close_date <= p.period_end
       AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
       AND (NOT $5::boolean OR (o.partner_name IS NOT NULL AND btrim(o.partner_name) <> ''))
      LEFT JOIN reps r
        ON r.organization_id = $1
       AND r.id = o.rep_id
    ),
    classified AS (
      SELECT
        *,
        ((' ' || fs || ' ') LIKE '% won %') AS is_won,
        ((' ' || fs || ' ') LIKE '% lost %') AS is_lost,
        (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) AS is_active,
        CASE
          WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) AND fs LIKE '%commit%' THEN 'commit'
          WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) AND fs LIKE '%best%' THEN 'best'
          WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) THEN 'pipeline'
          WHEN ((' ' || fs || ' ') LIKE '% won %') THEN 'won'
          WHEN ((' ' || fs || ' ') LIKE '% lost %') THEN 'lost'
          ELSE 'other'
        END AS bucket
      FROM base
    )
    SELECT
      quota_period_id,
      rep_id,
      rep_name,
      COUNT(*)::int AS total_count,
      COALESCE(SUM(CASE WHEN is_won THEN 1 ELSE 0 END), 0)::int AS won_count,
      COALESCE(SUM(CASE WHEN is_lost THEN 1 ELSE 0 END), 0)::int AS lost_count,
      COALESCE(SUM(CASE WHEN is_lost THEN amount ELSE 0 END), 0)::float8 AS lost_amount,
      COALESCE(SUM(CASE WHEN is_active THEN 1 ELSE 0 END), 0)::int AS active_count,
      COALESCE(SUM(CASE WHEN is_won THEN amount ELSE 0 END), 0)::float8 AS won_amount,
      COALESCE(SUM(CASE WHEN is_active THEN amount ELSE 0 END), 0)::float8 AS active_amount,
      COALESCE(SUM(CASE WHEN bucket = 'commit' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
      COALESCE(SUM(CASE WHEN bucket = 'best' THEN amount ELSE 0 END), 0)::float8 AS best_amount,
      COALESCE(SUM(CASE WHEN bucket = 'pipeline' THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
      COALESCE(SUM(CASE WHEN (is_won OR is_lost) AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN amount ELSE 0 END), 0)::float8 AS partner_closed_amount,
      COALESCE(SUM(CASE WHEN (is_won OR is_lost) THEN amount ELSE 0 END), 0)::float8 AS closed_amount,
      COALESCE(SUM(CASE WHEN is_won AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN 1 ELSE 0 END), 0)::int AS partner_won_count,
      COALESCE(SUM(CASE WHEN (is_won OR is_lost) AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN 1 ELSE 0 END), 0)::int AS partner_closed_count,
      AVG(
        CASE
          WHEN is_won AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0
          ELSE NULL
        END
      )::float8 AS avg_days_won,
      AVG(
        CASE
          WHEN is_lost AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0
          ELSE NULL
        END
      )::float8 AS avg_days_lost,
      AVG(
        CASE
          WHEN is_active AND create_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (LEAST(NOW(), period_end_ts) - create_date)) / 86400.0
          ELSE NULL
        END
      )::float8 AS avg_days_active
    FROM classified
    GROUP BY quota_period_id, rep_id, rep_name
    ORDER BY rep_name ASC, rep_id ASC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter, requirePartner]
  );
  return (rows || []) as RepPeriodKpisRow[];
}

export async function getCreatedByRep(args: {
  orgId: number;
  periodIds: string[];
  repIds: number[] | null;
}) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<CreatedByRepRow>(
    `
    WITH periods AS (
      SELECT
        id::bigint AS quota_period_id,
        period_start::date AS period_start,
        period_end::date AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = ANY($2::bigint[])
    )
    SELECT
      p.quota_period_id::text AS quota_period_id,
      o.rep_id::text AS rep_id,
      COALESCE(SUM(COALESCE(o.amount, 0)), 0)::float8 AS created_amount,
      COUNT(*)::int AS created_count
    FROM periods p
    JOIN opportunities o
      ON o.org_id = $1
     AND o.rep_id IS NOT NULL
     AND o.create_date IS NOT NULL
     AND o.create_date::date >= p.period_start
     AND o.create_date::date <= p.period_end
     AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
    GROUP BY p.quota_period_id, o.rep_id
    ORDER BY p.quota_period_id DESC, created_amount DESC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as CreatedByRepRow[];
}
