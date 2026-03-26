"use client";

import { useMemo, useState } from "react";
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { RepManagerRepRow } from "../../../app/components/dashboard/executive/RepManagerComparisonPanel";

export type CoverageHygieneRow = {
  rep_id: number;
  rep_name: string;
  total_opps: number;
  reviewed_opps: number;
  coverage_pct: number | null;
};

export type AssessmentHygieneRow = {
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

export type VelocityHygieneSummary = {
  repId: number;
  repName: string;
  avgBaseline: number;
  avgCurrent: number;
  avgDelta: number;
  dealsMoving: number;
  dealsFlat: number;
};

export type ProgressionHygieneSummary = {
  repId: number;
  repName: string;
  progressing: number;
  stalled: number;
  flat: number;
  total: number;
};

export type PipelineHygienePayload = {
  coverageRows: CoverageHygieneRow[];
  assessmentRows: AssessmentHygieneRow[];
  velocitySummaries: VelocityHygieneSummary[];
  progressionSummaries: ProgressionHygieneSummary[];
};

const MEDDPICC_CATEGORIES = [
  { key: "pain", label: "Pain" },
  { key: "metrics", label: "Metrics" },
  { key: "champion", label: "Champion" },
  { key: "eb", label: "EB" },
  { key: "criteria", label: "Criteria" },
  { key: "process", label: "Process" },
  { key: "competition", label: "Competition" },
  { key: "paper", label: "Paper" },
  { key: "timing", label: "Timing" },
  { key: "budget", label: "Budget" },
] as const;

const CHART_COLORS = [
  "#00BCD4",
  "#2ECC71",
  "#F1C40F",
  "#E74C3C",
  "#9B59B6",
  "#FF9800",
  "#00BFA5",
  "#FF5722",
];

function coveragePctTextClass(pct: number | null): string {
  if (pct == null) return "text-[color:var(--sf-text-primary)]";
  if (pct === 0) return "text-red-600";
  if (pct === 100) return "text-green-600";
  return "text-[color:var(--sf-text-primary)]";
}

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

function rollupRowLabel(repName: string, rollupCount: number): string {
  if (rollupCount <= 1) return "Team Total";
  return `${repName}'s Team`;
}

function fmtMoney(n: unknown) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

function avgCoverage(rows: CoverageHygieneRow[]): number {
  const pcts = rows.map((r) => r.coverage_pct).filter((p): p is number => p != null && Number.isFinite(p));
  if (!pcts.length) return 0;
  return pcts.reduce((a, b) => a + b, 0) / pcts.length;
}

export type RepCoachingData = {
  rep_id: string;
  rep_name: string;
  attainment: number | null;
  quota: number | null;
  won_amount: number | null;
  coverage_pct: number;
  total_opps: number;
  reviewed_opps: number;
  weakest_categories: string[];
  avg_meddpicc: number;
  avg_delta: number;
  deals_moving: number;
  deals_flat: number;
  progressing: number;
  stalled: number;
};

/**
 * Join coverage, assessment, velocity, and progression hygiene rows by rep id,
 * optionally enriched with quota / attainment / won from coachingRepRows.
 */
export function buildRepCoachingData(
  h: PipelineHygienePayload,
  coachingRepRows?: RepManagerRepRow[] | null
): RepCoachingData[] {
  const crById = new Map((coachingRepRows ?? []).map((r) => [String(r.rep_id), r]));

  const covPos = h.coverageRows.filter((r) => r.rep_id > 0);
  const assPos = h.assessmentRows.filter((r) => r.rep_id > 0);
  const velPos = h.velocitySummaries.filter((r) => r.repId > 0);
  const progPos = h.progressionSummaries.filter((r) => r.repId > 0);

  const repIds = new Set<string>();
  for (const r of covPos) repIds.add(String(r.rep_id));
  for (const r of assPos) repIds.add(String(r.rep_id));
  for (const r of velPos) repIds.add(String(r.repId));
  for (const r of progPos) repIds.add(String(r.repId));
  for (const r of coachingRepRows ?? []) repIds.add(String(r.rep_id));

  const covBy = new Map(covPos.map((r) => [String(r.rep_id), r]));
  const assBy = new Map(assPos.map((r) => [String(r.rep_id), r]));
  const velBy = new Map(velPos.map((r) => [String(r.repId), r]));
  const progBy = new Map(progPos.map((r) => [String(r.repId), r]));

  const out: RepCoachingData[] = [];
  for (const repId of repIds) {
    const cov = covBy.get(repId);
    const ass = assBy.get(repId);
    const vel = velBy.get(repId);
    const prog = progBy.get(repId);
    const cr = crById.get(repId);

    const coverage_pct = cov?.coverage_pct ?? 0;
    const total_opps = cov?.total_opps ?? 0;
    const reviewed_opps = cov?.reviewed_opps ?? 0;

    const catScores = MEDDPICC_CATEGORIES.map((c) => ({
      label: c.label,
      score: Number(ass?.[c.key as keyof AssessmentHygieneRow] ?? 0) || 0,
    })).sort((a, b) => a.score - b.score);
    const weakest_categories = catScores.slice(0, 3).map((x) => x.label);

    const avg_meddpicc = ass?.avg_total != null && Number.isFinite(ass.avg_total) ? Number(ass.avg_total) : 0;

    out.push({
      rep_id: repId,
      rep_name: cov?.rep_name ?? ass?.rep_name ?? vel?.repName ?? prog?.repName ?? `Rep ${repId}`,
      attainment: cr?.attainment != null && Number.isFinite(cr.attainment) ? cr.attainment : null,
      quota: cr?.quota != null && Number.isFinite(cr.quota) ? Number(cr.quota) : null,
      won_amount: cr?.won_amount != null && Number.isFinite(cr.won_amount) ? Number(cr.won_amount) : null,
      coverage_pct: typeof coverage_pct === "number" ? coverage_pct : 0,
      total_opps,
      reviewed_opps,
      weakest_categories,
      avg_meddpicc,
      avg_delta: vel?.avgDelta != null && Number.isFinite(vel.avgDelta) ? vel.avgDelta : 0,
      deals_moving: vel?.dealsMoving ?? 0,
      deals_flat: vel?.dealsFlat ?? 0,
      progressing: prog?.progressing ?? 0,
      stalled: prog?.stalled ?? 0,
    });
  }

  return out;
}

function teamAvgForCategory(
  repRows: AssessmentHygieneRow[],
  catKey: (typeof MEDDPICC_CATEGORIES)[number]["key"]
): number {
  if (!repRows.length) return 0;
  let sum = 0;
  let n = 0;
  for (const r of repRows) {
    const v = r[catKey];
    if (v != null && Number.isFinite(v)) {
      sum += Number(v);
      n += 1;
    }
  }
  return n ? sum / n : 0;
}

function paceRatioFromPeriod(periodStart?: string, periodEnd?: string): number {
  if (!periodStart || !periodEnd) return 1;
  const today = new Date();
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const totalDays = Math.max(1, (end.getTime() - start.getTime()) / 86400000);
  const daysPassed = Math.max(0, Math.min(totalDays, (today.getTime() - start.getTime()) / 86400000));
  return daysPassed / totalDays;
}

export function TeamForecastHygienePanels(props: {
  pipelineHygiene: PipelineHygienePayload;
  periodName?: string;
  sectionClassName?: string;
  /** Quota / attainment / won for coaching cards (e.g. team tab rep rows). */
  coachingRepRows?: RepManagerRepRow[] | null;
  coachingPeriodStart?: string;
  coachingPeriodEnd?: string;
}) {
  const { pipelineHygiene: h, periodName, coachingRepRows, coachingPeriodStart, coachingPeriodEnd } = props;
  const sectionClass = props.sectionClassName ?? "mt-4 space-y-4";
  const [showDetail, setShowDetail] = useState(false);

  const coverageRepRows = h.coverageRows.filter((r) => r.rep_id > 0);
  const coverageRollupRows = h.coverageRows.filter((r) => r.rep_id < 0);
  const coverageRollupN = coverageRollupRows.length;

  const assessmentRepRows = h.assessmentRows.filter((r) => r.rep_id > 0);
  const assessmentRollupRows = h.assessmentRows.filter((r) => r.rep_id < 0);
  const assessmentRollupN = assessmentRollupRows.length;

  const velocityRepRows = h.velocitySummaries.filter((r) => r.repId > 0);
  const velocityRollupRows = h.velocitySummaries.filter((r) => r.repId < 0);
  const velocityRollupN = velocityRollupRows.length;

  const progressionRepRows = h.progressionSummaries.filter((r) => r.repId > 0);
  const progressionRollupRows = h.progressionSummaries.filter((r) => r.repId < 0);
  const progressionRollupN = progressionRollupRows.length;

  const teamTotalRow = coverageRollupRows.length === 1 ? coverageRollupRows[0] : null;
  const teamCoverage =
    teamTotalRow?.coverage_pct != null
      ? teamTotalRow.coverage_pct
      : avgCoverage(coverageRepRows);
  const teamReviewed = teamTotalRow
    ? teamTotalRow.reviewed_opps
    : coverageRepRows.reduce((s, r) => s + r.reviewed_opps, 0);
  const teamTotal = teamTotalRow
    ? teamTotalRow.total_opps
    : coverageRepRows.reduce((s, r) => s + r.total_opps, 0);

  const coverageColor =
    teamCoverage >= 80 ? "text-green-400" : teamCoverage >= 60 ? "text-yellow-400" : "text-red-400";
  const coverageBarColor =
    teamCoverage >= 80 ? "bg-green-400" : teamCoverage >= 60 ? "bg-yellow-400" : "bg-red-400";

  const meddpiccAvg = useMemo(() => {
    if (assessmentRollupRows.length === 1 && assessmentRollupRows[0].avg_total != null) {
      return Number(assessmentRollupRows[0].avg_total);
    }
    const vals = assessmentRepRows.map((r) => r.avg_total).filter((v): v is number => v != null && Number.isFinite(v));
    if (!vals.length) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [assessmentRepRows, assessmentRollupRows]);

  const weakestCategory = useMemo(() => {
    const avgs = MEDDPICC_CATEGORIES.map((c) => ({
      label: c.label,
      v: teamAvgForCategory(assessmentRepRows, c.key),
    })).sort((a, b) => a.v - b.v);
    return avgs[0]?.label ?? "—";
  }, [assessmentRepRows]);

  const meddpiccColor =
    meddpiccAvg >= 2 ? "text-green-400" : meddpiccAvg >= 1 ? "text-yellow-400" : "text-red-400";

  const avgDelta = useMemo(() => {
    if (velocityRollupRows.length === 1) return velocityRollupRows[0].avgDelta;
    if (!velocityRepRows.length) return 0;
    return velocityRepRows.reduce((s, r) => s + r.avgDelta, 0) / velocityRepRows.length;
  }, [velocityRepRows, velocityRollupRows]);

  const velocityColor = avgDelta > 0 ? "text-green-400" : avgDelta < 0 ? "text-red-400" : "text-[color:var(--sf-text-secondary)]";

  const dealsMoving = useMemo(() => {
    if (velocityRollupRows.length === 1) return velocityRollupRows[0].dealsMoving;
    return velocityRepRows.reduce((s, r) => s + r.dealsMoving, 0);
  }, [velocityRepRows, velocityRollupRows]);

  const dealsFlat = useMemo(() => {
    if (velocityRollupRows.length === 1) return velocityRollupRows[0].dealsFlat;
    return velocityRepRows.reduce((s, r) => s + r.dealsFlat, 0);
  }, [velocityRepRows, velocityRollupRows]);

  const progressingCount = useMemo(() => {
    if (progressionRollupRows.length === 1) return progressionRollupRows[0].progressing;
    return progressionRepRows.reduce((s, r) => s + r.progressing, 0);
  }, [progressionRepRows, progressionRollupRows]);

  const stalledCount = useMemo(() => {
    if (progressionRollupRows.length === 1) return progressionRollupRows[0].stalled;
    return progressionRepRows.reduce((s, r) => s + r.stalled, 0);
  }, [progressionRepRows, progressionRollupRows]);

  const progressionColor =
    progressingCount > stalledCount ? "text-green-400" : stalledCount > progressingCount ? "text-red-400" : "text-yellow-400";

  const radarData = useMemo(() => {
    return MEDDPICC_CATEGORIES.map((cat) => {
      const point: Record<string, string | number> = { category: cat.label };
      for (const rep of assessmentRepRows) {
        const v = rep[cat.key as keyof AssessmentHygieneRow];
        point[rep.rep_name] = v != null && Number.isFinite(Number(v)) ? Number(v) : 0;
      }
      point["Team Avg"] = teamAvgForCategory(assessmentRepRows, cat.key);
      return point;
    });
  }, [assessmentRepRows]);

  const repCoaching = useMemo(() => buildRepCoachingData(h, coachingRepRows ?? null), [h, coachingRepRows]);

  const sortedReps = useMemo(() => {
    return [...repCoaching].sort((a, b) => {
      const aa = a.attainment ?? 1.01;
      const bb = b.attainment ?? 1.01;
      return aa - bb;
    });
  }, [repCoaching]);

  const lowestAttainmentRepId = useMemo(() => {
    let min = Infinity;
    let id: string | null = null;
    for (const r of repCoaching) {
      if (r.attainment == null || !Number.isFinite(r.attainment)) continue;
      if (r.attainment < min) {
        min = r.attainment;
        id = r.rep_id;
      }
    }
    return id;
  }, [repCoaching]);

  const repRadarColor = (repId: string, seriesIndex: number) => {
    if (repId === lowestAttainmentRepId) return "#E74C3C";
    return CHART_COLORS[seriesIndex % CHART_COLORS.length];
  };

  const paceRatio = paceRatioFromPeriod(coachingPeriodStart, coachingPeriodEnd);

  const managerCard = useMemo(() => {
    const rows = coachingRepRows ?? [];
    const quotaSum = rows.reduce((s, r) => s + (Number(r.quota) || 0), 0);
    const wonSum = rows.reduce((s, r) => s + (Number(r.won_amount) || 0), 0);
    const teamAttnPct = quotaSum > 0 ? (wonSum / quotaSum) * 100 : null;
    const uniqueMgrNames = Array.from(new Set(rows.map((r) => String(r.manager_name || "").trim()).filter(Boolean)));
    const mgrName =
      coverageRollupRows.length === 1
        ? coverageRollupRows[0].rep_name
        : uniqueMgrNames.length === 1
          ? uniqueMgrNames[0]
          : rows.length
            ? "Team"
            : "Team";
    const label = `${mgrName}'s Team`;
    const teamWeakest = weakestCategory;
    return {
      label,
      teamAttnPct,
      teamCoverage,
      meddpiccAvg,
      avgDelta,
      teamWeakest,
    };
  }, [coachingRepRows, coverageRollupRows, teamCoverage, meddpiccAvg, avgDelta, weakestCategory]);

  /** Attainment from coaching rows is 0–1; display as 0–100 with one decimal. */
  const attainmentPctDisplay = (attainment: number | null) =>
    attainment != null && Number.isFinite(attainment) ? Math.round(attainment * 1000) / 10 : null;

  const cardBorderForRep = (rep: RepCoachingData) => {
    const quota = rep.quota ?? 0;
    const won = rep.won_amount ?? 0;
    const expectedAtPace = quota * paceRatio;
    const paceScore = quota > 0 ? won / expectedAtPace : null;
    const paceStatus =
      paceScore == null || !Number.isFinite(paceScore)
        ? "unknown"
        : paceScore >= 0.9
          ? "on_track"
          : paceScore >= 0.7
            ? "at_risk"
            : "behind";
    if (paceStatus === "on_track") return "border-green-500/40 bg-green-500/5";
    if (paceStatus === "at_risk") return "border-yellow-500/40 bg-yellow-500/5";
    if (paceStatus === "behind") return "border-red-500/40 bg-red-500/5";
    return "border-[color:var(--sf-border)]";
  };

  const paceIcon = (rep: RepCoachingData) => {
    const quota = rep.quota ?? 0;
    const won = rep.won_amount ?? 0;
    const expectedAtPace = quota * paceRatio;
    const paceScore = quota > 0 ? won / expectedAtPace : null;
    if (paceScore == null || !Number.isFinite(paceScore)) return "·";
    if (paceScore >= 0.9) return "✅";
    if (paceScore >= 0.7) return "⚠️";
    return "🔴";
  };

  const attainmentBarColor = (pct: number) =>
    pct >= 70 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500";

  /** pct is 0–100 (display scale). */
  const attainmentTextColor = (pct: number) =>
    pct >= 70 ? "text-green-400" : pct >= 50 ? "text-yellow-400" : "text-red-400";

  return (
    <section className={sectionClass}>
      <header>
        <div className="px-1">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">
            Coaching Intelligence
            {periodName ? ` — ${periodName}` : ""}
          </h2>
        </div>
      </header>

      {/* SECTION 1 — Score boxes */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Coverage</div>
          <div className={`text-3xl font-bold mt-1 ${coverageColor}`}>{Math.round(teamCoverage)}%</div>
          <div className="mt-2 h-1.5 rounded-full bg-[color:var(--sf-surface-alt)]">
            <div
              className={`h-1.5 rounded-full ${coverageBarColor}`}
              style={{ width: `${Math.min(100, teamCoverage)}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
            {teamReviewed}/{teamTotal} reviewed
          </div>
        </div>

        <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">MEDDPICC Avg</div>
          <div className={`text-3xl font-bold mt-1 ${meddpiccColor}`}>{meddpiccAvg.toFixed(1)}</div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Weakest: {weakestCategory}</div>
        </div>

        <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Score Velocity</div>
          <div className={`text-3xl font-bold mt-1 ${velocityColor}`}>
            {avgDelta >= 0 ? "+" : ""}
            {avgDelta.toFixed(1)}
          </div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
            {dealsMoving} moving · {dealsFlat} flat
          </div>
        </div>

        <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Progression</div>
          <div className={`text-3xl font-bold mt-1 ${progressionColor}`}>{progressingCount}</div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
            progressing · {stalledCount} stalled
          </div>
        </div>
      </div>

      {/* SECTION 2 — Radar */}
      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 mt-5">
        <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)] mb-4">MEDDPICC+TB by Rep</h3>
        {assessmentRepRows.length ? (
          <ResponsiveContainer width="100%" height={380}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="var(--sf-border)" />
              <PolarAngleAxis dataKey="category" tick={{ fill: "var(--sf-text-secondary)", fontSize: 11 }} />
              <PolarRadiusAxis domain={[0, 3]} tick={{ fill: "var(--sf-text-secondary)", fontSize: 9 }} angle={90} />
              {assessmentRepRows.map((arow, i) => (
                <Radar
                  key={arow.rep_id}
                  name={arow.rep_name}
                  dataKey={arow.rep_name}
                  stroke={repRadarColor(String(arow.rep_id), i)}
                  fill={repRadarColor(String(arow.rep_id), i)}
                  fillOpacity={0.15}
                />
              ))}
              <Radar name="Team Avg" dataKey="Team Avg" stroke="#666" fill="none" strokeDasharray="4 4" fillOpacity={0} />
              <Legend wrapperStyle={{ color: "var(--sf-text-secondary)", fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  background: "var(--sf-surface)",
                  border: "1px solid var(--sf-border)",
                  color: "var(--sf-text-primary)",
                }}
              />
            </RadarChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-sm text-[color:var(--sf-text-secondary)]">No assessment data for this period.</div>
        )}
      </section>

      {/* SECTION 3 — Manager + rep cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">{managerCard.label}</div>
          <div className="mt-2 text-2xl font-bold text-[color:var(--sf-text-primary)]">
            {managerCard.teamAttnPct != null ? `${Math.round(managerCard.teamAttnPct * 10) / 10}%` : "—"}{" "}
            <span className="text-sm font-normal text-[color:var(--sf-text-secondary)]">attainment</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[color:var(--sf-text-secondary)]">
            <div>
              Coverage:{" "}
              <span className="font-semibold text-[color:var(--sf-text-primary)]">{Math.round(managerCard.teamCoverage)}%</span>
            </div>
            <div>
              MEDDPICC:{" "}
              <span className="font-semibold text-[color:var(--sf-text-primary)]">{managerCard.meddpiccAvg.toFixed(1)}</span>
            </div>
            <div>
              Velocity Δ:{" "}
              <span className="font-semibold text-[color:var(--sf-text-primary)]">
                {managerCard.avgDelta >= 0 ? "+" : ""}
                {managerCard.avgDelta.toFixed(1)}
              </span>
            </div>
            <div>
              Weakest:{" "}
              <span className="font-semibold text-[color:var(--sf-text-primary)]">{managerCard.teamWeakest}</span>
            </div>
          </div>
        </div>

        {sortedReps.map((rep) => {
          const pct = attainmentPctDisplay(rep.attainment) ?? 0;
          return (
            <div key={rep.rep_id} className={`rounded-xl border p-4 ${cardBorderForRep(rep)}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-[color:var(--sf-text-primary)]">
                    {paceIcon(rep)} {rep.rep_name}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-2xl font-bold ${attainmentTextColor(pct)}`}>
                    {attainmentPctDisplay(rep.attainment) != null ? `${attainmentPctDisplay(rep.attainment)}%` : "—"}
                  </div>
                  <div className="text-xs text-[color:var(--sf-text-secondary)]">attainment</div>
                </div>
              </div>

              <div className="mt-2 h-1.5 rounded-full bg-[color:var(--sf-surface-alt)]">
                <div
                  className={`h-1.5 rounded-full ${attainmentBarColor(pct)}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                {fmtMoney(rep.won_amount)} / {fmtMoney(rep.quota)}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-[color:var(--sf-text-secondary)]">
                  Coverage
                  <span className="ml-1 font-semibold text-[color:var(--sf-text-primary)]">{rep.coverage_pct}%</span>
                </div>
                <div className="text-[color:var(--sf-text-secondary)]">
                  MEDDPICC Avg
                  <span className="ml-1 font-semibold text-[color:var(--sf-text-primary)]">{rep.avg_meddpicc.toFixed(1)}</span>
                </div>
                <div className="text-[color:var(--sf-text-secondary)]">
                  Velocity
                  <span
                    className={`ml-1 font-semibold ${
                      rep.avg_delta > 0 ? "text-green-400" : "text-[color:var(--sf-text-secondary)]"
                    }`}
                  >
                    {rep.avg_delta >= 0 ? "+" : ""}
                    {rep.avg_delta.toFixed(1)}
                  </span>
                </div>
                <div className="text-[color:var(--sf-text-secondary)]">
                  Flat deals
                  <span className="ml-1 font-semibold text-[color:var(--sf-text-primary)]">{rep.deals_flat}</span>
                </div>
              </div>

              {rep.weakest_categories.length > 0 && (
                <div className="mt-3 text-xs">
                  <span className="text-[color:var(--sf-text-secondary)]">Focus areas: </span>
                  {rep.weakest_categories.map((cat) => (
                    <span
                      key={cat}
                      className="ml-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-red-400"
                    >
                      {cat}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setShowDetail((v) => !v)}
        className="mt-6 text-sm text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)]"
      >
        {showDetail ? "▲ Hide Detail Data" : "▼ View Detail Data"}
      </button>

      {showDetail && (
        <div className="mt-4 space-y-6">
          <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Coverage</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="px-3 py-2 text-left">Rep</th>
                    <th className="px-3 py-2 text-right">Total Opps</th>
                    <th className="px-3 py-2 text-right">Reviewed</th>
                    <th className="px-3 py-2 text-right">Coverage %</th>
                  </tr>
                </thead>
                <tbody>
                  {coverageRepRows.map((row) => (
                    <tr key={row.rep_id} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-3 py-2 text-[color:var(--sf-text-primary)]">{row.rep_name}</td>
                      <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.total_opps}</td>
                      <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.reviewed_opps}</td>
                      <td className={`px-3 py-2 text-right font-medium ${coveragePctTextClass(row.coverage_pct)}`}>
                        {row.coverage_pct != null ? `${row.coverage_pct}%` : "—"}
                      </td>
                    </tr>
                  ))}
                  {coverageRollupRows.map((row) => (
                    <tr key={row.rep_id} className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]">
                      <td className="px-3 py-2 font-semibold">{rollupRowLabel(row.rep_name, coverageRollupN)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{row.total_opps}</td>
                      <td className="px-3 py-2 text-right font-semibold">{row.reviewed_opps}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${coveragePctTextClass(row.coverage_pct)}`}>
                        {row.coverage_pct != null ? `${row.coverage_pct}%` : "—"}
                      </td>
                    </tr>
                  ))}
                  {!h.coverageRows.length && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-xs text-[color:var(--sf-text-secondary)]">
                        No opportunities found for this quarter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Matthew&apos;s Assessment (MEDDPICC+TB)</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full border-collapse text-[11px]">
                <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="px-2 py-2 text-left">Rep</th>
                    {["Pain", "Metrics", "Champion", "EB", "Criteria", "Process", "Competition", "Paper", "Timing", "Budget", "Avg"].map((x) => (
                      <th key={x} className="px-2 py-2 text-center">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {assessmentRepRows.map((row) => (
                    <tr key={row.rep_id} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-2 py-2 whitespace-nowrap text-[color:var(--sf-text-primary)]">{row.rep_name}</td>
                      {[row.pain, row.metrics, row.champion, row.eb, row.criteria, row.process, row.competition, row.paper, row.timing, row.budget, row.avg_total].map(
                        (v, idx) => (
                          <td key={idx} className={`px-2 py-1 text-center font-mono ${assessmentScoreTextClass(v)}`}>
                            {v != null ? v : "—"}
                          </td>
                        )
                      )}
                    </tr>
                  ))}
                  {assessmentRollupRows.map((row) => (
                    <tr key={row.rep_id} className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]">
                      <td className="px-2 py-2 whitespace-nowrap font-semibold">{rollupRowLabel(row.rep_name, assessmentRollupN)}</td>
                      {[row.pain, row.metrics, row.champion, row.eb, row.criteria, row.process, row.competition, row.paper, row.timing, row.budget, row.avg_total].map(
                        (v, idx) => (
                          <td key={idx} className={`px-2 py-1 text-center font-mono font-semibold ${assessmentScoreTextClass(v)}`}>
                            {v != null ? v : "—"}
                          </td>
                        )
                      )}
                    </tr>
                  ))}
                  {!h.assessmentRows.length && (
                    <tr>
                      <td colSpan={12} className="px-3 py-4 text-center text-xs text-[color:var(--sf-text-secondary)]">
                        No reviewed deals found for this quarter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Score Velocity</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
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
                  {velocityRepRows.map((row) => (
                    <tr key={row.repId} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-3 py-2 whitespace-nowrap text-[color:var(--sf-text-primary)]">{row.repName}</td>
                      <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                        {Number.isFinite(row.avgBaseline) ? row.avgBaseline.toFixed(1) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                        {Number.isFinite(row.avgCurrent) ? row.avgCurrent.toFixed(1) : "—"}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono ${deltaTextClass(row.avgDelta)}`}>
                        {Number.isFinite(row.avgDelta) ? row.avgDelta.toFixed(1) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.dealsMoving}</td>
                      <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.dealsFlat}</td>
                    </tr>
                  ))}
                  {velocityRollupRows.map((row) => (
                    <tr key={row.repId} className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]">
                      <td className="px-3 py-2 whitespace-nowrap font-semibold">{rollupRowLabel(row.repName, velocityRollupN)}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {Number.isFinite(row.avgBaseline) ? row.avgBaseline.toFixed(1) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {Number.isFinite(row.avgCurrent) ? row.avgCurrent.toFixed(1) : "—"}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold ${deltaTextClass(row.avgDelta)}`}>
                        {Number.isFinite(row.avgDelta) ? row.avgDelta.toFixed(1) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">{row.dealsMoving}</td>
                      <td className="px-3 py-2 text-right font-semibold">{row.dealsFlat}</td>
                    </tr>
                  ))}
                  {!h.velocitySummaries.length && (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-xs text-[color:var(--sf-text-secondary)]">
                        No score changes found for this quarter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Deal Progression</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="px-3 py-2 text-left">Rep</th>
                    <th className="px-3 py-2 text-right">Progressing</th>
                    <th className="px-3 py-2 text-right">Stalled</th>
                    <th className="px-3 py-2 text-right">Flat</th>
                    <th className="px-3 py-2 text-right">Total Reviewed</th>
                  </tr>
                </thead>
                <tbody>
                  {progressionRepRows.map((row) => (
                    <tr key={row.repId} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-3 py-2 whitespace-nowrap text-[color:var(--sf-text-primary)]">{row.repName}</td>
                      <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.progressing}</td>
                      <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.stalled}</td>
                      <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.flat}</td>
                      <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.total}</td>
                    </tr>
                  ))}
                  {progressionRollupRows.map((row) => (
                    <tr key={row.repId} className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]">
                      <td className="px-3 py-2 whitespace-nowrap font-semibold">{rollupRowLabel(row.repName, progressionRollupN)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{row.progressing}</td>
                      <td className="px-3 py-2 text-right font-semibold">{row.stalled}</td>
                      <td className="px-3 py-2 text-right font-semibold">{row.flat}</td>
                      <td className="px-3 py-2 text-right font-semibold">{row.total}</td>
                    </tr>
                  ))}
                  {!h.progressionSummaries.length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-xs text-[color:var(--sf-text-secondary)]">
                        No progression data found for this quarter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
