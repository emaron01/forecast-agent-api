"use client";

import { useMemo, useState } from "react";
import {
  RepManagerComparisonPanel,
  type RepManagerManagerRow,
  type RepManagerRepRow,
} from "./RepManagerComparisonPanel";
import { ExportToExcelButton } from "../../../_components/ExportToExcelButton";

type TeamLeaderboardFyQuarterRow = {
  rep_id: string;
  rep_int_id: string;
  period_id: string;
  period_name: string;
  fiscal_quarter: string;
  won_amount: number;
  quota: number;
  attainment: number | null;
};

type ProductsClosedWonByRepRow = {
  rep_name: string;
  product: string;
  won_amount: number;
  won_count: number;
  avg_order_value: number;
  avg_health_score: number | null;
};

type ProductsClosedWonByRepMap = Record<string, Record<string, number>>;

export type TeamLeaderboardProps = {
  repRows: RepManagerRepRow[];
  managerRows: RepManagerManagerRow[];
  periodName: string;
  quotaPeriodId: string;
  fiscalYear: string;
  periodStart: string;
  periodEnd: string;
  allPeriodRows?: TeamLeaderboardFyQuarterRow[];
  productsClosedWonByRep?: ProductsClosedWonByRepRow[] | ProductsClosedWonByRepMap;
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

function paceStatusTextClass(s: PaceStatus): string {
  switch (s) {
    case "on_track":
      return "text-green-400";
    case "at_risk":
      return "text-yellow-400";
    case "behind":
      return "text-red-400";
    default:
      return "text-[color:var(--sf-text-secondary)]";
  }
}

function paceStatusIcon(s: PaceStatus): string {
  if (s === "on_track") return "✅";
  if (s === "at_risk") return "⚠️";
  if (s === "behind") return "🔴";
  return "—";
}

function paceStatusLabel(s: PaceStatus): string {
  if (s === "on_track") return "On Track";
  if (s === "at_risk") return "At Risk";
  if (s === "behind") return "Behind Pace";
  return "Unknown";
}

function attainmentTextClassByPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "text-[color:var(--sf-text-secondary)]";
  if (pct >= 80) return "text-green-400";
  if (pct >= 50) return "text-yellow-400";
  return "text-red-400";
}

function coverageTextClass(value: number): string {
  if (!Number.isFinite(value)) return "text-[color:var(--sf-text-secondary)]";
  if (value >= 3) return "text-green-400";
  if (value >= 2) return "text-yellow-400";
  return "text-red-400";
}

function riskFromCoverage(value: number): { label: string; color: string } {
  if (!Number.isFinite(value)) return { label: "UNKNOWN", color: "text-[color:var(--sf-text-secondary)]" };
  if (value >= 3) return { label: "LOW", color: "text-green-400" };
  if (value >= 2) return { label: "MODERATE", color: "text-yellow-400" };
  return { label: "HIGH", color: "text-red-400" };
}

function healthTextClass(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "text-[color:var(--sf-text-secondary)]";
  if (pct >= 80) return "text-green-400";
  if (pct >= 50) return "text-yellow-400";
  return "text-red-400";
}

function quarterSortValue(value: string): number {
  const match = String(value || "").match(/(\d+)/);
  const n = match ? Number(match[1]) : Number(value);
  return Number.isFinite(n) ? n : 999;
}

function normalizeNameKey(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function healthPctFrom30(score: number | null | undefined): number | null {
  if (score == null || !Number.isFinite(score) || score <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((score / 30) * 100)));
}

function aggregateCurrentTeam(reps: RepManagerRepRow[]) {
  const average = (values: Array<number | null | undefined>) => {
    const nums = values
      .filter((v) => v != null && Number.isFinite(Number(v)))
      .map((v) => Number(v));
    return nums.length ? nums.reduce((sum, v) => sum + v, 0) / nums.length : null;
  };
  const getLostAmount = (rep: RepManagerRepRow) => Number((rep as RepManagerRepRow & { lost_amount?: number }).lost_amount || 0) || 0;
  const quota = reps.reduce((sum, rep) => sum + (Number(rep.quota) || 0), 0);
  const wonAmount = reps.reduce((sum, rep) => sum + (Number(rep.won_amount) || 0), 0);
  const lostAmount = reps.reduce((sum, rep) => sum + getLostAmount(rep), 0);
  const activePipelineAmount = reps.reduce((sum, rep) => sum + (Number(rep.active_amount) || 0), 0);
  const totalCount = reps.reduce((sum, rep) => sum + (Number(rep.total_count) || 0), 0);
  const wonCount = reps.reduce((sum, rep) => sum + (Number(rep.won_count) || 0), 0);
  const lostCount = reps.reduce((sum, rep) => sum + (Number(rep.lost_count) || 0), 0);
  const aov = wonCount > 0 ? wonAmount / wonCount : 0;
  const avgDaysWon = average(reps.map((rep) => rep.avg_days_won));
  const avgDaysLost = average(reps.map((rep) => rep.avg_days_lost));
  const avgDaysActive = average(reps.map((rep) => rep.avg_days_active));
  return { quota, wonAmount, lostAmount, activePipelineAmount, totalCount, wonCount, lostCount, aov, avgDaysWon, avgDaysLost, avgDaysActive };
}

function aggregateFyQuarterRows(rows: TeamLeaderboardFyQuarterRow[]): TeamLeaderboardFyQuarterRow[] {
  const byPeriod = new Map<string, TeamLeaderboardFyQuarterRow>();
  for (const row of rows) {
    const key = String(row.period_id);
    const prev = byPeriod.get(key);
    if (prev) {
      prev.won_amount += Number(row.won_amount || 0) || 0;
      prev.quota += Number(row.quota || 0) || 0;
      prev.attainment = prev.quota > 0 ? prev.won_amount / prev.quota : null;
    } else {
      byPeriod.set(key, {
        rep_id: String(row.rep_id),
        rep_int_id: String(row.rep_int_id),
        period_id: String(row.period_id),
        period_name: String(row.period_name || ""),
        fiscal_quarter: String(row.fiscal_quarter || ""),
        won_amount: Number(row.won_amount || 0) || 0,
        quota: Number(row.quota || 0) || 0,
        attainment:
          Number(row.quota || 0) > 0 ? (Number(row.won_amount || 0) || 0) / (Number(row.quota || 0) || 0) : null,
      });
    }
  }
  return Array.from(byPeriod.values()).sort((a, b) => quarterSortValue(a.fiscal_quarter) - quarterSortValue(b.fiscal_quarter));
}

function getProductSummary(args: {
  input?: ProductsClosedWonByRepRow[] | ProductsClosedWonByRepMap;
  repIds: string[];
  repNames: string[];
  fallbackAov?: number | null;
}) {
  const input = args.input;
  const repIdSet = new Set(args.repIds.map((x) => String(x)));
  const repNameSet = new Set(args.repNames.map((x) => normalizeNameKey(x)));

  if (!input) {
    return {
      repProducts: [] as Array<{ product: string; amount: number }>,
      aov: args.fallbackAov ?? 0,
      avgHealthPct: null as number | null,
    };
  }

  if (Array.isArray(input)) {
    const byProduct = new Map<string, { product: string; amount: number }>();
    let totalAmount = 0;
    let totalWonCount = 0;
    let healthWeightedSum = 0;
    let healthWeightedCount = 0;

    console.log("TEAM_LEADERBOARD_PRODUCT_DEBUG", {
      repNameSet: Array.from(repNameSet.values()),
      inputRepNames: input.slice(0, 5).map((row) => row.rep_name),
    });

    for (const row of input) {
      if (!repNameSet.has(normalizeNameKey(row.rep_name))) continue;
      const amount = Number(row.won_amount || 0) || 0;
      const wonCount = Number(row.won_count || 0) || 0;
      const healthScore = row.avg_health_score == null || !Number.isFinite(Number(row.avg_health_score)) ? null : Number(row.avg_health_score);

      totalAmount += amount;
      totalWonCount += wonCount;
      if (healthScore != null && wonCount > 0) {
        healthWeightedSum += healthScore * wonCount;
        healthWeightedCount += wonCount;
      }

      const prev = byProduct.get(row.product);
      if (prev) prev.amount += amount;
      else byProduct.set(row.product, { product: row.product, amount });
    }

    const avgHealthScore = healthWeightedCount > 0 ? healthWeightedSum / healthWeightedCount : null;
    return {
      repProducts: Array.from(byProduct.values()).sort((a, b) => b.amount - a.amount),
      aov: totalWonCount > 0 ? totalAmount / totalWonCount : args.fallbackAov ?? 0,
      avgHealthPct: healthPctFrom30(avgHealthScore),
    };
  }

  const byProduct = new Map<string, { product: string; amount: number }>();
  for (const repId of repIdSet) {
    const row = input[repId];
    if (!row) continue;
    for (const [product, amountRaw] of Object.entries(row)) {
      const amount = Number(amountRaw || 0) || 0;
      const prev = byProduct.get(product);
      if (prev) prev.amount += amount;
      else byProduct.set(product, { product, amount });
    }
  }
  return {
    repProducts: Array.from(byProduct.values()).sort((a, b) => b.amount - a.amount),
    aov: args.fallbackAov ?? 0,
    avgHealthPct: null,
  };
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
    productsClosedWonByRep,
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
    () => orderedManagerIds.filter((mid) => (repsByManager?.get(mid) || []).length > 0),
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

  const currentPeriodName = periodName || "Current Quarter";

  const renderPerformanceCard = (args: {
    name: string;
    paceStatus: PaceStatus;
    attainPct: number;
    quota: number;
    wonAmount: number;
    annualQuota: number;
    ytdRevenue: number;
    ytdAttainPct: number;
    fyQuarters: TeamLeaderboardFyQuarterRow[];
    activePipelineAmount: number;
    totalCount: number;
    wonCount: number;
    lostCount: number;
    lostAmount: number;
    avgDaysWon: number | null;
    avgDaysLost: number | null;
    avgDaysActive: number | null;
    repProducts: Array<{ product: string; amount: number }>;
    aov: number;
    avgHealthPct: number | null;
    isLeader: boolean;
    expanded: boolean;
    repCount: number;
    onToggle?: () => void;
  }) => {
    const paceColor = paceStatusTextClass(args.paceStatus);
    const paceIcon = paceStatusIcon(args.paceStatus);
    const paceLabel = paceStatusLabel(args.paceStatus);
    const attainColor = attainmentTextClassByPct(args.attainPct);
    const ytdAttainColor = attainmentTextClassByPct(args.ytdAttainPct);
    const remainingQuota = Math.max(0, args.quota - args.wonAmount);
    const qCoverage = remainingQuota > 0 ? args.activePipelineAmount / remainingQuota : null;
    const totalFyPipeline = args.activePipelineAmount;
    const annualRemaining = Math.max(0, args.annualQuota - args.ytdRevenue);
    const annualCoverage = annualRemaining > 0 ? totalFyPipeline / annualRemaining : null;
    const coverageColor = qCoverage == null ? "text-[color:var(--sf-text-secondary)]" : coverageTextClass(qCoverage);
    const annualCoverageColor =
      annualCoverage == null ? "text-[color:var(--sf-text-secondary)]" : coverageTextClass(annualCoverage);
    const { label: riskLabel, color: riskColor } =
      annualCoverage == null ? { label: "UNKNOWN", color: "text-[color:var(--sf-text-secondary)]" } : riskFromCoverage(annualCoverage);
    const healthColor = healthTextClass(args.avgHealthPct);
    const pipelineCount = Math.max(0, args.totalCount - args.wonCount - args.lostCount);
    const aovWon = args.wonCount > 0 ? args.wonAmount / args.wonCount : 0;
    const aovLost = args.lostCount > 0 ? args.lostAmount / args.lostCount : 0;
    const aovPipeline = pipelineCount > 0 ? args.activePipelineAmount / pipelineCount : 0;
    const sortedProducts = [...args.repProducts].sort((a, b) => b.amount - a.amount);

    return (
      <div className={`rounded-xl border p-5 ${paceStatusCardClass(args.paceStatus)}`}>
        <div className="flex items-start justify-between">
          <div>
            <div className="font-bold text-xl text-[color:var(--sf-text-primary)]">{args.name}</div>
            <div className={`mt-0.5 text-sm font-semibold ${paceColor}`}>
              {paceIcon} {paceLabel}
            </div>
          </div>
          <div className="text-right">
            <div className={`text-3xl font-bold ${attainColor}`}>{args.attainPct}%</div>
            <div className="text-sm text-[color:var(--sf-text-secondary)]">Q attainment</div>
          </div>
        </div>

        <div className="my-3 border-t border-[color:var(--sf-border)]" />

        <div className="grid grid-cols-1 gap-4 text-xs xl:grid-cols-3">
          <div className="space-y-1">
            <div className="mb-3 text-xs font-bold uppercase tracking-wider text-[color:var(--sf-text-secondary)]">
              Current Quarter
            </div>
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 text-base text-[color:var(--sf-text-secondary)]">{currentPeriodName} Quota</span>
              <span className="text-base font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(args.quota)}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 text-base text-[color:var(--sf-text-secondary)]">Won</span>
              <span className="text-base font-semibold text-green-400">{fmtMoney(args.wonAmount)}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 text-base text-[color:var(--sf-text-secondary)]">Attainment</span>
              <span className={`text-base font-semibold ${attainColor}`}>{args.attainPct}%</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 text-base text-[color:var(--sf-text-secondary)]">Pace</span>
              <span className={`text-base font-semibold ${paceColor}`}>{paceLabel}</span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="mb-3 text-xs font-bold uppercase tracking-wider text-[color:var(--sf-text-secondary)]">
              Full Year
            </div>
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 text-base text-[color:var(--sf-text-secondary)]">Annual Quota</span>
              <span className="text-base font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(args.annualQuota)}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 text-base text-[color:var(--sf-text-secondary)]">YTD Revenue</span>
              <span className="text-base font-semibold text-green-400">{fmtMoney(args.ytdRevenue)}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 text-base text-[color:var(--sf-text-secondary)]">YTD Attainment</span>
              <span className={`text-base font-semibold ${ytdAttainColor}`}>{args.ytdAttainPct}%</span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="mb-3 text-xs font-bold uppercase tracking-wider text-[color:var(--sf-text-secondary)]">
              Quarter over Quarter
            </div>
            {args.fyQuarters.length ? (
              args.fyQuarters.map((q) => {
                const qAttain = q.quota > 0 ? q.won_amount / q.quota : null;
                const qColor =
                  qAttain === null
                    ? "text-[color:var(--sf-text-secondary)]"
                    : qAttain >= 0.8
                      ? "text-green-400"
                      : qAttain >= 0.5
                        ? "text-yellow-400"
                        : "text-red-400";
                const qIcon = qAttain === null ? "—" : qAttain >= 0.9 ? "✅" : qAttain >= 0.7 ? "⚠️" : "🔴";
                return (
                  <div key={q.period_id} className="flex flex-wrap items-center gap-3 py-0.5">
                    <span className="w-6 shrink-0 text-base font-semibold text-[color:var(--sf-text-secondary)]">
                      Q{q.fiscal_quarter}
                    </span>
                    <span className="text-base text-[color:var(--sf-text-secondary)]">
                      Quota:
                      <span className="ml-1 font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(q.quota)}</span>
                    </span>
                    <span className="text-base text-[color:var(--sf-text-secondary)]">
                      Rev:
                      <span className="ml-1 font-semibold text-green-400">{fmtMoney(q.won_amount)}</span>
                    </span>
                    <span className={`text-base font-bold ${qColor}`}>{qAttain !== null ? `${Math.round(qAttain * 100)}%` : "—"} {qIcon}</span>
                  </div>
                );
              })
            ) : (
              <div className="text-[color:var(--sf-text-secondary)]">—</div>
            )}
          </div>
        </div>

        <div className="my-3 border-t border-[color:var(--sf-border)]" />

        <div className="space-y-1">
          <div className="mb-3 text-xs font-bold uppercase tracking-wider text-[color:var(--sf-text-secondary)]">
            Pipeline
          </div>
          <div className="mt-2 flex flex-wrap items-start gap-6">
            {[
              { label: "Q Coverage", value: qCoverage == null ? "—" : `${qCoverage.toFixed(1)}x`, color: coverageColor },
              { label: "Annual Coverage", value: annualCoverage == null ? "—" : `${annualCoverage.toFixed(1)}x`, color: annualCoverageColor },
              { label: "Avg Health", value: args.avgHealthPct != null ? `${args.avgHealthPct}%` : "—", color: healthColor },
              { label: "Pipeline Risk", value: riskLabel, color: riskColor },
              { label: "AOV Won", value: fmtMoney(aovWon), color: "text-green-400" },
              { label: "AOV Lost", value: fmtMoney(aovLost), color: "text-red-400" },
              { label: "AOV Pipeline", value: fmtMoney(aovPipeline), color: "text-[color:var(--sf-text-primary)]" },
            ].map((stat) => (
              <div key={stat.label} className="flex items-baseline gap-1">
                <span className="shrink-0 text-base text-[color:var(--sf-text-secondary)]">{stat.label}:</span>
                <span className={`shrink-0 text-base font-semibold ${stat.color}`}>{stat.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-start gap-6">
            {[
              { label: "Age Won", value: args.avgDaysWon != null ? `${Math.round(args.avgDaysWon)}d` : "—", color: "text-[color:var(--sf-text-primary)]" },
              { label: "Age Lost", value: args.avgDaysLost != null ? `${Math.round(args.avgDaysLost)}d` : "—", color: "text-[color:var(--sf-text-primary)]" },
              { label: "Age Pipeline", value: args.avgDaysActive != null ? `${Math.round(args.avgDaysActive)}d` : "—", color: "text-[color:var(--sf-text-primary)]" },
            ].map((stat) => (
              <div key={stat.label} className="flex items-baseline gap-1">
                <span className="shrink-0 text-base text-[color:var(--sf-text-secondary)]">{stat.label}:</span>
                <span className={`shrink-0 text-base font-semibold ${stat.color}`}>{stat.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="my-3 border-t border-[color:var(--sf-border)]" />

        <div>
          <div className="mb-3 text-xs font-bold uppercase tracking-wider text-[color:var(--sf-text-secondary)]">
            Products Sold (this quarter)
          </div>
          <div className="flex flex-wrap gap-3 text-base">
            {sortedProducts.length ? (
              sortedProducts.map((p) => (
                <div key={p.product} className="flex items-center gap-1">
                  <span className="text-[color:var(--sf-text-secondary)]">{p.product}:</span>
                  <span className="font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(p.amount)}</span>
                </div>
              ))
            ) : (
              <div className="text-[color:var(--sf-text-secondary)]">—</div>
            )}
          </div>
        </div>

        {args.isLeader && args.onToggle ? (
          <button
            type="button"
            onClick={args.onToggle}
            className="mt-4 w-full text-left text-xs text-[color:var(--sf-accent-primary)] hover:underline"
          >
            {args.expanded ? `▲ Hide reps (${args.repCount})` : `▼ See reps (${args.repCount})`}
          </button>
        ) : null}
      </div>
    );
  };

  const renderRepCard = (rep: RepManagerRepRow) => {
    const quota = Number(rep.quota) || 0;
    const wonAmount = Number(rep.won_amount) || 0;
    const paceStatus = calcPaceStatus(wonAmount, quota, paceRatio);
    const repKey = String(rep.rep_id);
    const fyQuarters = aggregateFyQuarterRows(
      (allPeriodRows ?? [])
        .filter(
          (r) =>
            r.rep_id === repKey ||
            r.rep_int_id === repKey ||
            r.rep_id === String(rep.rep_id) ||
            r.rep_int_id === String(rep.rep_id)
        )
        .sort((a, b) => Number(a.fiscal_quarter) - Number(b.fiscal_quarter))
    );
    const annualQuota = fyQuarters.length ? fyQuarters.reduce((sum, q) => sum + q.quota, 0) : quota * 4;
    const ytdRevenue = fyQuarters.length ? fyQuarters.reduce((sum, q) => sum + q.won_amount, 0) : wonAmount;
    const ytdAttainPct = annualQuota > 0 ? Math.round((ytdRevenue / annualQuota) * 100) : 0;
    const attainPct = quota > 0 ? Math.round((wonAmount / quota) * 100) : 0;
    const productSummary = getProductSummary({
      input: productsClosedWonByRep,
      repIds: [String(rep.rep_id)],
      repNames: [rep.rep_name],
      fallbackAov: rep.aov ?? 0,
    });

    return (
      <div key={`rep:${rep.rep_id}`}>
        {renderPerformanceCard({
          name: rep.rep_name,
          paceStatus,
          attainPct,
          quota,
          wonAmount,
          annualQuota,
          ytdRevenue,
          ytdAttainPct,
          fyQuarters,
          activePipelineAmount: Number(rep.active_amount) || 0,
          totalCount: Number(rep.total_count) || 0,
          wonCount: Number(rep.won_count) || 0,
          lostCount: Number(rep.lost_count) || 0,
          lostAmount: Number((rep as RepManagerRepRow & { lost_amount?: number }).lost_amount || 0) || 0,
          avgDaysWon: rep.avg_days_won ?? null,
          avgDaysLost: rep.avg_days_lost ?? null,
          avgDaysActive: rep.avg_days_active ?? null,
          repProducts: productSummary.repProducts,
          aov: productSummary.aov,
          avgHealthPct: productSummary.avgHealthPct,
          isLeader: false,
          expanded: false,
          repCount: 0,
        })}
      </div>
    );
  };

  const renderManagerCard = (managerId: string) => {
    const repsUnder = (repsByManager?.get(managerId) || [])
      .slice()
      .sort((a, b) => {
        const aa = a.attainment == null || !Number.isFinite(a.attainment) ? Number.POSITIVE_INFINITY : Number(a.attainment);
        const bb = b.attainment == null || !Number.isFinite(b.attainment) ? Number.POSITIVE_INFINITY : Number(b.attainment);
        return bb - aa || a.rep_name.localeCompare(b.rep_name);
      });
    const mgrMeta = managerRows.find((m) => String(m.manager_id || "") === String(managerId || ""));
    const managerLabel =
      mgrMeta?.manager_name ||
      (managerId ? repsUnder[0]?.manager_name : "(Unassigned)") ||
      `Manager ${managerId || ""}`;
    const cardKey = `mgr:${managerId || "unassigned"}`;
    const current = aggregateCurrentTeam(repsUnder);
    const repIds = repsUnder.map((r) => String(r.rep_id));
    const fyQuarters = aggregateFyQuarterRows(
      (allPeriodRows ?? [])
        .filter((r) => repIds.includes(String(r.rep_id)) || repIds.includes(String(r.rep_int_id)))
        .sort((a, b) => Number(a.fiscal_quarter) - Number(b.fiscal_quarter))
    );
    const annualQuota = fyQuarters.length ? fyQuarters.reduce((sum, q) => sum + q.quota, 0) : current.quota * 4;
    const ytdRevenue = fyQuarters.length ? fyQuarters.reduce((sum, q) => sum + q.won_amount, 0) : current.wonAmount;
    const ytdAttainPct = annualQuota > 0 ? Math.round((ytdRevenue / annualQuota) * 100) : 0;
    const attainPct = current.quota > 0 ? Math.round((current.wonAmount / current.quota) * 100) : 0;
    const paceStatus = calcPaceStatus(current.wonAmount, current.quota, paceRatio);
    const productSummary = getProductSummary({
      input: productsClosedWonByRep,
      repIds,
      repNames: repsUnder.map((r) => r.rep_name),
      fallbackAov: current.aov,
    });

    return (
      <div key={cardKey} className="min-w-0">
        {renderPerformanceCard({
          name: managerLabel,
          paceStatus,
          attainPct,
          quota: current.quota,
          wonAmount: current.wonAmount,
          annualQuota,
          ytdRevenue,
          ytdAttainPct,
          fyQuarters,
          activePipelineAmount: current.activePipelineAmount,
          totalCount: current.totalCount,
          wonCount: current.wonCount,
          lostCount: current.lostCount,
          lostAmount: current.lostAmount,
          avgDaysWon: current.avgDaysWon,
          avgDaysLost: current.avgDaysLost,
          avgDaysActive: current.avgDaysActive,
          repProducts: productSummary.repProducts,
          aov: productSummary.aov,
          avgHealthPct: productSummary.avgHealthPct,
          isLeader: true,
          expanded: expandedIds.has(cardKey),
          repCount: repsUnder.length,
          onToggle: () => toggleExpand(cardKey),
        })}

        {expandedIds.has(cardKey) && (
          <div className="mt-2 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] divide-y divide-[color:var(--sf-border)]">
            {repsUnder.map((rep) => renderRepCard(rep))}
          </div>
        )}
      </div>
    );
  };

  const showManagerGrid = managerIdsWithReps.length > 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">
          Team Performance — {periodName || "—"}
        </h2>
        <div className="flex items-center gap-2 text-xs text-[color:var(--sf-text-secondary)]">
          <span className="inline-block h-3 w-3 rounded-full bg-green-500/40" aria-hidden />
          On Track
          <span className="ml-2 inline-block h-3 w-3 rounded-full bg-yellow-500/40" aria-hidden />
          At Risk
          <span className="ml-2 inline-block h-3 w-3 rounded-full bg-red-500/40" aria-hidden />
          Behind
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-1">
        {showManagerGrid
          ? managerIdsWithReps.map((mid) => renderManagerCard(mid))
          : [...repRows]
              .sort((a, b) => {
                const aa = a.attainment == null || !Number.isFinite(a.attainment) ? Number.POSITIVE_INFINITY : Number(a.attainment);
                const bb = b.attainment == null || !Number.isFinite(b.attainment) ? Number.POSITIVE_INFINITY : Number(b.attainment);
                return bb - aa || a.rep_name.localeCompare(b.rep_name);
              })
              .map((r) => renderRepCard(r))}
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
