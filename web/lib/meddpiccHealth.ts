import { pool } from "./pool";

export type RepMeddpiccAveragesRow = {
  quota_period_id: string;
  rep_id: string;
  avg_pain: number | null;
  avg_metrics: number | null;
  avg_champion: number | null;
  avg_eb: number | null;
  avg_competition: number | null;
  avg_criteria: number | null;
  avg_process: number | null;
  avg_paper: number | null;
  avg_timing: number | null;
  avg_budget: number | null;
};

export async function getMeddpiccAveragesByRepByPeriods(args: {
  orgId: number;
  periodIds: string[];
  repIds: number[] | null;
  dateStart?: string | null;
  dateEnd?: string | null;
}) {
  if (!args.periodIds.length) return [] as RepMeddpiccAveragesRow[];
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<RepMeddpiccAveragesRow>(
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
        o.pain_score,
        o.metrics_score,
        o.champion_score,
        o.eb_score,
        o.competition_score,
        o.criteria_score,
        o.process_score,
        o.paper_score,
        o.timing_score,
        o.budget_score
      FROM periods p
      JOIN opportunities o
        ON o.org_id = $1
       AND o.rep_id IS NOT NULL
       AND o.close_date IS NOT NULL
       AND o.close_date >= p.range_start
       AND o.close_date <= p.range_end
       AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
    )
    SELECT
      quota_period_id,
      rep_id,
      AVG(NULLIF(pain_score, 0))::float8 AS avg_pain,
      AVG(NULLIF(metrics_score, 0))::float8 AS avg_metrics,
      AVG(NULLIF(champion_score, 0))::float8 AS avg_champion,
      AVG(NULLIF(eb_score, 0))::float8 AS avg_eb,
      AVG(NULLIF(competition_score, 0))::float8 AS avg_competition,
      AVG(NULLIF(criteria_score, 0))::float8 AS avg_criteria,
      AVG(NULLIF(process_score, 0))::float8 AS avg_process,
      AVG(NULLIF(paper_score, 0))::float8 AS avg_paper,
      AVG(NULLIF(timing_score, 0))::float8 AS avg_timing,
      AVG(NULLIF(budget_score, 0))::float8 AS avg_budget
    FROM base
    GROUP BY quota_period_id, rep_id
    ORDER BY quota_period_id DESC, rep_id ASC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter, args.dateStart || null, args.dateEnd || null]
  );
  return (rows || []) as any[];
}

