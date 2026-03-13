import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { pool } from "../../../lib/pool";
import { getScopedRepDirectory } from "../../../lib/repScope";
import { UserTopNav } from "../../_components/UserTopNav";
import { ForecastPeriodFiltersClient } from "../../forecast/_components/ForecastPeriodFiltersClient";
import { getExecutiveForecastDashboardSummary } from "../../../lib/executiveForecastDashboard";
import { ExecutiveGapInsightsClient } from "../../../components/dashboard/executive/ExecutiveGapInsightsClient";
import { ExecutiveTabsShellClient } from "../../components/dashboard/executive/ExecutiveTabsShellClient";
import { EXEC_TABS, setExecDefaultTabAction, type ExecTabKey } from "../../actions/execTabPreferences";

export const runtime = "nodejs";

function normalizeExecTab(raw: string | null | undefined): ExecTabKey | null {
  const v = String(raw || "").trim().toLowerCase();
  return EXEC_TABS.includes(v as ExecTabKey) ? (v as ExecTabKey) : null;
}

export default async function ExecutiveDashboardPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "ADMIN") redirect("/admin");
  if (ctx.user.role === "REP") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const summary = await getExecutiveForecastDashboardSummary({
    orgId: ctx.user.org_id,
    user: ctx.user,
    searchParams,
  });

  // Team Forecast Hygiene (Coverage, Assessment, Velocity, Progression) for Pipeline tab
  const orgId = ctx.user.org_id;
  const selectedPeriod = summary.selectedPeriod;
  const startIso =
    selectedPeriod?.period_start != null
      ? new Date(selectedPeriod.period_start).toISOString()
      : new Date(0).toISOString();
  const endIso =
    selectedPeriod?.period_end != null
      ? new Date(new Date(selectedPeriod.period_end).getTime() + 24 * 60 * 60 * 1000).toISOString()
      : new Date().toISOString();

  const scopedRole =
    ctx.user.role === "ADMIN" || ctx.user.role === "EXEC_MANAGER" || ctx.user.role === "MANAGER" || ctx.user.role === "REP"
      ? ctx.user.role
      : "MANAGER";
  const scope = await getScopedRepDirectory({
    orgId,
    userId: ctx.user.id,
    role: scopedRole,
  }).catch(() => ({
    repDirectory: [],
    allowedRepIds: null as number[] | null,
    myRepId: null as number | null,
  }));

  const visibleRepIds: number[] =
    scope.allowedRepIds !== null && scope.allowedRepIds.length > 0
      ? scope.allowedRepIds
      : scope.repDirectory.map((r) => r.id).filter((n) => Number.isFinite(n) && n > 0);
  const visibleRepIdsForQuery = visibleRepIds.length > 0 ? visibleRepIds : [-1];

  const repDirectory = scope.repDirectory;
  const childrenByManagerRepId = new Map<number, number[]>();
  for (const r of repDirectory) {
    if (r.manager_rep_id != null && repDirectory.some((x) => x.id === r.manager_rep_id)) {
      let arr = childrenByManagerRepId.get(r.manager_rep_id);
      if (!arr) {
        arr = [];
        childrenByManagerRepId.set(r.manager_rep_id, arr);
      }
      arr.push(r.id);
    }
  }
  const leaders = repDirectory
    .filter(
      (r) =>
        (r.role === "EXEC_MANAGER" || r.role === "MANAGER") &&
        (childrenByManagerRepId.get(r.id)?.length ?? 0) > 0
    )
    .map((r) => ({ id: r.id, display_name: r.name }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" }));

  function getSubtreeRepIds(rootRepId: number): number[] {
    const out: number[] = [rootRepId];
    const queue = [rootRepId];
    const visited = new Set([rootRepId]);
    while (queue.length > 0) {
      const rid = queue.shift()!;
      const children = childrenByManagerRepId.get(rid) ?? [];
      for (const c of children) {
        if (!visited.has(c)) {
          visited.add(c);
          out.push(c);
          queue.push(c);
        }
      }
    }
    return out;
  }

  const leaderRepIds = new Map<number, number[]>();
  for (const leader of leaders) {
    const repIds = getSubtreeRepIds(leader.id);
    if (repIds.length > 0) leaderRepIds.set(leader.id, repIds);
  }
  const leaderRepIdSet = new Set(Array.from(leaderRepIds.keys()).map((id) => id));

  type CoverageRow = {
    rep_id: number;
    rep_name: string;
    total_opps: number;
    reviewed_opps: number;
    coverage_pct: number | null;
  };

  let coverageRowsFinal: CoverageRow[] = [];
  try {
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
             AND oae.total_score IS NOT NULL
        )
      )::int AS reviewed_opps,
      ROUND(
        COUNT(opp.id) FILTER (
          WHERE EXISTS (
            SELECT 1
              FROM opportunity_audit_events oae
             WHERE oae.opportunity_id = opp.id
               AND oae.org_id = $1
               AND oae.total_score IS NOT NULL
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
      [orgId, startIso, endIso, visibleRepIdsForQuery]
    );

    const coverageRowsByRepId = new Map<number, CoverageRow>(
      (coverageRows ?? []).map((r) => [r.rep_id, r])
    );
    const leaderCoverageRows: CoverageRow[] = leaders
      .filter((l) => leaderRepIds.get(l.id)?.length)
      .map((leader) => {
        const repIds = leaderRepIds.get(leader.id)!;
        let total = 0;
        let reviewed = 0;
        for (const repId of repIds) {
          const row = coverageRowsByRepId.get(repId);
          if (row) {
            total += row.total_opps;
            reviewed += row.reviewed_opps;
          }
        }
        return {
          rep_id: -leader.id,
          rep_name: leader.display_name,
          total_opps: total,
          reviewed_opps: reviewed,
          coverage_pct: total > 0 ? Math.round((reviewed / total) * 100) : null,
        };
      });
    const coverageRowsFiltered = (coverageRows ?? []).filter((row) => !leaderRepIdSet.has(row.rep_id));
    coverageRowsFinal = [...leaderCoverageRows, ...coverageRowsFiltered];
  } catch (e) {
    console.error("[hygiene:coverage]", e);
  }

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

  let assessmentRowsFinal: AssessmentRow[] = [];
  try {
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
          AND oae.total_score IS NOT NULL
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
      [orgId, startIso, endIso, visibleRepIdsForQuery]
    );

    type AssessmentOppRow = {
      rep_id: number;
      pain_score: number | null;
      metrics_score: number | null;
      champion_score: number | null;
      eb_score: number | null;
      criteria_score: number | null;
      process_score: number | null;
      competition_score: number | null;
      paper_score: number | null;
      timing_score: number | null;
      budget_score: number | null;
      health_score: number | null;
    };

    const { rows: assessmentOppRows } = await pool.query<AssessmentOppRow>(
      `
      SELECT
        opp.rep_id,
        opp.pain_score,
        opp.metrics_score,
        opp.champion_score,
        opp.eb_score,
        opp.criteria_score,
        opp.process_score,
        opp.competition_score,
        opp.paper_score,
        opp.timing_score,
        opp.budget_score,
        opp.health_score
      FROM opportunities opp
      WHERE opp.rep_id = ANY($4::bigint[])
        AND opp.org_id = $1
        AND opp.close_date >= $2::timestamptz
        AND opp.close_date < $3::timestamptz
        AND EXISTS (
          SELECT 1 FROM opportunity_audit_events oae
          WHERE oae.opportunity_id = opp.id AND oae.org_id = $1
            AND oae.total_score IS NOT NULL
        )
      `,
      [orgId, startIso, endIso, visibleRepIdsForQuery]
    );

    const num = (v: number | null | undefined): number => (v != null && Number.isFinite(v) ? Number(v) : 0);

    const leaderAssessmentRows: AssessmentRow[] = leaders
      .filter((l) => leaderRepIds.get(l.id)?.length)
      .map((leader) => {
        const repIds = new Set(leaderRepIds.get(leader.id)!);
        const rows = (assessmentOppRows ?? []).filter((r) => repIds.has(r.rep_id));
        const n = rows.length;
        if (n === 0) {
          return {
            rep_id: -leader.id,
            rep_name: leader.display_name,
            pain: null,
            metrics: null,
            champion: null,
            eb: null,
            criteria: null,
            process: null,
            competition: null,
            paper: null,
            timing: null,
            budget: null,
            avg_total: null,
          };
        }
        const sum = (get: (r: AssessmentOppRow) => number | null) =>
          rows.reduce((a, r) => a + num(get(r)), 0);
        const avg = (get: (r: AssessmentOppRow) => number | null) =>
          Math.round(sum(get) / n);
        return {
          rep_id: -leader.id,
          rep_name: leader.display_name,
          pain: avg((r) => r.pain_score),
          metrics: avg((r) => r.metrics_score),
          champion: avg((r) => r.champion_score),
          eb: avg((r) => r.eb_score),
          criteria: avg((r) => r.criteria_score),
          process: avg((r) => r.process_score),
          competition: avg((r) => r.competition_score),
          paper: avg((r) => r.paper_score),
          timing: avg((r) => r.timing_score),
          budget: avg((r) => r.budget_score),
          avg_total: avg((r) => r.health_score),
        };
      });
    const assessmentRowsFiltered = (assessmentRows ?? []).filter((row) => !leaderRepIdSet.has(row.rep_id));
    assessmentRowsFinal = [...leaderAssessmentRows, ...assessmentRowsFiltered];
  } catch (e) {
    console.error("[hygiene:assessment]", e);
  }

  type VelocityRow = {
    opp_id: number;
    opp_name: string;
    rep_id: number;
    rep_name: string;
    baseline_score: number | null;
    current_score: number | null;
    delta: number | null;
  };

  let velocityRepSummariesFinal: VelocityRepSummary[] = [];
  try {
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
      AND EXISTS (
        SELECT 1 FROM opportunity_audit_events oae2
        WHERE oae2.opportunity_id = opp.id AND oae2.org_id = $1
          AND oae2.total_score IS NOT NULL
      )
    ORDER BY delta ASC NULLS LAST, rep_name ASC, opp_name ASC
      `,
      [orgId, startIso, endIso, visibleRepIdsForQuery]
    );

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

    const leaderVelocityRows: VelocityRepSummary[] = leaders
      .filter((l) => leaderRepIds.get(l.id)?.length)
      .map((leader) => {
        const repIds = leaderRepIds.get(leader.id)!;
        let count = 0;
        let sumBaseline = 0;
        let sumCurrent = 0;
        let sumDelta = 0;
        let dealsMoving = 0;
        let dealsFlat = 0;
        for (const row of velocityRows) {
          if (!repIds.includes(row.rep_id)) continue;
          count += 1;
          const b = num(row.baseline_score);
          const c = num(row.current_score);
          const d = (row.delta != null && Number.isFinite(row.delta)) ? Number(row.delta) : c - b;
          sumBaseline += b;
          sumCurrent += c;
          sumDelta += d;
          if (d > 0) dealsMoving += 1;
          if (d === 0) dealsFlat += 1;
        }
        return {
          repName: leader.display_name,
          avgBaseline: count ? sumBaseline / count : 0,
          avgCurrent: count ? sumCurrent / count : 0,
          avgDelta: count ? sumDelta / count : 0,
          dealsMoving,
          dealsFlat,
        };
      });
    const velocityRepSummariesFiltered: VelocityRepSummary[] = velocityRepSummaries.filter((row) => {
      return !leaders.some((l) => row.repName === l.display_name);
    });
    velocityRepSummariesFinal = [...leaderVelocityRows, ...velocityRepSummariesFiltered];
  } catch (e) {
    console.error("[hygiene:velocity]", e);
  }

  type ProgressionRow = {
    opportunity_id: number;
    opp_name: string;
    rep_id: number;
    rep_name: string;
    ts: string;
    total_score: number | null;
  };

  let progressionRepSummariesFinal: ProgressionRepSummary[] = [];
  try {
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
      [orgId, startIso, endIso, visibleRepIdsForQuery]
    );

    type ProgressionSeries = {
      opportunity_id: number;
      opp_name: string;
      rep_id: number;
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
          rep_id: row.rep_id,
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

    type ProgressionRepSummary = {
      repName: string;
      progressing: number;
      stalled: number;
      flat: number;
      total: number;
    };

    const progressionByRepId = new Map<number, ProgressionRepSummary>();

    for (const series of progressionSeries) {
      const key = series.rep_id;
      let agg = progressionByRepId.get(key);
      if (!agg) {
        agg = { repName: series.rep_name, progressing: 0, stalled: 0, flat: 0, total: 0 };
        progressionByRepId.set(key, agg);
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

    const progressionRepSummaries: ProgressionRepSummary[] = Array.from(progressionByRepId.values());

    const leaderProgressionRows: ProgressionRepSummary[] = leaders
      .filter((l) => leaderRepIds.get(l.id)?.length)
      .map((leader) => {
        const repIds = leaderRepIds.get(leader.id)!;
        let progressing = 0;
        let stalled = 0;
        let flat = 0;
        let total = 0;
        for (const repId of repIds) {
          const s = progressionByRepId.get(repId);
          if (s) {
            progressing += s.progressing;
            stalled += s.stalled;
            flat += s.flat;
            total += s.total;
          }
        }
        return {
          repName: leader.display_name,
          progressing,
          stalled,
          flat,
          total,
        };
      });
    const progressionRepSummariesFiltered: ProgressionRepSummary[] = progressionRepSummaries.filter((row) => {
      return !leaders.some((l) => row.repName === l.display_name);
    });
    progressionRepSummariesFinal = [
      ...leaderProgressionRows,
      ...progressionRepSummariesFiltered,
    ];
  } catch (e) {
    console.error("[hygiene:progression]", e);
  }

  // Determine active tab: URL param > user preference > forecast
  const search = searchParams || {};
  const tabRaw = Array.isArray(search.tab) ? search.tab[0] : search.tab;
  const tabParam = normalizeExecTab(tabRaw);
  let prefTab: ExecTabKey | null = null;
  try {
    const prefRows = await pool.query<{ user_preferences: any }>(
      `SELECT user_preferences FROM users WHERE id = $1::bigint`,
      [ctx.user.id]
    );
    const prefs = (prefRows.rows?.[0]?.user_preferences as any) || {};
    prefTab = normalizeExecTab(prefs.exec_default_tab);
  } catch {
    prefTab = null;
  }
  const activeTab: ExecTabKey = tabParam || prefTab || "forecast";

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6 num-tabular">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-pageTitle text-[color:var(--sf-text-primary)]">Executive Dashboard</h1>
          </div>
        </div>

        <div className="mt-4">
          <ForecastPeriodFiltersClient
            basePath="/dashboard/executive"
            fiscalYears={summary.fiscalYearsSorted}
            periods={summary.periods}
            selectedFiscalYear={summary.selectedFiscalYear}
            selectedPeriodId={summary.selectedQuotaPeriodId}
          />
        </div>

        <div className="mt-4 grid gap-4">
          <ExecutiveGapInsightsClient
            basePath="/dashboard/executive"
            periods={summary.periods}
            quotaPeriodId={summary.selectedQuotaPeriodId}
            reps={summary.reps}
            fiscalYear={String(summary.selectedPeriod?.fiscal_year || summary.selectedFiscalYear || "").trim() || "—"}
            fiscalQuarter={String(summary.selectedPeriod?.fiscal_quarter || "").trim() || "—"}
            stageProbabilities={summary.stageProbabilities}
            healthModifiers={summary.healthModifiers}
            repDirectory={summary.repDirectory}
            myRepId={summary.myRepId}
            repRollups={summary.repRollups}
            productsClosedWon={summary.productsClosedWon}
            productsClosedWonPrevSummary={summary.productsClosedWonPrevSummary}
            productsClosedWonByRep={summary.productsClosedWonByRep}
            quarterKpis={summary.quarterKpis}
            pipelineMomentum={summary.pipelineMomentum}
            crmTotals={summary.crmForecast}
            partnersExecutive={summary.partnersExecutive}
            quota={summary.quota}
            aiForecast={summary.aiForecast.weighted_forecast}
            crmForecast={summary.crmForecast.weighted_forecast}
            gap={summary.forecastGap}
            bucketDeltas={{
              commit: summary.bucketDeltas.commit,
              best_case: summary.bucketDeltas.best_case,
              pipeline: summary.bucketDeltas.pipeline,
            }}
            aiPctToGoal={summary.pctToGoal}
            leftToGo={summary.leftToGo}
            commitAdmission={summary.commitAdmission}
            commitDealPanels={summary.commitDealPanels}
            defaultTopN={5}
          />
        </div>

        <ExecutiveTabsShellClient
          basePath="/dashboard/executive"
          initialTab={activeTab}
          setDefaultTab={setExecDefaultTabAction}
          forecastTabProps={{
            basePath: "/dashboard/executive",
            periods: summary.periods,
            quotaPeriodId: summary.selectedQuotaPeriodId,
            reps: summary.reps,
            fiscalYear: String(summary.selectedPeriod?.fiscal_year || summary.selectedFiscalYear || "").trim() || "—",
            fiscalQuarter: String(summary.selectedPeriod?.fiscal_quarter || "").trim() || "—",
            stageProbabilities: summary.stageProbabilities,
            healthModifiers: summary.healthModifiers,
            repDirectory: summary.repDirectory,
            myRepId: summary.myRepId,
            repRollups: summary.repRollups,
            productsClosedWon: summary.productsClosedWon,
            productsClosedWonPrevSummary: summary.productsClosedWonPrevSummary,
            productsClosedWonByRep: summary.productsClosedWonByRep,
            quarterKpis: summary.quarterKpis,
            pipelineMomentum: summary.pipelineMomentum,
            crmTotals: summary.crmForecast,
            partnersExecutive: summary.partnersExecutive,
            quota: summary.quota,
            aiForecast: summary.aiForecast.weighted_forecast,
            crmForecast: summary.crmForecast.weighted_forecast,
            gap: summary.forecastGap,
            bucketDeltas: {
              commit: summary.bucketDeltas.commit,
              best_case: summary.bucketDeltas.best_case,
              pipeline: summary.bucketDeltas.pipeline,
            },
            aiPctToGoal: summary.pctToGoal,
            leftToGo: summary.leftToGo,
            commitAdmission: summary.commitAdmission,
            commitDealPanels: summary.commitDealPanels,
            defaultTopN: 5,
          }}
          pipelineTabProps={{
            basePath: "/dashboard/executive",
            periods: summary.periods,
            quotaPeriodId: summary.selectedQuotaPeriodId,
            reps: summary.reps,
            fiscalYear: String(summary.selectedPeriod?.fiscal_year || summary.selectedFiscalYear || "").trim() || "—",
            fiscalQuarter: String(summary.selectedPeriod?.fiscal_quarter || "").trim() || "—",
            stageProbabilities: summary.stageProbabilities,
            healthModifiers: summary.healthModifiers,
            repDirectory: summary.repDirectory,
            myRepId: summary.myRepId,
            repRollups: summary.repRollups,
            productsClosedWon: summary.productsClosedWon,
            productsClosedWonPrevSummary: summary.productsClosedWonPrevSummary,
            productsClosedWonByRep: summary.productsClosedWonByRep,
            quarterKpis: summary.quarterKpis,
            pipelineMomentum: summary.pipelineMomentum,
            crmTotals: summary.crmForecast,
            partnersExecutive: summary.partnersExecutive,
            quota: summary.quota,
            aiForecast: summary.aiForecast.weighted_forecast,
            crmForecast: summary.crmForecast.weighted_forecast,
            gap: summary.forecastGap,
            bucketDeltas: {
              commit: summary.bucketDeltas.commit,
              best_case: summary.bucketDeltas.best_case,
              pipeline: summary.bucketDeltas.pipeline,
            },
            aiPctToGoal: summary.pctToGoal,
            leftToGo: summary.leftToGo,
            commitAdmission: summary.commitAdmission,
            commitDealPanels: summary.commitDealPanels,
            defaultTopN: 5,
          }}
          pipelineHygiene={{
            coverageRows: coverageRowsFinal,
            assessmentRows: assessmentRowsFinal,
            velocitySummaries: velocityRepSummariesFinal,
            progressionSummaries: progressionRepSummariesFinal,
          }}
        />
      </main>
    </div>
  );
}

