"use client";

import { useMemo, useState } from "react";
import {
  RepManagerComparisonPanel,
  type RepManagerManagerRow,
  type RepManagerRepRow,
} from "./RepManagerComparisonPanel";
import { ExportToExcelButton } from "../../../_components/ExportToExcelButton";

export type TeamLeaderboardProps = {
  repRows: RepManagerRepRow[];
  managerRows: RepManagerManagerRow[];
  periodName: string;
  quotaPeriodId: string;
  fiscalYear: string;
  periodStart: string;
  periodEnd: string;
  allPeriodRows?: RepManagerRepRow[];
};

function fmtMoney(n: unknown) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

function computePaceRatio(periodStart: string, periodEnd: string) {
  const today = new Date();
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const totalDays = Math.max(1, (end.getTime() - start.getTime()) / 86400000);
  const daysPassed = Math.max(0, Math.min(totalDays, (today.getTime() - start.getTime()) / 86400000));
  const paceRatio = daysPassed / totalDays;
  return { totalDays, daysPassed, paceRatio };
}

type PaceStatus = "on_track" | "at_risk" | "behind" | "unknown";

function calcPaceStatus(wonAmount: number, quota: number, paceRatio: number): PaceStatus {
  const expectedAtPace = quota * paceRatio;
  const paceScore = quota > 0 ? wonAmount / expectedAtPace : null;
  if (paceScore === null || !Number.isFinite(paceScore)) return "unknown";
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

function paceStatusBarClass(s: PaceStatus): string {
  switch (s) {
    case "on_track":
      return "bg-green-500";
    case "at_risk":
      return "bg-yellow-500";
    case "behind":
      return "bg-red-500";
    default:
      return "bg-[color:var(--sf-text-secondary)]";
  }
}

function paceStatusPaceTextClass(s: PaceStatus): string {
  switch (s) {
    case "on_track":
      return "text-green-600";
    case "at_risk":
      return "text-yellow-600";
    case "behind":
      return "text-red-600";
    default:
      return "text-[color:var(--sf-text-secondary)]";
  }
}

function attainmentHeaderClass(s: PaceStatus): string {
  switch (s) {
    case "on_track":
      return "text-green-600";
    case "at_risk":
      return "text-yellow-600";
    case "behind":
      return "text-red-600";
    default:
      return "text-[color:var(--sf-text-primary)]";
  }
}

/** Manager quota = sum of direct rep quotas (never use managerRow.quota alone). */
function sumRepQuota(reps: RepManagerRepRow[]): number {
  return reps.reduce((sum, rep) => sum + (Number(rep.quota) || 0), 0);
}

function sumRepWon(reps: RepManagerRepRow[]): number {
  return reps.reduce((sum, rep) => sum + (Number(rep.won_amount) || 0), 0);
}

function aggregateTeam(reps: RepManagerRepRow[]) {
  const quota = sumRepQuota(reps);
  const wonAmount = sumRepWon(reps);
  let wonC = 0;
  let lostC = 0;
  let pipeline = 0;
  for (const r of reps) {
    wonC += Number(r.won_count) || 0;
    lostC += Number(r.lost_count) || 0;
    pipeline += Number(r.active_amount) || 0;
  }
  const winRatePct =
    wonC + lostC > 0 ? Math.round((wonC / (wonC + lostC)) * 1000) / 10 : null;
  const aov = wonC > 0 ? wonAmount / wonC : 0;
  const attainmentPct = quota > 0 ? Math.min(100, (wonAmount / quota) * 100) : 0;
  return { quota, wonAmount, winRatePct, pipeline, aov, attainmentPct };
}

/** YTD % of annual quota: allPeriodRows sums per rep, else 4× quarterly quota as annual estimate. */
function ytdPctOfAnnual(rep: RepManagerRepRow, allPeriodRows?: RepManagerRepRow[]): number | null {
  const q = Number(rep.quota) || 0;
  if (q <= 0) return null;
  if (allPeriodRows && allPeriodRows.length > 0) {
    const rows = allPeriodRows.filter((r) => r.rep_id === rep.rep_id);
    const annualQuotaSum = rows.reduce((s, r) => s + (Number(r.quota) || 0), 0);
    const wonSum = rows.reduce((s, r) => s + (Number(r.won_amount) || 0), 0);
    if (annualQuotaSum <= 0) return null;
    return wonSum / annualQuotaSum;
  }
  const annualQuota = 4 * q;
  const won = Number(rep.won_amount) || 0;
  return won / annualQuota;
}

function ytdPctManager(reps: RepManagerRepRow[], allPeriodRows?: RepManagerRepRow[]): number | null {
  if (!reps.length) return null;
  let num = 0;
  let den = 0;
  for (const rep of reps) {
    const p = ytdPctOfAnnual(rep, allPeriodRows);
    if (p == null) continue;
    const q = Number(rep.quota) || 0;
    if (allPeriodRows && allPeriodRows.length) {
      const rows = allPeriodRows.filter((r) => r.rep_id === rep.rep_id);
      const aq = rows.reduce((s, r) => s + (Number(r.quota) || 0), 0);
      const w = rows.reduce((s, r) => s + (Number(r.won_amount) || 0), 0);
      num += w;
      den += aq;
    } else {
      num += Number(rep.won_amount) || 0;
      den += 4 * q;
    }
  }
  if (den <= 0) return null;
  return num / den;
}

function repAttainmentPct(rep: RepManagerRepRow): number {
  const q = Number(rep.quota) || 0;
  if (q <= 0) return 0;
  return Math.min(100, ((Number(rep.won_amount) || 0) / q) * 100);
}

function attainmentTextClass(rep: RepManagerRepRow): string {
  const pct = repAttainmentPct(rep);
  if (pct >= 90) return "text-green-600 font-semibold";
  if (pct >= 70) return "text-yellow-600 font-semibold";
  return "text-red-600 font-semibold";
}

function repWinRate(rep: RepManagerRepRow): string {
  const w = Number(rep.won_count) || 0;
  const l = Number(rep.lost_count) || 0;
  if (w + l <= 0) return "—";
  return String(Math.round((w / (w + l)) * 1000) / 10);
}

export function TeamLeaderboardClient(props: TeamLeaderboardProps) {
  const {
    repRows,
    managerRows,
    periodName,
    quotaPeriodId,
    fiscalYear,
    periodStart,
    periodEnd,
    allPeriodRows,
  } = props;

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showDetail, setShowDetail] = useState(false);

  const { paceRatio } = useMemo(() => computePaceRatio(periodStart, periodEnd), [periodStart, periodEnd]);

  const repsByManager = useMemo(() => {
    const m = new Map<string, RepManagerRepRow[]>();
    for (const r of repRows) {
      const k = r.manager_id || "";
      const arr = m.get(k) || [];
      arr.push(r);
      m.set(k, arr);
    }
    return m;
  }, [repRows]);

  const orderedManagerIds = useMemo(() => {
    const managerIdsInRepRows = Array.from(repsByManager.keys());
    return [
      ...managerRows.map((x) => x.manager_id || ""),
      ...managerIdsInRepRows.filter((id) => !managerRows.some((m) => String(m.manager_id || "") === String(id || ""))),
    ];
  }, [managerRows, repsByManager]);

  const managerIdsWithReps = useMemo(
    () => orderedManagerIds.filter((mid) => (repsByManager.get(mid) || []).length > 0),
    [orderedManagerIds, repsByManager]
  );

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const exportSheets = useMemo(() => {
    const rows = repRows.map((r) => ({
      rep: r.rep_name,
      manager: r.manager_name,
      quota: r.quota,
      won: r.won_amount,
      attainment: r.attainment != null ? Math.round(r.attainment * 10000) / 100 + "%" : "",
      pipeline: r.active_amount,
      win_rate: r.win_rate != null ? Math.round(r.win_rate * 10000) / 100 + "%" : "",
    }));
    return [{ name: "Team", rows }];
  }, [repRows]);

  const renderManagerCard = (managerId: string) => {
    const repsUnder = (repsByManager.get(managerId) || []).slice();
    const mgrMeta = managerRows.find((m) => String(m.manager_id || "") === String(managerId || ""));
    const managerLabel =
      mgrMeta?.manager_name ||
      (managerId ? repsUnder[0]?.manager_name : "(Unassigned)") ||
      `Manager ${managerId || ""}`;
    const cardKey = `mgr:${managerId || "unassigned"}`;
    const agg = aggregateTeam(repsUnder);
    const { quota: managerQuota, wonAmount, winRatePct, pipeline, aov, attainmentPct } = agg;
    const paceStatus = calcPaceStatus(wonAmount, managerQuota, paceRatio);
    const cardBorder = paceStatusCardClass(paceStatus);
    const barColor = paceStatusBarClass(paceStatus);
    const paceColor = paceStatusPaceTextClass(paceStatus);
    const attainmentColor = attainmentHeaderClass(paceStatus);
    const pct = Math.min(100, managerQuota > 0 ? (wonAmount / managerQuota) * 100 : 0);
    const repCount = repsUnder.length;
    const ytdPct = ytdPctManager(repsUnder, allPeriodRows);

    return (
      <div key={cardKey} className="min-w-0">
        <div
          role="button"
          tabIndex={0}
          onClick={() => toggleExpand(cardKey)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleExpand(cardKey);
            }
          }}
          className={`rounded-xl border p-4 cursor-pointer transition-colors ${cardBorder}`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="font-semibold text-[color:var(--sf-text-primary)]">{managerLabel}</div>
              <div className="text-xs text-[color:var(--sf-text-secondary)] mt-0.5">
                {repCount} rep{repCount !== 1 ? "s" : ""}
              </div>
            </div>
            <div className="text-right">
              <div className={`text-2xl font-bold ${attainmentColor}`}>{Math.round(attainmentPct * 10) / 10}%</div>
              <div className="text-xs text-[color:var(--sf-text-secondary)]">to quota</div>
            </div>
          </div>

          <div className="mt-3 h-2 rounded-full bg-[color:var(--sf-surface-alt)]">
            <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
          </div>

          <div className="mt-2 flex items-center justify-between text-xs">
            <span className={paceStatus === "unknown" ? "text-[color:var(--sf-text-secondary)]" : paceColor}>
              {paceStatus === "unknown"
                ? "Pace unknown (no quota)"
                : paceStatus === "on_track"
                  ? "✅ On Pace"
                  : paceStatus === "at_risk"
                    ? "⚠️ At Risk"
                    : "🔴 Behind Pace"}
            </span>
            <span className="text-[color:var(--sf-text-secondary)]">
              {fmtMoney(wonAmount)} / {fmtMoney(managerQuota)}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-[color:var(--sf-text-secondary)]">Win Rate</div>
              <div className="font-semibold text-[color:var(--sf-text-primary)]">
                {winRatePct != null ? `${winRatePct}%` : "—"}
              </div>
            </div>
            <div>
              <div className="text-[color:var(--sf-text-secondary)]">Pipeline</div>
              <div className="font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(pipeline)}</div>
            </div>
            <div>
              <div className="text-[color:var(--sf-text-secondary)]">AOV</div>
              <div className="font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(aov)}</div>
            </div>
          </div>

          {ytdPct !== null && (
            <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
              YTD: {Math.round(ytdPct * 100)}% of annual quota
            </div>
          )}

          <div className="mt-3 text-xs text-[color:var(--sf-accent-primary)] text-right">
            {expandedIds.has(cardKey) ? "▲ Hide reps" : "▼ See reps"}
          </div>
        </div>

        {expandedIds.has(cardKey) && (
          <div className="mt-2 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] divide-y divide-[color:var(--sf-border)]">
            {repsUnder.map((rep) => {
              const rq = Number(rep.quota) || 0;
              const rw = Number(rep.won_amount) || 0;
              const repPaceStatus = calcPaceStatus(rw, rq, paceRatio);
              const repPaceIcon =
                repPaceStatus === "unknown"
                  ? "·"
                  : repPaceStatus === "on_track"
                    ? "✅"
                    : repPaceStatus === "at_risk"
                      ? "⚠️"
                      : "🔴";
              return (
                <div key={rep.rep_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span aria-hidden>{repPaceIcon}</span>
                    <span className="text-sm font-medium text-[color:var(--sf-text-primary)] truncate">{rep.rep_name}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-[color:var(--sf-text-secondary)]">
                    <span>
                      <span className={attainmentTextClass(rep)}>{Math.round(repAttainmentPct(rep) * 10) / 10}%</span> attainment
                    </span>
                    <span>{fmtMoney(rep.won_amount)} won</span>
                    <span>{repWinRate(rep)}% win rate</span>
                    <span>{fmtMoney(rep.active_amount)} pipeline</span>
                    <span>
                      {rep.avg_days_won != null ? `${Math.round(rep.avg_days_won)}d cycle` : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderRepCard = (rep: RepManagerRepRow) => {
    const rq = Number(rep.quota) || 0;
    const rw = Number(rep.won_amount) || 0;
    const repsOne = [rep];
    const agg = aggregateTeam(repsOne);
    const paceStatus = calcPaceStatus(rw, rq, paceRatio);
    const cardBorder = paceStatusCardClass(paceStatus);
    const barColor = paceStatusBarClass(paceStatus);
    const paceColor = paceStatusPaceTextClass(paceStatus);
    const attainmentColor = attainmentHeaderClass(paceStatus);
    const pct = Math.min(100, rq > 0 ? (rw / rq) * 100 : 0);
    const ytdPct = ytdPctOfAnnual(rep, allPeriodRows);
    const wonC = Number(rep.won_count) || 0;
    const lostC = Number(rep.lost_count) || 0;
    const winRatePct = wonC + lostC > 0 ? Math.round((wonC / (wonC + lostC)) * 1000) / 10 : null;

    return (
      <div
        key={`rep:${rep.rep_id}`}
        className={`rounded-xl border p-4 transition-colors ${cardBorder}`}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="font-semibold text-[color:var(--sf-text-primary)]">{rep.rep_name}</div>
            <div className="text-xs text-[color:var(--sf-text-secondary)] mt-0.5">Rep</div>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-bold ${attainmentColor}`}>{Math.round(agg.attainmentPct * 10) / 10}%</div>
            <div className="text-xs text-[color:var(--sf-text-secondary)]">to quota</div>
          </div>
        </div>

        <div className="mt-3 h-2 rounded-full bg-[color:var(--sf-surface-alt)]">
          <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>

        <div className="mt-2 flex items-center justify-between text-xs">
          <span className={paceStatus === "unknown" ? "text-[color:var(--sf-text-secondary)]" : paceColor}>
            {paceStatus === "unknown"
              ? "Pace unknown (no quota)"
              : paceStatus === "on_track"
                ? "✅ On Pace"
                : paceStatus === "at_risk"
                  ? "⚠️ At Risk"
                  : "🔴 Behind Pace"}
          </span>
          <span className="text-[color:var(--sf-text-secondary)]">
            {fmtMoney(rw)} / {fmtMoney(rq)}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-[color:var(--sf-text-secondary)]">Win Rate</div>
            <div className="font-semibold text-[color:var(--sf-text-primary)]">
              {winRatePct != null ? `${winRatePct}%` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[color:var(--sf-text-secondary)]">Pipeline</div>
            <div className="font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(rep.active_amount)}</div>
          </div>
          <div>
            <div className="text-[color:var(--sf-text-secondary)]">AOV</div>
            <div className="font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(rep.aov ?? 0)}</div>
          </div>
        </div>

        {ytdPct !== null && (
          <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
            YTD: {Math.round(ytdPct * 100)}% of annual quota
          </div>
        )}
      </div>
    );
  };

  const showManagerGrid = managerIdsWithReps.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">
          Team Performance — {periodName || "—"}
        </h2>
        <div className="flex items-center gap-2 text-xs text-[color:var(--sf-text-secondary)]">
          <span className="inline-block w-3 h-3 rounded-full bg-green-500/40" aria-hidden />
          On Track
          <span className="inline-block w-3 h-3 rounded-full bg-yellow-500/40 ml-2" aria-hidden />
          At Risk
          <span className="inline-block w-3 h-3 rounded-full bg-red-500/40 ml-2" aria-hidden />
          Behind
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {showManagerGrid
          ? managerIdsWithReps.map((mid) => renderManagerCard(mid))
          : repRows.map((r) => renderRepCard(r))}
      </div>

      <button
        type="button"
        onClick={() => setShowDetail((v) => !v)}
        className="mt-6 text-sm text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)]"
      >
        {showDetail ? "▲ Hide Detail Report" : "▼ View Detail Report"}
      </button>

      {showDetail && (
        <div className="mt-4 space-y-4">
          <RepManagerComparisonPanel repRows={repRows} managerRows={managerRows} periodName={periodName} />
          <ExportToExcelButton
            fileName={`Team comparison — ${fiscalYear} — ${quotaPeriodId}`}
            sheets={exportSheets}
            label="Export to Excel"
          />
        </div>
      )}
    </div>
  );
}
