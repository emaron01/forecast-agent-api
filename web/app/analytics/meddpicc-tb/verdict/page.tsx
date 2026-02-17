import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization } from "../../../../lib/db";
import { pool } from "../../../../lib/pool";
import { getCompanyAttainmentForPeriod } from "../../../../lib/quotaComparisons";
import { UserTopNav } from "../../../_components/UserTopNav";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function spAll(v: string | string[] | undefined) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) return [v];
  return [] as string[];
}

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtNum(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString();
}

function fmtPct(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function deltaClass(n: number) {
  if (!Number.isFinite(n) || n === 0) return "text-[color:var(--sf-text-secondary)]";
  return n > 0 ? "text-[#2ECC71]" : "text-[#E74C3C]";
}

type QuotaPeriodLite = {
  id: string;
  fiscal_year: string;
  fiscal_quarter: string;
  period_name: string;
  period_start: string;
  period_end: string;
};

type ForecastAggRow = {
  crm_commit_amount: number;
  crm_commit_count: number;
  crm_best_amount: number;
  crm_best_count: number;
  crm_pipeline_amount: number;
  crm_pipeline_count: number;
  crm_total_amount: number;
  crm_total_count: number;
  won_amount: number;
  won_count: number;
  ai_commit_amount: number;
  ai_commit_count: number;
  ai_best_amount: number;
  ai_best_count: number;
  ai_pipeline_amount: number;
  ai_pipeline_count: number;
  ai_total_amount: number;
  ai_total_count: number;
};

type ForecastAggByRoleRow = ForecastAggRow & { owner_role: string };

function rangeLabel(a: number, b: number) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return `${fmtMoney(lo)} → ${fmtMoney(hi)}`;
}

function Box(props: { label: string; amount: number; count: number; subLabel?: string }) {
  return (
    <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3">
      <div className="text-xs text-[color:var(--sf-text-secondary)]">{props.label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(props.amount)}</div>
      <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
        # Opps: <span className="font-mono">{fmtNum(props.count)}</span>
        {props.subLabel ? <span className="ml-2">{props.subLabel}</span> : null}
      </div>
    </div>
  );
}

function Stat(props: { label: string; value: string; subLabel?: string }) {
  return (
    <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3">
      <div className="text-xs text-[color:var(--sf-text-secondary)]">{props.label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-[color:var(--sf-text-primary)]">{props.value}</div>
      {props.subLabel ? <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">{props.subLabel}</div> : null}
    </div>
  );
}

export default async function VerdictForecastPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "REP") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const quota_period_id = String(sp(searchParams?.quota_period_id) || "").trim();

  const ALL_OWNER_ROLES = ["EXEC_MANAGER", "MANAGER", "REP"] as const;
  const selectedOwnerRolesRaw = spAll(searchParams?.owner_role).map((r) => String(r || "").trim().toUpperCase());
  const selectedOwnerRolesSet = new Set<string>(
    selectedOwnerRolesRaw.filter((r) => (ALL_OWNER_ROLES as readonly string[]).includes(r))
  );
  const effectiveOwnerRoles =
    selectedOwnerRolesSet.size > 0 ? Array.from(selectedOwnerRolesSet) : Array.from(ALL_OWNER_ROLES);
  // If all roles are selected, treat this as "no filter" to preserve original behavior.
  const ownerRolesFilter = effectiveOwnerRoles.length === ALL_OWNER_ROLES.length ? ([] as string[]) : effectiveOwnerRoles;

  const periods = await pool
    .query<QuotaPeriodLite>(
      `
      SELECT
        id::text AS id,
        fiscal_year,
        fiscal_quarter::text AS fiscal_quarter,
        period_name,
        period_start::text AS period_start,
        period_end::text AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
      ORDER BY period_start DESC, id DESC
      `,
      [ctx.user.org_id]
    )
    .then((r) => r.rows || [])
    .catch(() => []);

  const todayIso = new Date().toISOString().slice(0, 10);
  const containingToday = periods.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;
  const defaultQuotaPeriodId = String(containingToday?.id || periods?.[0]?.id || "").trim();
  const qpId = quota_period_id || defaultQuotaPeriodId;
  const qp = qpId ? periods.find((p) => String(p.id) === qpId) || null : null;

  const company = qpId ? await getCompanyAttainmentForPeriod({ orgId: ctx.user.org_id, quotaPeriodId: qpId }).catch(() => null) : null;
  const quarterlyQuotaAmount = Number(company?.quarterly_company_quota_amount || 0) || 0;

  const aggRows: ForecastAggByRoleRow[] = qpId && qp
    ? await pool
        .query<ForecastAggByRoleRow>(
            `
            WITH qp AS (
              SELECT period_start::date AS period_start, period_end::date AS period_end
                FROM quota_periods
               WHERE org_id = $1::bigint
                 AND id = $2::bigint
               LIMIT 1
            ),
            deals AS (
              SELECT
                COALESCE(o.amount, 0)::float8 AS amount,
                o.health_score,
                CASE
                  WHEN r.role IN ('EXEC_MANAGER', 'MANAGER', 'REP') THEN r.role
                  ELSE 'UNASSIGNED'
                END AS owner_role,
                lower(
                  regexp_replace(
                    COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
                    '[^a-zA-Z]+',
                    ' ',
                    'g'
                  )
                ) AS fs
              FROM opportunities o
              JOIN qp ON TRUE
              LEFT JOIN reps r
                ON r.organization_id = $1
               AND r.id = o.rep_id
              WHERE o.org_id = $1
                AND o.close_date IS NOT NULL
                AND o.close_date >= qp.period_start
                AND o.close_date <= qp.period_end
                AND (COALESCE(array_length($3::text[], 1), 0) = 0 OR r.role = ANY($3::text[]))
            ),
            classified AS (
              SELECT
                *,
                ((' ' || fs || ' ') LIKE '% won %') AS is_won,
                ((' ' || fs || ' ') LIKE '% lost %') AS is_lost,
                ((' ' || fs || ' ') LIKE '% closed %') AS is_closed_kw,
                (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %') AND NOT ((' ' || fs || ' ') LIKE '% closed %')) AS is_open,
                CASE
                  WHEN health_score >= 24 THEN 'commit'
                  WHEN health_score >= 18 THEN 'best'
                  ELSE 'pipeline'
                END AS ai_bucket
              FROM deals
            )
            SELECT
              COALESCE(owner_role, 'ALL') AS owner_role,
              COALESCE(SUM(CASE WHEN is_open AND fs LIKE '%commit%' THEN amount ELSE 0 END), 0)::float8 AS crm_commit_amount,
              COALESCE(SUM(CASE WHEN is_open AND fs LIKE '%commit%' THEN 1 ELSE 0 END), 0)::int AS crm_commit_count,
              COALESCE(SUM(CASE WHEN is_open AND fs LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS crm_best_amount,
              COALESCE(SUM(CASE WHEN is_open AND fs LIKE '%best%' THEN 1 ELSE 0 END), 0)::int AS crm_best_count,
              COALESCE(SUM(CASE WHEN is_open AND NOT (fs LIKE '%commit%') AND NOT (fs LIKE '%best%') THEN amount ELSE 0 END), 0)::float8 AS crm_pipeline_amount,
              COALESCE(SUM(CASE WHEN is_open AND NOT (fs LIKE '%commit%') AND NOT (fs LIKE '%best%') THEN 1 ELSE 0 END), 0)::int AS crm_pipeline_count,
              COALESCE(SUM(CASE WHEN is_open THEN amount ELSE 0 END), 0)::float8 AS crm_total_amount,
              COALESCE(SUM(CASE WHEN is_open THEN 1 ELSE 0 END), 0)::int AS crm_total_count,
              COALESCE(SUM(CASE WHEN is_won THEN amount ELSE 0 END), 0)::float8 AS won_amount,
              COALESCE(SUM(CASE WHEN is_won THEN 1 ELSE 0 END), 0)::int AS won_count,
              COALESCE(SUM(CASE WHEN is_open AND ai_bucket = 'commit' THEN amount ELSE 0 END), 0)::float8 AS ai_commit_amount,
              COALESCE(SUM(CASE WHEN is_open AND ai_bucket = 'commit' THEN 1 ELSE 0 END), 0)::int AS ai_commit_count,
              COALESCE(SUM(CASE WHEN is_open AND ai_bucket = 'best' THEN amount ELSE 0 END), 0)::float8 AS ai_best_amount,
              COALESCE(SUM(CASE WHEN is_open AND ai_bucket = 'best' THEN 1 ELSE 0 END), 0)::int AS ai_best_count,
              COALESCE(SUM(CASE WHEN is_open AND ai_bucket = 'pipeline' THEN amount ELSE 0 END), 0)::float8 AS ai_pipeline_amount,
              COALESCE(SUM(CASE WHEN is_open AND ai_bucket = 'pipeline' THEN 1 ELSE 0 END), 0)::int AS ai_pipeline_count,
              COALESCE(SUM(CASE WHEN is_open THEN amount ELSE 0 END), 0)::float8 AS ai_total_amount,
              COALESCE(SUM(CASE WHEN is_open THEN 1 ELSE 0 END), 0)::int AS ai_total_count
            FROM classified
            GROUP BY GROUPING SETS ((owner_role), ())
            `,
            [ctx.user.org_id, qpId, ownerRolesFilter]
          )
        .then((r) => r.rows || [])
        .catch(() => [])
    : [];

  const normalizeAggRow = (r: any, owner_role: string): ForecastAggByRoleRow => {
    const z = (k: keyof ForecastAggRow) => Number(r?.[k] || 0) || 0;
    const zi = (k: keyof ForecastAggRow) => Number(r?.[k] || 0) || 0;
    return {
      owner_role,
      crm_commit_amount: z("crm_commit_amount"),
      crm_commit_count: zi("crm_commit_count"),
      crm_best_amount: z("crm_best_amount"),
      crm_best_count: zi("crm_best_count"),
      crm_pipeline_amount: z("crm_pipeline_amount"),
      crm_pipeline_count: zi("crm_pipeline_count"),
      crm_total_amount: z("crm_total_amount"),
      crm_total_count: zi("crm_total_count"),
      won_amount: z("won_amount"),
      won_count: zi("won_count"),
      ai_commit_amount: z("ai_commit_amount"),
      ai_commit_count: zi("ai_commit_count"),
      ai_best_amount: z("ai_best_amount"),
      ai_best_count: zi("ai_best_count"),
      ai_pipeline_amount: z("ai_pipeline_amount"),
      ai_pipeline_count: zi("ai_pipeline_count"),
      ai_total_amount: z("ai_total_amount"),
      ai_total_count: zi("ai_total_count"),
    };
  };

  const aggList = Array.isArray(aggRows) ? aggRows : [];
  const allAggRowRaw = aggList.find((r) => String((r as any)?.owner_role || "").toUpperCase() === "ALL") || null;
  const aggAll = normalizeAggRow(allAggRowRaw, "ALL");

  const aggByRole = new Map<string, ForecastAggByRoleRow>();
  for (const row of aggList) {
    const k = String((row as any)?.owner_role || "").toUpperCase();
    if (!k || k === "ALL") continue;
    aggByRole.set(k, normalizeAggRow(row, k));
  }

  const diff = {
    commit_amount: aggAll.ai_commit_amount - aggAll.crm_commit_amount,
    commit_count: aggAll.ai_commit_count - aggAll.crm_commit_count,
    best_amount: aggAll.ai_best_amount - aggAll.crm_best_amount,
    best_count: aggAll.ai_best_count - aggAll.crm_best_count,
    pipeline_amount: aggAll.ai_pipeline_amount - aggAll.crm_pipeline_amount,
    pipeline_count: aggAll.ai_pipeline_count - aggAll.crm_pipeline_count,
    total_amount: aggAll.ai_total_amount - aggAll.crm_total_amount,
    total_count: aggAll.ai_total_count - aggAll.crm_total_count,
  };

  const boxGrid = "mt-4 grid gap-3 text-sm sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5";
  const ownerRoleLabel = (k: string) => {
    const key = String(k || "").toUpperCase();
    if (key === "EXEC_MANAGER") return "Executive";
    if (key === "MANAGER") return "Manager";
    if (key === "REP") return "Rep";
    return key;
  };

  const commitMid = (Number(aggAll.crm_commit_amount || 0) + Number(aggAll.ai_commit_amount || 0)) / 2;
  const endOfQuarterVerdict = (Number(aggAll.won_amount || 0) || 0) + (Number.isFinite(commitMid) ? commitMid : 0);
  const leftToGo = quarterlyQuotaAmount - (Number(aggAll.won_amount || 0) || 0);
  const pctToGoal = quarterlyQuotaAmount > 0 ? endOfQuarterVerdict / quarterlyQuotaAmount : null;

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Verdict (Sales Forecast vs AI Forecast)</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Sales Forecast uses <span className="font-mono text-xs">forecast_stage</span>. The Verdict uses AI Forecast Stage (computed from{" "}
              <span className="font-mono text-xs">health_score</span>).
            </p>
            <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/analytics/meddpicc-tb">
                MEDDPICC+TB Reports
              </Link>
              {" · "}
              <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/analytics">
                Analytics home
              </Link>
            </div>
          </div>
        </div>

        <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Quarter</h2>
              <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                Period: <span className="font-mono text-xs">{qp?.period_start || "—"}</span> →{" "}
                <span className="font-mono text-xs">{qp?.period_end || "—"}</span>
              </p>
            </div>
            <form method="GET" action="/analytics/meddpicc-tb/verdict" className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1">
                <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Quota period</label>
                <select
                  name="quota_period_id"
                  defaultValue={qpId}
                  className="h-[40px] min-w-[260px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                >
                  {periods.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {String(p.period_name || "").trim() || `${p.period_start} → ${p.period_end}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <div className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Owner roles</div>
                <div className="flex flex-wrap gap-3 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                  {ALL_OWNER_ROLES.map((r) => (
                    <label key={r} className="inline-flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
                      <input type="checkbox" name="owner_role" value={r} defaultChecked={effectiveOwnerRoles.includes(r)} />
                      {ownerRoleLabel(r)}
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="submit"
                className="h-[40px] rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
              >
                Apply
              </button>
            </form>
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Quota + verdict</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            End of Quarter Verdict uses <span className="font-mono text-xs">mid-range AI Commit</span> + Closed Won.
          </p>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Quota" value={fmtMoney(quarterlyQuotaAmount)} subLabel="Company quota (role_level = 0)" />
            <Stat label="% to Goal" value={pctToGoal == null ? "—" : fmtPct(pctToGoal)} subLabel="(End of Quarter Verdict ÷ Quota)" />
            <Stat label="Left to Go" value={fmtMoney(leftToGo)} subLabel="Quota − Won" />
            <Stat label="End of Quarter Verdict" value={fmtMoney(endOfQuarterVerdict)} subLabel="Won + mid-range AI Commit" />
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Role comparison (Total Pipeline)</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Compare Sales Forecast vs The Verdict totals by owner role.</p>

          <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3 text-right">Sales Forecast (Total)</th>
                  <th className="px-4 py-3 text-right">Verdict (Total)</th>
                  <th className="px-4 py-3 text-right">Δ Total</th>
                  <th className="px-4 py-3 text-right">Δ # Opps</th>
                  <th className="px-4 py-3">Range</th>
                </tr>
              </thead>
              <tbody>
                {effectiveOwnerRoles.map((k) => {
                  const row = aggByRole.get(k) || normalizeAggRow(null, k);
                  const da = row.ai_total_amount - row.crm_total_amount;
                  const dc = row.ai_total_count - row.crm_total_count;
                  return (
                    <tr key={k} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-4 py-3 font-medium text-[color:var(--sf-text-primary)]">{ownerRoleLabel(k)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-[color:var(--sf-text-primary)]">{fmtMoney(row.crm_total_amount)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-[color:var(--sf-text-primary)]">{fmtMoney(row.ai_total_amount)}</td>
                      <td className={`px-4 py-3 text-right font-mono text-xs ${deltaClass(da)}`}>
                        {da === 0 ? "—" : `${da > 0 ? "+" : ""}${fmtMoney(Math.abs(da)).replace("$", "$")}`}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-xs ${deltaClass(dc)}`}>
                        {dc === 0 ? "—" : `${dc > 0 ? "+" : ""}${fmtNum(Math.abs(dc))}`}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[color:var(--sf-text-secondary)]">{rangeLabel(row.crm_total_amount, row.ai_total_amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Sales Forecast Module</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Buckets based on CRM Forecast Stage.</p>
          <div className={boxGrid}>
            <Box label="Commit" amount={aggAll.crm_commit_amount} count={aggAll.crm_commit_count} />
            <Box label="Best Case" amount={aggAll.crm_best_amount} count={aggAll.crm_best_count} />
            <Box label="Pipeline" amount={aggAll.crm_pipeline_amount} count={aggAll.crm_pipeline_count} />
            <Box label="Total Pipeline" amount={aggAll.crm_total_amount} count={aggAll.crm_total_count} />
            <Box label="Closed Won" amount={aggAll.won_amount} count={aggAll.won_count} />
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">The Verdict Module</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Buckets based on AI Forecast Stage (from health score).</p>
          <div className={boxGrid}>
            <Box label="Commit" amount={aggAll.ai_commit_amount} count={aggAll.ai_commit_count} />
            <Box label="Best Case" amount={aggAll.ai_best_amount} count={aggAll.ai_best_count} />
            <Box label="Pipeline" amount={aggAll.ai_pipeline_amount} count={aggAll.ai_pipeline_count} />
            <Box label="Total Pipeline" amount={aggAll.ai_total_amount} count={aggAll.ai_total_count} />
            <Box label="Closed Won" amount={aggAll.won_amount} count={aggAll.won_count} subLabel="(same)" />
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Difference Forecast (Verdict − Sales Forecast)</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Quarter range (Total Pipeline): <span className="font-mono">{rangeLabel(aggAll.crm_total_amount, aggAll.ai_total_amount)}</span>
          </p>

          <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-4 py-3">Bucket</th>
                  <th className="px-4 py-3 text-right">Δ Amount</th>
                  <th className="px-4 py-3 text-right">Δ # Opps</th>
                  <th className="px-4 py-3">Range</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    k: "Commit",
                    da: diff.commit_amount,
                    dc: diff.commit_count,
                    range: rangeLabel(aggAll.crm_commit_amount, aggAll.ai_commit_amount),
                  },
                  {
                    k: "Best Case",
                    da: diff.best_amount,
                    dc: diff.best_count,
                    range: rangeLabel(aggAll.crm_best_amount, aggAll.ai_best_amount),
                  },
                  {
                    k: "Pipeline",
                    da: diff.pipeline_amount,
                    dc: diff.pipeline_count,
                    range: rangeLabel(aggAll.crm_pipeline_amount, aggAll.ai_pipeline_amount),
                  },
                  {
                    k: "Total Pipeline",
                    da: diff.total_amount,
                    dc: diff.total_count,
                    range: rangeLabel(aggAll.crm_total_amount, aggAll.ai_total_amount),
                  },
                ].map((r) => (
                  <tr key={r.k} className="border-t border-[color:var(--sf-border)]">
                    <td className="px-4 py-3 font-medium text-[color:var(--sf-text-primary)]">{r.k}</td>
                    <td className={`px-4 py-3 text-right font-mono text-xs ${deltaClass(r.da)}`}>
                      {r.da === 0 ? "—" : `${r.da > 0 ? "+" : ""}${fmtMoney(Math.abs(r.da)).replace("$", "$")}`}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-xs ${deltaClass(r.dc)}`}>
                      {r.dc === 0 ? "—" : `${r.dc > 0 ? "+" : ""}${fmtNum(Math.abs(r.dc))}`}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[color:var(--sf-text-secondary)]">{r.range}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

