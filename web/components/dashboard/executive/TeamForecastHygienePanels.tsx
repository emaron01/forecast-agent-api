"use client";

import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import type {
  RepManagerManagerRow,
  RepManagerRepRow,
} from "../../../app/components/dashboard/executive/RepManagerComparisonPanel";

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
    const cr = coachingRepRows?.find((r) => String(r.rep_id) === repIdKey) ?? null;

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
  if (!rows.length) {
    return weakestCategoryLabelsFromScores(
      MEDDPICC_CATEGORIES.map((c) => ({
        label: c.label,
        score: 0,
      }))
    );
  }
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
  /** Reps shown under this card when expanded (excludes reps who are sub-managers). */
  leafReps?: RepCoachingData[];
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
  const won = Number(rep.won_amount);
  const quota = Number(rep.quota);
  if (Number.isFinite(won) && Number.isFinite(quota) && quota > 0) {
    return Math.min(100, Math.round((won / quota) * 1000) / 10);
  }
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

function coachingBucketForRow(cr: RepManagerRepRow | null): string {
  if (!cr) return "__orphan__";
  const m = String(cr.manager_id ?? "").trim();
  return m === "" ? "__unassigned__" : m;
}

/** Legacy flat list when `coachingManagerRows` is empty (no org tree). */
function buildLegacyFlatCoachingTeams(
  repCoaching: RepCoachingData[],
  coachingRepRows: RepManagerRepRow[] | null | undefined,
  assessmentRepRows: AssessmentHygieneRow[],
  paceRatio: number,
  teamViewerRepId?: string | null
): ManagerCoachingTeam[] {
  const crRows = coachingRepRows ?? [];
  const viewerKey =
    teamViewerRepId != null && String(teamViewerRepId).trim() !== "" ? String(teamViewerRepId).trim() : null;

  if (repCoaching.length === 0) return [];

  if (crRows.length === 0) {
    return [aggregateManagerTeam("team-all", "Team", [...repCoaching], assessmentRepRows, paceRatio)];
  }

  const byMid = new Map<string, RepCoachingData[]>();
  for (const rep of repCoaching) {
    const cr = crRows.find((r) => String(r.rep_id) === String(rep.rep_id)) ?? null;
    const bucket = coachingBucketForRow(cr);
    if (!byMid.has(bucket)) byMid.set(bucket, []);
    byMid.get(bucket)!.push(rep);
  }

  const directReps = viewerKey && byMid.has(viewerKey) ? (byMid.get(viewerKey) ?? []).slice() : [];
  if (viewerKey && byMid.has(viewerKey)) byMid.delete(viewerKey);

  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const r of crRows) {
    const bucket = coachingBucketForRow(r);
    if (viewerKey && bucket === viewerKey) continue;
    if (!seen.has(bucket) && byMid.has(bucket)) {
      ordered.push(bucket);
      seen.add(bucket);
    }
  }
  for (const id of byMid.keys()) {
    if (!seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }

  const directTeams: ManagerCoachingTeam[] = directReps.map((rep) =>
    aggregateManagerTeam(
      `direct:${rep.rep_id}`,
      String(rep.rep_name || "").trim() || `Rep ${rep.rep_id}`,
      [rep],
      assessmentRepRows,
      paceRatio
    )
  );

  const managerTeams = ordered.map((managerId) => {
    const reps = byMid.get(managerId) ?? [];
    const mgrName =
      managerId === "__unassigned__"
        ? "(Unassigned)"
        : managerId === "__orphan__"
          ? "(Unassigned)"
          : crRows.find((r) => coachingBucketForRow(r) === managerId)?.manager_name?.trim() || `Manager ${managerId}`;
    return aggregateManagerTeam(managerId, mgrName, reps, assessmentRepRows, paceRatio);
  });

  return [...directTeams, ...managerTeams];
}

function mergeManagerMetaIntoTeam(
  team: ManagerCoachingTeam,
  mgrMeta: RepManagerManagerRow | undefined,
  paceRatio: number,
  repCountDisplay: number,
  leafReps: RepCoachingData[]
): ManagerCoachingTeam {
  if (!mgrMeta) {
    return { ...team, repCount: repCountDisplay, leafReps };
  }
  const q = Number(mgrMeta.quota) || 0;
  const w = Number(mgrMeta.won_amount) || 0;
  const attPct =
    mgrMeta.attainment != null && Number.isFinite(Number(mgrMeta.attainment))
      ? Math.min(100, Number(mgrMeta.attainment) * 100)
      : q > 0
        ? Math.min(100, (w / q) * 100)
        : team.teamAttainmentPct;
  return {
    ...team,
    teamQuotaSum: q,
    teamWonSum: w,
    teamAttainmentPct: attPct,
    paceStatus: calcPaceStatus(w, q, paceRatio),
    repCount: repCountDisplay,
    leafReps,
  };
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
  paceRatio: number;
  expandKeys: Set<string>;
  toggleExpandKey: (key: string) => void;
  /** Rendered inside the expanded panel before leaf rep rows (e.g. nested manager cards). */
  expandedBeforeReps?: ReactNode;
}) {
  const { team, cardKey, paceRatio, expandKeys, toggleExpandKey, expandedBeforeReps } = props;
  const expandKey = `mgr:${team.managerId}`;
  const expanded = expandKeys.has(expandKey);
  const borderColor = paceStatusCardClass(team.paceStatus);
  const headlineColor = attainmentTierTextClass(team.teamAttainmentPct);
  const attDisplay = Math.round(team.teamAttainmentPct * 10) / 10;
  const teamWonSum = team.teamWonSum;
  const teamQuotaSum = team.teamQuotaSum;
  const paceStatus = team.paceStatus;

  const repListForExpanded = team.leafReps ?? team.reps;
  const sortedReps = [...repListForExpanded].sort((a, b) => {
    const aa = repAttainmentPctDisplay(a) ?? 999;
    const bb = repAttainmentPctDisplay(b) ?? 999;
    return aa - bb;
  });

  return (
    <div className="min-w-0 w-full">
      <div className={`rounded-xl border p-4 ${borderColor}`}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-medium text-[color:var(--sf-text-primary)]">{team.managerName}</div>
            <PaceStatusBadge paceStatus={paceStatus} />
            <div className="text-xs text-[color:var(--sf-text-secondary)] mt-0.5">
              {team.repCount} reps · {team.reviewedCount} reviewed
            </div>
          </div>
          <div className="text-right shrink-0 ml-4">
            <div className={`text-sm font-bold ${headlineColor}`}>{attDisplay}%</div>
            <div className="text-xs text-[color:var(--sf-text-secondary)]">attainment</div>
          </div>
        </div>

        <div className="mt-1 flex flex-wrap gap-3 text-xs text-[color:var(--sf-text-secondary)]">
          <span>
            Won:{" "}
            <span className="ml-1 font-semibold text-green-400">{fmtMoney(teamWonSum)}</span>
          </span>
          <span>
            Quota:{" "}
            <span className="ml-1 font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(teamQuotaSum)}</span>
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-[color:var(--sf-text-secondary)]">
          <span>
            Velocity:{" "}
            <span
              className={`ml-1 font-semibold ${
                team.teamDelta > 0 ? "text-green-400" : "text-[color:var(--sf-text-secondary)]"
              }`}
            >
              {team.teamDelta >= 0 ? "+" : ""}
              {team.teamDelta.toFixed(1)}
            </span>
          </span>
          <span>
            Flat:{" "}
            <span className="ml-1 font-semibold text-[color:var(--sf-text-primary)]">{team.teamFlat}</span>
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-[color:var(--sf-text-secondary)]">
          <span>
            Coverage:{" "}
            <span className="ml-1 font-semibold text-[color:var(--sf-text-primary)]">{team.teamCoveragePct}%</span>
          </span>
          <span>
            MEDDPICC:{" "}
            <span className={`ml-1 font-semibold ${lmhLetterTextClass(lmhFromAvg(team.teamMeddpiccAvg))}`}>
              {lmhFromAvg(team.teamMeddpiccAvg)}
            </span>
          </span>
        </div>

        {team.teamWeakest.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-xs text-[color:var(--sf-text-secondary)] mr-1">Top Risk:</span>
            {team.teamWeakest.map((cat) => (
              <span
                key={cat}
                className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-white"
              >
                {cat}
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => toggleExpandKey(expandKey)}
          className="mt-3 text-xs text-[color:var(--sf-accent-primary)] hover:underline"
        >
          {expanded ? "▲ Hide reps" : "▼ See reps"}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
          {expandedBeforeReps ? (
            <div className="space-y-4 border-b border-[color:var(--sf-border)] p-3">{expandedBeforeReps}</div>
          ) : null}
          <div className="divide-y divide-[color:var(--sf-border)]">
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
  /** Same as Team tab: viewer’s direct reports as top-level coaching cards. */
  teamViewerRepId?: string | null;
  coachingManagerRows?: RepManagerManagerRow[] | null;
}) {
  const {
    pipelineHygiene: h,
    periodName,
    coachingRepRows,
    coachingPeriodStart,
    coachingPeriodEnd,
    teamViewerRepId,
    coachingManagerRows,
  } = props;
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

  const managerRows = coachingManagerRows ?? [];
  const hasCoachingManagerTree = managerRows.length > 0;

  const repsByManager = useMemo(() => {
    const m = new Map<string, RepCoachingData[]>();
    const crRows = coachingRepRows ?? [];
    for (const rep of repCoaching) {
      const cr = crRows.find((r) => String(r.rep_id) === String(rep.rep_id)) ?? null;
      const k = coachingBucketForRow(cr);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(rep);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (repAttainmentPctDisplay(a) ?? 999) - (repAttainmentPctDisplay(b) ?? 999));
    }
    return m;
  }, [repCoaching, coachingRepRows]);

  const viewerCard = useMemo(() => {
    const vk =
      teamViewerRepId != null && String(teamViewerRepId).trim() !== ""
        ? String(teamViewerRepId).trim()
        : null;
    if (!vk || !managerRows.length) return null;
    return managerRows.find((r) => String(r.manager_id) === vk) ?? null;
  }, [managerRows, teamViewerRepId]);

  const unassignedCard = useMemo(
    () => managerRows.find((r) => r.manager_id === "__unassigned__") ?? null,
    [managerRows]
  );

  const legacyFlatTeams = useMemo(
    () =>
      hasCoachingManagerTree
        ? []
        : buildLegacyFlatCoachingTeams(
            repCoaching,
            coachingRepRows ?? null,
            assessmentRepRows,
            coachingPaceRatio,
            teamViewerRepId
          ),
    [hasCoachingManagerTree, repCoaching, coachingRepRows, assessmentRepRows, coachingPaceRatio, teamViewerRepId]
  );

  const [expandedManagerKeys, setExpandedManagerKeys] = useState<Set<string>>(() => {
    const vk =
      teamViewerRepId != null && String(teamViewerRepId).trim() !== ""
        ? String(teamViewerRepId).trim()
        : null;
    return new Set(vk != null ? [`mgr:${vk}`] : []);
  });

  function toggleManagerExpand(managerKey: string) {
    setExpandedManagerKeys((prev) => {
      const next = new Set(prev);
      if (next.has(managerKey)) next.delete(managerKey);
      else next.add(managerKey);
      return next;
    });
  }

  function renderCoachingManagerCard(managerId: string): ReactElement {
    const mid = String(managerId || "").trim();
    const mgrMeta = managerRows.find((r) => String(r.manager_id) === mid);
    const repsUnder = repsByManager.get(mid) ?? [];
    const subManagerCards = managerRows
      .filter((r) => String(r.parent_manager_id || "").trim() === mid && mid !== "")
      .sort(
        (a, b) =>
          (Number(b.attainment ?? -1) - Number(a.attainment ?? -1)) ||
          Number(b.won_amount || 0) - Number(a.won_amount || 0) ||
          String(a.manager_name || "").localeCompare(String(b.manager_name || ""))
      );
    const subManagerIdSet = new Set(subManagerCards.map((r) => String(r.manager_id)));
    const leafRepsUnder = repsUnder.filter((r) => !subManagerIdSet.has(String(r.rep_id)));
    const managerName =
      mid === "__unassigned__"
        ? "(Unassigned)"
        : String(mgrMeta?.manager_name || "").trim() ||
          (mid ? repsUnder[0]?.rep_name : "") ||
          `Manager ${mid || ""}`;
    const baseTeam = aggregateManagerTeam(mid, managerName, repsUnder, assessmentRepRows, coachingPaceRatio);
    const team = mergeManagerMetaIntoTeam(
      baseTeam,
      mgrMeta,
      coachingPaceRatio,
      subManagerCards.length + leafRepsUnder.length,
      leafRepsUnder
    );
    const cardKey = `mgr:${mid || "unassigned"}`;

    return (
      <div key={cardKey} className="min-w-0 w-full">
        <ManagerCoachingLeaderCard
          team={team}
          cardKey={cardKey}
          paceRatio={coachingPaceRatio}
          expandKeys={expandedManagerKeys}
          toggleExpandKey={toggleManagerExpand}
          expandedBeforeReps={
            subManagerCards.length > 0 ? (
              <>
                {subManagerCards.map((sm) => (
                  <div
                    key={String(sm.manager_id)}
                    className="pl-2 ml-1 border-l border-[color:var(--sf-border)]"
                  >
                    {renderCoachingManagerCard(String(sm.manager_id))}
                  </div>
                ))}
              </>
            ) : undefined
          }
        />
      </div>
    );
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

      {/* Manager leader cards + nested tree (same pattern as Team Performance) */}
      <div className="mt-6 grid grid-cols-1 gap-4">
        {hasCoachingManagerTree ? (
          <>
            {viewerCard ? renderCoachingManagerCard(String(viewerCard.manager_id)) : null}
            {unassignedCard ? renderCoachingManagerCard("__unassigned__") : null}
          </>
        ) : (
          legacyFlatTeams.map((team) => (
            <ManagerCoachingLeaderCard
              key={team.managerId}
              cardKey={`mgr:${team.managerId}`}
              team={team}
              paceRatio={coachingPaceRatio}
              expandKeys={expandedManagerKeys}
              toggleExpandKey={toggleManagerExpand}
            />
          ))
        )}
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
