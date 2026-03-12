import { pool } from "../../../lib/pool";
import { requireOrgContext } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { UserTopNav } from "../../_components/UserTopNav";
import { redirect } from "next/navigation";

type SearchParams = { quarter?: string };

function getQuarterWindow(q?: string): { start: Date; end: Date } {
  const now = new Date();
  if (!q) {
    const qStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
    return { start: qStart, end: now };
  }
  const [year, qn] = q.split("-Q");
  const month = (parseInt(qn, 10) - 1) * 3;
  const start = new Date(Date.UTC(parseInt(year, 10), month, 1));
  const end = new Date(Date.UTC(parseInt(year, 10), month + 3, 1));
  return { start, end };
}

function currentQuarterString(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  return `${year}-Q${q}`;
}

function coverageRowClass(pct: number | null): string {
  if (pct == null) return "";
  if (pct === 0) return "bg-red-50";
  if (pct === 100) return "bg-green-50";
  return "";
}

function scoreBg(score: number | null | undefined): string {
  if (score == null) return "";
  if (score <= 0) return "bg-red-100";
  if (score === 1) return "bg-orange-100";
  if (score === 2) return "bg-yellow-100";
  if (score >= 3) return "bg-green-100";
  return "";
}

function deltaTextClass(delta: number): string {
  if (delta > 0) return "text-green-600";
  if (delta < 0) return "text-red-600";
  return "text-gray-500";
}

export default async function ForecastHygienePage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind !== "user") {
    redirect("/admin/organizations");
  }
  const user = ctx.user;
  if (user.role === "REP") {
    redirect("/dashboard");
  }

  const quarterParam = typeof searchParams?.quarter === "string" ? searchParams?.quarter : undefined;
  const { start, end } = getQuarterWindow(quarterParam);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  // Visible reps: hierarchy-scoped
  let visibleRepIds: number[] = [];
  if (user.role === "ADMIN" || user.see_all_visibility) {
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM users WHERE org_id = $1 AND active IS TRUE`,
      [orgId]
    );
    visibleRepIds = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
  } else {
    const { rows } = await pool.query<{ id: number }>(
      `
      WITH RECURSIVE visible_users AS (
        SELECT id FROM users WHERE id = $1 AND org_id = $2
        UNION ALL
        SELECT u.id
          FROM users u
          INNER JOIN visible_users vu ON u.manager_user_id = vu.id
         WHERE u.org_id = $2
      )
      SELECT id FROM visible_users
      `,
      [user.id, orgId]
    );
    const baseIds = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));

    const { rows: mvRows } = await pool.query<{ rep_user_id: number }>(
      `
      SELECT mv.visible_user_id AS rep_user_id
        FROM manager_visibility mv
        JOIN users mgr ON mgr.id = mv.manager_user_id
        JOIN users vis ON vis.id = mv.visible_user_id
       WHERE mv.manager_user_id = $1
         AND mgr.org_id = $2
         AND vis.org_id = $2
      `,
      [user.id, orgId]
    );
    const extra = mvRows.map((r) => Number(r.rep_user_id)).filter((n) => Number.isFinite(n));
    visibleRepIds = Array.from(new Set([...baseIds, ...extra]));
  }

  if (!visibleRepIds.length) {
    visibleRepIds = [-1]; // avoid empty ANY()
  }

  // Query A — Coverage
  type CoverageRow = {
    rep_id: number;
    rep_name: string;
    total_opps: number;
    reviewed_opps: number;
    coverage_pct: number | null;
  };

  const { rows: coverageRows } = await pool.query<CoverageRow>(
    `
    SELECT
      u.id AS rep_id,
      COALESCE(NULLIF(btrim(u.display_name), ''), NULLIF(btrim(u.account_owner_name), ''), u.email) AS rep_name,
      COUNT(opp.id)::int AS total_opps,
      COUNT(opp.id) FILTER (WHERE COALESCE(opp.run_count, 0) > 0)::int AS reviewed_opps,
      ROUND(
        COUNT(opp.id) FILTER (WHERE COALESCE(opp.run_count, 0) > 0)::numeric
        / NULLIF(COUNT(opp.id), 0) * 100
      )::int AS coverage_pct
    FROM users u
    LEFT JOIN opportunities opp
      ON opp.rep_id = u.id
     AND opp.org_id = $1
     AND opp.close_date >= $2::timestamptz
     AND opp.close_date < $3::timestamptz
    WHERE u.org_id = $1
      AND u.id = ANY($4::int[])
    GROUP BY u.id, rep_name
    ORDER BY coverage_pct ASC NULLS LAST, rep_name ASC
    `,
    [orgId, startIso, endIso, visibleRepIds]
  );

  // Query B — Matthew's Assessment (category heatmap)
  type AssessmentRow = {
    rep_id: number;
    rep_name: string;
    pain: number | null;
    metrics: number | null;
    champion: number | null;
    eb: number | null;
    criteria: number | null;
    process: number | null;
    competition: number | null;
    paper: number | null;
    timing: number | null;
    budget: number | null;
    avg_total: number | null;
  };

  const { rows: assessmentRows } = await pool.query<AssessmentRow>(
    `
    SELECT
      u.id AS rep_id,
      COALESCE(NULLIF(btrim(u.display_name), ''), NULLIF(btrim(u.account_owner_name), ''), u.email) AS rep_name,
      ROUND(AVG(opp.pain_score))        AS pain,
      ROUND(AVG(opp.metrics_score))     AS metrics,
      ROUND(AVG(opp.champion_score))    AS champion,
      ROUND(AVG(opp.eb_score))          AS eb,
      ROUND(AVG(opp.criteria_score))    AS criteria,
      ROUND(AVG(opp.process_score))     AS process,
      ROUND(AVG(opp.competition_score)) AS competition,
      ROUND(AVG(opp.paper_score))       AS paper,
      ROUND(AVG(opp.timing_score))      AS timing,
      ROUND(AVG(opp.budget_score))      AS budget,
      ROUND(AVG(opp.health_score))      AS avg_total
    FROM users u
    LEFT JOIN opportunities opp
      ON opp.rep_id = u.id
     AND opp.org_id = $1
     AND opp.close_date >= $2::timestamptz
     AND opp.close_date < $3::timestamptz
     AND COALESCE(opp.run_count, 0) > 0
    WHERE u.org_id = $1
      AND u.id = ANY($4::int[])
    GROUP BY u.id, rep_name
    ORDER BY avg_total ASC NULLS LAST, rep_name ASC
    `,
    [orgId, startIso, endIso, visibleRepIds]
  );

  // Query C — Score Velocity
  type VelocityRow = {
    opp_id: number;
    opp_name: string;
    rep_id: number;
    rep_name: string;
    baseline_score: number | null;
    current_score: number | null;
    delta: number | null;
  };

  const { rows: velocityRows } = await pool.query<VelocityRow>(
    `
    SELECT
      opp.id AS opp_id,
      COALESCE(NULLIF(btrim(opp.opportunity_name), ''), NULLIF(btrim(opp.account_name), ''), opp.id::text) AS opp_name,
      opp.rep_id,
      COALESCE(NULLIF(btrim(u.display_name), ''), NULLIF(btrim(u.account_owner_name), ''), u.email) AS rep_name,
      first_event.total_score AS baseline_score,
      opp.health_score AS current_score,
      (opp.health_score - first_event.total_score) AS delta
    FROM opportunities opp
    JOIN users u ON u.id = opp.rep_id
    JOIN LATERAL (
      SELECT total_score
      FROM opportunity_audit_events
      WHERE opportunity_id = opp.id
        AND org_id = $1
      ORDER BY ts ASC
      LIMIT 1
    ) first_event ON true
    WHERE opp.rep_id = ANY($4::int[])
      AND opp.org_id = $1
      AND opp.close_date >= $2::timestamptz
      AND opp.close_date < $3::timestamptz
      AND COALESCE(opp.run_count, 0) > 0
    ORDER BY delta ASC NULLS LAST, rep_name ASC, opp_name ASC
    `,
    [orgId, startIso, endIso, visibleRepIds]
  );

  // Query D — Deal Progression
  type ProgressionRow = {
    opportunity_id: number;
    opp_name: string;
    rep_id: number;
    rep_name: string;
    ts: string;
    total_score: number | null;
  };

  const { rows: progressionRows } = await pool.query<ProgressionRow>(
    `
    SELECT
      oae.opportunity_id,
      COALESCE(NULLIF(btrim(opp.opportunity_name), ''), NULLIF(btrim(opp.account_name), ''), opp.id::text) AS opp_name,
      opp.rep_id,
      COALESCE(NULLIF(btrim(u.display_name), ''), NULLIF(btrim(u.account_owner_name), ''), u.email) AS rep_name,
      oae.ts::text,
      oae.total_score
    FROM opportunity_audit_events oae
    JOIN opportunities opp ON opp.id = oae.opportunity_id
    JOIN users u ON u.id = opp.rep_id
    WHERE oae.org_id = $1
      AND opp.org_id = $1
      AND opp.rep_id = ANY($4::int[])
      AND opp.close_date >= $2::timestamptz
      AND opp.close_date < $3::timestamptz
    ORDER BY oae.opportunity_id, oae.ts ASC
    `,
    [orgId, startIso, endIso, visibleRepIds]
  );

  // Group progression by opportunity and compute stalled flags.
  type ProgressionSeries = {
    opportunity_id: number;
    opp_name: string;
    rep_name: string;
    points: { t: Date; score: number | null }[];
    stalled: boolean;
  };

  const now = new Date();
  const progressionByOpp = new Map<number, ProgressionSeries>();
  for (const row of progressionRows) {
    const t = new Date(row.ts);
    const existing = progressionByOpp.get(row.opportunity_id);
    if (!existing) {
      progressionByOpp.set(row.opportunity_id, {
        opportunity_id: row.opportunity_id,
        opp_name: row.opp_name,
        rep_name: row.rep_name,
        points: [{ t, score: row.total_score }],
        stalled: false,
      });
    } else {
      existing.points.push({ t, score: row.total_score });
    }
  }

  for (const series of progressionByOpp.values()) {
    const pts = series.points;
    if (pts.length < 3) {
      series.stalled = false;
      continue;
    }
    const lastThree = pts.slice(-3);
    const allEqual =
      lastThree[0].score === lastThree[1].score &&
      lastThree[1].score === lastThree[2].score;
    const lastTime = lastThree[2].t;
    const daysSince =
      (now.getTime() - lastTime.getTime()) / (1000 * 60 * 60 * 24);
    series.stalled = !!allEqual && daysSince > 14;
  }

  const progressionSeries = Array.from(progressionByOpp.values());

  const quarterOptions = (() => {
    const options: { value: string; label: string }[] = [];
    const base = new Date();
    const currentYear = base.getUTCFullYear();
    const currentQuarter = Math.floor(base.getUTCMonth() / 3) + 1;
    for (let i = 0; i < 4; i++) {
      const qIndex = currentQuarter - i;
      let year = currentYear;
      let q = qIndex;
      if (qIndex <= 0) {
        q = qIndex + 4;
        year = currentYear - 1;
      }
      const value = `${year}-Q${q}`;
      const label = `Q${q} ${year}`;
      options.push({ value, label });
    }
    return options;
  })();

  const selectedQuarter = quarterParam || currentQuarterString();

  const org = await getOrganization({ id: orgId }).catch(() => null);
  const orgName = org?.name || "Organization";

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={user} />
      <main className="mx-auto max-w-4xl p-6 space-y-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-[color:var(--sf-text-primary)]">Forecast Hygiene</h1>
          <form method="GET">
            <label className="mr-2 text-sm text-[color:var(--sf-text-secondary)]" htmlFor="quarter-select">
              Quarter:
            </label>
            <select
              id="quarter-select"
              name="quarter"
              defaultValue={selectedQuarter}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-2 py-1 text-sm text-[color:var(--sf-text-primary)]"
            >
              {quarterOptions.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="ml-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]"
            >
              Apply
            </button>
          </form>
        </div>

        {/* Panel 1 — Coverage */}
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-[color:var(--sf-text-primary)]">Coverage</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Share of in-quarter opportunities that have been reviewed by Matthew for each rep.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-3 py-2 text-left">Rep</th>
                  <th className="px-3 py-2 text-right">Total Opps</th>
                  <th className="px-3 py-2 text-right">Reviewed</th>
                  <th className="px-3 py-2 text-right">Coverage %</th>
                </tr>
              </thead>
              <tbody>
                {coverageRows.map((row) => (
                  <tr key={row.rep_id} className={coverageRowClass(row.coverage_pct)}>
                    <td className="px-3 py-2 text-[color:var(--sf-text-primary)]">{row.rep_name}</td>
                    <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.total_opps}</td>
                    <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.reviewed_opps}</td>
                    <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                      {row.coverage_pct != null ? `${row.coverage_pct}%` : "—"}
                    </td>
                  </tr>
                ))}
                {!coverageRows.length && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-sm text-[color:var(--sf-text-secondary)]">
                      No opportunities found for this quarter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Panel 2 — Assessment Heatmap */}
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-[color:var(--sf-text-primary)]">Matthew&apos;s Assessment (MEDDPICC+TB)</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Average category scores for reviewed deals this quarter.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-2 py-2 text-left">Rep</th>
                  {["Pain","Metrics","Champion","EB","Criteria","Process","Competition","Paper","Timing","Budget","Avg"].map((h) => (
                    <th key={h} className="px-2 py-2 text-center">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assessmentRows.map((row) => (
                  <tr key={row.rep_id} className="border-t border-[color:var(--sf-border)]">
                    <td className="px-2 py-2 text-[color:var(--sf-text-primary)] whitespace-nowrap">{row.rep_name}</td>
                    {[
                      row.pain,
                      row.metrics,
                      row.champion,
                      row.eb,
                      row.criteria,
                      row.process,
                      row.competition,
                      row.paper,
                      row.timing,
                      row.budget,
                      row.avg_total,
                    ].map((v, idx) => (
                      <td
                        key={idx}
                        className={`px-2 py-1 text-center font-mono ${scoreBg(v)}`}
                      >
                        {v != null ? v : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
                {!assessmentRows.length && (
                  <tr>
                    <td colSpan={12} className="px-3 py-4 text-center text-sm text-[color:var(--sf-text-secondary)]">
                      No reviewed deals found for this quarter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Panel 3 — Score Velocity */}
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-[color:var(--sf-text-primary)]">Score Velocity</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Change from baseline total score to current score for each reviewed opportunity this quarter.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-3 py-2 text-left">Rep</th>
                  <th className="px-3 py-2 text-left">Opportunity</th>
                  <th className="px-3 py-2 text-right">Baseline</th>
                  <th className="px-3 py-2 text-right">Current</th>
                  <th className="px-3 py-2 text-right">Delta</th>
                </tr>
              </thead>
              <tbody>
                {velocityRows.map((row, idx) => (
                  <tr key={`${row.opp_id}:${idx}`} className="border-t border-[color:var(--sf-border)]">
                    <td className="px-3 py-2 text-[color:var(--sf-text-primary)] whitespace-nowrap">{row.rep_name}</td>
                    <td className="px-3 py-2 text-[color:var(--sf-text-primary)]">{row.opp_name}</td>
                    <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                      {row.baseline_score != null ? row.baseline_score : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                      {row.current_score != null ? row.current_score : "—"}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${deltaTextClass(row.delta ?? 0)}`}>
                      {row.delta != null ? row.delta : "—"}
                    </td>
                  </tr>
                ))}
                {!velocityRows.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-sm text-[color:var(--sf-text-secondary)]">
                      No score changes found for this quarter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Panel 4 — Deal Progression */}
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-[color:var(--sf-text-primary)]">Deal Progression</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Score trajectories for reviewed deals this quarter. Deals with flat scores for 3+ events over 14+ days are flagged as stalled.
          </p>
          <div className="mt-3 space-y-3">
            {progressionSeries.map((series) => {
              const pts = series.points;
              if (!pts.length) return null;
              const scores = pts.map((p) => (p.score == null ? 0 : p.score));
              const minScore = Math.min(...scores);
              const maxScore = Math.max(...scores);
              const range = maxScore - minScore || 1;
              const width = 160;
              const height = 40;
              const stepX = pts.length > 1 ? width / (pts.length - 1) : 0;
              const pathD = pts
                .map((p, idx) => {
                  const x = idx * stepX;
                  const y = height - ((p.score == null ? minScore : p.score) - minScore) / range * height;
                  return `${idx === 0 ? "M" : "L"}${x},${y}`;
                })
                .join(" ");

              return (
                <div key={series.opportunity_id} className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-[color:var(--sf-text-primary)] truncate">
                        {series.opp_name}
                      </div>
                      {series.stalled && (
                        <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800">
                          ⚠ Stalled
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[color:var(--sf-text-secondary)]">{series.rep_name}</div>
                  </div>
                  <svg
                    width={width}
                    height={height}
                    viewBox={`0 0 ${width} ${height}`}
                    className="shrink-0 text-[color:var(--sf-accent-primary)]"
                  >
                    <path d={pathD} fill="none" stroke="currentColor" strokeWidth={2} />
                  </svg>
                </div>
              );
            })}
            {!progressionSeries.length && (
              <div className="text-center text-sm text-[color:var(--sf-text-secondary)]">
                No audit history found for this quarter.
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

