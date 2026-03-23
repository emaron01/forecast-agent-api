import { pool } from "../../../lib/pool";
import { requireOrgContext } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { getScopedRepDirectory, type RepDirectoryRow } from "../../../lib/repScope";
import { UserTopNav } from "../../_components/UserTopNav";
import { redirect } from "next/navigation";

type SearchParams = { quota_period_id?: string };

function coveragePctTextClass(pct: number | null): string {
  if (pct == null) return "text-[color:var(--sf-text-primary)]";
  if (pct === 0) return "text-red-600";
  if (pct === 100) return "text-green-600";
  return "text-[color:var(--sf-text-primary)]";
}

/** Text-only colors for Matthew's Assessment: red 0–1, yellow 2, green 3+ */
function assessmentScoreTextClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return "text-gray-400";
  if (score <= 1) return "text-red-600";
  if (score === 2) return "text-yellow-600";
  return "text-green-600";
}

function deltaTextClass(delta: number): string {
  if (delta > 0) return "text-green-600";
  if (delta < 0) return "text-red-600";
  return "text-gray-500";
}

/** Team total vs indented rep row styling. */
function hygieneRowClass(row: { rowKind?: "team" | "rep" }): string {
  const base = "border-t border-[color:var(--sf-border)]";
  if (row.rowKind === "team") {
    return `${base} bg-[color:var(--sf-surface-alt)] font-semibold`;
  }
  return base;
}

function hygieneRepIndentClass(row: { rowKind?: "team" | "rep" }): string {
  return row.rowKind === "rep" ? "pl-8" : "";
}

/**
 * Exclude hierarchy levels 6–8 (channel) from hygiene metrics. `reps` has no hierarchy_level column here;
 * we filter via linked `users` (equivalent to AND r.hierarchy_level <= 3 when reps mirror users).
 */
const SALES_REP_USER_JOIN_SQL = `INNER JOIN users u ON u.org_id = $1::bigint AND u.id = r.user_id AND u.hierarchy_level <= 3`;

type AssessmentOppRowLike = {
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

/** Direct reports grouped by manager_rep_id (manager must exist in directory). */
function collectDirectManagerGroups(
  repDirectory: RepDirectoryRow[],
  visibleRepIds: number[]
): Array<{ managerId: number; managerName: string; repIds: number[] }> {
  const repById = new Map(repDirectory.map((r) => [r.id, r]));
  const byMgr = new Map<number, number[]>();
  for (const rid of visibleRepIds) {
    const r = repById.get(rid);
    if (!r) continue;
    const mgrId = r.manager_rep_id;
    if (mgrId != null && repById.has(mgrId)) {
      let arr = byMgr.get(mgrId);
      if (!arr) {
        arr = [];
        byMgr.set(mgrId, arr);
      }
      arr.push(rid);
    }
  }
  return Array.from(byMgr.entries())
    .map(([managerId, repIds]) => {
      const sorted = [...repIds].sort((a, b) => {
        const na = repById.get(a)?.name ?? "";
        const nb = repById.get(b)?.name ?? "";
        return na.localeCompare(nb, "en", { sensitivity: "base" });
      });
      return {
        managerId,
        managerName: repById.get(managerId)!.name,
        repIds: sorted,
      };
    })
    .sort((a, b) =>
      a.managerName.localeCompare(b.managerName, "en", { sensitivity: "base" })
    );
}

function collectUnassignedRepIds(
  repDirectory: RepDirectoryRow[],
  visibleRepIds: number[]
): number[] {
  const repById = new Map(repDirectory.map((r) => [r.id, r]));
  const out: number[] = [];
  for (const rid of visibleRepIds) {
    const r = repById.get(rid);
    if (!r) continue;
    const mgrId = r.manager_rep_id;
    if (mgrId == null || !repById.has(mgrId)) out.push(rid);
  }
  out.sort((a, b) => {
    const na = repById.get(a)?.name ?? "";
    const nb = repById.get(b)?.name ?? "";
    return na.localeCompare(nb, "en", { sensitivity: "base" });
  });
  return out;
}

function buildTeamCoverageRows(
  coverageRows: Array<{
    rep_id: number;
    rep_name: string;
    total_opps: number;
    reviewed_opps: number;
    coverage_pct: number | null;
  }>,
  repDirectory: RepDirectoryRow[],
  visibleRepIds: number[]
): Array<{
  rep_id: number;
  rep_name: string;
  total_opps: number;
  reviewed_opps: number;
  coverage_pct: number | null;
  rowKind: "team" | "rep";
}> {
  const byId = new Map(coverageRows.map((r) => [r.rep_id, r]));
  const groups = collectDirectManagerGroups(repDirectory, visibleRepIds);
  const unassigned = collectUnassignedRepIds(repDirectory, visibleRepIds);
  const out: Array<{
    rep_id: number;
    rep_name: string;
    total_opps: number;
    reviewed_opps: number;
    coverage_pct: number | null;
    rowKind: "team" | "rep";
  }> = [];

  for (const g of groups) {
    let total = 0;
    let reviewed = 0;
    for (const id of g.repIds) {
      const row = byId.get(id);
      if (row) {
        total += row.total_opps;
        reviewed += row.reviewed_opps;
      }
    }
    out.push({
      rep_id: -(g.managerId + 1_000_000),
      rep_name: `${g.managerName} Team Total`,
      total_opps: total,
      reviewed_opps: reviewed,
      coverage_pct: total > 0 ? Math.round((reviewed / total) * 100) : null,
      rowKind: "team",
    });
    for (const id of g.repIds) {
      const row = byId.get(id);
      if (row) out.push({ ...row, rowKind: "rep" });
    }
  }

  if (unassigned.length > 0) {
    let total = 0;
    let reviewed = 0;
    for (const id of unassigned) {
      const row = byId.get(id);
      if (row) {
        total += row.total_opps;
        reviewed += row.reviewed_opps;
      }
    }
    out.push({
      rep_id: -1,
      rep_name: "Unassigned Team Total",
      total_opps: total,
      reviewed_opps: reviewed,
      coverage_pct: total > 0 ? Math.round((reviewed / total) * 100) : null,
      rowKind: "team",
    });
    for (const id of unassigned) {
      const row = byId.get(id);
      if (row) out.push({ ...row, rowKind: "rep" });
    }
  }

  return out;
}

function buildTeamAssessmentRows(
  assessmentRows: Array<{
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
  }>,
  assessmentOppRows: AssessmentOppRowLike[],
  repDirectory: RepDirectoryRow[],
  visibleRepIds: number[]
): Array<{
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
  rowKind: "team" | "rep";
}> {
  const byId = new Map(assessmentRows.map((r) => [r.rep_id, r]));
  const groups = collectDirectManagerGroups(repDirectory, visibleRepIds);
  const unassigned = collectUnassignedRepIds(repDirectory, visibleRepIds);

  const num = (v: number | null | undefined): number =>
    v != null && Number.isFinite(v) ? Number(v) : 0;

  const rollupFromOpps = (repIds: Set<number>) => {
    const rows = assessmentOppRows.filter((r) => repIds.has(r.rep_id));
    const n = rows.length;
    if (n === 0) {
      return {
        pain: null as number | null,
        metrics: null as number | null,
        champion: null as number | null,
        eb: null as number | null,
        criteria: null as number | null,
        process: null as number | null,
        competition: null as number | null,
        paper: null as number | null,
        timing: null as number | null,
        budget: null as number | null,
        avg_total: null as number | null,
      };
    }
    const sum = (get: (r: AssessmentOppRowLike) => number | null) =>
      rows.reduce((a, r) => a + num(get(r)), 0);
    const avg = (get: (r: AssessmentOppRowLike) => number | null) =>
      Math.round(sum(get) / n);
    return {
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
  };

  const out: Array<{
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
    rowKind: "team" | "rep";
  }> = [];

  for (const g of groups) {
    const rolled = rollupFromOpps(new Set(g.repIds));
    out.push({
      rep_id: -(g.managerId + 1_000_000),
      rep_name: `${g.managerName} Team Total`,
      ...rolled,
      rowKind: "team",
    });
    for (const id of g.repIds) {
      const row = byId.get(id);
      if (row) out.push({ ...row, rowKind: "rep" });
    }
  }

  if (unassigned.length > 0) {
    const rolled = rollupFromOpps(new Set(unassigned));
    out.push({
      rep_id: -1,
      rep_name: "Unassigned Team Total",
      ...rolled,
      rowKind: "team",
    });
    for (const id of unassigned) {
      const row = byId.get(id);
      if (row) out.push({ ...row, rowKind: "rep" });
    }
  }

  return out;
}

function buildTeamVelocityRows(
  velocityRows: Array<{
    rep_id: number;
    rep_name: string;
    baseline_score: number | null;
    current_score: number | null;
    delta: number | null;
  }>,
  repDirectory: RepDirectoryRow[],
  visibleRepIds: number[]
): Array<{
  repName: string;
  avgBaseline: number;
  avgCurrent: number;
  avgDelta: number;
  dealsMoving: number;
  dealsFlat: number;
  rowKind: "team" | "rep";
}> {
  const repById = new Map(repDirectory.map((r) => [r.id, r]));
  const groups = collectDirectManagerGroups(repDirectory, visibleRepIds);
  const unassigned = collectUnassignedRepIds(repDirectory, visibleRepIds);

  const num = (v: number | null | undefined): number =>
    v != null && Number.isFinite(v) ? Number(v) : 0;

  const rollupVelocity = (repIds: number[]) => {
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
      const d =
        row.delta != null && Number.isFinite(row.delta) ? Number(row.delta) : c - b;
      sumBaseline += b;
      sumCurrent += c;
      sumDelta += d;
      if (d > 0) dealsMoving += 1;
      if (d === 0) dealsFlat += 1;
    }
    return {
      avgBaseline: count ? sumBaseline / count : 0,
      avgCurrent: count ? sumCurrent / count : 0,
      avgDelta: count ? sumDelta / count : 0,
      dealsMoving,
      dealsFlat,
    };
  };

  const repVelocitySummary = (repId: number) => {
    const name = repById.get(repId)?.name ?? "";
    const leafRows = velocityRows.filter((r) => r.rep_id === repId);
    let count = 0;
    let sumBaseline = 0;
    let sumCurrent = 0;
    let sumDelta = 0;
    let dealsMoving = 0;
    let dealsFlat = 0;
    for (const row of leafRows) {
      count += 1;
      const b = num(row.baseline_score);
      const c = num(row.current_score);
      const d =
        row.delta != null && Number.isFinite(row.delta) ? Number(row.delta) : c - b;
      sumBaseline += b;
      sumCurrent += c;
      sumDelta += d;
      if (d > 0) dealsMoving += 1;
      if (d === 0) dealsFlat += 1;
    }
    return {
      repName: name,
      avgBaseline: count ? sumBaseline / count : 0,
      avgCurrent: count ? sumCurrent / count : 0,
      avgDelta: count ? sumDelta / count : 0,
      dealsMoving,
      dealsFlat,
    };
  };

  const out: Array<{
    repName: string;
    avgBaseline: number;
    avgCurrent: number;
    avgDelta: number;
    dealsMoving: number;
    dealsFlat: number;
    rowKind: "team" | "rep";
  }> = [];

  for (const g of groups) {
    const agg = rollupVelocity(g.repIds);
    out.push({
      repName: `${g.managerName} Team Total`,
      ...agg,
      rowKind: "team",
    });
    for (const id of g.repIds) {
      out.push({ ...repVelocitySummary(id), rowKind: "rep" });
    }
  }

  if (unassigned.length > 0) {
    const agg = rollupVelocity(unassigned);
    out.push({
      repName: "Unassigned Team Total",
      ...agg,
      rowKind: "team",
    });
    for (const id of unassigned) {
      out.push({ ...repVelocitySummary(id), rowKind: "rep" });
    }
  }

  return out;
}

function buildTeamProgressionRows(
  progressionByRepId: Map<
    number,
    { repName: string; progressing: number; stalled: number; flat: number; total: number }
  >,
  repDirectory: RepDirectoryRow[],
  visibleRepIds: number[]
): Array<{
  repName: string;
  progressing: number;
  stalled: number;
  flat: number;
  total: number;
  rowKind: "team" | "rep";
}> {
  const repById = new Map(repDirectory.map((r) => [r.id, r]));
  const groups = collectDirectManagerGroups(repDirectory, visibleRepIds);
  const unassigned = collectUnassignedRepIds(repDirectory, visibleRepIds);

  const rollupProg = (repIds: number[]) => {
    let progressing = 0;
    let stalled = 0;
    let flat = 0;
    let total = 0;
    for (const id of repIds) {
      const s = progressionByRepId.get(id);
      if (s) {
        progressing += s.progressing;
        stalled += s.stalled;
        flat += s.flat;
        total += s.total;
      }
    }
    return { progressing, stalled, flat, total };
  };

  const out: Array<{
    repName: string;
    progressing: number;
    stalled: number;
    flat: number;
    total: number;
    rowKind: "team" | "rep";
  }> = [];

  for (const g of groups) {
    const agg = rollupProg(g.repIds);
    out.push({
      repName: `${g.managerName} Team Total`,
      ...agg,
      rowKind: "team",
    });
    for (const id of g.repIds) {
      const s = progressionByRepId.get(id);
      if (s) out.push({ ...s, rowKind: "rep" });
    }
  }

  if (unassigned.length > 0) {
    const agg = rollupProg(unassigned);
    out.push({
      repName: "Unassigned Team Total",
      ...agg,
      rowKind: "team",
    });
    for (const id of unassigned) {
      const s = progressionByRepId.get(id);
      if (s) out.push({ ...s, rowKind: "rep" });
    }
  }

  return out;
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
  if (user.role === "REP" || user.role === "CHANNEL_REP") {
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

  // Rep-to-executive schema: same as executive dashboard (getScopedRepDirectory)
  const scopedRole =
    user.role === "ADMIN" ||
    user.role === "EXEC_MANAGER" ||
    user.role === "MANAGER" ||
    user.role === "REP" ||
    user.role === "CHANNEL_EXECUTIVE" ||
    user.role === "CHANNEL_DIRECTOR" ||
    user.role === "CHANNEL_REP"
      ? user.role
      : "MANAGER";
  const scope = await getScopedRepDirectory({
    orgId,
    userId: user.id,
    role: scopedRole,
  }).catch(() => ({
    repDirectory: [] as RepDirectoryRow[],
    allowedRepIds: null as number[] | null,
    myRepId: null as number | null,
  }));

  // Reps to include in the report: scoped list (admin = all in directory, else allowedRepIds)
  const visibleRepIds: number[] =
    scope.allowedRepIds !== null && scope.allowedRepIds.length > 0
      ? scope.allowedRepIds
      : scope.repDirectory.map((r) => r.id).filter((n) => Number.isFinite(n) && n > 0);
  const visibleRepIdsForQuery =
    visibleRepIds.length > 0 ? visibleRepIds : [-1];

  const repDirectory = scope.repDirectory;

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
    ${SALES_REP_USER_JOIN_SQL}
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

  const coverageRowsFinal = buildTeamCoverageRows(
    coverageRows ?? [],
    repDirectory,
    visibleRepIds
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
    ${SALES_REP_USER_JOIN_SQL}
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

  // Raw agent-reviewed opps for team rollup (average of category scores)
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
    JOIN reps r
      ON r.id = opp.rep_id
     AND COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
    ${SALES_REP_USER_JOIN_SQL}
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

  const assessmentRowsFinal = buildTeamAssessmentRows(
    assessmentRows ?? [],
    assessmentOppRows ?? [],
    repDirectory,
    visibleRepIds
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
    ${SALES_REP_USER_JOIN_SQL}
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

  // Group Query C results by rep for summary.
  type VelocityRepSummary = {
    repName: string;
    avgBaseline: number;
    avgCurrent: number;
    avgDelta: number;
    dealsMoving: number;
    dealsFlat: number;
  };

  const velocityRepSummariesFinal = buildTeamVelocityRows(
    velocityRows ?? [],
    repDirectory,
    visibleRepIds
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
    ${SALES_REP_USER_JOIN_SQL}
    WHERE oae.org_id = $1
      AND opp.org_id = $1
      AND opp.rep_id = ANY($4::bigint[])
      AND opp.close_date >= $2::timestamptz
      AND opp.close_date < $3::timestamptz
    ORDER BY oae.opportunity_id, oae.ts ASC
    `,
    [orgId, startIso, endIso, visibleRepIdsForQuery]
  );

  // Group progression by opportunity and compute stalled flags.
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

  // Rep-level progression summary (keyed by rep_id).
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

  const progressionRepSummariesFinal = buildTeamProgressionRows(
    progressionByRepId,
    repDirectory,
    visibleRepIds
  );

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
                {coverageRowsFinal.map((row) => (
                  <tr key={row.rep_id} className={hygieneRowClass(row)}>
                    <td
                      className={`px-3 py-2 text-[color:var(--sf-text-primary)] ${hygieneRepIndentClass(row)}`}
                    >
                      {row.rep_name}
                    </td>
                    <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.total_opps}</td>
                    <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.reviewed_opps}</td>
                    <td className={`px-3 py-2 text-right font-medium ${coveragePctTextClass(row.coverage_pct)}`}>
                      {row.coverage_pct != null ? `${row.coverage_pct}%` : "—"}
                    </td>
                  </tr>
                ))}
                {!coverageRowsFinal.length && (
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
                {assessmentRowsFinal.map((row) => (
                  <tr key={row.rep_id} className={hygieneRowClass(row)}>
                    <td
                      className={`px-2 py-2 text-[color:var(--sf-text-primary)] whitespace-nowrap ${hygieneRepIndentClass(row)}`}
                    >
                      {row.rep_name}
                    </td>
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
                        className={`px-2 py-1 text-center font-mono ${assessmentScoreTextClass(v)}`}
                      >
                        {v != null ? v : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
                {!assessmentRowsFinal.length && (
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
                {velocityRepSummariesFinal.map((row, idx) => (
                  <tr key={`${row.repName}:${idx}`} className={hygieneRowClass(row)}>
                    <td
                      className={`px-3 py-2 text-[color:var(--sf-text-primary)] whitespace-nowrap ${hygieneRepIndentClass(row)}`}
                    >
                      {row.repName}
                    </td>
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
                {!velocityRepSummariesFinal.length && (
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
                {progressionRepSummariesFinal.map((row, idx) => (
                    <tr key={`${row.repName}:${idx}`} className={hygieneRowClass(row)}>
                      <td
                        className={`px-3 py-2 text-[color:var(--sf-text-primary)] whitespace-nowrap ${hygieneRepIndentClass(row)}`}
                      >
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
                ))}
                {!progressionRepSummariesFinal.length && (
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

