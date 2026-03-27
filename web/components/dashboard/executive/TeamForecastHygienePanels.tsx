"use client";

import { useMemo, useState } from "react";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from "recharts";
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

function coveragePctTextClass(pct: number | null): string {
  if (pct == null) return "text-[color:var(--sf-text-primary)]";
  if (pct === 0) return "text-red-600";
  if (pct === 100) return "text-green-600";
  return "text-[color:var(--sf-text-primary)]";
}

/** MEDDPICC+TB category average → letter band (same scale as Report Builder). */
function lmhFromAvg(avg: number | null | undefined): string {
  if (avg === null || avg === undefined) return "—";
  const n = Number(avg);
  if (!Number.isFinite(n)) return "—";
  if (n <= 0) return "L";
  if (n <= 2) return "M";
  return "H";
}

function lmhLetterTextClass(letter: string): string {
  if (letter === "L") return "text-red-400";
  if (letter === "M") return "text-yellow-400";
  if (letter === "H") return "text-green-400";
  return "text-[color:var(--sf-text-secondary)]";
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

function normalizeRepName(name: unknown): string {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
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
    const repIdKey = String(repId ?? "");
    const cov = covBy.get(repIdKey);
    const ass = assBy.get(repIdKey);
    const vel = velBy.get(repIdKey);
    const prog = progBy.get(repIdKey);
    const repName =
      cov?.rep_name ??
      ass?.rep_name ??
      vel?.repName ??
      prog?.repName ??
      coachingRepRows?.find((r) => String(r.rep_id) === repIdKey)?.rep_name ??
      `Rep ${repIdKey}`;
    const repNameKey = normalizeRepName(repName);
    const cr =
      coachingRepRows?.find(
        (r) => String(r.rep_id) === String(repIdKey) || normalizeRepName(r.rep_name) === repNameKey
      ) ?? null;

    const coverage_pct = cov?.coverage_pct ?? 0;
    const total_opps = cov?.total_opps ?? 0;
    const reviewed_opps = cov?.reviewed_opps ?? 0;

    const weakest_categories = weakestCategoryLabelsFromScores(
      MEDDPICC_CATEGORIES.map((cat) => ({
        label: cat.label,
        score: Number(ass?.[cat.key as keyof AssessmentHygieneRow] ?? 0),
      }))
    );

    const avg_meddpicc = ass?.avg_total != null && Number.isFinite(ass.avg_total) ? Number(ass.avg_total) : 0;

    out.push({
      rep_id: repIdKey,
      rep_name: repName,
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

function weakestCategoryLabelsFromScores(scores: Array<{ label: string; score: number }>): string[] {
  return scores
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((c) => c.label);
}

function weakestCategoryLabelsForRows(rows: AssessmentHygieneRow[]): string[] {
  if (!rows.length) return [];
  return weakestCategoryLabelsFromScores(
    MEDDPICC_CATEGORIES.map((c) => ({
      label: c.label,
      score: teamAvgForCategory(rows, c.key),
    }))
  );
}

type PaceStatus = "on_track" | "at_risk" | "behind" | "unknown";

type ManagerCoachingTeam = {
  managerId: string;
  managerName: string;
  reps: RepCoachingData[];
  repCount: number;
  reviewedCount: number;
  teamCoveragePct: number;
  teamQuotaSum: number;
  teamWonSum: number;
  /** 0–100 display scale (won / quota). */
  teamAttainmentPct: number;
  paceStatus: PaceStatus;
  teamMeddpiccAvg: number;
  teamDelta: number;
  teamFlat: number;
  teamWeakest: string[];
  teamRadarData: { category: string; value: number }[];
};

function paceRatioFromPeriod(periodStart?: string, periodEnd?: string): number {
  if (!periodStart || !periodEnd) return 1;
  const today = new Date();
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const totalDays = Math.max(1, (end.getTime() - start.getTime()) / 86400000);
  const daysPassed = Math.max(0, Math.min(totalDays, (today.getTime() - start.getTime()) / 86400000));
  return daysPassed / totalDays;
}

function calcPaceStatus(wonAmount: number, quota: number, paceRatio: number): PaceStatus {
  const expectedAtPace = quota * paceRatio;
  const paceScore = quota > 0 ? wonAmount / expectedAtPace : null;
  if (paceScore == null || !Number.isFinite(paceScore)) return "unknown";
  if (paceScore >= 0.9) return "on_track";
  if (paceScore >= 0.7) return "at_risk";
  return "behind";
}

function paceStatusCardClass(s: PaceStatus): string {
  switch (s) {
    case "on_track":
      return "border-green-500/40 bg-green-500/5";
    case "at_risk":
      return "border-yellow-500/40 bg-yellow-500/5";
    case "behind":
      return "border-red-500/40 bg-red-500/5";
    default:
      return "border-[color:var(--sf-border)]";
  }
}

/** Headline / bar: attainment % tiers (not pace). */
function attainmentTierTextClass(pct: number): string {
  if (pct >= 80) return "text-green-600";
  if (pct >= 50) return "text-yellow-600";
  return "text-red-600";
}

function repAttainmentPctDisplay(rep: RepCoachingData): number | null {
  const a = rep.attainment;
  if (a == null || !Number.isFinite(a)) return null;
  return Math.min(100, Math.round(a * 1000) / 10);
}

function aggregateManagerTeam(
  managerId: string,
  managerName: string,
  reps: RepCoachingData[],
  assessmentRepRows: AssessmentHygieneRow[],
  paceRatio: number
): ManagerCoachingTeam {
  const repIdSet = new Set(reps.map((r) => r.rep_id));
  const assessmentSlice = assessmentRepRows.filter((a) => repIdSet.has(String(a.rep_id)));
  const totalOpps = reps.reduce((s, r) => s + r.total_opps, 0);
  const reviewedCount = reps.reduce((s, r) => s + r.reviewed_opps, 0);
  const teamCoveragePct = totalOpps > 0 ? Math.round((reviewedCount / totalOpps) * 100) : 0;
  const teamQuotaSum = reps.reduce((s, r) => s + (Number(r.quota) || 0), 0);
  const teamWonSum = reps.reduce((s, r) => s + (Number(r.won_amount) || 0), 0);
  const teamAttainmentPct =
    teamQuotaSum > 0 ? Math.min(100, (teamWonSum / teamQuotaSum) * 100) : 0;
  const paceStatus = calcPaceStatus(teamWonSum, teamQuotaSum, paceRatio);
  const n = reps.length || 1;
  const teamMeddpiccAvg = reps.length ? reps.reduce((s, r) => s + r.avg_meddpicc, 0) / n : 0;
  const teamDelta = reps.length ? reps.reduce((s, r) => s + r.avg_delta, 0) / n : 0;
  const teamFlat = reps.reduce((s, r) => s + r.deals_flat, 0);
  const teamWeakest = weakestCategoryLabelsForRows(assessmentSlice);
  const teamRadarData = MEDDPICC_CATEGORIES.map((c) => ({
    category: c.label,
    value: teamAvgForCategory(assessmentSlice, c.key),
  }));
  return {
    managerId,
    managerName,
    reps,
    repCount: reps.length,
    reviewedCount,
    teamCoveragePct,
    teamQuotaSum,
    teamWonSum,
    teamAttainmentPct,
    paceStatus,
    teamMeddpiccAvg,
    teamDelta,
    teamFlat,
    teamWeakest,
    teamRadarData,
  };
}

function buildManagerCoachingTeams(
  repCoaching: RepCoachingData[],
  coachingRepRows: RepManagerRepRow[] | null | undefined,
  assessmentRepRows: AssessmentHygieneRow[],
  paceRatio: number
): ManagerCoachingTeam[] {
  const crRows = coachingRepRows ?? [];
  if (repCoaching.length === 0) return [];

  if (crRows.length === 0) {
    return [aggregateManagerTeam("team-all", "Team", [...repCoaching], assessmentRepRows, paceRatio)];
  }

  const byMid = new Map<string, RepCoachingData[]>();
  for (const rep of repCoaching) {
    const repNameKey = normalizeRepName(rep.rep_name);
    const cr =
      crRows.find((r) => String(r.rep_id) === rep.rep_id || normalizeRepName(r.rep_name) === repNameKey) ?? null;
    const mid = cr ? String(cr.manager_id ?? "") : "__unassigned__";
    if (!byMid.has(mid)) byMid.set(mid, []);
    byMid.get(mid)!.push(rep);
  }

  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const r of crRows) {
    const id = String(r.manager_id ?? "");
    if (!seen.has(id) && byMid.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }
  for (const id of byMid.keys()) {
    if (!seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }

  return ordered.map((managerId) => {
    const reps = byMid.get(managerId) ?? [];
    const mgrName =
      crRows.find((r) => String(r.manager_id ?? "") === managerId)?.manager_name?.trim() ||
      (managerId === "__unassigned__" ? "(Unassigned)" : `Manager ${managerId}`);
    return aggregateManagerTeam(managerId, mgrName, reps, assessmentRepRows, paceRatio);
  });
}

function repPaceIcon(rep: RepCoachingData, paceRatio: number): string {
  const s = calcPaceStatus(Number(rep.won_amount) || 0, Number(rep.quota) || 0, paceRatio);
  if (s === "on_track") return "✅";
  if (s === "at_risk") return "⚠️";
  if (s === "behind") return "🔴";
  return "·";
}

function PaceStatusBadge({ paceStatus }: { paceStatus: PaceStatus }) {
  return (
    <div className="mt-1">
      {paceStatus === "on_track" && (
        <span className="text-xs font-semibold text-green-400">✅ On Track</span>
      )}
      {paceStatus === "at_risk" && (
        <span className="text-xs font-semibold text-yellow-400">⚠️ At Risk</span>
      )}
      {paceStatus === "behind" && (
        <span className="text-xs font-semibold text-red-400">🔴 Behind Pace</span>
      )}
    </div>
  );
}

function ManagerCoachingLeaderCard(props: {
  team: ManagerCoachingTeam;
  cardKey: string;
  expanded: boolean;
  onToggle: () => void;
  paceRatio: number;
}) {
  const { team, cardKey, expanded, onToggle, paceRatio } = props;
  const borderColor = paceStatusCardClass(team.paceStatus);
  const headlineColor = attainmentTierTextClass(team.teamAttainmentPct);
  const attDisplay = Math.round(team.teamAttainmentPct * 10) / 10;
  const teamWonSum = team.teamWonSum;
  const teamQuotaSum = team.teamQuotaSum;
  const paceStatus = team.paceStatus;

  const sortedReps = [...team.reps].sort((a, b) => {
    const aa = repAttainmentPctDisplay(a) ?? 999;
    const bb = repAttainmentPctDisplay(b) ?? 999;
    return aa - bb;
  });

  return (
    <div className="min-w-0 w-full">
      <div className={`rounded-xl border p-4 ${borderColor}`}>
        <div className="flex items-start justify-between">
          <div>
            <div className="font-semibold text-[color:var(--sf-text-primary)]">{team.managerName}</div>
            <PaceStatusBadge paceStatus={paceStatus} />
            <div className="text-xs text-[color:var(--sf-text-secondary)] mt-0.5">
              {team.repCount} reps · {team.reviewedCount} reviewed
            </div>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-bold ${headlineColor}`}>{attDisplay}%</div>
            <div className="text-xs text-[color:var(--sf-text-secondary)]">attainment</div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-[color:var(--sf-text-secondary)]">Won</span>
          <span className="font-semibold text-green-400">{fmtMoney(teamWonSum)}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-[color:var(--sf-text-secondary)]">Quota</span>
          <span className="font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(teamQuotaSum)}</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div>
            <div className="text-[color:var(--sf-text-secondary)]">MEDDPICC Avg</div>
            <div className={`font-semibold ${lmhLetterTextClass(lmhFromAvg(team.teamMeddpiccAvg))}`}>
              {lmhFromAvg(team.teamMeddpiccAvg)}
            </div>
          </div>
          <div>
            <div className="text-[color:var(--sf-text-secondary)]">Velocity Δ</div>
            <div
              className={`font-semibold ${
                team.teamDelta > 0 ? "text-green-400" : "text-[color:var(--sf-text-secondary)]"
              }`}
            >
              {team.teamDelta >= 0 ? "+" : ""}
              {team.teamDelta.toFixed(1)}
            </div>
          </div>
          <div>
            <div className="text-[color:var(--sf-text-secondary)]">Flat deals</div>
            <div className="font-semibold text-[color:var(--sf-text-primary)]">{team.teamFlat}</div>
          </div>
          <div>
            <div className="text-[color:var(--sf-text-secondary)]">Coverage</div>
            <div className="font-semibold text-[color:var(--sf-text-primary)]">{team.teamCoveragePct}%</div>
          </div>
        </div>

        {team.teamMeddpiccAvg > 0 && (
          <div className="mt-3">
            <ResponsiveContainer width="100%" height={120}>
              <RadarChart data={team.teamRadarData}>
                <PolarGrid stroke="var(--sf-border)" />
                <PolarAngleAxis dataKey="category" tick={{ fill: "var(--sf-text-secondary)", fontSize: 8 }} />
                <PolarRadiusAxis domain={[0, 3]} tick={false} axisLine={false} />
                <Radar dataKey="value" stroke="#00BCD4" fill="#00BCD4" fillOpacity={0.2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}

        {team.teamWeakest.length > 0 && (
          <div className="mt-2">
            <span className="text-xs text-[color:var(--sf-text-secondary)]">Weakest: </span>
            {team.teamWeakest.slice(0, 4).map((cat) => (
              <span
                key={cat}
                className="ml-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-white"
              >
                {cat}
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onToggle}
          className="mt-3 text-xs text-[color:var(--sf-accent-primary)] hover:underline"
        >
          {expanded ? "▲ Hide reps" : "▼ See reps"}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] divide-y divide-[color:var(--sf-border)]">
          {sortedReps.map((rep) => {
            const repPct = repAttainmentPctDisplay(rep);
            const repPaceStatus = calcPaceStatus(Number(rep.won_amount) || 0, Number(rep.quota) || 0, paceRatio);
            const attClass =
              repPct != null ? attainmentTierTextClass(repPct) : "text-[color:var(--sf-text-secondary)]";
            const attLabel =
              repPct != null ? `${Math.round(repPct * 10) / 10}%` : "—";
            return (
              <div key={`${cardKey}-${rep.rep_id}`} className="flex items-start justify-between px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[color:var(--sf-text-primary)]">
                    {rep.rep_name}
                  </div>
                  <PaceStatusBadge paceStatus={repPaceStatus} />
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-[color:var(--sf-text-secondary)]">
                    <span>
                      Won:{" "}
                      <span className="ml-1 font-semibold text-[color:var(--sf-text-primary)]">
                        {fmtMoney(rep.won_amount)}
                      </span>
                    </span>
                    <span>
                      Quota:{" "}
                      <span className="ml-1 font-semibold text-[color:var(--sf-text-primary)]">
                        {fmtMoney(rep.quota ?? 0)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-[color:var(--sf-text-secondary)]">
                    <span>
                      Velocity:{" "}
                      <span
                        className={`ml-1 font-semibold ${
                          rep.avg_delta > 0 ? "text-green-400" : "text-[color:var(--sf-text-secondary)]"
                        }`}
                      >
                        {rep.avg_delta >= 0 ? "+" : ""}
                        {rep.avg_delta.toFixed(1)}
                      </span>
                    </span>
                    <span>
                      Flat:{" "}
                      <span className="ml-1 font-semibold text-[color:var(--sf-text-primary)]">{rep.deals_flat}</span>
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-[color:var(--sf-text-secondary)]">
                    <span>
                      Coverage:{" "}
                      <span className="ml-1 font-semibold text-[color:var(--sf-text-primary)]">{rep.coverage_pct}%</span>
                    </span>
                    <span>
                      MEDDPICC:{" "}
                      <span className={`ml-1 font-semibold ${lmhLetterTextClass(lmhFromAvg(rep.avg_meddpicc))}`}>
                        {lmhFromAvg(rep.avg_meddpicc)}
                      </span>
                    </span>
                  </div>
                  {rep.weakest_categories.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="text-xs text-[color:var(--sf-text-secondary)] mr-1">Top Risk:</span>
                      {rep.weakest_categories.map((cat) => (
                        <span
                          key={cat}
                          className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-white"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0 ml-4">
                  <div className={`text-sm font-bold ${attClass}`}>{attLabel}</div>
                  <div className="text-xs text-[color:var(--sf-text-secondary)]">attainment</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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

  const weakestCategories = useMemo(() => {
    return weakestCategoryLabelsFromScores(
      MEDDPICC_CATEGORIES.map((c) => ({
        label: c.label,
        score: teamAvgForCategory(assessmentRepRows, c.key),
      }))
    );
  }, [assessmentRepRows]);

  const weakestCategoryDisplay = weakestCategories.length ? weakestCategories.slice(0, 3).join(", ") : "—";

  const meddpiccLetter = lmhFromAvg(meddpiccAvg);
  const meddpiccColor = lmhLetterTextClass(meddpiccLetter);

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

  const repCoaching = useMemo(() => buildRepCoachingData(h, coachingRepRows ?? null), [h, coachingRepRows]);

  const coachingPaceRatio = useMemo(
    () => paceRatioFromPeriod(coachingPeriodStart, coachingPeriodEnd),
    [coachingPeriodStart, coachingPeriodEnd]
  );

  const managerCoachingTeams = useMemo(
    () => buildManagerCoachingTeams(repCoaching, coachingRepRows ?? null, assessmentRepRows, coachingPaceRatio),
    [repCoaching, coachingRepRows, assessmentRepRows, coachingPaceRatio]
  );

  const [expandedManagerKeys, setExpandedManagerKeys] = useState<Set<string>>(new Set());

  function toggleManagerExpand(managerKey: string) {
    setExpandedManagerKeys((prev) => {
      const next = new Set(prev);
      if (next.has(managerKey)) next.delete(managerKey);
      else next.add(managerKey);
      return next;
    });
  }

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
          <div className={`text-3xl font-bold mt-1 ${meddpiccColor}`}>{meddpiccLetter}</div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Weakest: {weakestCategoryDisplay}</div>
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

      {/* Manager leader cards + expandable rep rows (Team tab pattern) */}
      <div className="mt-6 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {managerCoachingTeams.map((team) => {
          const cardKey = `mgr:${team.managerId}`;
          return (
            <ManagerCoachingLeaderCard
              key={cardKey}
              cardKey={cardKey}
              team={team}
              expanded={expandedManagerKeys.has(cardKey)}
              onToggle={() => toggleManagerExpand(cardKey)}
              paceRatio={coachingPaceRatio}
            />
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
            <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Averages shown as L (0), M (1–2), H (3)</p>
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
                        (v, idx) => {
                          const letter = lmhFromAvg(v);
                          return (
                            <td key={idx} className={`px-2 py-1 text-center font-semibold ${lmhLetterTextClass(letter)}`}>
                              {letter}
                            </td>
                          );
                        }
                      )}
                    </tr>
                  ))}
                  {assessmentRollupRows.map((row) => (
                    <tr key={row.rep_id} className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]">
                      <td className="px-2 py-2 whitespace-nowrap font-semibold">{rollupRowLabel(row.rep_name, assessmentRollupN)}</td>
                      {[row.pain, row.metrics, row.champion, row.eb, row.criteria, row.process, row.competition, row.paper, row.timing, row.budget, row.avg_total].map(
                        (v, idx) => {
                          const letter = lmhFromAvg(v);
                          return (
                            <td key={idx} className={`px-2 py-1 text-center font-semibold ${lmhLetterTextClass(letter)}`}>
                              {letter}
                            </td>
                          );
                        }
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
