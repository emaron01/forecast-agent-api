import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment } from "react";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { pool } from "../../../lib/pool";
import { UserTopNav } from "../../_components/UserTopNav";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function safeDiv(n: number, d: number) {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

type QuotaPeriodLite = {
  id: string;
  period_name: string;
  period_start: string;
  period_end: string;
  fiscal_year: string;
  fiscal_quarter: string; // text
};

type RepLite = {
  id: number;
  rep_name: string | null;
  display_name: string | null;
  manager_rep_id: number | null;
  active: boolean | null;
};

type RepPeriodKpisRow = {
  quota_period_id: string;
  period_start: string;
  period_end: string;
  rep_id: string;
  rep_name: string;
  manager_rep_id: string | null;
  manager_name: string | null;
  total_count: number;
  won_count: number;
  lost_count: number;
  active_count: number;
  won_amount: number;
  lost_amount: number;
  active_amount: number;
  commit_amount: number;
  best_amount: number;
  pipeline_amount: number;
  partner_closed_amount: number;
  closed_amount: number;
  partner_won_count: number;
  partner_closed_count: number;
  avg_days_won: number | null;
  avg_days_lost: number | null;
  avg_days_active: number | null;
};

type CreatedByRepRow = { quota_period_id: string; rep_id: string; created_amount: number; created_count: number };
type QuotaByRepRow = { quota_period_id: string; rep_id: string; quota_amount: number };

async function listQuotaPeriodsForOrg(orgId: number): Promise<QuotaPeriodLite[]> {
  const { rows } = await pool.query<QuotaPeriodLite>(
    `
    SELECT
      id::text AS id,
      period_name,
      period_start::text AS period_start,
      period_end::text AS period_end,
      fiscal_year,
      fiscal_quarter::text AS fiscal_quarter
    FROM quota_periods
    WHERE org_id = $1::bigint
    ORDER BY period_start DESC, id DESC
    `,
    [orgId]
  );
  return (rows || []) as any[];
}

async function listRepsForOrg(orgId: number): Promise<RepLite[]> {
  const { rows } = await pool.query<RepLite>(
    `
    SELECT
      id,
      rep_name,
      display_name,
      manager_rep_id,
      active
    FROM reps
    WHERE organization_id = $1
    ORDER BY COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(rep_name), ''), id::text) ASC, id ASC
    `,
    [orgId]
  );
  return (rows || []) as any[];
}

async function managerRepIdForUser(args: { orgId: number; userId: number }) {
  const { rows } = await pool.query<{ id: number }>(
    `
    SELECT r.id
      FROM reps r
     WHERE r.organization_id = $1
       AND r.user_id = $2
     LIMIT 1
    `,
    [args.orgId, args.userId]
  );
  const id = rows?.[0]?.id;
  return Number.isFinite(id) ? Number(id) : null;
}

async function listDirectRepIds(args: { orgId: number; managerRepId: number }): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(
    `
    SELECT r.id
      FROM reps r
     WHERE r.organization_id = $1
       AND r.manager_rep_id = $2
       AND r.active IS TRUE
     ORDER BY r.id ASC
    `,
    [args.orgId, args.managerRepId]
  );
  return (rows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
}

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
        p.period_start::text AS period_start,
        p.period_end::text AS period_end,
        o.rep_id::text AS rep_id,
        COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), NULLIF(btrim(o.rep_name), ''), '(Unknown rep)') AS rep_name,
        r.manager_rep_id::text AS manager_rep_id,
        COALESCE(NULLIF(btrim(m.display_name), ''), NULLIF(btrim(m.rep_name), ''), NULL) AS manager_name,
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
      period_start,
      period_end,
      rep_id,
      rep_name,
      manager_rep_id,
      manager_name,
      COUNT(*)::int AS total_count,
      COALESCE(SUM(CASE WHEN is_won THEN 1 ELSE 0 END), 0)::int AS won_count,
      COALESCE(SUM(CASE WHEN is_lost THEN 1 ELSE 0 END), 0)::int AS lost_count,
      COALESCE(SUM(CASE WHEN is_active THEN 1 ELSE 0 END), 0)::int AS active_count,
      COALESCE(SUM(CASE WHEN is_won THEN amount ELSE 0 END), 0)::float8 AS won_amount,
      COALESCE(SUM(CASE WHEN is_lost THEN amount ELSE 0 END), 0)::float8 AS lost_amount,
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
    GROUP BY
      quota_period_id,
      period_start,
      period_end,
      rep_id,
      rep_name,
      manager_rep_id,
      manager_name
    ORDER BY period_start DESC, won_amount DESC, rep_name ASC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

async function getCreatedByRep(args: { orgId: number; periodIds: string[]; repIds: number[] | null }) {
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
  return (rows || []) as any[];
}

async function getQuotaByRep(args: { orgId: number; periodIds: string[]; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<QuotaByRepRow>(
    `
    SELECT
      quota_period_id::text AS quota_period_id,
      rep_id::text AS rep_id,
      COALESCE(SUM(quota_amount), 0)::float8 AS quota_amount
    FROM quotas
    WHERE org_id = $1::bigint
      AND role_level = 3
      AND rep_id IS NOT NULL
      AND quota_period_id = ANY($2::bigint[])
      AND (NOT $4::boolean OR rep_id = ANY($3::bigint[]))
    GROUP BY quota_period_id, rep_id
    ORDER BY quota_period_id DESC, quota_amount DESC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

function dateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function QuarterlyKpisPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "REP") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const yearParam = String(sp(searchParams.fiscal_year) || "").trim();

  const allPeriods = await listQuotaPeriodsForOrg(ctx.user.org_id).catch(() => []);
  const fiscalYears = Array.from(new Set(allPeriods.map((p) => String(p.fiscal_year || "").trim()).filter(Boolean))).sort((a, b) =>
    b.localeCompare(a)
  );

  const today = new Date();
  const todayIso = dateOnly(today);
  const periodContainingToday =
    allPeriods.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;

  const defaultYear = periodContainingToday ? String(periodContainingToday.fiscal_year) : fiscalYears[0] || "";
  const yearToUse = yearParam || defaultYear;

  const periodsForYear = yearToUse ? allPeriods.filter((p) => String(p.fiscal_year) === yearToUse) : allPeriods;
  const currentForYear =
    periodsForYear.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;

  const periodsSortedDesc = periodsForYear
    .slice()
    .sort((a, b) => new Date(b.period_start).getTime() - new Date(a.period_start).getTime());

  const visiblePeriods =
    currentForYear != null
      ? periodsSortedDesc.filter((p) => new Date(p.period_start).getTime() <= new Date(currentForYear.period_start).getTime())
      : periodsSortedDesc;

  // Scope: Exec/Admin see org; Manager sees direct reports (via reps.manager_rep_id); other non-rep roles treated as org.
  let scopeRepIds: number[] | null = null;
  if (ctx.user.role === "MANAGER") {
    const mgrRepId = await managerRepIdForUser({ orgId: ctx.user.org_id, userId: ctx.user.id });
    scopeRepIds = mgrRepId ? await listDirectRepIds({ orgId: ctx.user.org_id, managerRepId: mgrRepId }).catch(() => []) : [];
  } else {
    scopeRepIds = null;
  }

  const periodIds = visiblePeriods.map((p) => String(p.id)).filter(Boolean);

  const [repKpisRows, createdRows, quotaRows, reps] = periodIds.length
    ? await Promise.all([
        getRepKpisByPeriods({ orgId: ctx.user.org_id, periodIds, repIds: scopeRepIds }),
        getCreatedByRep({ orgId: ctx.user.org_id, periodIds, repIds: scopeRepIds }),
        getQuotaByRep({ orgId: ctx.user.org_id, periodIds, repIds: scopeRepIds }),
        listRepsForOrg(ctx.user.org_id).catch(() => []),
      ])
    : [[], [], [], []];

  const repIdToManagerId = new Map<string, string>();
  const repIdToManagerName = new Map<string, string>();
  const repIdToRepName = new Map<string, string>();
  for (const r of reps) {
    const id = Number(r.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const repName = String(r.display_name || "").trim() || String(r.rep_name || "").trim() || `Rep ${id}`;
    repIdToRepName.set(String(id), repName);
    const mid = r.manager_rep_id == null ? "" : String(r.manager_rep_id);
    repIdToManagerId.set(String(id), mid);
  }

  // Index maps
  const createdByKey = new Map<string, { amount: number; count: number }>();
  for (const r of createdRows) {
    const k = `${String(r.quota_period_id)}|${String(r.rep_id)}`;
    createdByKey.set(k, { amount: Number(r.created_amount || 0) || 0, count: Number(r.created_count || 0) || 0 });
  }
  const quotaByKey = new Map<string, number>();
  for (const r of quotaRows) {
    const k = `${String(r.quota_period_id)}|${String(r.rep_id)}`;
    quotaByKey.set(k, Number(r.quota_amount || 0) || 0);
  }

  // Structure: period -> manager -> reps
  type RepRow = {
    rep_id: string;
    rep_name: string;
    quota: number;
    total_count: number;
    won_amount: number;
    won_count: number;
    lost_count: number;
    active_count: number;
    commit_amount: number;
    best_amount: number;
    pipeline_amount: number;
    active_amount: number;
    win_rate: number | null;
    opp_to_win: number | null;
    attainment: number | null;
    commit_coverage: number | null;
    best_coverage: number | null;
    aov: number | null;
    partner_contribution: number | null;
    partner_win_rate: number | null;
    avg_days_won: number | null;
    avg_days_lost: number | null;
    avg_days_active: number | null;
    created_amount: number;
    created_count: number;
    mix_pipeline: number | null;
    mix_best: number | null;
    mix_commit: number | null;
    mix_won: number | null;
  };
  type ManagerRow = {
    manager_id: string;
    manager_name: string;
    quota: number;
    total_count: number;
    won_amount: number;
    won_count: number;
    lost_count: number;
    pipeline_amount: number;
    active_amount: number;
    commit_amount: number;
    best_amount: number;
    created_amount: number;
    created_count: number;
    partner_closed_amount: number;
    closed_amount: number;
    partner_won_count: number;
    partner_closed_count: number;
    attainment: number | null;
    win_rate: number | null;
    opp_to_win: number | null;
    commit_coverage: number | null;
    best_coverage: number | null;
    aov: number | null;
    partner_contribution: number | null;
    partner_win_rate: number | null;
    mix_pipeline: number | null;
    mix_best: number | null;
    mix_commit: number | null;
    mix_won: number | null;
    avg_days_won: number | null;
    avg_days_lost: number | null;
    avg_days_active: number | null;
    reps: RepRow[];
  };
  type PeriodBlock = {
    period: QuotaPeriodLite;
    is_current: boolean;
    quota_total: number;
    won_amount: number;
    pipeline_value: number;
    win_rate: number | null;
    attainment: number | null;
    aov: number | null;
    created_amount: number;
    managers: ManagerRow[];
  };

  const periodBlocks = new Map<string, PeriodBlock>();

  // Initialize period blocks
  for (const p of visiblePeriods) {
    periodBlocks.set(String(p.id), {
      period: p,
      is_current: !!currentForYear && String(p.id) === String(currentForYear.id),
      quota_total: 0,
      won_amount: 0,
      pipeline_value: 0,
      win_rate: null,
      attainment: null,
      aov: null,
      created_amount: 0,
      managers: [],
    });
  }

  // Aggregation maps
  const mgrAgg = new Map<string, ManagerRow>(); // key: period|manager
  const mgrToReps = new Map<string, RepRow[]>(); // key: period|manager
  const mgrMetaName = new Map<string, string>(); // manager_id->name

  for (const rr of repKpisRows) {
    const pid = String(rr.quota_period_id);
    const rep_id = String(rr.rep_id || "");
    if (!pid || !rep_id) continue;

    const manager_id = rr.manager_rep_id ? String(rr.manager_rep_id) : repIdToManagerId.get(rep_id) || "";
    const manager_name =
      String(rr.manager_name || "").trim() ||
      (manager_id ? repIdToRepName.get(manager_id) || `Manager ${manager_id}` : "(Unassigned)");
    if (manager_id) mgrMetaName.set(manager_id, manager_name);

    const k = `${pid}|${rep_id}`;
    const created = createdByKey.get(k) || { amount: 0, count: 0 };
    const quota = quotaByKey.get(k) || 0;

    const total_count = Number(rr.total_count || 0) || 0;
    const won_amount = Number(rr.won_amount || 0) || 0;
    const won_count = Number(rr.won_count || 0) || 0;
    const lost_count = Number(rr.lost_count || 0) || 0;
    const active_count = Number(rr.active_count || 0) || 0;
    const active_amount = Number(rr.active_amount || 0) || 0;
    const pipeline_amount = Number(rr.pipeline_amount || 0) || 0;
    const commit_amount = Number(rr.commit_amount || 0) || 0;
    const best_amount = Number(rr.best_amount || 0) || 0;
    const partner_closed_amount = Number(rr.partner_closed_amount || 0) || 0;
    const closed_amount = Number(rr.closed_amount || 0) || 0;
    const partner_won_count = Number((rr as any).partner_won_count || 0) || 0;
    const partner_closed_count = Number((rr as any).partner_closed_count || 0) || 0;

    const rep_name = String(rr.rep_name || "").trim() || repIdToRepName.get(rep_id) || `Rep ${rep_id}`;
    const win_rate = safeDiv(won_count, won_count + lost_count);
    const opp_to_win = safeDiv(won_count, total_count);
    const attainment = safeDiv(won_amount, quota);
    const commit_coverage = safeDiv(commit_amount, quota);
    const best_coverage = safeDiv(best_amount, quota);
    const aov = safeDiv(won_amount, won_count);
    const partner_contribution = safeDiv(partner_closed_amount, closed_amount);
    const partner_win_rate = safeDiv(partner_won_count, partner_closed_count);
    const mixDen = pipeline_amount + best_amount + commit_amount + won_amount;
    const mix_pipeline = safeDiv(pipeline_amount, mixDen);
    const mix_best = safeDiv(best_amount, mixDen);
    const mix_commit = safeDiv(commit_amount, mixDen);
    const mix_won = safeDiv(won_amount, mixDen);

    const repRow: RepRow = {
      rep_id,
      rep_name,
      quota,
      total_count,
      won_amount,
      won_count,
      lost_count,
      active_count,
      commit_amount,
      best_amount,
      pipeline_amount,
      active_amount,
      win_rate,
      opp_to_win,
      attainment,
      commit_coverage,
      best_coverage,
      aov,
      partner_contribution,
      partner_win_rate,
      avg_days_won: rr.avg_days_won == null ? null : Number(rr.avg_days_won),
      avg_days_lost: rr.avg_days_lost == null ? null : Number(rr.avg_days_lost),
      avg_days_active: rr.avg_days_active == null ? null : Number(rr.avg_days_active),
      created_amount: created.amount,
      created_count: created.count,
      mix_pipeline,
      mix_best,
      mix_commit,
      mix_won,
    };

    const mgrKey = `${pid}|${manager_id}`;
    const repList = mgrToReps.get(mgrKey) || [];
    repList.push(repRow);
    mgrToReps.set(mgrKey, repList);

    const m = mgrAgg.get(mgrKey) || {
      manager_id,
      manager_name,
      quota: 0,
      total_count: 0,
      won_amount: 0,
      won_count: 0,
      lost_count: 0,
      pipeline_amount: 0,
      active_amount: 0,
      commit_amount: 0,
      best_amount: 0,
      created_amount: 0,
      created_count: 0,
      partner_closed_amount: 0,
      closed_amount: 0,
      partner_won_count: 0,
      partner_closed_count: 0,
      attainment: null,
      win_rate: null,
      opp_to_win: null,
      commit_coverage: null,
      best_coverage: null,
      aov: null,
      partner_contribution: null,
      partner_win_rate: null,
      mix_pipeline: null,
      mix_best: null,
      mix_commit: null,
      mix_won: null,
      avg_days_won: null,
      avg_days_lost: null,
      avg_days_active: null,
      reps: [],
    };
    m.manager_name = manager_name;
    m.quota += quota;
    m.total_count += total_count;
    m.won_amount += won_amount;
    m.won_count += won_count;
    m.lost_count += lost_count;
    m.pipeline_amount += pipeline_amount;
    m.active_amount += active_amount;
    m.commit_amount += commit_amount;
    m.best_amount += best_amount;
    m.created_amount += created.amount;
    m.created_count += created.count;
    m.partner_closed_amount += partner_closed_amount;
    m.closed_amount += closed_amount;
    m.partner_won_count += partner_won_count;
    m.partner_closed_count += partner_closed_count;
    mgrAgg.set(mgrKey, m);
  }

  // Add quota/created-only reps that had no close_date-in-quarter rows (still should appear with quota/created)
  for (const pid of periodIds) {
    // Collect rep_ids from quota and created maps for this period.
    const repIds = new Set<string>();
    for (const k of quotaByKey.keys()) {
      const [p, rid] = k.split("|");
      if (p === pid) repIds.add(rid);
    }
    for (const k of createdByKey.keys()) {
      const [p, rid] = k.split("|");
      if (p === pid) repIds.add(rid);
    }
    for (const rep_id of repIds) {
      // Already included?
      const already = repKpisRows.some((r) => String(r.quota_period_id) === pid && String(r.rep_id) === rep_id);
      if (already) continue;

      const manager_id = repIdToManagerId.get(rep_id) || "";
      const manager_name = manager_id ? repIdToRepName.get(manager_id) || `Manager ${manager_id}` : "(Unassigned)";
      const k = `${pid}|${rep_id}`;
      const created = createdByKey.get(k) || { amount: 0, count: 0 };
      const quota = quotaByKey.get(k) || 0;
      if (created.amount === 0 && quota === 0) continue;

      const rep_name = repIdToRepName.get(rep_id) || `Rep ${rep_id}`;
      const repRow: RepRow = {
        rep_id,
        rep_name,
        quota,
        total_count: 0,
        won_amount: 0,
        won_count: 0,
        lost_count: 0,
        active_count: 0,
        commit_amount: 0,
        best_amount: 0,
        pipeline_amount: 0,
        active_amount: 0,
        win_rate: null,
        opp_to_win: null,
        attainment: null,
        commit_coverage: null,
        best_coverage: null,
        aov: null,
        partner_contribution: null,
        partner_win_rate: null,
        avg_days_won: null,
        avg_days_lost: null,
        avg_days_active: null,
        created_amount: created.amount,
        created_count: created.count,
        mix_pipeline: null,
        mix_best: null,
        mix_commit: null,
        mix_won: null,
      };
      const mgrKey = `${pid}|${manager_id}`;
      const repList = mgrToReps.get(mgrKey) || [];
      repList.push(repRow);
      mgrToReps.set(mgrKey, repList);

      const m = mgrAgg.get(mgrKey) || {
        manager_id,
        manager_name,
        quota: 0,
        total_count: 0,
        won_amount: 0,
        won_count: 0,
        lost_count: 0,
        pipeline_amount: 0,
        active_amount: 0,
        commit_amount: 0,
        best_amount: 0,
        created_amount: 0,
        created_count: 0,
        partner_closed_amount: 0,
        closed_amount: 0,
        partner_won_count: 0,
        partner_closed_count: 0,
        attainment: null,
        win_rate: null,
        opp_to_win: null,
        commit_coverage: null,
        best_coverage: null,
        aov: null,
        partner_contribution: null,
        partner_win_rate: null,
        mix_pipeline: null,
        mix_best: null,
        mix_commit: null,
        mix_won: null,
        avg_days_won: null,
        avg_days_lost: null,
        avg_days_active: null,
        reps: [],
      };
      m.manager_name = manager_name;
      m.quota += quota;
      m.created_amount += created.amount;
      m.created_count += created.count;
      mgrAgg.set(mgrKey, m);
    }
  }

  // Finalize blocks: compute manager rows, sort reps by closed won, then managers.
  for (const pid of periodIds) {
    const block = periodBlocks.get(pid);
    if (!block) continue;
    const managers: ManagerRow[] = [];
    for (const [mgrKey, m] of mgrAgg.entries()) {
      const [p] = mgrKey.split("|");
      if (p !== pid) continue;

      const reps = (mgrToReps.get(mgrKey) || []).slice().sort((a, b) => b.won_amount - a.won_amount || a.rep_name.localeCompare(b.rep_name));
      m.reps = reps;
      m.attainment = safeDiv(m.won_amount, m.quota);
      m.win_rate = safeDiv(m.won_count, m.won_count + m.lost_count);
      m.opp_to_win = safeDiv(m.won_count, m.total_count);
      m.commit_coverage = safeDiv(m.commit_amount, m.quota);
      m.best_coverage = safeDiv(m.best_amount, m.quota);
      m.aov = safeDiv(m.won_amount, m.won_count);
      m.partner_contribution = safeDiv(m.partner_closed_amount, m.closed_amount);
      m.partner_win_rate = safeDiv(m.partner_won_count, m.partner_closed_count);
      const mixDen = m.pipeline_amount + m.best_amount + m.commit_amount + m.won_amount;
      m.mix_pipeline = safeDiv(m.pipeline_amount, mixDen);
      m.mix_best = safeDiv(m.best_amount, mixDen);
      m.mix_commit = safeDiv(m.commit_amount, mixDen);
      m.mix_won = safeDiv(m.won_amount, mixDen);

      // Weighted cycle metrics from rep rows (approximate but stable).
      let wonDaysSum = 0;
      let wonCnt = 0;
      let lostDaysSum = 0;
      let lostCnt = 0;
      let activeDaysSum = 0;
      let activeCnt = 0;
      for (const r of reps) {
        if (r.avg_days_won != null && r.won_count > 0) {
          wonDaysSum += r.avg_days_won * r.won_count;
          wonCnt += r.won_count;
        }
        if (r.avg_days_lost != null && r.lost_count > 0) {
          lostDaysSum += r.avg_days_lost * r.lost_count;
          lostCnt += r.lost_count;
        }
        if (r.avg_days_active != null && r.active_count > 0) {
          activeDaysSum += r.avg_days_active * r.active_count;
          activeCnt += r.active_count;
        }
      }
      m.avg_days_won = wonCnt ? wonDaysSum / wonCnt : null;
      m.avg_days_lost = lostCnt ? lostDaysSum / lostCnt : null;
      m.avg_days_active = activeCnt ? activeDaysSum / activeCnt : null;
      managers.push(m);
    }
    managers.sort((a, b) => b.won_amount - a.won_amount || (Number(b.attainment ?? -1) - Number(a.attainment ?? -1)) || a.manager_name.localeCompare(b.manager_name));

    // Compute period totals from manager totals.
    const quota_total = managers.reduce((acc, m) => acc + (Number(m.quota || 0) || 0), 0);
    const won_amount = managers.reduce((acc, m) => acc + (Number(m.won_amount || 0) || 0), 0);
    const won_count = managers.reduce((acc, m) => acc + (Number(m.won_count || 0) || 0), 0);
    const lost_count = managers.reduce((acc, m) => acc + (Number(m.lost_count || 0) || 0), 0);
    const pipeline_value = managers.reduce((acc, m) => acc + (Number(m.active_amount || 0) || 0), 0);
    const created_amount = managers.reduce((acc, m) => acc + (Number(m.created_amount || 0) || 0), 0);

    block.quota_total = quota_total;
    block.won_amount = won_amount;
    block.pipeline_value = pipeline_value;
    block.win_rate = safeDiv(won_count, won_count + lost_count);
    block.attainment = safeDiv(won_amount, quota_total);
    block.aov = safeDiv(won_amount, won_count);
    block.created_amount = created_amount;
    block.managers = managers;
  }

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">KPIs by quarter</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Select a fiscal year to see the current quarter first, then prior quarters. Reps are always sorted by Closed Won (desc).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/analytics" className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
              Analytics home
            </Link>
          </div>
        </div>

        <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Filters</h2>
          <form method="GET" action="/analytics/kpis" className="mt-3 flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Fiscal Year</label>
              <select
                name="fiscal_year"
                defaultValue={yearToUse}
                className="w-[180px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                {fiscalYears.map((fy) => (
                  <option key={fy} value={fy}>
                    {fy}
                  </option>
                ))}
              </select>
            </div>
            <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
              Apply
            </button>
          </form>
        </section>

        {!visiblePeriods.length ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <p className="text-sm text-[color:var(--sf-text-secondary)]">No quota periods found for this fiscal year.</p>
          </section>
        ) : (
          <div className="mt-5 grid gap-4">
            {visiblePeriods.map((p) => {
              const block = periodBlocks.get(String(p.id))!;
              const summaryLabel = `${p.period_name} (FY${p.fiscal_year} Q${p.fiscal_quarter})`;
              const quotaTotal = block.managers.reduce((acc, m) => acc + (Number(m.quota || 0) || 0), 0);
              const wonAmountTotal = block.managers.reduce((acc, m) => acc + (Number(m.won_amount || 0) || 0), 0);
              const wonCountTotal = block.managers.reduce((acc, m) => acc + (Number(m.won_count || 0) || 0), 0);
              const lostCountTotal = block.managers.reduce((acc, m) => acc + (Number(m.lost_count || 0) || 0), 0);
              const totalCountTotal = block.managers.reduce((acc, m) => acc + (Number(m.total_count || 0) || 0), 0);
              const commitTotal = block.managers.reduce((acc, m) => acc + (Number(m.commit_amount || 0) || 0), 0);
              const bestTotal = block.managers.reduce((acc, m) => acc + (Number(m.best_amount || 0) || 0), 0);
              const pipelineTotal = block.managers.reduce((acc, m) => acc + (Number(m.pipeline_amount || 0) || 0), 0);
              const partnerClosedAmtTotal = block.managers.reduce((acc, m) => acc + (Number(m.partner_closed_amount || 0) || 0), 0);
              const closedAmtTotal = block.managers.reduce((acc, m) => acc + (Number(m.closed_amount || 0) || 0), 0);
              const partnerWonCountTotal = block.managers.reduce((acc, m) => acc + (Number(m.partner_won_count || 0) || 0), 0);
              const partnerClosedCountTotal = block.managers.reduce((acc, m) => acc + (Number(m.partner_closed_count || 0) || 0), 0);

              const quotaAttainment = safeDiv(wonAmountTotal, quotaTotal);
              const winRate = safeDiv(wonCountTotal, wonCountTotal + lostCountTotal);
              const oppToWin = safeDiv(wonCountTotal, totalCountTotal);
              const commitCov = safeDiv(commitTotal, quotaTotal);
              const bestCov = safeDiv(bestTotal, quotaTotal);
              const partnerPct = safeDiv(partnerClosedAmtTotal, closedAmtTotal);
              const partnerWin = safeDiv(partnerWonCountTotal, partnerClosedCountTotal);
              const mixDen = pipelineTotal + bestTotal + commitTotal + wonAmountTotal;
              const mixStr = `${fmtPct(safeDiv(pipelineTotal, mixDen))} / ${fmtPct(safeDiv(bestTotal, mixDen))} / ${fmtPct(
                safeDiv(commitTotal, mixDen)
              )} / ${fmtPct(safeDiv(wonAmountTotal, mixDen))}`;

              // Aging (avg deal age): weighted avg of rep active-age by active deal count.
              let agingDaysSum = 0;
              let agingCnt = 0;
              for (const m of block.managers) {
                for (const r of m.reps || []) {
                  if (r.avg_days_active != null && r.active_count > 0) {
                    agingDaysSum += r.avg_days_active * r.active_count;
                    agingCnt += r.active_count;
                  }
                }
              }
              const agingAvgDays = agingCnt ? agingDaysSum / agingCnt : null;
              return (
                <section key={p.id} className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
                        {summaryLabel}{" "}
                        {block.is_current ? <span className="ml-2 rounded bg-[color:var(--sf-surface-alt)] px-2 py-0.5 text-xs">Current</span> : null}
                      </div>
                      <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                        {p.period_start} → {p.period_end}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                        <div className="text-[color:var(--sf-text-secondary)]">Quota Attainment</div>
                        <div className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(quotaAttainment)}</div>
                      </div>
                      <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                        <div className="text-[color:var(--sf-text-secondary)]">Closed Won</div>
                        <div className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(block.won_amount)}</div>
                      </div>
                      <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                        <div className="text-[color:var(--sf-text-secondary)]">Pipeline Value</div>
                        <div className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(block.pipeline_value)}</div>
                      </div>
                      <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                        <div className="text-[color:var(--sf-text-secondary)]">Aging (avg deal age)</div>
                        <div className="font-mono font-semibold text-[color:var(--sf-text-primary)]">
                          {agingAvgDays == null ? "—" : `${Math.round(agingAvgDays)}d`}
                        </div>
                      </div>
                      <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                        <div className="text-[color:var(--sf-text-secondary)]">Win Rate</div>
                        <div className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(winRate)}</div>
                      </div>
                      <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                        <div className="text-[color:var(--sf-text-secondary)]">Average Order Value</div>
                        <div className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(block.aov)}</div>
                      </div>
                      <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                        <div className="text-[color:var(--sf-text-secondary)]">New Pipeline Created</div>
                        <div className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(block.created_amount)}</div>
                      </div>
                      <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                        <div className="text-[color:var(--sf-text-secondary)]">Commit Coverage</div>
                        <div className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(commitCov)}</div>
                      </div>
                      <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                        <div className="text-[color:var(--sf-text-secondary)]">Best Case Coverage</div>
                        <div className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(bestCov)}</div>
                      </div>
                      <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                        <div className="text-[color:var(--sf-text-secondary)]">Opp→Win Conversion</div>
                        <div className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(oppToWin)}</div>
                      </div>
                      <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                        <div className="text-[color:var(--sf-text-secondary)]">Partner Contribution %</div>
                        <div className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(partnerPct)}</div>
                      </div>
                      <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                        <div className="text-[color:var(--sf-text-secondary)]">Partner Win Rate</div>
                        <div className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(partnerWin)}</div>
                      </div>
                      <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                        <div className="text-[color:var(--sf-text-secondary)]">Forecast Mix (P/B/C/W)</div>
                        <div className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{mixStr}</div>
                      </div>
                    </div>
                  </div>

                  <details open={block.is_current} className="mt-4 flex flex-col">
                    <summary className="order-2 mt-3 cursor-pointer rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-medium text-[color:var(--sf-text-primary)]">
                      Show / hide manager + rep breakdown (collapse control at bottom)
                    </summary>
                    <div className="order-1 mt-3 overflow-auto rounded-md border border-[color:var(--sf-border)]">
                      <table className="w-full min-w-[1650px] text-left text-sm">
                        <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                          <tr>
                            <th className="px-4 py-3">manager</th>
                            <th className="px-4 py-3 text-right">quota</th>
                            <th className="px-4 py-3 text-right">won</th>
                            <th className="px-4 py-3 text-right">attn</th>
                            <th className="px-4 py-3 text-right">commit cov</th>
                            <th className="px-4 py-3 text-right">best cov</th>
                            <th className="px-4 py-3 text-right">pipeline</th>
                            <th className="px-4 py-3 text-right">win rate</th>
                            <th className="px-4 py-3 text-right">opp→win</th>
                            <th className="px-4 py-3 text-right">AOV</th>
                            <th className="px-4 py-3 text-right">partner %</th>
                            <th className="px-4 py-3 text-right">partner win</th>
                            <th className="px-4 py-3 text-right">new pipe</th>
                            <th className="px-4 py-3 text-right">cycle(w)</th>
                            <th className="px-4 py-3 text-right">cycle(l)</th>
                            <th className="px-4 py-3 text-right">aging</th>
                            <th className="px-4 py-3 text-right">mix (P/B/C/W)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {block.managers.length ? (
                            block.managers.map((m) => {
                              const mixStr = `${fmtPct(m.mix_pipeline)} / ${fmtPct(m.mix_best)} / ${fmtPct(m.mix_commit)} / ${fmtPct(m.mix_won)}`;
                              return (
                                <Fragment key={`${p.id}:${m.manager_id || "unassigned"}`}>
                                  <tr key={`${p.id}:${m.manager_id || "unassigned"}`} className="border-t border-[color:var(--sf-border)] align-top">
                                    <td className="px-4 py-3 font-medium text-[color:var(--sf-text-primary)]">{m.manager_name}</td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(m.quota)}</td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">
                                      {fmtMoney(m.won_amount)} <span className="text-[color:var(--sf-text-secondary)]">({m.won_count})</span>
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">{fmtPct(m.attainment)}</td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">{fmtPct(m.commit_coverage)}</td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">{fmtPct(m.best_coverage)}</td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(m.active_amount)}</td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">{fmtPct(m.win_rate)}</td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">{fmtPct(m.opp_to_win)}</td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(m.aov)}</td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">{fmtPct(m.partner_contribution)}</td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">{fmtPct(m.partner_win_rate)}</td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">
                                      {fmtMoney(m.created_amount)} <span className="text-[color:var(--sf-text-secondary)]">({m.created_count})</span>
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">{m.avg_days_won == null ? "—" : `${Math.round(m.avg_days_won)}d`}</td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">{m.avg_days_lost == null ? "—" : `${Math.round(m.avg_days_lost)}d`}</td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">{m.avg_days_active == null ? "—" : `${Math.round(m.avg_days_active)}d`}</td>
                                    <td className="px-4 py-3 text-right font-mono text-xs">{mixStr}</td>
                                  </tr>
                                  <tr key={`${p.id}:${m.manager_id || "unassigned"}:reps`} className="border-t border-[color:var(--sf-border)]">
                                    <td colSpan={17} className="px-4 py-3">
                                      <details className="flex flex-col">
                                        <summary className="order-2 mt-3 cursor-pointer rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]">
                                          Show / hide reps (collapse control at bottom; sorted by Closed Won)
                                        </summary>
                                        <div className="order-1 mt-3 overflow-auto rounded-md border border-[color:var(--sf-border)]">
                                          <table className="w-full min-w-[1800px] text-left text-sm">
                                            <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                                              <tr>
                                                <th className="px-3 py-2">rep</th>
                                                <th className="px-3 py-2 text-right">quota</th>
                                                <th className="px-3 py-2 text-right">won</th>
                                                <th className="px-3 py-2 text-right">attn</th>
                                                <th className="px-3 py-2 text-right">commit cov</th>
                                                <th className="px-3 py-2 text-right">best cov</th>
                                                <th className="px-3 py-2 text-right">pipeline</th>
                                                <th className="px-3 py-2 text-right">win rate</th>
                                                <th className="px-3 py-2 text-right">opp→win</th>
                                                <th className="px-3 py-2 text-right">AOV</th>
                                                <th className="px-3 py-2 text-right">partner %</th>
                                                <th className="px-3 py-2 text-right">partner win</th>
                                                <th className="px-3 py-2 text-right">new pipe</th>
                                                <th className="px-3 py-2 text-right">cycle(w)</th>
                                                <th className="px-3 py-2 text-right">cycle(l)</th>
                                                <th className="px-3 py-2 text-right">aging</th>
                                                <th className="px-3 py-2 text-right">mix (P/B/C/W)</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {m.reps.map((r) => {
                                                const mix = `${fmtPct(r.mix_pipeline)} / ${fmtPct(r.mix_best)} / ${fmtPct(r.mix_commit)} / ${fmtPct(r.mix_won)}`;
                                                return (
                                                  <tr key={`${p.id}:${m.manager_id}:${r.rep_id}`} className="border-t border-[color:var(--sf-border)]">
                                                    <td className="px-3 py-2 font-medium text-[color:var(--sf-text-primary)]">{r.rep_name}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">{fmtMoney(r.quota)}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">
                                                      {fmtMoney(r.won_amount)}{" "}
                                                      <span className="text-[color:var(--sf-text-secondary)]">({r.won_count})</span>
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">{fmtPct(r.attainment)}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">{fmtPct(r.commit_coverage)}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">{fmtPct(r.best_coverage)}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">{fmtMoney(r.active_amount)}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">{fmtPct(r.win_rate)}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">{fmtPct(r.opp_to_win)}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">{fmtMoney(r.aov)}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">{fmtPct(r.partner_contribution)}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">{fmtPct(r.partner_win_rate)}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">
                                                      {fmtMoney(r.created_amount)}{" "}
                                                      <span className="text-[color:var(--sf-text-secondary)]">({r.created_count})</span>
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">{r.avg_days_won == null ? "—" : `${Math.round(r.avg_days_won)}d`}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">{r.avg_days_lost == null ? "—" : `${Math.round(r.avg_days_lost)}d`}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">{r.avg_days_active == null ? "—" : `${Math.round(r.avg_days_active)}d`}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-xs">{mix}</td>
                                                  </tr>
                                                );
                                              })}
                                            </tbody>
                                          </table>
                                        </div>
                                      </details>
                                    </td>
                                  </tr>
                                </Fragment>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={17} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                                No KPI data found for this period.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

