import { pool } from "../../../lib/pool";
import { requireOrgContext } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { UserTopNav } from "../../_components/UserTopNav";
import { redirect } from "next/navigation";

type SearchParams = { quota_period_id?: string };

function coverageRowClass(pct: number | null): string {
  if (pct == null) return "";
  if (pct === 0) return "bg-red-50";
  if (pct === 100) return "bg-green-50";
  return "";
}

function scoreColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return "bg-gray-100 text-gray-400";
  if (score === 0) return "bg-red-600 text-white";
  if (score === 1) return "bg-orange-500 text-white";
  if (score === 2) return "bg-yellow-400 text-gray-900";
  return "bg-green-500 text-white";
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

  // Resolve quota periods for this org and derive date window from selected quarter.
  const selectedQuotaPeriodId = String(searchParams?.quota_period_id || "").trim();
  const { rows: qpRows } = await pool.query<{
    id: string;
    period_name: string;
    period_start: string;
    period_end: string;
    fiscal_year: string | null;
    fiscal_quarter: string | null;
  }>(
    `
    SELECT
      id::text AS id,
      period_name,
      period_start::text AS period_start,
      period_end::text AS period_end,
      fiscal_year::text AS fiscal_year,
      fiscal_quarter::text AS fiscal_quarter
    FROM quota_periods
    WHERE org_id = $1::bigint
    ORDER BY period_start DESC, id DESC
    `,
    [orgId]
  );
  const quotaPeriods = qpRows || [];

  let selectedPeriod = quotaPeriods.find((p) => p.id === selectedQuotaPeriodId) || null;
  if (!selectedPeriod) {
    const { rows: currentRows } = await pool.query<{ id: string }>(
      `
      SELECT id::text AS id
        FROM quota_periods
       WHERE org_id = $1::bigint
         AND period_start <= CURRENT_DATE
         AND period_end >= CURRENT_DATE
       ORDER BY period_start DESC, id DESC
       LIMIT 1
      `,
      [orgId]
    );
    const currentId = String(currentRows?.[0]?.id || "").trim();
    selectedPeriod =
      (currentId && quotaPeriods.find((p) => p.id === currentId)) ||
      quotaPeriods[0] ||
      null;
  }

  const startIso =
    selectedPeriod?.period_start != null
      ? new Date(selectedPeriod.period_start).toISOString()
      : new Date(0).toISOString();
  const endIso =
    selectedPeriod?.period_end != null
      ? new Date(new Date(selectedPeriod.period_end).getTime() + 24 * 60 * 60 * 1000).toISOString()
      : new Date().toISOString();

  // Visible users: hierarchy-scoped (user_ids first)
  let visibleUserIds: number[] = [];
  if (user.role === "ADMIN" || user.see_all_visibility) {
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM users WHERE org_id = $1 AND active IS TRUE`,
      [orgId]
    );
    visibleUserIds = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
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
    visibleUserIds = Array.from(new Set([...baseIds, ...extra]));
  }

  if (!visibleUserIds.length) {
    visibleUserIds = [-1]; // avoid empty ANY()
  }

  // Map visible user_ids -> reps.id used by opportunities.rep_id
  const { rows: repRows } = await pool.query<{ id: number }>(
    `
    SELECT r.id
      FROM reps r
      JOIN users u ON u.id = r.user_id
     WHERE u.org_id = $1
       AND u.id = ANY($2::int[])
    `,
    [orgId, visibleUserIds]
  );
  let visibleRepIds = repRows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
  if (!visibleRepIds.length) {
    visibleRepIds = [-1];
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
      r.id AS rep_id,
      COALESCE(
        NULLIF(btrim(r.display_name), ''),
        NULLIF(btrim(r.rep_name), ''),
        '(Unknown rep)'
      ) AS rep_name,
      COUNT(opp.id)::int AS total_opps,
      COUNT(opp.id) FILTER (
        WHERE EXISTS (
          SELECT 1
            FROM opportunity_audit_events oae
           WHERE oae.opportunity_id = opp.id
             AND oae.org_id = $1
             AND (
               oae.meta->>'score_event_source' = 'agent'
               OR oae.event_type = 'agent'
             )
        )
      )::int AS reviewed_opps,
      ROUND(
        COUNT(opp.id) FILTER (
          WHERE EXISTS (
            SELECT 1
              FROM opportunity_audit_events oae
             WHERE oae.opportunity_id = opp.id
               AND oae.org_id = $1
               AND (
                 oae.meta->>'score_event_source' = 'agent'
                 OR oae.event_type = 'agent'
               )
          )
        )::numeric
        / NULLIF(COUNT(opp.id), 0) * 100
      )::int AS coverage_pct
    FROM reps r
    LEFT JOIN opportunities opp
      ON opp.rep_id = r.id
     AND opp.org_id = $1
     AND opp.close_date >= $2::timestamptz
     AND opp.close_date < $3::timestamptz
    WHERE COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
      AND r.id = ANY($4::bigint[])
    GROUP BY
      r.id,
      COALESCE(
        NULLIF(btrim(r.display_name), ''),
        NULLIF(btrim(r.rep_name), ''),
        '(Unknown rep)'
      )
    ORDER BY coverage_pct ASC NULLS LAST,
      COALESCE(
        NULLIF(btrim(r.display_name), ''),
        NULLIF(btrim(r.rep_name), ''),
        '(Unknown rep)'
      ) ASC
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
      r.id AS rep_id,
      COALESCE(
        NULLIF(btrim(r.display_name), ''),
        NULLIF(btrim(r.rep_name), ''),
        '(Unknown rep)'
      ) AS rep_name,
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
    FROM reps r
    LEFT JOIN opportunities opp
      ON opp.rep_id = r.id
     AND opp.org_id = $1
     AND opp.close_date >= $2::timestamptz
     AND opp.close_date < $3::timestamptz
     AND EXISTS (
       SELECT 1
         FROM opportunity_audit_events oae
        WHERE oae.opportunity_id = opp.id
          AND oae.org_id = $1
          AND (
            oae.meta->>'score_event_source' = 'agent'
            OR oae.event_type = 'agent'
          )
     )
    WHERE COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
      AND r.id = ANY($4::bigint[])
    GROUP BY
      r.id,
      COALESCE(
        NULLIF(btrim(r.display_name), ''),
        NULLIF(btrim(r.rep_name), ''),
        '(Unknown rep)'
      )
    ORDER BY avg_total ASC NULLS LAST,
      COALESCE(
        NULLIF(btrim(r.display_name), ''),
        NULLIF(btrim(r.rep_name), ''),
        '(Unknown rep)'
      ) ASC
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
      COALESCE(
        NULLIF(btrim(r.display_name), ''),
        NULLIF(btrim(r.rep_name), ''),
        '(Unknown rep)'
      ) AS rep_name,
      first_event.total_score AS baseline_score,
      opp.health_score AS current_score,
      (opp.health_score - first_event.total_score) AS delta
    FROM opportunities opp
    JOIN reps r
      ON r.id = opp.rep_id
     AND COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
    JOIN LATERAL (
      SELECT total_score
      FROM opportunity_audit_events
      WHERE opportunity_id = opp.id
        AND org_id = $1
      ORDER BY ts ASC
      LIMIT 1
    ) first_event ON true
    WHERE opp.rep_id = ANY($4::bigint[])
      AND opp.org_id = $1
      AND opp.close_date >= $2::timestamptz
      AND opp.close_date < $3::timestamptz
      AND COALESCE(opp.run_count, 0) > 0
    ORDER BY delta ASC NULLS LAST, rep_name ASC, opp_name ASC
    `,
    [orgId, startIso, endIso, visibleRepIds]
  );

  // Group Query C results by rep for summary.
  type VelocityRepSummary = {
    repName: string;
    avgBaseline: number;
    avgCurrent: number;
    avgDelta: number;
    dealsMoving: number;
    dealsFlat: number;
  };

  const velocityByRep = new Map<string, {
    repName: string;
    count: number;
    sumBaseline: number;
    sumCurrent: number;
    sumDelta: number;
    dealsMoving: number;
    dealsFlat: number;
  }>();

  for (const row of velocityRows) {
    const key = `${row.rep_id}:${row.rep_name}`;
    let agg = velocityByRep.get(key);
    if (!agg) {
      agg = {
        repName: row.rep_name,
        count: 0,
        sumBaseline: 0,
        sumCurrent: 0,
        sumDelta: 0,
        dealsMoving: 0,
        dealsFlat: 0,
      };
      velocityByRep.set(key, agg);
    }
    const baseline = Number.isFinite(row.baseline_score as number) && row.baseline_score != null ? Number(row.baseline_score) : 0;
    const current = Number.isFinite(row.current_score as number) && row.current_score != null ? Number(row.current_score) : 0;
    const delta = current - baseline;
    agg.count += 1;
    agg.sumBaseline += baseline;
    agg.sumCurrent += current;
    agg.sumDelta += delta;
    if (delta > 0) agg.dealsMoving += 1;
    if (delta === 0) agg.dealsFlat += 1;
  }

  const velocityRepSummaries: VelocityRepSummary[] = Array.from(velocityByRep.values()).map((agg) => ({
    repName: agg.repName,
    avgBaseline: agg.count ? agg.sumBaseline / agg.count : 0,
    avgCurrent: agg.count ? agg.sumCurrent / agg.count : 0,
    avgDelta: agg.count ? agg.sumDelta / agg.count : 0,
    dealsMoving: agg.dealsMoving,
    dealsFlat: agg.dealsFlat,
  }));

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
      COALESCE(
        NULLIF(btrim(r.display_name), ''),
        NULLIF(btrim(r.rep_name), ''),
        '(Unknown rep)'
      ) AS rep_name,
      oae.ts::text,
      oae.total_score
    FROM opportunity_audit_events oae
    JOIN opportunities opp ON opp.id = oae.opportunity_id
    JOIN reps r
      ON r.id = opp.rep_id
     AND COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
    WHERE oae.org_id = $1
      AND opp.org_id = $1
      AND opp.rep_id = ANY($4::bigint[])
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

  // Rep-level progression summary.
  type ProgressionRepSummary = {
    repName: string;
    progressing: number;
    stalled: number;
    flat: number;
    total: number;
  };

  const progressionByRep = new Map<string, ProgressionRepSummary>();

  for (const series of progressionSeries) {
    const key = series.rep_name;
    let agg = progressionByRep.get(key);
    if (!agg) {
      agg = { repName: series.rep_name, progressing: 0, stalled: 0, flat: 0, total: 0 };
      progressionByRep.set(key, agg);
    }
    const pts = series.points;
    const firstScore = pts.length ? (pts[0].score ?? 0) : 0;
    const lastScore = pts.length ? (pts[pts.length - 1].score ?? 0) : 0;
    const isProgressing = lastScore > firstScore;

    agg.total += 1;
    if (series.stalled) {
      agg.stalled += 1;
    } else if (isProgressing) {
      agg.progressing += 1;
    } else {
      agg.flat += 1;
    }
  }

  const progressionRepSummaries: ProgressionRepSummary[] = Array.from(progressionByRep.values());

  const quarterOptions = quotaPeriods.slice(0, 6).map((p) => {
    const fy = (p.fiscal_year || "").trim();
    const fq = (p.fiscal_quarter || "").trim();
    const label =
      fy && fq ? `Q${fq} ${fy}` : String(p.period_name || "").trim() || `${p.period_start} → ${p.period_end}`;
    return { value: p.id, label };
  });

  const selectedQuarterId = selectedPeriod?.id || "";

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
              name="quota_period_id"
              defaultValue={selectedQuarterId}
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
                        className={`px-2 py-1 text-center font-mono ${scoreColor(v)}`}
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
            Change from baseline total score to current score, summarized by rep.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-3 py-2 text-left">Rep</th>
                  <th className="px-3 py-2 text-right">Avg Baseline</th>
                  <th className="px-3 py-2 text-right">Avg Current</th>
                  <th className="px-3 py-2 text-right">Avg Delta</th>
                  <th className="px-3 py-2 text-right">Deals Moving</th>
                  <th className="px-3 py-2 text-right">Deals Flat</th>
                </tr>
              </thead>
              <tbody>
                {velocityRepSummaries.map((row, idx) => (
                  <tr key={`${row.repName}:${idx}`} className="border-t border-[color:var(--sf-border)]">
                    <td className="px-3 py-2 text-[color:var(--sf-text-primary)] whitespace-nowrap">{row.repName}</td>
                    <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                      {Number.isFinite(row.avgBaseline) ? row.avgBaseline.toFixed(1) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                      {Number.isFinite(row.avgCurrent) ? row.avgCurrent.toFixed(1) : "—"}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${deltaTextClass(row.avgDelta)}`}>
                      {Number.isFinite(row.avgDelta) ? row.avgDelta.toFixed(1) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                      {row.dealsMoving}
                    </td>
                    <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                      {row.dealsFlat}
                    </td>
                  </tr>
                ))}
                {!velocityRepSummaries.length && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-sm text-[color:var(--sf-text-secondary)]">
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
            Progression summary by rep. Deals with flat scores for 3+ events over 14+ days are flagged as stalled.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-3 py-2 text-left">Rep</th>
                  <th className="px-3 py-2 text-right">Progressing</th>
                  <th className="px-3 py-2 text-right">Stalled</th>
                  <th className="px-3 py-2 text-right">Flat</th>
                  <th className="px-3 py-2 text-right">Total Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {progressionRepSummaries.map((row, idx) => {
                  const stalledRatio = row.total ? row.stalled / row.total : 0;
                  const rowClass =
                    stalledRatio > 0.5 ? "border-l-4 border-red-400 bg-red-50" : "";
                  return (
                    <tr key={`${row.repName}:${idx}`} className={`border-t border-[color:var(--sf-border)] ${rowClass}`}>
                      <td className="px-3 py-2 text-[color:var(--sf-text-primary)] whitespace-nowrap">
                        {row.repName}
                      </td>
                      <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                        {row.progressing}
                      </td>
                      <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                        {row.stalled}
                      </td>
                      <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                        {row.flat}
                      </td>
                      <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                        {row.total}
                      </td>
                    </tr>
                  );
                })}
                {!progressionRepSummaries.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-sm text-[color:var(--sf-text-secondary)]">
                      No audit history found for this quarter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

