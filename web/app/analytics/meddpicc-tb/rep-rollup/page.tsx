import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization } from "../../../../lib/db";
import { pool } from "../../../../lib/pool";
import { UserTopNav } from "../../../_components/UserTopNav";
import { MeddpiccRepRollupClient, type RepRollupRow } from "./uiClient";
import { getScopedRepDirectory } from "../../../../lib/repScope";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function spAll(v: string | string[] | undefined) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) return [v];
  return [] as string[];
}

function parseIntList(v: Array<string | undefined>) {
  const out: number[] = [];
  for (const raw of v || []) {
    const t = String(raw || "").trim();
    if (!t) continue;
    for (const part of t.split(/[,\s]+/g)) {
      const s = part.trim();
      if (!s) continue;
      const n = Number.parseInt(s, 10);
      if (Number.isFinite(n) && n > 0) out.push(n);
    }
  }
  return Array.from(new Set(out));
}

type QuotaPeriodLite = {
  id: string;
  fiscal_year: string;
  fiscal_quarter: string;
  period_name: string;
  period_start: string;
  period_end: string;
};

type RepOption = {
  id: number;
  name: string;
  role: string | null;
  manager_rep_id: number | null;
};

export default async function MeddpiccRepRollupPage({
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
  const include_closed = String(sp(searchParams?.include_closed) || "").trim() === "1";

  const teamIds = parseIntList([...spAll(searchParams?.team_id), ...spAll(searchParams?.team_ids)]);
  const repIds = parseIntList([...spAll(searchParams?.rep_id), ...spAll(searchParams?.rep_ids)]);

  const scope = await getScopedRepDirectory({ orgId: ctx.user.org_id, userId: ctx.user.id, role: ctx.user.role as any }).catch(() => null);
  const repOptions: RepOption[] = (scope?.repDirectory || []).map((r: any) => ({
    id: Number(r.id),
    name: String(r.name || "").trim() || "(Unnamed)",
    role: r.role == null ? null : String(r.role),
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
  }));
  const visibleIds = scope?.allowedRepIds ?? null;
  const visibleSet = visibleIds ? new Set<number>(visibleIds) : null;

  const execOptions = repOptions.filter((r) => r.role === "EXEC_MANAGER");
  const managerOptions = repOptions.filter((r) => r.role === "MANAGER");
  const repOnlyOptions = repOptions.filter((r) => r.role === "REP");

  const managersByExec = new Map<number, RepOption[]>();
  for (const m of managerOptions) {
    const eid = m.manager_rep_id ?? 0;
    const list = managersByExec.get(eid) || [];
    list.push(m);
    managersByExec.set(eid, list);
  }
  for (const [k, v] of managersByExec.entries()) {
    v.sort((a, b) => a.name.localeCompare(b.name));
    managersByExec.set(k, v);
  }

  const repsByManager = new Map<number, RepOption[]>();
  for (const r of repOnlyOptions) {
    const mid = r.manager_rep_id ?? 0;
    const list = repsByManager.get(mid) || [];
    list.push(r);
    repsByManager.set(mid, list);
  }
  for (const [k, v] of repsByManager.entries()) {
    v.sort((a, b) => a.name.localeCompare(b.name));
    repsByManager.set(k, v);
  }

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

  const scopedTeamIds = visibleSet ? teamIds.filter((id) => visibleSet.has(id)) : teamIds;
  const scopedRepIds = visibleSet ? repIds.filter((id) => visibleSet.has(id)) : repIds;

  const rows = qp
    ? await pool
        .query<{
          stage_group: string;
          manager_id: number | null;
          manager_name: string | null;
          rep_id: number | null;
          rep_name: string | null;
          opp_count: number;
          avg_health_score: number | null;
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
        }>(
          `
          WITH qp AS (
            SELECT period_start::date AS period_start, period_end::date AS period_end
              FROM quota_periods
             WHERE org_id = $1::bigint
               AND id = $2::bigint
             LIMIT 1
          ),
          base AS (
            SELECT
              e.id AS executive_id,
              COALESCE(NULLIF(btrim(e.display_name), ''), NULLIF(btrim(e.rep_name), ''), '(Unassigned)') AS executive_name,
              o.rep_id,
              COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), NULLIF(btrim(o.rep_name), ''), '(Unknown rep)') AS rep_name,
              r.manager_rep_id AS manager_id,
              COALESCE(NULLIF(btrim(m.display_name), ''), NULLIF(btrim(m.rep_name), ''), '(Unassigned)') AS manager_name,
              lower(
                regexp_replace(
                  COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
                  '[^a-zA-Z]+',
                  ' ',
                  'g'
                )
              ) AS forecast_stage_norm,
              o.health_score,
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
            FROM opportunities o
            JOIN qp ON TRUE
            LEFT JOIN reps r
              ON r.organization_id = $1
             AND r.id = o.rep_id
            LEFT JOIN reps m
              ON m.organization_id = $1
             AND m.id = r.manager_rep_id
            LEFT JOIN reps e
              ON e.organization_id = $1
             AND e.id = m.manager_rep_id
            WHERE o.org_id = $1
              AND o.close_date IS NOT NULL
              AND o.close_date >= qp.period_start
              AND o.close_date <= qp.period_end
              AND (COALESCE(array_length($4::int[], 1), 0) = 0 OR r.manager_rep_id = ANY($4::int[]) OR m.manager_rep_id = ANY($4::int[]))
              AND (COALESCE(array_length($5::int[], 1), 0) = 0 OR o.rep_id = ANY($5::int[]))
          ),
          filtered AS (
            SELECT
              *,
              CASE
                WHEN ((' ' || forecast_stage_norm || ' ') LIKE '% won %') THEN 'Closed Won'
                WHEN ((' ' || forecast_stage_norm || ' ') LIKE '% lost %') THEN 'Closed Lost'
                WHEN ((' ' || forecast_stage_norm || ' ') LIKE '% closed %') THEN 'Closed'
                WHEN forecast_stage_norm LIKE '%commit%' THEN 'Commit'
                WHEN forecast_stage_norm LIKE '%best%' THEN 'Best Case'
                ELSE 'Pipeline'
              END AS stage_group
              FROM base
             WHERE
               $3::boolean
               OR (
                 NOT ((' ' || forecast_stage_norm || ' ') LIKE '% won %')
                 AND NOT ((' ' || forecast_stage_norm || ' ') LIKE '% lost %')
                 AND NOT ((' ' || forecast_stage_norm || ' ') LIKE '% closed %')
               )
          )
          SELECT
            stage_group,
            executive_id,
            executive_name,
            manager_id,
            manager_name,
            rep_id,
            rep_name,
            COUNT(*)::int AS opp_count,
            AVG(NULLIF(health_score, 0))::float8 AS avg_health_score,
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
          FROM filtered
          GROUP BY stage_group, executive_id, executive_name, manager_id, manager_name, rep_id, rep_name
          ORDER BY stage_group ASC, executive_name ASC, manager_name ASC, rep_name ASC
          `,
          [ctx.user.org_id, qp.id, include_closed, scopedTeamIds, scopedRepIds]
        )
        .then((r) => r.rows || [])
        .catch(() => [])
    : [];

  const repRows: RepRollupRow[] = (rows || []).map((r) => {
    return {
      stage_group: String((r as any).stage_group || ""),
      forecast_stage_norm: "",
      executive_id: r.executive_id == null ? "" : String(r.executive_id),
      executive_name: String(r.executive_name || "(Unassigned)"),
      manager_id: r.manager_id == null ? "" : String(r.manager_id),
      manager_name: String(r.manager_name || "(Unassigned)"),
      rep_id: r.rep_id == null ? "" : String(r.rep_id),
      rep_name: String(r.rep_name || "(Unknown rep)"),
      opp_count: Number(r.opp_count || 0) || 0,
      avg_health_score: r.avg_health_score == null ? null : Number(r.avg_health_score),
      avg_pain: r.avg_pain == null ? null : Number(r.avg_pain),
      avg_metrics: r.avg_metrics == null ? null : Number(r.avg_metrics),
      avg_champion: r.avg_champion == null ? null : Number(r.avg_champion),
      avg_eb: r.avg_eb == null ? null : Number(r.avg_eb),
      avg_competition: r.avg_competition == null ? null : Number(r.avg_competition),
      avg_criteria: r.avg_criteria == null ? null : Number(r.avg_criteria),
      avg_process: r.avg_process == null ? null : Number(r.avg_process),
      avg_paper: r.avg_paper == null ? null : Number(r.avg_paper),
      avg_timing: r.avg_timing == null ? null : Number(r.avg_timing),
      avg_budget: r.avg_budget == null ? null : Number(r.avg_budget),
    };
  });

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">MEDDPICC+TB: Rep Rollup (Grouped by Forecast Stage)</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Shows opportunity counts and average MEDDPICC+TB scores per category, rolled up to manager. Colors follow the MEDDPICC score rules.
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
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Filters</h2>
          </div>

          <form method="GET" action="/analytics/meddpicc-tb/rep-rollup" className="mt-3 grid gap-4 md:grid-cols-12">
            <section className="md:col-span-8">
              <div className="text-xs font-medium text-[color:var(--sf-text-secondary)]">People (organized by team)</div>
              <div className="mt-2 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
                <div className="grid gap-2">
                  {(execOptions.length ? execOptions : [{ id: 0, name: "(Unassigned)", role: "EXEC_MANAGER", manager_rep_id: null }]).map((ex) => {
                    const exId = Number(ex.id) || 0;
                    const execChecked = teamIds.includes(exId);
                    const mgrs = managersByExec.get(exId) || [];
                    return (
                      <details key={`exec:${exId}`} open className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-2">
                        <summary className="cursor-pointer select-none text-sm font-semibold text-[color:var(--sf-text-primary)]">
                          <label className="inline-flex items-center gap-2">
                            <input type="checkbox" name="team_id" value={String(exId)} defaultChecked={execChecked} />
                            Executive: {ex.name}
                          </label>
                        </summary>

                        <div className="mt-2 grid gap-2 pl-4">
                          {(mgrs.length ? mgrs : [{ id: 0, name: "(Unassigned)", role: "MANAGER", manager_rep_id: exId }]).map((m) => {
                            const mid = Number(m.id) || 0;
                            const mgrChecked = teamIds.includes(mid);
                            const reps = repsByManager.get(mid) || [];
                            return (
                              <div key={`mgr:${exId}:${mid}`} className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-2">
                                <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
                                  <label className="inline-flex items-center gap-2">
                                    <input type="checkbox" name="team_id" value={String(mid)} defaultChecked={mgrChecked} />
                                    Manager: {m.name}
                                  </label>
                                </div>
                                <div className="mt-2 grid gap-1 pl-6">
                                  {(reps.length ? reps : [{ id: 0, name: "(No reps)", role: "REP", manager_rep_id: mid }]).map((r) => {
                                    const rid = Number(r.id) || 0;
                                    const repChecked = repIds.includes(rid);
                                    return (
                                      <label
                                        key={`rep:${mid}:${rid}`}
                                        className="inline-flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]"
                                      >
                                        <input type="checkbox" name="rep_id" value={String(rid)} defaultChecked={repChecked} disabled={rid === 0} />
                                        {r.name}
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="md:col-span-4 md:justify-self-end">
              <div className="grid gap-3">
                <div className="grid gap-1">
                  <div className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Period</div>
                  <div className="text-sm text-[color:var(--sf-text-secondary)]">
                    <span className="font-mono text-xs">{qp?.period_start || "—"}</span> →{" "}
                    <span className="font-mono text-xs">{qp?.period_end || "—"}</span>
                  </div>
                </div>

                <div className="grid gap-1">
                  <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Quarter</label>
                  <select
                    name="quota_period_id"
                    defaultValue={qpId}
                    className="h-[40px] w-full min-w-[240px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    {periods.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {String(p.period_name || "").trim() || `${p.period_start} → ${p.period_end}`}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
                  <input type="checkbox" name="include_closed" value="1" defaultChecked={include_closed} />
                  Include closed
                </label>

                <button
                  type="submit"
                  className="h-[40px] w-full rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
                >
                  Apply
                </button>
              </div>
            </section>
          </form>
        </section>

        <MeddpiccRepRollupClient rows={repRows} />
      </main>
    </div>
  );
}

