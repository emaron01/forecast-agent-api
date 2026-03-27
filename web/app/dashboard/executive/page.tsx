import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { pool } from "../../../lib/pool";
import { getScopedRepDirectory } from "../../../lib/repScope";
import { UserTopNav } from "../../_components/UserTopNav";
import { ForecastPeriodFiltersClient } from "../../forecast/_components/ForecastPeriodFiltersClient";
import { getExecutiveForecastDashboardSummary } from "../../../lib/executiveForecastDashboard";
import { ExecutiveGapInsightsClient } from "../../../components/dashboard/executive/ExecutiveGapInsightsClient";
import { ExecutiveBriefingProvider } from "../../../components/dashboard/executive/ExecutiveBriefingContext";
import { ExecutiveTabsShellClient } from "../../components/dashboard/executive/ExecutiveTabsShellClient";
import type {
  RepManagerManagerRow,
  RepManagerRepRow,
} from "../../components/dashboard/executive/RepManagerComparisonPanel";
import { EXEC_TABS, normalizeExecTab, type ExecTabKey } from "../../actions/execTabConstants";
import { setExecDefaultTabAction } from "../../actions/execTabPreferences";
import {
  getCreatedByRep,
  getQuotaByRepPeriod,
  getRepKpisByPeriod,
} from "../../../lib/executiveRepKpis";
import {
  loadChannelLedFedRows,
  loadChannelPartnerHeroProps,
  type ChannelLedFedRow,
  type ChannelPartnerHeroProps,
} from "../../../lib/channelPartnerHeroData";
import { getHealthAveragesByRepByPeriods } from "../../../lib/analyticsHealth";
import { getMeddpiccAveragesByRepByPeriods } from "../../../lib/meddpiccHealth";

export const runtime = "nodejs";

console.log("[ExecutiveDashboardPage module loaded]");

export default async function ExecutiveDashboardPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  try {
    const ctx = await requireAuth();
    if (ctx.kind === "master") redirect("/admin/organizations");
    if (ctx.user.role === "ADMIN") redirect("/admin");
    if (ctx.user.role === "REP" || ctx.user.role === "CHANNEL_REP") redirect("/dashboard");

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
    const pipelineQuarterIds = selectedPeriod?.period_start
      ? summary.periods
          .slice()
          .filter((p) => new Date(p.period_start).getTime() >= new Date(selectedPeriod.period_start).getTime())
          .sort((a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime())
          .slice(0, 3)
          .map((p) => String(p.id))
      : selectedPeriod?.id != null
        ? [String(selectedPeriod.id)]
        : [];

    const scopedRole =
      ctx.user.role === "ADMIN" ||
      ctx.user.role === "EXEC_MANAGER" ||
      ctx.user.role === "MANAGER" ||
      ctx.user.role === "REP" ||
      ctx.user.role === "CHANNEL_EXECUTIVE" ||
      ctx.user.role === "CHANNEL_DIRECTOR" ||
      ctx.user.role === "CHANNEL_REP"
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
    /** Hygiene tables: exclude leaders from peer rep rows; they only appear as rollup rows (negative rep_id). */
    const managerRoleRepIds = new Set(
      repDirectory
        .filter((r) => r.role === "EXEC_MANAGER" || r.role === "MANAGER")
        .map((r) => r.id)
    );

    /** Only REP / MANAGER / EXEC_MANAGER â€” excludes channel roles (and any other rep.role values). */
    const hygieneRepRoleSql = `AND r.role IN ('REP', 'MANAGER', 'EXEC_MANAGER')`;

    type CoverageRow = {
      rep_id: number;
      rep_name: string;
      total_opps: number;
      reviewed_opps: number;
      coverage_pct: number | null;
    };

    type VelocityRepSummary = {
      repId: number;
      repName: string;
      avgBaseline: number;
      avgCurrent: number;
      avgDelta: number;
      dealsMoving: number;
      dealsFlat: number;
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
             AND oae.source = 'matthew'
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
               AND oae.source = 'matthew'
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
      ${hygieneRepRoleSql}
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
      const coverageRowsFiltered = (coverageRows ?? []).filter(
        (row) => row.rep_id > 0 && !managerRoleRepIds.has(row.rep_id)
      );
      coverageRowsFinal = [...coverageRowsFiltered, ...leaderCoverageRows];
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
      ROUND((
        AVG(opp.pain_score) +
        AVG(opp.metrics_score) +
        AVG(opp.champion_score) +
        AVG(opp.eb_score) +
        AVG(opp.criteria_score) +
        AVG(opp.process_score) +
        AVG(opp.competition_score) +
        AVG(opp.paper_score) +
        AVG(opp.timing_score) +
        AVG(opp.budget_score)
      ) / 10.0) AS avg_total
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
      ${hygieneRepRoleSql}
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
      JOIN reps r_h ON r_h.id = opp.rep_id
        AND COALESCE(r_h.organization_id, r_h.org_id::bigint) = $1::bigint
      WHERE opp.rep_id = ANY($4::bigint[])
        AND opp.org_id = $1
        AND opp.close_date >= $2::timestamptz
        AND opp.close_date < $3::timestamptz
        AND r_h.role IN ('REP', 'MANAGER', 'EXEC_MANAGER')
        AND EXISTS (
          SELECT 1 FROM opportunity_audit_events oae
          WHERE oae.opportunity_id = opp.id AND oae.org_id = $1
            AND oae.total_score IS NOT NULL
        )
      `,
      [orgId, startIso, endIso, visibleRepIdsForQuery]
    );

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
        /** SQL AVG(x): mean of non-null values; empty set â†’ null (matches assessment SQL). */
        const sqlAvg = (get: (r: AssessmentOppRow) => number | null): number | null => {
          const vals = rows.map(get).filter((v) => v != null && Number.isFinite(Number(v)));
          if (!vals.length) return null;
          return vals.reduce((a, v) => a + Number(v), 0) / vals.length;
        };
        const mPain = sqlAvg((r) => r.pain_score);
        const mMetrics = sqlAvg((r) => r.metrics_score);
        const mChampion = sqlAvg((r) => r.champion_score);
        const mEb = sqlAvg((r) => r.eb_score);
        const mCriteria = sqlAvg((r) => r.criteria_score);
        const mProcess = sqlAvg((r) => r.process_score);
        const mCompetition = sqlAvg((r) => r.competition_score);
        const mPaper = sqlAvg((r) => r.paper_score);
        const mTiming = sqlAvg((r) => r.timing_score);
        const mBudget = sqlAvg((r) => r.budget_score);
        const categoryMeans = [
          mPain,
          mMetrics,
          mChampion,
          mEb,
          mCriteria,
          mProcess,
          mCompetition,
          mPaper,
          mTiming,
          mBudget,
        ];
        const avgTotal =
          categoryMeans.every((v) => v != null && Number.isFinite(v))
            ? Math.round(categoryMeans.reduce((a, b) => a + b!, 0) / 10)
            : null;
        const roundCol = (m: number | null) => (m != null && Number.isFinite(m) ? Math.round(m) : null);
        return {
          rep_id: -leader.id,
          rep_name: leader.display_name,
          pain: roundCol(mPain),
          metrics: roundCol(mMetrics),
          champion: roundCol(mChampion),
          eb: roundCol(mEb),
          criteria: roundCol(mCriteria),
          process: roundCol(mProcess),
          competition: roundCol(mCompetition),
          paper: roundCol(mPaper),
          timing: roundCol(mTiming),
          budget: roundCol(mBudget),
          avg_total: avgTotal,
        };
      });
    const assessmentRowsFiltered = (assessmentRows ?? []).filter(
      (row) => row.rep_id > 0 && !managerRoleRepIds.has(row.rep_id)
    );
    assessmentRowsFinal = [...assessmentRowsFiltered, ...leaderAssessmentRows];
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

  function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

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
      last_event.total_score AS current_score,
      (last_event.total_score - first_event.total_score) AS delta
    FROM opportunities opp
    JOIN reps r
      ON r.id = opp.rep_id
     AND COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
     ${hygieneRepRoleSql}
    JOIN LATERAL (
      SELECT total_score
      FROM opportunity_audit_events
      WHERE opportunity_id = opp.id
        AND org_id = $1
        AND total_score IS NOT NULL
      ORDER BY ts ASC, id ASC
      LIMIT 1
    ) first_event ON true
    JOIN LATERAL (
      SELECT total_score
      FROM opportunity_audit_events
      WHERE opportunity_id = opp.id
        AND org_id = $1
        AND total_score IS NOT NULL
      ORDER BY ts DESC, id DESC
      LIMIT 1
    ) last_event ON true
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

    const velocityByRep = new Map<string, {
      repId: number;
      repName: string;
      count: number;
      sumBaseline: number;
      sumCurrent: number;
      sumDelta: number;
      dealsMoving: number;
      dealsFlat: number;
    }>();

    for (const row of velocityRows) {
      if (managerRoleRepIds.has(row.rep_id)) continue;
      const key = `${row.rep_id}:${row.rep_name}`;
      let agg = velocityByRep.get(key);
      if (!agg) {
        agg = {
          repId: row.rep_id,
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
      repId: agg.repId,
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
          if (managerRoleRepIds.has(row.rep_id)) continue;
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
          repId: -leader.id,
          repName: leader.display_name,
          avgBaseline: count ? sumBaseline / count : 0,
          avgCurrent: count ? sumCurrent / count : 0,
          avgDelta: count ? sumDelta / count : 0,
          dealsMoving,
          dealsFlat,
        };
      });
    velocityRepSummariesFinal = [...velocityRepSummaries, ...leaderVelocityRows];
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

  type ProgressionSeries = {
    opp_id: string;
    opp_name: string;
    rep_id: number;
    rep_name: string;
    scores: { ts: string; score: number }[];
  };

  type ProgressionRepSummary = {
    repId: number;
    repName: string;
    progressing: number;
    stalled: number;
    flat: number;
    total: number;
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
     ${hygieneRepRoleSql}
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
      if (managerRoleRepIds.has(row.rep_id)) continue;
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

    type ProgressionRepAgg = {
      repName: string;
      progressing: number;
      stalled: number;
      flat: number;
      total: number;
    };

    const progressionByRepId = new Map<number, ProgressionRepAgg>();

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

    const progressionRepSummaries: ProgressionRepSummary[] = Array.from(progressionByRepId.entries()).map(
      ([repId, agg]) => ({
        repId,
        repName: agg.repName,
        progressing: agg.progressing,
        stalled: agg.stalled,
        flat: agg.flat,
        total: agg.total,
      })
    );

    const leaderProgressionRows: ProgressionRepSummary[] = leaders
      .filter((l) => leaderRepIds.get(l.id)?.length)
      .map((leader) => {
        const repIds = leaderRepIds.get(leader.id)!;
        let progressing = 0;
        let stalled = 0;
        let flat = 0;
        let total = 0;
        for (const repId of repIds) {
          if (managerRoleRepIds.has(repId)) continue;
          const s = progressionByRepId.get(repId);
          if (s) {
            progressing += s.progressing;
            stalled += s.stalled;
            flat += s.flat;
            total += s.total;
          }
        }
        return {
          repId: -leader.id,
          repName: leader.display_name,
          progressing,
          stalled,
          flat,
          total,
        };
      });
    progressionRepSummariesFinal = [...progressionRepSummaries, ...leaderProgressionRows];
  } catch (e) {
    console.error("[hygiene:progression]", e);
  }

  // Rep & Manager comparison data for Team tab (same shape as analytics/executive)
  const selectedPeriodId = summary.selectedQuotaPeriodId ? String(summary.selectedQuotaPeriodId) : "";
  const selectedPeriodForTeam = summary.selectedPeriod ?? null;
  const periodsSortedByStartDesc = [...(summary.periods || [])].sort(
    (a, b) => new Date(String(b.period_start)).getTime() - new Date(String(a.period_start)).getTime()
  );
  const prevPeriod =
    selectedPeriodForTeam && periodsSortedByStartDesc.length
      ? periodsSortedByStartDesc.find(
          (p) => new Date(String(p.period_start)).getTime() < new Date(String(selectedPeriodForTeam.period_start)).getTime()
        ) ?? null
      : null;
  const prevPeriodId = prevPeriod ? String(prevPeriod.id) : "";
  const comparePeriodIds = [selectedPeriodId, prevPeriodId].filter(Boolean);
  const scopeRepIdsForTeam = visibleRepIds.length > 0 ? visibleRepIds : null;

  // Rep directory for Report Builder:
  // - exclude Channel roles
  // - keep only REP / MANAGER / EXEC_MANAGER
  // - sort/group as EXEC_MANAGER -> MANAGER (under their exec) -> REP (under their manager)
  const directoryInScope = (() => {
    type BuilderDirRow = {
      id: number;
      name: string;
      manager_rep_id: number | null;
      role: string;
    };

    const filtered: BuilderDirRow[] = repDirectory
      .map((r) => {
        const role = String(r.role || "").trim();
        return {
          id: r.id,
          name: r.name,
          manager_rep_id: r.manager_rep_id ?? null,
          role,
        };
      })
      .filter((r) => {
        if (!r.role) return false;
        if (r.role.includes("CHANNEL")) return false;
        return r.role === "REP" || r.role === "MANAGER" || r.role === "EXEC_MANAGER";
      });

    const execs = filtered
      .filter((r) => r.role === "EXEC_MANAGER")
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
    const managers = filtered
      .filter((r) => r.role === "MANAGER")
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
    const reps = filtered
      .filter((r) => r.role === "REP")
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

    const execIds = new Set<number>(execs.map((e) => e.id));
    const managerIds = new Set<number>(managers.map((m) => m.id));

    const managersByExecId = new Map<number, BuilderDirRow[]>();
    const orphanManagers: BuilderDirRow[] = [];
    for (const m of managers) {
      if (m.manager_rep_id != null && execIds.has(m.manager_rep_id)) {
        const arr = managersByExecId.get(m.manager_rep_id) || [];
        arr.push(m);
        managersByExecId.set(m.manager_rep_id, arr);
      } else {
        orphanManagers.push(m);
      }
    }

    const repsByManagerId = new Map<number, BuilderDirRow[]>();
    const orphanReps: BuilderDirRow[] = [];
    for (const r of reps) {
      if (r.manager_rep_id != null && managerIds.has(r.manager_rep_id)) {
        const arr = repsByManagerId.get(r.manager_rep_id) || [];
        arr.push(r);
        repsByManagerId.set(r.manager_rep_id, arr);
      } else {
        orphanReps.push(r);
      }
    }

    const out: BuilderDirRow[] = [];
    for (const exec of execs) {
      out.push({
        id: exec.id,
        name: exec.name,
        manager_rep_id: exec.manager_rep_id ?? null,
        role: exec.role,
      });

      const execManagers = (managersByExecId.get(exec.id) || []).slice();
      execManagers.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

      for (const mgr of execManagers) {
        out.push({
          id: mgr.id,
          name: mgr.name,
          manager_rep_id: mgr.manager_rep_id ?? null,
          role: mgr.role,
        });

        const mgrReps = (repsByManagerId.get(mgr.id) || []).slice();
        mgrReps.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

        for (const rep of mgrReps) {
          out.push({
            id: rep.id,
            name: rep.name,
            manager_rep_id: rep.manager_rep_id ?? null,
            role: rep.role,
          });
        }
      }
    }

    orphanManagers.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
    for (const mgr of orphanManagers) {
      out.push({
        id: mgr.id,
        name: mgr.name,
        manager_rep_id: mgr.manager_rep_id ?? null,
        role: mgr.role,
      });

      const mgrReps = (repsByManagerId.get(mgr.id) || []).slice();
      mgrReps.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
      for (const rep of mgrReps) {
        out.push({
          id: rep.id,
          name: rep.name,
          manager_rep_id: rep.manager_rep_id ?? null,
          role: rep.role,
        });
      }
    }

    orphanReps.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
    for (const rep of orphanReps) {
      out.push({
        id: rep.id,
        name: rep.name,
        manager_rep_id: rep.manager_rep_id ?? null,
        role: rep.role,
      });
    }

    return out;
  })();

  const periodLabel = selectedPeriodForTeam?.period_name ?? "Current Period";

  let reportBuilderRepRows: any[] = [];
  try {
    if (selectedPeriodId && visibleRepIds.length > 0) {
      const repIdsFilter = visibleRepIds;
      const periodIds = [String(selectedPeriodId)];
      const [repKpisRows, quotaByRepPeriod, repHealthRows, meddpiccRows] = await Promise.all([
        getRepKpisByPeriod({ orgId, periodIds, repIds: repIdsFilter }),
        getQuotaByRepPeriod({ orgId, quotaPeriodIds: periodIds, repIds: repIdsFilter }),
        getHealthAveragesByRepByPeriods({
          orgId,
          periodIds,
          repIds: repIdsFilter,
          dateStart: null,
          dateEnd: null,
        }),
        getMeddpiccAveragesByRepByPeriods({
          orgId,
          periodIds,
          repIds: repIdsFilter,
          dateStart: null,
          dateEnd: null,
        }),
      ]);

      const quotaByRep = new Map<string, number>();
      for (const q of quotaByRepPeriod) {
        if (String(q.quota_period_id) === String(selectedPeriodId)) {
          quotaByRep.set(String(q.rep_id), Number(q.quota_amount || 0) || 0);
        }
      }

      const healthByRepId = new Map<string, any>();
      for (const r of repHealthRows || []) healthByRepId.set(String((r as any).rep_id), r);

      const meddpiccByRepId = new Map<string, any>();
      for (const r of meddpiccRows || []) meddpiccByRepId.set(String((r as any).rep_id), r);

      const kpisByRepId = new Map<string, any>();
      for (const c of repKpisRows || []) {
        if (String(c.quota_period_id) === String(selectedPeriodId)) {
          kpisByRepId.set(String((c as any).rep_id), c);
        }
      }

      const rbRepIdToManagerId = new Map<string, string>();
      const rbManagerNameById = new Map<string, string>();
      for (const r of directoryInScope) {
        rbRepIdToManagerId.set(String(r.id), r.manager_rep_id == null ? "" : String(r.manager_rep_id));
      }
      for (const r of directoryInScope) {
        if (r.manager_rep_id != null) {
          const mid = String(r.manager_rep_id);
          if (!rbManagerNameById.has(mid)) {
            const m = directoryInScope.find((x) => String(x.id) === mid);
            rbManagerNameById.set(mid, m ? m.name : `Manager ${mid}`);
          }
        }
      }

      function safeDivRb(n: number, d: number) {
        if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
        return n / d;
      }

      reportBuilderRepRows = directoryInScope.map((opt: any) => {
        const rep_id = String(opt.id);
        const c: any = kpisByRepId.get(rep_id) || null;
        const quota = quotaByRep.get(rep_id) || 0;
        const won_amount = Number(c?.won_amount || 0) || 0;
        const won_count = Number(c?.won_count || 0) || 0;
        const lost_count = Number(c?.lost_count || 0) || 0;
        const active_amount = Number(c?.active_amount || 0) || 0;
        const total_count = Number(c?.total_count || 0) || 0;
        const manager_id = rbRepIdToManagerId.get(rep_id) || "";
        const manager_name = manager_id ? rbManagerNameById.get(manager_id) || `Manager ${manager_id}` : "(Unassigned)";
        const mh: any = meddpiccByRepId.get(rep_id) || null;

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
          avg_pain: mh?.avg_pain ?? null,
          avg_metrics: mh?.avg_metrics ?? null,
          avg_champion: mh?.avg_champion ?? null,
          avg_eb: mh?.avg_eb ?? null,
          avg_competition: mh?.avg_competition ?? null,
          avg_criteria: mh?.avg_criteria ?? null,
          avg_process: mh?.avg_process ?? null,
          avg_paper: mh?.avg_paper ?? null,
          avg_timing: mh?.avg_timing ?? null,
          avg_budget: mh?.avg_budget ?? null,
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
          win_rate: safeDivRb(won_count, won_count + lost_count),
          opp_to_win: safeDivRb(won_count, total_count),
          aov: safeDivRb(won_amount, won_count),
          attainment: safeDivRb(won_amount, quota),
          commit_coverage: safeDivRb(commit_amount, quota),
          best_coverage: safeDivRb(best_amount, quota),
          partner_contribution: safeDivRb(Number(c?.partner_closed_amount || 0) || 0, Number(c?.closed_amount || 0) || 0),
          partner_win_rate: safeDivRb(Number(c?.partner_won_count || 0) || 0, Number(c?.partner_closed_count || 0) || 0),
          avg_days_won: c?.avg_days_won == null ? null : Number(c.avg_days_won),
          avg_days_lost: c?.avg_days_lost == null ? null : Number(c.avg_days_lost),
          avg_days_active: c?.avg_days_active == null ? null : Number(c.avg_days_active),
          mix_pipeline: safeDivRb(pipeline_amount, mixDen),
          mix_best: safeDivRb(best_amount, mixDen),
          mix_commit: safeDivRb(commit_amount, mixDen),
          mix_won: safeDivRb(won_amount, mixDen),
        };
      });

      reportBuilderRepRows.sort(
        (a: any, b: any) =>
          Number(b.won_amount || 0) - Number(a.won_amount || 0) || String(a.rep_name).localeCompare(String(b.rep_name))
      );
    }
  } catch {
    reportBuilderRepRows = [];
  }

  let reportBuilderSavedReports: any[] = [];
  try {
    const { rows: saved } = await pool.query(
      `
      SELECT id::text AS id, report_type, name, description, config, created_at::text AS created_at, updated_at::text AS updated_at
      FROM analytics_saved_reports
      WHERE owner_user_id = $1::bigint
        AND org_id = $2::bigint
        AND report_type = 'rep_comparison_custom_v1'
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 100
      `,
      [ctx.user.id, orgId]
    );
    reportBuilderSavedReports = saved || [];
  } catch {
    reportBuilderSavedReports = [];
  }

  const repIdToManagerId = new Map<string, string>();
  const managerNameById = new Map<string, string>();
  for (const r of repDirectory) {
    const id = String(r.id);
    repIdToManagerId.set(id, r.manager_rep_id != null ? String(r.manager_rep_id) : "");
    managerNameById.set(id, String(r.name || "").trim() || `Rep ${r.id}`);
  }
  for (const r of repDirectory) {
    if (r.role === "EXEC_MANAGER" || r.role === "MANAGER") {
      const id = String(r.id);
      if (!managerNameById.has(id)) managerNameById.set(id, String(r.name || "").trim() || `Manager ${r.id}`);
    }
  }

  let teamRepRows: RepManagerRepRow[] = [];
  let teamManagerRows: RepManagerManagerRow[] = [];
  let teamRepsByManager = new Map<string, RepManagerRepRow[]>();
  let teamOrderedManagerIds: string[] = [];

  const showManagerReviewQueue =
    ctx.user.role === "MANAGER" || ctx.user.role === "EXEC_MANAGER" || ctx.user.role === "ADMIN";
  type ReviewQueueDealRow = {
    id: string;
    opp_name: string | null;
    account_name: string | null;
    rep_name: string | null;
    health_score: number | null;
    forecast_stage: string | null;
    amount: number | null;
    last_reviewed_at: string | null;
    score_before_request: number | null;
    score_after_request: number | null;
    reviewed_after_at: string | null;
    review_requested_by: number | null;
    review_requested_at: string | null;
    review_request_note: string | null;
    requester_name: string | null;
  };
  let reviewQueueDeals: ReviewQueueDealRow[] = [];
  if (showManagerReviewQueue && selectedPeriod && visibleRepIdsForQuery.length > 0) {
    try {
      const { rows } = await pool.query<ReviewQueueDealRow>(
        `
        SELECT
          o.public_id::text AS id,
          COALESCE(NULLIF(btrim(o.opportunity_name), ''), NULLIF(btrim(o.account_name), '')) AS opp_name,
          o.account_name,
          COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), '(Unknown)') AS rep_name,
          o.health_score,
          o.forecast_stage,
          o.amount,
          score_before.total_score AS score_before_request,
          score_after.total_score AS score_after_request,
          score_after.reviewed_at AS reviewed_after_at,
          o.review_requested_by,
          o.review_requested_at::text AS review_requested_at,
          o.review_request_note,
          u.display_name AS requester_name,
          MAX(oae.ts)::text AS last_reviewed_at
        FROM opportunities o
        JOIN reps r ON r.id = o.rep_id
        LEFT JOIN users u ON u.id = o.review_requested_by
        LEFT JOIN opportunity_audit_events oae
          ON oae.opportunity_id = o.id
          AND oae.org_id = $1::bigint
          AND oae.total_score IS NOT NULL
        LEFT JOIN LATERAL (
          SELECT sb.total_score
          FROM opportunity_audit_events sb
          WHERE sb.opportunity_id = o.id
            AND sb.org_id = $1::bigint
            AND sb.total_score IS NOT NULL
            AND sb.ts <= o.review_requested_at
          ORDER BY sb.ts DESC, sb.id DESC
          LIMIT 1
        ) score_before ON true
        LEFT JOIN LATERAL (
          SELECT sa.total_score, sa.ts::text AS reviewed_at
          FROM opportunity_audit_events sa
          WHERE sa.opportunity_id = o.id
            AND sa.org_id = $1::bigint
            AND sa.total_score IS NOT NULL
          ORDER BY sa.ts DESC, sa.id DESC
          LIMIT 1
        ) score_after ON true
        WHERE o.org_id = $1::bigint
          AND o.rep_id = ANY($2::bigint[])
          AND o.close_date >= $3::date
          AND o.close_date < $4::date
          AND (
            o.sales_stage IS NULL
            OR (
              o.sales_stage NOT ILIKE '%closed%'
              AND o.sales_stage NOT ILIKE '%won%'
              AND o.sales_stage NOT ILIKE '%lost%'
            )
          )
          AND (
            o.forecast_stage IS NULL
            OR o.forecast_stage NOT ILIKE '%closed%'
          )
        GROUP BY 
          o.id, r.id, u.id,
          score_before.total_score,
          score_after.total_score,
          score_after.reviewed_at
        ORDER BY o.review_requested_at DESC NULLS LAST, o.health_score ASC NULLS LAST
        `,
        [orgId, visibleRepIdsForQuery, selectedPeriod.period_start, selectedPeriod.period_end]
      );
      reviewQueueDeals = rows ?? [];
    } catch {
      reviewQueueDeals = [];
    }
  }

  type TopPartnerDealRow = {
    opportunity_public_id: string;
    partner_name: string;
    account_name: string | null;
    opportunity_name: string | null;
    product: string | null;
    amount: number;
    create_date: string | null;
    close_date: string | null;
    baseline_health_score: number | null;
    health_score: number | null;
  };

  type TopDealRow = {
    opportunity_public_id: string;
    rep_name: string | null;
    account_name: string | null;
    opportunity_name: string | null;
    product: string | null;
    amount: number;
    create_date: string | null;
    close_date: string | null;
    baseline_health_score: number | null;
    health_score: number | null;
  };

  async function listTopDeals(args: {
    orgId: number;
    outcome: "won" | "lost";
    limit: number;
    dateStart?: string | null;
    dateEnd?: string | null;
    repIds: number[] | null;
  }): Promise<TopDealRow[]> {
    const wantWon = args.outcome === "won";
    const useRepFilter = !!(args.repIds && args.repIds.length);
    const { rows } = await pool.query<TopDealRow>(
      `
      SELECT
        o.public_id::text AS opportunity_public_id,
        COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), '') AS rep_name,
        o.account_name,
        o.opportunity_name,
        o.product,
        COALESCE(o.amount, 0)::float8 AS amount,
        o.create_date::timestamptz::text AS create_date,
        o.close_date::date::text AS close_date,
        o.baseline_health_score::float8 AS baseline_health_score,
        o.health_score::float8 AS health_score
      FROM opportunities o
      LEFT JOIN reps r ON r.id = o.rep_id
      WHERE o.org_id = $1
        AND (NOT $6::boolean OR o.rep_id = ANY($5::bigint[]))
        AND o.close_date IS NOT NULL
        AND o.close_date >= COALESCE($3::date, o.close_date)
        AND o.close_date <= COALESCE($4::date, o.close_date)
        AND (
          CASE
            WHEN $2::boolean THEN ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
            ELSE (
              ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
              OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% loss %')
            )
          END
        )
      ORDER BY amount DESC NULLS LAST, o.id DESC
      LIMIT $7
      `,
      [args.orgId, wantWon, args.dateStart || null, args.dateEnd || null, args.repIds || [], useRepFilter, args.limit]
    );
    return rows || [];
  }

  async function listTopPartnerDealsExec(args: {
    orgId: number;
    quotaPeriodId: string;
    outcome: "won" | "lost";
    limit: number;
    dateStart?: string | null;
    dateEnd?: string | null;
    repIds: number[] | null;
  }): Promise<TopPartnerDealRow[]> {
    const wantWon = args.outcome === "won";
    const useRepFilter = !!(args.repIds && args.repIds.length);
    const { rows } = await pool.query<TopPartnerDealRow>(
      `
    WITH qp AS (
      SELECT
        period_start::date AS period_start,
        period_end::date AS period_end,
        GREATEST(period_start::date, COALESCE($5::date, period_start::date)) AS range_start,
        LEAST(period_end::date, COALESCE($6::date, period_end::date)) AS range_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = $2::bigint
      LIMIT 1
    )
    SELECT
      o.public_id::text AS opportunity_public_id,
      btrim(o.partner_name) AS partner_name,
      o.account_name,
      o.opportunity_name,
      o.product,
      COALESCE(o.amount, 0)::float8 AS amount,
      o.create_date::timestamptz::text AS create_date,
      o.close_date::date::text AS close_date,
      o.baseline_health_score::float8 AS baseline_health_score,
      o.health_score::float8 AS health_score
    FROM opportunities o
    JOIN qp ON TRUE
    WHERE o.org_id = $1
      AND (NOT $8::boolean OR o.rep_id = ANY($7::bigint[]))
      AND o.partner_name IS NOT NULL
      AND btrim(o.partner_name) <> ''
      AND o.close_date IS NOT NULL
      AND o.close_date >= qp.range_start
      AND o.close_date <= qp.range_end
      AND (
        CASE
          WHEN $3::boolean THEN ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
          ELSE (
            ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
            OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% loss %')
          )
        END
      )
    ORDER BY amount DESC NULLS LAST, o.id DESC
    LIMIT $4
    `,
      [args.orgId, args.quotaPeriodId, wantWon, args.limit, args.dateStart || null, args.dateEnd || null, args.repIds || [], useRepFilter]
    );
    return rows || [];
  }

  let topPartnerWon: any[] = [];
  let topPartnerLost: any[] = [];
  let topDealsWon: any[] = [];
  let topDealsLost: any[] = [];
  let channelContributionHero: ChannelPartnerHeroProps | null = null;
  try {
    if (selectedPeriod && visibleRepIds.length > 0 && selectedPeriodId) {
      const [won, lost, hero] = await Promise.all([
        listTopPartnerDealsExec({
          orgId: ctx.user.org_id,
          quotaPeriodId: selectedPeriodId,
          outcome: "won",
          limit: 10,
          dateStart: selectedPeriod.period_start,
          dateEnd: selectedPeriod.period_end,
          repIds: visibleRepIds,
        }),
        listTopPartnerDealsExec({
          orgId: ctx.user.org_id,
          quotaPeriodId: selectedPeriodId,
          outcome: "lost",
          limit: 10,
          dateStart: selectedPeriod.period_start,
          dateEnd: selectedPeriod.period_end,
          repIds: visibleRepIds,
        }),
        loadChannelPartnerHeroProps({
          orgId: ctx.user.org_id,
          quotaPeriodId: selectedPeriodId,
          prevQuotaPeriodId: prevPeriodId,
          repIds: visibleRepIds,
        }),
      ]);
      topPartnerWon = won ?? [];
      topPartnerLost = lost ?? [];
      channelContributionHero = hero ?? null;
    }
  } catch {
    topPartnerWon = [];
    topPartnerLost = [];
    topDealsWon = [];
    topDealsLost = [];
    channelContributionHero = null;
  }

  try {
    if (selectedPeriod && visibleRepIds.length > 0) {
      const [won, lost] = await Promise.all([
        listTopDeals({
          orgId: ctx.user.org_id,
          outcome: "won",
          limit: 10,
          dateStart: selectedPeriod.period_start,
          dateEnd: selectedPeriod.period_end,
          repIds: visibleRepIds,
        }),
        listTopDeals({
          orgId: ctx.user.org_id,
          outcome: "lost",
          limit: 10,
          dateStart: selectedPeriod.period_start,
          dateEnd: selectedPeriod.period_end,
          repIds: visibleRepIds,
        }),
      ]);
      topDealsWon = won ?? [];
      topDealsLost = lost ?? [];
    }
  } catch {
    topDealsWon = [];
    topDealsLost = [];
  }

  const showChannelContribution = Number(ctx.user.hierarchy_level ?? 99) <= 2;

  let channelContributionRows: ChannelLedFedRow[] = [];
  try {
    if (showChannelContribution && selectedPeriod && visibleRepIds.length > 0 && selectedPeriodId) {
      channelContributionRows = await loadChannelLedFedRows({
        orgId: ctx.user.org_id,
        quotaPeriodId: selectedPeriodId,
        repIds: visibleRepIds,
      });
    }
  } catch {
    channelContributionRows = [];
  }

  if (selectedPeriodId && comparePeriodIds.length) {
    const [repKpisRows, createdByRepRows, quotaByRepPeriod] = await Promise.all([
      getRepKpisByPeriod({ orgId, periodIds: comparePeriodIds, repIds: scopeRepIdsForTeam }),
      getCreatedByRep({ orgId, periodIds: comparePeriodIds, repIds: scopeRepIdsForTeam }),
      getQuotaByRepPeriod({ orgId, quotaPeriodIds: comparePeriodIds, repIds: scopeRepIdsForTeam }),
    ]);

    const safeDiv = (n: number, d: number): number | null => {
      if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
      return n / d;
    };

    const quotaByRepPeriodMap = new Map<string, number>();
    for (const q of quotaByRepPeriod) {
      const k = `${String(q.quota_period_id)}|${String(q.rep_id)}`;
      quotaByRepPeriodMap.set(k, Number(q.quota_amount || 0) || 0);
    }
    const repKpisByKey = new Map<string, (typeof repKpisRows)[number]>();
    for (const r of repKpisRows) {
      repKpisByKey.set(`${String(r.quota_period_id)}|${String(r.rep_id)}`, r);
    }
    const createdByKey = new Map<string, { created_amount: number; created_count: number }>();
    for (const r of createdByRepRows) {
      const k = `${String(r.quota_period_id)}|${String(r.rep_id)}`;
      createdByKey.set(k, {
        created_amount: Number((r as { created_amount?: number }).created_amount || 0) || 0,
        created_count: Number((r as { created_count?: number }).created_count || 0) || 0,
      });
    }

    const repIdsInData = new Set<string>();
    for (const r of repKpisRows) repIdsInData.add(String(r.rep_id));
    for (const q of quotaByRepPeriod) repIdsInData.add(String(q.rep_id));

    const repRowsBuild: RepManagerRepRow[] = [];
    for (const rep_id of repIdsInData) {
      const currK = `${selectedPeriodId}|${rep_id}`;
      const prevK = prevPeriodId ? `${prevPeriodId}|${rep_id}` : "";
      const c = repKpisByKey.get(currK) || null;
      const p = prevK ? repKpisByKey.get(prevK) || null : null;
      const quota = quotaByRepPeriodMap.get(currK) || 0;
      const prevQuotaForRep = prevK ? quotaByRepPeriodMap.get(prevK) || 0 : 0;

      const total_count = c ? Number((c as { total_count?: number }).total_count || 0) || 0 : 0;
      const won_amount = c ? Number(c.won_amount || 0) || 0 : 0;
      const won_count = c ? Number(c.won_count || 0) || 0 : 0;
      const active_amount = c ? Number(c.active_amount || 0) || 0 : 0;
      const lost_count = c ? Number((c as { lost_count?: number }).lost_count || 0) || 0 : 0;
      const commit_amount = c ? Number((c as { commit_amount?: number }).commit_amount || 0) || 0 : 0;
      const best_amount = c ? Number((c as { best_amount?: number }).best_amount || 0) || 0 : 0;
      const pipeline_amount = c ? Number((c as { pipeline_amount?: number }).pipeline_amount || 0) || 0 : 0;
      const win_rate = c ? safeDiv(won_count, won_count + lost_count) : null;
      const opp_to_win = c ? safeDiv(won_count, total_count) : null;
      const aov = c ? safeDiv(won_amount, won_count) : null;
      const attainment = c ? safeDiv(won_amount, quota) : null;
      const partner_contribution = c
        ? safeDiv(Number(c.partner_closed_amount || 0) || 0, Number(c.closed_amount || 0) || 0)
        : null;
      const partner_win_rate = c
        ? safeDiv(
            Number((c as { partner_won_count?: number }).partner_won_count || 0) || 0,
            Number((c as { partner_closed_count?: number }).partner_closed_count || 0) || 0
          )
        : null;
      const commit_coverage = c ? safeDiv(commit_amount, quota) : null;
      const best_coverage = c ? safeDiv(best_amount, quota) : null;
      const prevAttainment = p ? safeDiv(Number(p.won_amount || 0) || 0, prevQuotaForRep) : null;

      const created = createdByKey.get(currK) || { created_amount: 0, created_count: 0 };
      const manager_id = repIdToManagerId.get(String(rep_id)) || "";
      const manager_name = manager_id ? managerNameById.get(manager_id) || `Manager ${manager_id}` : "(Unassigned)";

      const mixDen = pipeline_amount + best_amount + commit_amount + won_amount;
      const mix_pipeline = safeDiv(pipeline_amount, mixDen);
      const mix_best = safeDiv(best_amount, mixDen);
      const mix_commit = safeDiv(commit_amount, mixDen);
      const mix_won = safeDiv(won_amount, mixDen);

      const rep_name =
        (c && String(c.rep_name || "").trim()) ||
        repDirectory.find((r) => String(r.id) === String(rep_id))?.name ||
        `Rep ${rep_id}`;

      repRowsBuild.push({
        rep_id: String(rep_id),
        rep_name,
        manager_id,
        manager_name,
        quota,
        total_count,
        won_amount,
        won_count,
        lost_count,
        active_amount,
        commit_amount,
        best_amount,
        pipeline_amount,
        created_amount: created.created_amount,
        created_count: created.created_count,
        win_rate,
        opp_to_win,
        aov,
        attainment,
        commit_coverage,
        best_coverage,
        partner_contribution,
        partner_win_rate,
        avg_days_won: c?.avg_days_won ?? null,
        avg_days_lost: c?.avg_days_lost ?? null,
        avg_days_active: c?.avg_days_active ?? null,
        mix_pipeline,
        mix_best,
        mix_commit,
        mix_won,
        qoq_attainment_delta: attainment != null && prevAttainment != null ? attainment - prevAttainment : null,
      });
    }

    repRowsBuild.sort((a, b) => (Number(b.attainment ?? -1) - Number(a.attainment ?? -1)) || a.rep_name.localeCompare(b.rep_name));

    const managerAgg = new Map<
      string,
      { quota: number; won_amount: number; won_count: number; lost_count: number; active_amount: number; partner_closed_amount: number; closed_amount: number }
    >();
    for (const repRow of repRowsBuild) {
      const mid = repIdToManagerId.get(String(repRow.rep_id)) || "";
      const a = managerAgg.get(mid) || {
        quota: 0,
        won_amount: 0,
        won_count: 0,
        lost_count: 0,
        active_amount: 0,
        partner_closed_amount: 0,
        closed_amount: 0,
      };
      a.quota += repRow.quota;
      a.won_amount += repRow.won_amount;
      a.won_count += repRow.won_count;
      const ck = `${selectedPeriodId}|${String(repRow.rep_id)}`;
      const c = repKpisByKey.get(ck);
      a.lost_count += Number(c?.lost_count || 0) || 0;
      a.active_amount += repRow.active_amount;
      a.partner_closed_amount += Number((c as { partner_closed_amount?: number })?.partner_closed_amount || 0) || 0;
      a.closed_amount += Number((c as { closed_amount?: number })?.closed_amount || 0) || 0;
      managerAgg.set(mid, a);
    }

    const managerRowsBuild: RepManagerManagerRow[] = [];
    for (const [manager_id, agg] of managerAgg.entries()) {
      const manager_name = manager_id ? managerNameById.get(manager_id) || `Manager ${manager_id}` : "(Unassigned)";
      const attainment = safeDiv(agg.won_amount, agg.quota);
      const win_rate = safeDiv(agg.won_count, agg.won_count + agg.lost_count);
      const partner_contribution = safeDiv(agg.partner_closed_amount, agg.closed_amount);
      managerRowsBuild.push({
        manager_id,
        manager_name,
        quota: agg.quota,
        won_amount: agg.won_amount,
        active_amount: agg.active_amount,
        attainment,
        win_rate,
        partner_contribution,
      });
    }
    managerRowsBuild.sort(
      (a, b) =>
        (Number(b.attainment ?? -1) - Number(a.attainment ?? -1)) ||
        b.won_amount - a.won_amount ||
        a.manager_name.localeCompare(b.manager_name)
    );

    const repsByManagerMap = new Map<string, RepManagerRepRow[]>();
    for (const r of repRowsBuild) {
      const k = r.manager_id || "";
      const arr = repsByManagerMap.get(k) || [];
      arr.push(r);
      repsByManagerMap.set(k, arr);
    }
    const managerIdsInRepRows = Array.from(repsByManagerMap.keys());
    teamOrderedManagerIds = [
      ...managerRowsBuild.map((m) => m.manager_id || ""),
      ...managerIdsInRepRows.filter((id) => !managerRowsBuild.some((m) => String(m.manager_id || "") === String(id || ""))),
    ];
    teamRepRows = repRowsBuild;
    teamManagerRows = managerRowsBuild;
    teamRepsByManager = repsByManagerMap;
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

        <ExecutiveBriefingProvider>
          <div className="mt-4 grid gap-4">
            <ExecutiveGapInsightsClient
              basePath="/dashboard/executive"
              periods={summary.periods}
              quotaPeriodId={summary.selectedQuotaPeriodId}
              orgId={ctx.user.org_id}
              reps={summary.reps}
              fiscalYear={String(summary.selectedPeriod?.fiscal_year || summary.selectedFiscalYear || "").trim() || "â€”"}
              fiscalQuarter={String(summary.selectedPeriod?.fiscal_quarter || "").trim() || "â€”"}
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
              heroOnly={true}
              heroAgingCards
              viewerRole={ctx.user.role}
            />
          </div>

          <ExecutiveTabsShellClient
          basePath="/dashboard/executive"
          initialTab={activeTab}
          setDefaultTab={setExecDefaultTabAction}
          orgId={ctx.user.org_id}
          orgName={orgName}
          viewerRole={ctx.user.role}
          forecastTabProps={{
            basePath: "/dashboard/executive",
            periods: summary.periods,
            quotaPeriodId: summary.selectedQuotaPeriodId,
            orgId: ctx.user.org_id,
            reps: summary.reps,
            fiscalYear: String(summary.selectedPeriod?.fiscal_year || summary.selectedFiscalYear || "").trim() || "â€”",
            fiscalQuarter: String(summary.selectedPeriod?.fiscal_quarter || "").trim() || "â€”",
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
            topDealsWon,
            topDealsLost,
            periodName: selectedPeriod?.period_name ?? "",
            pipelineQuarterIds,
            coachingRepRows: teamRepRows,
            coachingPeriodStart: selectedPeriod?.period_start ?? "",
            coachingPeriodEnd: selectedPeriod?.period_end ?? "",
            pipelineHygiene: {
              coverageRows: coverageRowsFinal,
              assessmentRows: assessmentRowsFinal,
              velocitySummaries: velocityRepSummariesFinal,
              progressionSummaries: progressionRepSummariesFinal,
            },
          }}
          pipelineTabProps={{
            basePath: "/dashboard/executive",
            periods: summary.periods,
            quotaPeriodId: summary.selectedQuotaPeriodId,
            orgId: ctx.user.org_id,
            reps: summary.reps,
            fiscalYear: String(summary.selectedPeriod?.fiscal_year || summary.selectedFiscalYear || "").trim() || "â€”",
            fiscalQuarter: String(summary.selectedPeriod?.fiscal_quarter || "").trim() || "â€”",
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
            periodName: selectedPeriod?.period_name ?? "",
          }}
          pipelineHygiene={{
            coverageRows: coverageRowsFinal,
            assessmentRows: assessmentRowsFinal,
            velocitySummaries: velocityRepSummariesFinal,
            progressionSummaries: progressionRepSummariesFinal,
          }}
          teamTabProps={{
            basePath: "/dashboard/executive",
            periods: summary.periods,
            quotaPeriodId: summary.selectedQuotaPeriodId,
            orgId: ctx.user.org_id,
            reps: summary.reps,
            fiscalYear: String(summary.selectedPeriod?.fiscal_year || summary.selectedFiscalYear || "").trim() || "â€”",
            fiscalQuarter: String(summary.selectedPeriod?.fiscal_quarter || "").trim() || "â€”",
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
          teamRepManagerPayload={{
            repRows: teamRepRows,
            managerRows: teamManagerRows,
            periodName: summary.selectedPeriod?.period_name ?? "",
            periodStart: selectedPeriod?.period_start ?? "",
            periodEnd: selectedPeriod?.period_end ?? "",
          }}
          reviewQueueDeals={reviewQueueDeals}
          currentUserId={ctx.user.id}
          showManagerReviewQueue={showManagerReviewQueue}
          topPartnerWon={topPartnerWon}
          topPartnerLost={topPartnerLost}
          topDealsWon={topDealsWon}
          topDealsLost={topDealsLost}
          reportBuilderRepRows={reportBuilderRepRows}
          reportBuilderSavedReports={reportBuilderSavedReports}
          reportBuilderPeriodLabel={periodLabel}
          reportBuilderRepDirectory={directoryInScope}
          reportBuilderQuotaPeriods={summary.periods.map((p) => ({
            id: String(p.id),
            name: p.period_name ? `${p.period_name}` : String(p.id),
            fiscal_year: String(p.fiscal_year ?? ""),
          }))}
          reportBuilderOrgId={orgId}
          reportBuilderInitialPeriodId={selectedPeriodId}
          revenueIntelligenceOrgId={orgId}
          revenueIntelligenceQuotaPeriods={summary.periods.map((p) => ({
            id: String(p.id),
            name: p.period_name,
            fiscal_year: String(p.fiscal_year ?? ""),
          }))}
          revenueIntelligenceRepDirectory={directoryInScope.map((r) => ({
            id: r.id,
            name: r.name,
            role: r.role ?? "REP",
            manager_rep_id: r.manager_rep_id ?? null,
          }))}
          showChannelContribution={showChannelContribution}
          channelContributionHero={channelContributionHero}
          channelContributionRows={channelContributionRows}
          revenueTabProps={{
            basePath: "/dashboard/executive",
            periods: summary.periods,
            quotaPeriodId: summary.selectedQuotaPeriodId,
            orgId: ctx.user.org_id,
            reps: summary.reps,
            fiscalYear: String(summary.selectedPeriod?.fiscal_year || summary.selectedFiscalYear || "").trim() || "â€”",
            fiscalQuarter: String(summary.selectedPeriod?.fiscal_quarter || "").trim() || "â€”",
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
        />
        </ExecutiveBriefingProvider>
      </main>
    </div>
  );
  } catch (e) {
    const fs = await import("fs");
    const msg = e instanceof Error ? e.stack || e.message : String(e);
    console.error("[ExecutiveDashboardPage crash]", msg);
    try {
      fs.writeFileSync("/tmp/exec-dashboard-error.txt", msg);
    } catch {}
    throw e;
  }
}

