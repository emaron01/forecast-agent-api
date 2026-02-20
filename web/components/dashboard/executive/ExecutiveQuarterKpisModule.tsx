"use client";

import type { ReactNode } from "react";
import type { PipelineMomentumData } from "../../../lib/pipelineMomentum";
import type { QuarterKpisSnapshot } from "../../../lib/quarterKpisSnapshot";

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtNum(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString();
}

function fmtPct(p01: number | null) {
  if (p01 == null || !Number.isFinite(p01)) return "—";
  return `${Math.round(p01 * 100)}%`;
}

function healthColorClass(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-disabled)]";
  if (pct >= 80) return "text-[#2ECC71]";
  if (pct >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

export function ExecutiveQuarterKpisModule(props: {
  period: { id: string; fiscal_year: string; fiscal_quarter: string; period_name: string; period_start: string; period_end: string } | null;
  quota: number;
  pipelineMomentum: PipelineMomentumData | null;
  quarterKpis: QuarterKpisSnapshot | null;
  repRollups?: Array<{ commit_amount: number; best_case_amount: number; pipeline_amount: number; won_amount: number; won_count: number }> | null;
  productsClosedWon?: Array<{ won_amount: number; won_count: number }> | null;
}) {
  const period = props.period;
  const km = props.pipelineMomentum;
  const kpis = props.quarterKpis;

  const repRollups = Array.isArray(props.repRollups) ? props.repRollups : [];
  const products = Array.isArray(props.productsClosedWon) ? props.productsClosedWon : [];

  const commitAmtFallback = repRollups.reduce((acc, r) => acc + (Number(r.commit_amount || 0) || 0), 0);
  const bestAmtFallback = repRollups.reduce((acc, r) => acc + (Number(r.best_case_amount || 0) || 0), 0);
  const pipeAmtFallback = repRollups.reduce((acc, r) => acc + (Number(r.pipeline_amount || 0) || 0), 0);

  const commitAmt = km?.current_quarter?.mix?.commit?.value ?? commitAmtFallback;
  const bestAmt = km?.current_quarter?.mix?.best_case?.value ?? bestAmtFallback;
  const pipeAmt = km?.current_quarter?.mix?.pipeline?.value ?? pipeAmtFallback;
  const totalPipelineAmt = km?.current_quarter?.total_pipeline ?? commitAmt + bestAmt + pipeAmt;

  const commitCount = km?.current_quarter?.mix?.commit?.opps ?? null;
  const bestCount = km?.current_quarter?.mix?.best_case?.opps ?? null;
  const pipeCount = km?.current_quarter?.mix?.pipeline?.opps ?? null;
  const totalPipelineCount = km?.current_quarter?.total_opps ?? (commitCount != null && bestCount != null && pipeCount != null ? commitCount + bestCount + pipeCount : null);

  const closedWonAmt =
    products.length > 0 ? products.reduce((acc, r) => acc + (Number(r.won_amount || 0) || 0), 0) : repRollups.reduce((acc, r) => acc + (Number(r.won_amount || 0) || 0), 0);
  const closedWonCount =
    kpis?.wonCount ?? (products.length > 0 ? products.reduce((acc, r) => acc + (Number(r.won_count || 0) || 0), 0) : repRollups.reduce((acc, r) => acc + (Number(r.won_count || 0) || 0), 0));

  const quota = Number(props.quota || 0) || 0;
  const pctToGoal = quota > 0 ? closedWonAmt / quota : null;

  const Chip = (p: { label: string; value: ReactNode }) => (
    <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
      <div className="text-[color:var(--sf-text-secondary)]">{p.label}</div>
      <div className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{p.value}</div>
    </div>
  );

  const boxClass = "min-w-0 overflow-hidden rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-2";
  const cards = [
    { key: "commit", label: "Commit", amount: commitAmt, count: commitCount },
    { key: "best", label: "Best Case", amount: bestAmt, count: bestCount },
    { key: "pipe", label: "Pipeline", amount: pipeAmt, count: pipeCount },
    { key: "total", label: "Total Pipeline", amount: totalPipelineAmt, count: totalPipelineCount },
    { key: "won", label: "Closed Won", amount: closedWonAmt, count: closedWonCount },
  ];

  const titleLeft = period
    ? `${String(period.period_name || "").trim() || "Quarter"} (FY${period.fiscal_year} Q${period.fiscal_quarter}) Current`
    : "Quarter KPIs (Current)";
  const dateRange = period ? `${String(period.period_start)} \u2192 ${String(period.period_end)}` : "";

  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{titleLeft}</div>
          {dateRange ? <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">{dateRange}</div> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
          <div className="text-xs font-semibold text-[color:var(--sf-text-primary)]">Sales Forecast</div>

          <div className="mt-2 grid w-full max-w-full gap-2 text-sm [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
            {cards.map((c) => (
              <div key={c.key} className={boxClass}>
                <div className="text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">{c.label}</div>
                <div className="mt-0.5 truncate font-mono text-xs font-semibold leading-tight text-[color:var(--sf-text-primary)]">{fmtMoney(c.amount)}</div>
                <div className="mt-0.5 text-[11px] leading-tight text-[color:var(--sf-text-secondary)]"># Opps: {c.count == null ? "—" : fmtNum(c.count)}</div>
              </div>
            ))}

            <div className={boxClass}>
              <div className="text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">Quarterly Quota</div>
              <div className="mt-0.5 truncate font-mono text-xs font-semibold leading-tight text-[color:var(--sf-text-primary)]">{fmtMoney(quota)}</div>
              <div className="mt-0.5 text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">&nbsp;</div>
            </div>

            <div className={boxClass}>
              <div className="text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">% To Goal</div>
              <div className="mt-0.5 truncate font-mono text-xs font-semibold leading-tight text-[color:var(--sf-text-primary)]">{fmtPct(pctToGoal)}</div>
              <div className="mt-0.5 text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">&nbsp;</div>
            </div>

            <div className="col-span-full">
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Chip label="Win Rate" value={fmtPct(kpis?.winRate ?? null)} />
                <Chip label="Win/Loss Count" value={`${fmtNum(kpis?.wonCount ?? "—")} / ${fmtNum(kpis?.lostCount ?? "—")}`} />
                <Chip label="Average Order Value" value={kpis?.aov == null ? "—" : fmtMoney(kpis.aov)} />
                <Chip
                  label="Avg Health Closed Won"
                  value={<span className={healthColorClass(kpis?.avgHealthWonPct ?? null)}>{kpis?.avgHealthWonPct == null ? "—" : `${kpis.avgHealthWonPct}%`}</span>}
                />
                <Chip
                  label="Avg Health Closed Loss"
                  value={
                    <span className={healthColorClass(kpis?.avgHealthLostPct ?? null)}>{kpis?.avgHealthLostPct == null ? "—" : `${kpis.avgHealthLostPct}%`}</span>
                  }
                />
                <Chip label="Opp→Win Conversion" value={fmtPct(kpis?.oppToWin ?? null)} />
                <Chip label="Aging (avg days)" value={kpis?.agingAvgDays == null ? "—" : String(Math.round(kpis.agingAvgDays))} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

