import "server-only";

import { pool } from "./pool";
import { getHealthAveragesByPeriods } from "./analyticsHealth";

function safeDiv(n: number, d: number) {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

function healthPctFrom30(score: any) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((n / 30) * 100)));
}

export type QuarterKpisSnapshot = {
  winRate: number | null; // 0..1
  wonCount: number;
  lostCount: number;
  aov: number | null;
  avgHealthWonPct: number | null;
  avgHealthLostPct: number | null;
  oppToWin: number | null; // 0..1
  wonAvgDays: number | null; // avg days to close (won only)
  agingAvgDays: number | null;
  directVsPartner: {
    directWonAmount: number;
    partnerWonAmount: number;
    directClosedDeals: number;
    directAov: number | null;
    directAvgAgeDays: number | null;
    partnerContributionPct: number | null; // 0..1
    partnerClosedDeals: number;
    partnerAov: number | null;
    partnerAvgAgeDays: number | null;
    partnerWinRate: number | null; // 0..1
  };
  createdPipeline: {
    commitAmount: number;
    commitCount: number;
    commitHealthPct: number | null;
    bestAmount: number;
    bestCount: number;
    bestHealthPct: number | null;
    pipelineAmount: number;
    pipelineCount: number;
    pipelineHealthPct: number | null;
    totalAmount: number;
    totalCount: number;
    totalHealthPct: number | null;
    mixCommit: number | null; // 0..1
    mixBest: number | null; // 0..1
    mixPipeline: number | null; // 0..1
  };
  createdPipelineByManager: Array<{
    managerId: string; // empty or numeric string
    managerName: string;
    reps: Array<{
      repId: string;
      repName: string;
      commitAmount: number;
      commitCount: number;
      bestAmount: number;
      bestCount: number;
      pipelineAmount: number;
      pipelineCount: number;
      wonAmount: number;
      wonCount: number;
      lostAmount: number;
      lostCount: number;
    }>;
  }>;
};

type RepPeriodKpisRow = {
  quota_period_id: string;
  rep_id: string;
  total_count: number;
  won_count: number;
  lost_count: number;
  active_count: number;
  won_amount: number;
  lost_amount: number;
  active_amount: number;
  partner_closed_amount: number;
  partner_won_amount: number;
  closed_amount: number;
  partner_won_count: number;
  partner_closed_count: number;
  partner_closed_days_sum: number;
  partner_closed_days_count: number;
  direct_closed_days_sum: number;
  direct_closed_days_count: number;
  avg_days_won: number | null;
  avg_days_active: number | null;
};

async function getRepKpisByPeriods(args: { orgId: number; periodIds: string[]; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
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
        COALESCE(o.amount, 0)::float8 AS amount,
        o.partner_name,
        o.create_date,
        o.close_date,
        lower(
          regexp_replace(
            COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
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
    ),
    classified AS (
      SELECT
        *,
        ((' ' || fs || ' ') LIKE '% won %') AS is_won,
        ((' ' || fs || ' ') LIKE '% lost %') AS is_lost,
        (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) AS is_active
      FROM base
    )
    SELECT
      quota_period_id,
      rep_id,
      COUNT(*)::int AS total_count,
      COALESCE(SUM(CASE WHEN is_won THEN 1 ELSE 0 END), 0)::int AS won_count,
      COALESCE(SUM(CASE WHEN is_lost THEN 1 ELSE 0 END), 0)::int AS lost_count,
      COALESCE(SUM(CASE WHEN is_active THEN 1 ELSE 0 END), 0)::int AS active_count,
      COALESCE(SUM(CASE WHEN is_won THEN amount ELSE 0 END), 0)::float8 AS won_amount,
      COALESCE(SUM(CASE WHEN is_lost THEN amount ELSE 0 END), 0)::float8 AS lost_amount,
      COALESCE(SUM(CASE WHEN is_active THEN amount ELSE 0 END), 0)::float8 AS active_amount,
      COALESCE(SUM(CASE WHEN (is_won OR is_lost) AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN amount ELSE 0 END), 0)::float8 AS partner_closed_amount,
      COALESCE(SUM(CASE WHEN is_won AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN amount ELSE 0 END), 0)::float8 AS partner_won_amount,
      COALESCE(SUM(CASE WHEN (is_won OR is_lost) THEN amount ELSE 0 END), 0)::float8 AS closed_amount,
      COALESCE(SUM(CASE WHEN is_won AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN 1 ELSE 0 END), 0)::int AS partner_won_count,
      COALESCE(SUM(CASE WHEN (is_won OR is_lost) AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN 1 ELSE 0 END), 0)::int AS partner_closed_count,
      COALESCE(SUM(
        CASE
          WHEN (is_won OR is_lost) AND partner_name IS NOT NULL AND btrim(partner_name) <> '' AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0
          ELSE 0
        END
      ), 0)::float8 AS partner_closed_days_sum,
      COALESCE(SUM(
        CASE
          WHEN (is_won OR is_lost) AND partner_name IS NOT NULL AND btrim(partner_name) <> '' AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN 1
          ELSE 0
        END
      ), 0)::int AS partner_closed_days_count,
      COALESCE(SUM(
        CASE
          WHEN (is_won OR is_lost) AND (partner_name IS NULL OR btrim(partner_name) = '') AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0
          ELSE 0
        END
      ), 0)::float8 AS direct_closed_days_sum,
      COALESCE(SUM(
        CASE
          WHEN (is_won OR is_lost) AND (partner_name IS NULL OR btrim(partner_name) = '') AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN 1
          ELSE 0
        END
      ), 0)::int AS direct_closed_days_count,
      AVG(
        CASE
          WHEN is_won AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0
          ELSE NULL
        END
      )::float8 AS avg_days_won,
      AVG(
        CASE
          WHEN is_active AND create_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (LEAST(NOW(), period_end_ts) - create_date)) / 86400.0
          ELSE NULL
        END
      )::float8 AS avg_days_active
    FROM classified
    GROUP BY quota_period_id, rep_id
    ORDER BY quota_period_id DESC, rep_id ASC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

type CreatedPipelineAggRow = {
  quota_period_id: string;
  commit_amount: number;
  commit_count: number;
  commit_health_score: number | null;
  best_amount: number;
  best_count: number;
  best_health_score: number | null;
  pipeline_amount: number;
  pipeline_count: number;
  pipeline_health_score: number | null;
  total_pipeline_health_score: number | null;
};

async function getCreatedPipelineAggByPeriods(args: { orgId: number; periodIds: string[]; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<CreatedPipelineAggRow>(
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
        COALESCE(o.amount, 0)::float8 AS amount,
        o.health_score,
        CASE
          WHEN o.close_date IS NULL THEN NULL
          WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
          WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
            to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'MM/DD/YYYY')
          ELSE NULL
        END AS close_d,
        p.period_start,
        p.period_end,
        lower(
          regexp_replace(
            COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
            '[^a-zA-Z]+',
            ' ',
            'g'
          )
        ) AS fs
      FROM periods p
      JOIN opportunities o
        ON o.org_id = $1
       AND o.rep_id IS NOT NULL
       AND o.create_date IS NOT NULL
       AND o.create_date::date >= p.period_start
       AND o.create_date::date <= p.period_end
       AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
    ),
    classified AS (
      SELECT
        *,
        (close_d IS NOT NULL AND close_d >= period_start AND close_d <= period_end) AS closed_in_qtr,
        CASE
          WHEN NOT (close_d IS NOT NULL AND close_d >= period_start AND close_d <= period_end) AND fs LIKE '%commit%' THEN 'commit'
          WHEN NOT (close_d IS NOT NULL AND close_d >= period_start AND close_d <= period_end) AND fs LIKE '%best%' THEN 'best'
          WHEN NOT (close_d IS NOT NULL AND close_d >= period_start AND close_d <= period_end) THEN 'pipeline'
          ELSE 'other'
        END AS bucket,
        (NOT (close_d IS NOT NULL AND close_d >= period_start AND close_d <= period_end)) AS is_active
      FROM base
    )
    SELECT
      quota_period_id,
      COALESCE(SUM(CASE WHEN is_active AND bucket = 'commit' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
      COALESCE(SUM(CASE WHEN is_active AND bucket = 'commit' THEN 1 ELSE 0 END), 0)::int AS commit_count,
      AVG(CASE WHEN is_active AND bucket = 'commit' THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS commit_health_score,
      COALESCE(SUM(CASE WHEN is_active AND bucket = 'best' THEN amount ELSE 0 END), 0)::float8 AS best_amount,
      COALESCE(SUM(CASE WHEN is_active AND bucket = 'best' THEN 1 ELSE 0 END), 0)::int AS best_count,
      AVG(CASE WHEN is_active AND bucket = 'best' THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS best_health_score,
      COALESCE(SUM(CASE WHEN is_active AND bucket = 'pipeline' THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
      COALESCE(SUM(CASE WHEN is_active AND bucket = 'pipeline' THEN 1 ELSE 0 END), 0)::int AS pipeline_count,
      AVG(CASE WHEN is_active AND bucket = 'pipeline' THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS pipeline_health_score,
      AVG(CASE WHEN is_active THEN NULLIF(health_score, 0) ELSE NULL END)::float8 AS total_pipeline_health_score
    FROM classified
    GROUP BY quota_period_id
    ORDER BY quota_period_id DESC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

type CreatedPipelineByRepRow = {
  quota_period_id: string;
  rep_id: string;
  rep_name: string;
  manager_rep_id: string | null;
  manager_name: string | null;
  commit_amount: number;
  commit_count: number;
  best_amount: number;
  best_count: number;
  pipeline_amount: number;
  pipeline_count: number;
  won_amount: number;
  won_count: number;
  lost_amount: number;
  lost_count: number;
};

async function getCreatedPipelineByRepByPeriods(args: { orgId: number; periodIds: string[]; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<CreatedPipelineByRepRow>(
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
        r.manager_rep_id::text AS manager_rep_id,
        COALESCE(NULLIF(btrim(m.display_name), ''), NULLIF(btrim(m.rep_name), ''), NULL) AS manager_name,
        COALESCE(o.amount, 0)::float8 AS amount,
        lower(
          regexp_replace(
            COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
            '[^a-zA-Z]+',
            ' ',
            'g'
          )
        ) AS fs,
        CASE
          WHEN o.close_date IS NULL THEN NULL
          WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
          WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
            to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'MM/DD/YYYY')
          ELSE NULL
        END AS close_d,
        p.period_start,
        p.period_end
      FROM periods p
      JOIN opportunities o
        ON o.org_id = $1
       AND o.rep_id IS NOT NULL
       AND o.create_date IS NOT NULL
       AND o.create_date::date >= p.period_start
       AND o.create_date::date <= p.period_end
       AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
      LEFT JOIN reps r
        ON r.organization_id = $1
       AND r.id = o.rep_id
      LEFT JOIN reps m
        ON m.organization_id = $1
       AND m.id = r.manager_rep_id
    ),
    classified AS (
      SELECT
        *,
        (close_d IS NOT NULL AND close_d >= period_start AND close_d <= period_end) AS closed_in_qtr,
        ((' ' || fs || ' ') LIKE '% won %') AS is_won_word,
        ((' ' || fs || ' ') LIKE '% lost %') AS is_lost_word
      FROM base
    )
    SELECT
      quota_period_id,
      rep_id,
      rep_name,
      manager_rep_id,
      manager_name,
      COALESCE(SUM(CASE WHEN NOT closed_in_qtr AND fs LIKE '%commit%' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
      COALESCE(SUM(CASE WHEN NOT closed_in_qtr AND fs LIKE '%commit%' THEN 1 ELSE 0 END), 0)::int AS commit_count,
      COALESCE(SUM(CASE WHEN NOT closed_in_qtr AND fs LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS best_amount,
      COALESCE(SUM(CASE WHEN NOT closed_in_qtr AND fs LIKE '%best%' THEN 1 ELSE 0 END), 0)::int AS best_count,
      COALESCE(SUM(CASE WHEN NOT closed_in_qtr AND NOT (fs LIKE '%commit%') AND NOT (fs LIKE '%best%') THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
      COALESCE(SUM(CASE WHEN NOT closed_in_qtr AND NOT (fs LIKE '%commit%') AND NOT (fs LIKE '%best%') THEN 1 ELSE 0 END), 0)::int AS pipeline_count,
      COALESCE(SUM(CASE WHEN closed_in_qtr AND is_won_word THEN amount ELSE 0 END), 0)::float8 AS won_amount,
      COALESCE(SUM(CASE WHEN closed_in_qtr AND is_won_word THEN 1 ELSE 0 END), 0)::int AS won_count,
      COALESCE(SUM(CASE WHEN closed_in_qtr AND is_lost_word THEN amount ELSE 0 END), 0)::float8 AS lost_amount,
      COALESCE(SUM(CASE WHEN closed_in_qtr AND is_lost_word THEN 1 ELSE 0 END), 0)::int AS lost_count
    FROM classified
    GROUP BY
      quota_period_id,
      rep_id,
      rep_name,
      manager_rep_id,
      manager_name
    ORDER BY quota_period_id DESC, manager_name ASC, rep_name ASC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

export async function getQuarterKpisSnapshot(args: { orgId: number; quotaPeriodId: string; repIds: number[] | null }): Promise<QuarterKpisSnapshot> {
  const periodIds = [String(args.quotaPeriodId || "").trim()].filter(Boolean);
  if (!periodIds.length) {
    return {
      winRate: null,
      wonCount: 0,
      lostCount: 0,
      aov: null,
      avgHealthWonPct: null,
      avgHealthLostPct: null,
      oppToWin: null,
      wonAvgDays: null,
      agingAvgDays: null,
      directVsPartner: {
        directWonAmount: 0,
        partnerWonAmount: 0,
        directClosedDeals: 0,
        directAov: null,
        directAvgAgeDays: null,
        partnerContributionPct: null,
        partnerClosedDeals: 0,
        partnerAov: null,
        partnerAvgAgeDays: null,
        partnerWinRate: null,
      },
      createdPipeline: {
        commitAmount: 0,
        commitCount: 0,
        commitHealthPct: null,
        bestAmount: 0,
        bestCount: 0,
        bestHealthPct: null,
        pipelineAmount: 0,
        pipelineCount: 0,
        pipelineHealthPct: null,
        totalAmount: 0,
        totalCount: 0,
        totalHealthPct: null,
        mixCommit: null,
        mixBest: null,
        mixPipeline: null,
      },
      createdPipelineByManager: [],
    };
  }

  const [repRows, createdAggRows, createdByRepRows, healthRows] = await Promise.all([
    getRepKpisByPeriods({ orgId: args.orgId, periodIds, repIds: args.repIds }),
    getCreatedPipelineAggByPeriods({ orgId: args.orgId, periodIds, repIds: args.repIds }),
    getCreatedPipelineByRepByPeriods({ orgId: args.orgId, periodIds, repIds: args.repIds }),
    getHealthAveragesByPeriods({ orgId: args.orgId, periodIds, repIds: args.repIds }).catch(() => []),
  ]);

  const wonAmountTotal = repRows.reduce((acc, r) => acc + (Number(r.won_amount || 0) || 0), 0);
  const wonCountTotal = repRows.reduce((acc, r) => acc + (Number(r.won_count || 0) || 0), 0);
  const lostCountTotal = repRows.reduce((acc, r) => acc + (Number(r.lost_count || 0) || 0), 0);
  const totalCountTotal = repRows.reduce((acc, r) => acc + (Number(r.total_count || 0) || 0), 0);

  const partnerWonAmount = repRows.reduce((acc, r) => acc + (Number(r.partner_won_amount || 0) || 0), 0);
  const partnerWonCount = repRows.reduce((acc, r) => acc + (Number(r.partner_won_count || 0) || 0), 0);
  const partnerClosedAmount = repRows.reduce((acc, r) => acc + (Number(r.partner_closed_amount || 0) || 0), 0);
  const closedAmount = repRows.reduce((acc, r) => acc + (Number(r.closed_amount || 0) || 0), 0);
  const partnerClosedCount = repRows.reduce((acc, r) => acc + (Number(r.partner_closed_count || 0) || 0), 0);

  const partnerClosedDaysSum = repRows.reduce((acc, r) => acc + (Number(r.partner_closed_days_sum || 0) || 0), 0);
  const partnerClosedDaysCnt = repRows.reduce((acc, r) => acc + (Number(r.partner_closed_days_count || 0) || 0), 0);
  const directClosedDaysSum = repRows.reduce((acc, r) => acc + (Number(r.direct_closed_days_sum || 0) || 0), 0);
  const directClosedDaysCnt = repRows.reduce((acc, r) => acc + (Number(r.direct_closed_days_count || 0) || 0), 0);

  // Aging (avg days): weighted avg of rep active-age by active deal count.
  let agingDaysSum = 0;
  let agingCnt = 0;
  for (const r of repRows) {
    const avg = r.avg_days_active;
    const c = Number(r.active_count || 0) || 0;
    if (avg != null && Number.isFinite(avg) && c > 0) {
      agingDaysSum += avg * c;
      agingCnt += c;
    }
  }
  const agingAvgDays = agingCnt ? agingDaysSum / agingCnt : null;

  // Avg days (Closed Won): weighted avg of rep won-cycle by won deal count.
  let wonDaysSum = 0;
  let wonCnt = 0;
  for (const r of repRows) {
    const avg = r.avg_days_won;
    const c = Number(r.won_count || 0) || 0;
    if (avg != null && Number.isFinite(avg) && c > 0) {
      wonDaysSum += avg * c;
      wonCnt += c;
    }
  }
  const wonAvgDays = wonCnt ? wonDaysSum / wonCnt : null;

  const winRate = safeDiv(wonCountTotal, wonCountTotal + lostCountTotal);
  const oppToWin = safeDiv(wonCountTotal, totalCountTotal);
  const aov = safeDiv(wonAmountTotal, wonCountTotal);

  const health = (healthRows || []).find((r: any) => String(r.quota_period_id) === String(periodIds[0])) || null;
  const avgHealthWonPct = healthPctFrom30((health as any)?.avg_health_won);
  const avgHealthLostPct = healthPctFrom30((health as any)?.avg_health_lost);

  const directWonAmount = wonAmountTotal - partnerWonAmount;
  const directWonCount = wonCountTotal - partnerWonCount;

  const directAov = safeDiv(directWonAmount, directWonCount);
  const partnerAov = safeDiv(partnerWonAmount, partnerWonCount);

  const directAvgAgeDays = safeDiv(directClosedDaysSum, directClosedDaysCnt);
  const partnerAvgAgeDays = safeDiv(partnerClosedDaysSum, partnerClosedDaysCnt);
  const partnerContributionPct = safeDiv(partnerClosedAmount, closedAmount);
  const partnerWinRate = safeDiv(partnerWonCount, partnerClosedCount);

  const createdAgg =
    (createdAggRows || []).find((r: any) => String(r.quota_period_id) === String(periodIds[0])) ||
    ({
      quota_period_id: periodIds[0],
      commit_amount: 0,
      commit_count: 0,
      commit_health_score: null,
      best_amount: 0,
      best_count: 0,
      best_health_score: null,
      pipeline_amount: 0,
      pipeline_count: 0,
      pipeline_health_score: null,
      total_pipeline_health_score: null,
    } as CreatedPipelineAggRow);

  const cAmt = Number((createdAgg as any).commit_amount || 0) || 0;
  const bAmt = Number((createdAgg as any).best_amount || 0) || 0;
  const pAmt = Number((createdAgg as any).pipeline_amount || 0) || 0;
  const tAmt = cAmt + bAmt + pAmt;

  const cCnt = Number((createdAgg as any).commit_count || 0) || 0;
  const bCnt = Number((createdAgg as any).best_count || 0) || 0;
  const pCnt = Number((createdAgg as any).pipeline_count || 0) || 0;
  const tCnt = cCnt + bCnt + pCnt;

  const createdPipelineByManagerMap = new Map<string, { managerName: string; reps: QuarterKpisSnapshot["createdPipelineByManager"][number]["reps"] }>();
  for (const r of createdByRepRows || []) {
    const mid = String((r as any).manager_rep_id || "");
    const mname = String((r as any).manager_name || "").trim() || (mid ? `Manager ${mid}` : "(Unassigned)");
    const key = mid || "(unassigned)";
    const cur = createdPipelineByManagerMap.get(key) || { managerName: mname, reps: [] as any[] };
    cur.managerName = mname;
    cur.reps.push({
      repId: String((r as any).rep_id || ""),
      repName: String((r as any).rep_name || "").trim() || "(Unknown rep)",
      commitAmount: Number((r as any).commit_amount || 0) || 0,
      commitCount: Number((r as any).commit_count || 0) || 0,
      bestAmount: Number((r as any).best_amount || 0) || 0,
      bestCount: Number((r as any).best_count || 0) || 0,
      pipelineAmount: Number((r as any).pipeline_amount || 0) || 0,
      pipelineCount: Number((r as any).pipeline_count || 0) || 0,
      wonAmount: Number((r as any).won_amount || 0) || 0,
      wonCount: Number((r as any).won_count || 0) || 0,
      lostAmount: Number((r as any).lost_amount || 0) || 0,
      lostCount: Number((r as any).lost_count || 0) || 0,
    });
    createdPipelineByManagerMap.set(key, cur);
  }

  const createdPipelineByManager = Array.from(createdPipelineByManagerMap.entries())
    .map(([managerId, v]) => ({
      managerId,
      managerName: v.managerName,
      reps: v.reps.slice().sort((a, b) => a.repName.localeCompare(b.repName)),
    }))
    .sort((a, b) => a.managerName.localeCompare(b.managerName));

  return {
    winRate,
    wonCount: wonCountTotal,
    lostCount: lostCountTotal,
    aov,
    avgHealthWonPct,
    avgHealthLostPct,
    oppToWin,
    wonAvgDays,
    agingAvgDays,
    directVsPartner: {
      directWonAmount,
      partnerWonAmount,
      directClosedDeals: directClosedDaysCnt,
      directAov,
      directAvgAgeDays,
      partnerContributionPct,
      partnerClosedDeals: partnerClosedCount,
      partnerAov,
      partnerAvgAgeDays,
      partnerWinRate,
    },
    createdPipeline: {
      commitAmount: cAmt,
      commitCount: cCnt,
      commitHealthPct: healthPctFrom30((createdAgg as any).commit_health_score),
      bestAmount: bAmt,
      bestCount: bCnt,
      bestHealthPct: healthPctFrom30((createdAgg as any).best_health_score),
      pipelineAmount: pAmt,
      pipelineCount: pCnt,
      pipelineHealthPct: healthPctFrom30((createdAgg as any).pipeline_health_score),
      totalAmount: tAmt,
      totalCount: tCnt,
      totalHealthPct: healthPctFrom30((createdAgg as any).total_pipeline_health_score),
      mixCommit: safeDiv(cAmt, tAmt),
      mixBest: safeDiv(bAmt, tAmt),
      mixPipeline: safeDiv(pAmt, tAmt),
    },
    createdPipelineByManager,
  };
}

