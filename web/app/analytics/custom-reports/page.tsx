import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { pool } from "../../../lib/pool";
import { UserTopNav } from "../../_components/UserTopNav";
import { CustomReportDesignerClient } from "./CustomReportDesignerClient";
import { getHealthAveragesByRepByPeriods } from "../../../lib/analyticsHealth";
import { TopDealsFiltersClient } from "../quotas/executive/TopDealsFiltersClient";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function isIsoDateOnly(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

function normalizeDateRange(startRaw: string, endRaw: string) {
  let start = isIsoDateOnly(startRaw) ? String(startRaw).trim() : "";
  let end = isIsoDateOnly(endRaw) ? String(endRaw).trim() : "";
  if (start && end && start > end) [start, end] = [end, start];
  return { start, end };
}

type QuotaPeriodLite = {
  id: string;
  period_name: string;
  period_start: string;
  period_end: string;
  fiscal_year: string;
  fiscal_quarter: string;
};

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

type RepOption = { id: number; name: string; manager_rep_id: number | null };

async function listRepOptions(orgId: number): Promise<RepOption[]> {
  const { rows } = await pool.query(
    `
    SELECT id, display_name, rep_name, manager_rep_id
      FROM reps
     WHERE organization_id = $1
       AND active IS TRUE
     ORDER BY COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(rep_name), ''), id::text) ASC, id ASC
    `,
    [orgId]
  );
  return (rows || [])
    .map((r: any) => ({
      id: Number(r.id),
      name: String(r.display_name || "").trim() || String(r.rep_name || "").trim() || `Rep ${r.id}`,
      manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    }))
    .filter((r: any) => Number.isFinite(r.id) && r.id > 0);
}

type RepPeriodKpisRow = {
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
  partner_won_count: number;
  partner_closed_count: number;
  avg_days_won: number | null;
  avg_days_lost: number | null;
  avg_days_active: number | null;
};

async function getRepKpisByPeriod(args: {
  orgId: number;
  periodId: string;
  repIds: number[] | null;
  dateStart?: string | null;
  dateEnd?: string | null;
}) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<RepPeriodKpisRow>(
    `
    WITH p AS (
      SELECT
        id::bigint AS quota_period_id,
        period_start::date AS period_start,
        period_end::date AS period_end,
        GREATEST(period_start::date, COALESCE($5::date, period_start::date)) AS range_start,
        LEAST(period_end::date, COALESCE($6::date, period_end::date)) AS range_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = $2::bigint
      LIMIT 1
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
        lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) AS fs,
        p.range_end::timestamptz AS period_end_ts,
        p.range_start::date AS period_start,
        p.range_end::date AS period_end
      FROM p
      JOIN opportunities o
        ON o.org_id = $1
       AND o.rep_id IS NOT NULL
       AND o.close_date IS NOT NULL
       AND o.close_date >= p.range_start
       AND o.close_date <= p.range_end
       AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
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
      AVG(CASE WHEN is_won AND create_date IS NOT NULL AND close_date IS NOT NULL THEN EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0 ELSE NULL END)::float8 AS avg_days_won,
      AVG(CASE WHEN is_lost AND create_date IS NOT NULL AND close_date IS NOT NULL THEN EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0 ELSE NULL END)::float8 AS avg_days_lost,
      AVG(CASE WHEN is_active AND create_date IS NOT NULL THEN EXTRACT(EPOCH FROM (LEAST(NOW(), period_end_ts) - create_date)) / 86400.0 ELSE NULL END)::float8 AS avg_days_active
    FROM classified
    GROUP BY quota_period_id, rep_id, rep_name
    ORDER BY won_amount DESC, rep_name ASC
    `,
    [args.orgId, args.periodId, args.repIds || [], useRepFilter, args.dateStart || null, args.dateEnd || null]
  );
  return (rows || []) as any[];
}

type QuotaByRepRow = { rep_id: string; quota_amount: number };
async function getQuotaByRepForPeriod(args: { orgId: number; quotaPeriodId: string; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<QuotaByRepRow>(
    `
    SELECT
      rep_id::text AS rep_id,
      COALESCE(SUM(quota_amount), 0)::float8 AS quota_amount
    FROM quotas
    WHERE org_id = $1::bigint
      AND role_level = 3
      AND rep_id IS NOT NULL
      AND quota_period_id = $2::bigint
      AND (NOT $4::boolean OR rep_id = ANY($3::bigint[]))
    GROUP BY rep_id
    ORDER BY quota_amount DESC
    `,
    [args.orgId, args.quotaPeriodId, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

function safeDiv(n: number, d: number) {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

export default async function AnalyticsCustomReportsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "REP") redirect("/dashboard");
  if (ctx.user.role === "ADMIN" && !ctx.user.admin_has_full_analytics_access) redirect("/admin");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const fiscal_year = String(sp(searchParams.fiscal_year) || "").trim();
  const quota_period_id = String(sp(searchParams.quota_period_id) || "").trim();
  const { start: start_date, end: end_date } = normalizeDateRange(String(sp(searchParams.start_date) || "").trim(), String(sp(searchParams.end_date) || "").trim());

  const periods = await listQuotaPeriodsForOrg(ctx.user.org_id).catch(() => []);
  const fiscalYears = Array.from(new Set(periods.map((p) => String(p.fiscal_year || "").trim()).filter(Boolean))).sort((a, b) => b.localeCompare(a));

  const todayIso = new Date().toISOString().slice(0, 10);
  const periodContainingToday = periods.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;
  const defaultYear = periodContainingToday ? String(periodContainingToday.fiscal_year) : fiscalYears[0] || "";
  const yearToUse = fiscal_year || defaultYear;

  const periodsForYear = yearToUse ? periods.filter((p) => String(p.fiscal_year) === yearToUse) : periods;
  const currentForYear = periodsForYear.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;
  const selectedPeriod = (quota_period_id && periodsForYear.find((p) => String(p.id) === quota_period_id)) || currentForYear || periodsForYear[0] || null;

  // For custom reports, default to org-wide rep set (like Exec view). Manager scoping can be added later.
  const repOptions = await listRepOptions(ctx.user.org_id).catch(() => []);
  const repIdToManagerId = new Map<string, string>();
  const managerNameById = new Map<string, string>();
  for (const r of repOptions) {
    repIdToManagerId.set(String(r.id), r.manager_rep_id == null ? "" : String(r.manager_rep_id));
  }
  for (const r of repOptions) {
    if (r.manager_rep_id != null) {
      const mid = String(r.manager_rep_id);
      if (!managerNameById.has(mid)) {
        const m = repOptions.find((x) => String(x.id) === mid);
        managerNameById.set(mid, m ? m.name : `Manager ${mid}`);
      }
    }
  }

  const repKpisRows = selectedPeriod
    ? await getRepKpisByPeriod({
        orgId: ctx.user.org_id,
        periodId: String(selectedPeriod.id),
        repIds: null,
        dateStart: start_date || null,
        dateEnd: end_date || null,
      }).catch(() => [])
    : [];
  const quotaRows = selectedPeriod ? await getQuotaByRepForPeriod({ orgId: ctx.user.org_id, quotaPeriodId: String(selectedPeriod.id), repIds: null }).catch(() => []) : [];
  const quotaByRep = new Map<string, number>();
  for (const q of quotaRows) quotaByRep.set(String(q.rep_id), Number(q.quota_amount || 0) || 0);

  const repHealthRows = selectedPeriod
    ? await getHealthAveragesByRepByPeriods({
        orgId: ctx.user.org_id,
        periodIds: [String(selectedPeriod.id)],
        repIds: null,
        dateStart: start_date || null,
        dateEnd: end_date || null,
      }).catch(() => [])
    : [];
  const healthByRepId = new Map<string, any>();
  for (const r of repHealthRows || []) healthByRepId.set(String((r as any).rep_id), r);

  const kpisByRepId = new Map<string, any>();
  for (const c of repKpisRows || []) kpisByRepId.set(String((c as any).rep_id), c);

  const repRows = repOptions.map((opt: any) => {
    const rep_id = String(opt.id);
    const c: any = kpisByRepId.get(rep_id) || null;
    const quota = quotaByRep.get(rep_id) || 0;
    const won_amount = Number(c?.won_amount || 0) || 0;
    const won_count = Number(c?.won_count || 0) || 0;
    const lost_count = Number(c?.lost_count || 0) || 0;
    const active_amount = Number(c?.active_amount || 0) || 0;
    const total_count = Number(c?.total_count || 0) || 0;
    const manager_id = repIdToManagerId.get(rep_id) || "";
    const manager_name = manager_id ? managerNameById.get(manager_id) || `Manager ${manager_id}` : "(Unassigned)";

    const commit_amount = Number(c?.commit_amount || 0) || 0;
    const best_amount = Number(c?.best_amount || 0) || 0;
    const pipeline_amount = Number(c?.pipeline_amount || 0) || 0;
    const mixDen = pipeline_amount + best_amount + commit_amount + won_amount;

    return {
      rep_id,
      rep_name: String(opt?.name || "").trim() || String(c?.rep_name || "").trim() || `Rep ${rep_id}`,
      manager_id,
      manager_name,
      avg_health_all: healthByRepId.get(rep_id)?.avg_health_all ?? null,
      avg_health_commit: healthByRepId.get(rep_id)?.avg_health_commit ?? null,
      avg_health_best: healthByRepId.get(rep_id)?.avg_health_best ?? null,
      avg_health_pipeline: healthByRepId.get(rep_id)?.avg_health_pipeline ?? null,
      avg_health_won: healthByRepId.get(rep_id)?.avg_health_won ?? null,
      avg_health_closed: healthByRepId.get(rep_id)?.avg_health_closed ?? null,
      quota,
      total_count,
      won_amount,
      won_count,
      lost_count,
      active_amount,
      commit_amount,
      best_amount,
      pipeline_amount,
      created_amount: 0,
      created_count: 0,
      win_rate: safeDiv(won_count, won_count + lost_count),
      opp_to_win: safeDiv(won_count, total_count),
      aov: safeDiv(won_amount, won_count),
      attainment: safeDiv(won_amount, quota),
      commit_coverage: safeDiv(commit_amount, quota),
      best_coverage: safeDiv(best_amount, quota),
      partner_contribution: safeDiv(Number(c?.partner_closed_amount || 0) || 0, Number(c?.closed_amount || 0) || 0),
      partner_win_rate: safeDiv(Number(c?.partner_won_count || 0) || 0, Number(c?.partner_closed_count || 0) || 0),
      avg_days_won: c?.avg_days_won == null ? null : Number(c.avg_days_won),
      avg_days_lost: c?.avg_days_lost == null ? null : Number(c.avg_days_lost),
      avg_days_active: c?.avg_days_active == null ? null : Number(c.avg_days_active),
      mix_pipeline: safeDiv(pipeline_amount, mixDen),
      mix_best: safeDiv(best_amount, mixDen),
      mix_commit: safeDiv(commit_amount, mixDen),
      mix_won: safeDiv(won_amount, mixDen),
    };
  });

  repRows.sort((a: any, b: any) => (Number(b.won_amount || 0) - Number(a.won_amount || 0)) || String(a.rep_name).localeCompare(String(b.rep_name)));

  // Saved reports for this user
  const { rows: saved } = await pool.query(
    `
    SELECT id::text AS id, report_type, name, description, config, created_at::text AS created_at, updated_at::text AS updated_at
    FROM analytics_saved_reports
    WHERE org_id = $1::bigint
      AND owner_user_id = $2::bigint
      AND report_type = 'rep_comparison_custom_v1'
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 100
    `,
    [ctx.user.org_id, ctx.user.id]
  );

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Build Custom Reports</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Create and save custom rep comparison reports (fields + selected reps).
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
          <TopDealsFiltersClient
            basePath="/analytics/custom-reports"
            fiscalYears={fiscalYears}
            periods={periods.map((p) => ({
              id: String(p.id),
              period_name: String(p.period_name),
              period_start: String(p.period_start),
              period_end: String(p.period_end),
              fiscal_year: String(p.fiscal_year),
              fiscal_quarter: String(p.fiscal_quarter),
            }))}
            selectedFiscalYear={yearToUse}
            selectedPeriodId={selectedPeriod ? String(selectedPeriod.id) : ""}
            showDateRange={true}
          />
        </section>

        <CustomReportDesignerClient
          reportType="rep_comparison_custom_v1"
          repRows={repRows as any}
          repDirectory={repOptions as any}
          savedReports={(saved || []) as any}
          periodLabel={
            selectedPeriod
              ? `${selectedPeriod.period_name} (FY${selectedPeriod.fiscal_year} Q${selectedPeriod.fiscal_quarter})${
                  start_date || end_date ? ` · Dates: ${start_date || "…"} → ${end_date || "…"}`
                    : ""
                }`
              : `—${start_date || end_date ? ` · Dates: ${start_date || "…"} → ${end_date || "…"}` : ""}`
          }
        />
      </main>
    </div>
  );
}

