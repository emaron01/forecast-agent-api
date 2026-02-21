"use client";

import type { ReactNode } from "react";
import type { PipelineMomentumData } from "../../../lib/pipelineMomentum";
import type { QuarterKpisSnapshot } from "../../../lib/quarterKpisSnapshot";

function fmtMoney(n: any) {
  if (n == null) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtCoverageRatio(r: number | null, opts?: { digits?: number }) {
  if (r == null || !Number.isFinite(r)) return "—";
  const d = Math.max(0, Math.min(2, opts?.digits ?? 1));
  return `${r.toFixed(d)}x`;
}

function fmtNum(n: any) {
  if (n == null) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString();
}

function fmtPct(p01: number | null) {
  if (p01 == null || !Number.isFinite(p01)) return "—";
  return `${Math.round(p01 * 100)}%`;
}

function fmtSignedPct(p01: number | null, opts?: { digits?: number }) {
  if (p01 == null || !Number.isFinite(p01)) return "—";
  const pct = p01 * 100;
  const d = Math.max(0, Math.min(2, opts?.digits ?? 0));
  const abs = Math.abs(pct);
  const absText = d ? abs.toFixed(d) : String(Math.round(abs));
  const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
  return `${sign}${absText}%`;
}

function fmtDays(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = Math.round(n);
  return `${v.toLocaleString()} day${v === 1 ? "" : "s"}`;
}

function healthColorClass(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-disabled)]";
  if (pct >= 80) return "text-[#2ECC71]";
  if (pct >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

function coverageStatus(r: number | null) {
  if (r == null || !Number.isFinite(r)) {
    return { label: "—", cls: "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]" };
  }
  if (r >= 3.6) return { label: "QUOTA COVERAGE", cls: "border-[#2ECC71]/40 bg-[#2ECC71]/10 text-[#2ECC71]" };
  if (r >= 3.0) return { label: "FAIR COVERAGE", cls: "border-[#F1C40F]/50 bg-[#F1C40F]/10 text-[#F1C40F]" };
  return { label: "DANGER LOW COVERAGE", cls: "border-[#E74C3C]/50 bg-[#E74C3C]/10 text-[#E74C3C]" };
}

export function ExecutiveQuarterKpisModule(props: {
  period: { id: string; fiscal_year: string; fiscal_quarter: string; period_name: string; period_start: string; period_end: string } | null;
  quota: number;
  pipelineMomentum: PipelineMomentumData | null;
  crmTotals: { commit_amount: number; best_case_amount: number; pipeline_amount: number; won_amount: number };
  quarterKpis: QuarterKpisSnapshot | null;
  repRollups?: Array<{ commit_amount: number; best_case_amount: number; pipeline_amount: number; won_amount: number; won_count: number }> | null;
  productsClosedWon?: Array<{ won_amount: number; won_count: number }> | null;
}) {
  const period = props.period;
  const km = props.pipelineMomentum;
  const kpis = props.quarterKpis;

  // Use the same source of truth as the KPI page “Sales Forecast” block:
  // - amounts from quarter-scoped CRM totals (open stages + won)
  // - counts from the quarter stage snapshot (already computed server-side into pipelineMomentum)
  const commitAmt = Number(props.crmTotals?.commit_amount ?? NaN);
  const bestAmt = Number(props.crmTotals?.best_case_amount ?? NaN);
  const pipeAmt = Number(props.crmTotals?.pipeline_amount ?? NaN);
  const totalPipelineAmt = Number.isFinite(commitAmt) && Number.isFinite(bestAmt) && Number.isFinite(pipeAmt) ? commitAmt + bestAmt + pipeAmt : null;

  const commitCount = km?.current_quarter?.mix?.commit?.opps ?? null;
  const bestCount = km?.current_quarter?.mix?.best_case?.opps ?? null;
  const pipeCount = km?.current_quarter?.mix?.pipeline?.opps ?? null;
  const totalPipelineCount =
    km?.current_quarter?.total_opps ??
    (commitCount != null && bestCount != null && pipeCount != null ? commitCount + bestCount + pipeCount : null);

  const closedWonAmt = Number(props.crmTotals?.won_amount ?? NaN);

  const quota = Number(props.quota || 0) || 0;
  const remainingQuota = quota > 0 && Number.isFinite(closedWonAmt) ? Math.max(0, quota - closedWonAmt) : null;
  const coverage =
    remainingQuota != null && remainingQuota > 0 && totalPipelineAmt != null && totalPipelineAmt > 0 ? totalPipelineAmt / remainingQuota : null;
  const covStatus = coverageStatus(coverage);

  const boxClass = "min-w-0 overflow-hidden rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-2";
  const cards = [
    { key: "commit", label: "Commit", amount: commitAmt, count: commitCount },
    { key: "best", label: "Best Case", amount: bestAmt, count: bestCount },
    { key: "pipe", label: "Pipeline", amount: pipeAmt, count: pipeCount },
    { key: "total", label: "Total Pipeline", amount: totalPipelineAmt, count: totalPipelineCount },
  ];

  const titleLeft = period
    ? `${String(period.period_name || "").trim() || "Quarter"} (FY${period.fiscal_year} Q${period.fiscal_quarter}) Current`
    : "Quarter KPIs (Current)";
  const dateRange = period ? `${String(period.period_start)} \u2192 ${String(period.period_end)}` : "";

  const createdFromKpis = kpis?.createdPipeline || null;
  const created = km?.predictive?.created_pipeline || null;
  const createdMix = created?.current?.mix || null;
  const createdQoq = created?.qoq_total_amount_all_pct01 ?? created?.qoq_total_amount_pct01 ?? null;
  const createdActiveQoq = created?.qoq_total_amount_pct01 ?? null;

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
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">Pipeline Coverage</div>
                <span className={["inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", covStatus.cls].join(" ")}>
                  RISK PILL
                </span>
              </div>
              <div className="mt-0.5 truncate font-mono text-xs font-semibold leading-tight text-[color:var(--sf-text-primary)]">
                {fmtCoverageRatio(coverage, { digits: 1 })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {createdFromKpis ? (
        <div className="mt-3 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-[color:var(--sf-text-primary)]">Forecast Mix</div>
              <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                Pipeline created in quarter
                {createdQoq != null ? (
                  <>
                    {" "}
                    · compared to last quarter:{" "}
                    <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtSignedPct(createdQoq, { digits: 0 })}</span>
                  </>
                ) : null}
              </div>
            </div>
            <div className="text-xs text-[color:var(--sf-text-secondary)]">
              Total{" "}
              <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(createdFromKpis.totalAmount)}</span> ·{" "}
              <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtNum(createdFromKpis.totalCount)}</span> opps
            </div>
          </div>

          <div className="mt-3 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
            {(() => {
              const cp = createdFromKpis;
              const Card = (p: { label: string; mix: number | null; amount: number; count: number; health: number | null }) => (
                <div className={boxClass}>
                  <div className="text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">
                    {p.label} {p.mix == null ? "" : `(${fmtPct(p.mix)})`}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-xs font-semibold leading-tight text-[color:var(--sf-text-primary)]">{fmtMoney(p.amount)}</div>
                  <div className="mt-0.5 text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">
                    <div># Opps: {fmtNum(p.count)}</div>
                    <div>
                      Health: <span className={healthColorClass(p.health)}>{p.health == null ? "—" : `${p.health}%`}</span>
                    </div>
                  </div>
                </div>
              );

              return (
                <>
                  <Card label="Commit" mix={cp.mixCommit} amount={cp.commitAmount} count={cp.commitCount} health={cp.commitHealthPct} />
                  <Card label="Best Case" mix={cp.mixBest} amount={cp.bestAmount} count={cp.bestCount} health={cp.bestHealthPct} />
                  <Card label="Pipeline" mix={cp.mixPipeline} amount={cp.pipelineAmount} count={cp.pipelineCount} health={cp.pipelineHealthPct} />
                  <Card label="Total Pipeline" mix={null} amount={cp.totalAmount} count={cp.totalCount} health={cp.totalHealthPct} />
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {created ? (
        <div className="mt-3 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-[color:var(--sf-text-primary)]">Pipeline Created This Quarter (predicts next quarter)</div>
              <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Create date in-quarter. Active excludes won/lost.</div>
            </div>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-3">
            <div className="rounded-md border border-[color:var(--sf-text-secondary)]/20 bg-[color:var(--sf-surface-alt)] px-3 py-2">
              <div className="text-[11px] text-[color:var(--sf-text-secondary)]">Created pipeline (value)</div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(created.current?.total_amount)}</div>
              <div className="mt-1 text-[11px] text-[color:var(--sf-text-secondary)]">Created pipeline (Active)</div>
              <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-2 text-[11px] text-[color:var(--sf-text-secondary)]">
                <div>Prev (carried into current)</div>
                <div className="text-right font-mono font-semibold text-[color:var(--sf-text-primary)]">
                  {created.previous?.total_amount == null ? "—" : fmtMoney(created.previous.total_amount)}
                </div>
                <div>Previous Quarter</div>
                <div className="text-right font-mono font-semibold text-[color:var(--sf-text-primary)]">
                  {createdActiveQoq == null ? "—" : `${createdActiveQoq < 0 ? "↓" : createdActiveQoq > 0 ? "↑" : "•"} ${fmtSignedPct(createdActiveQoq, { digits: 0 })}`}
                </div>
              </div>
              <div className="mt-1 text-[11px] text-[color:var(--sf-text-secondary)]">Excludes won and lost</div>
            </div>

            <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
              <div className="text-[11px] text-[color:var(--sf-text-secondary)]">Previous Quarter velocity</div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{fmtSignedPct(createdQoq, { digits: 0 })}</div>
              <div className="mt-1 text-[11px] text-[color:var(--sf-text-secondary)]">
                Created pipeline ({fmtMoney(created.previous?.total_amount_all ?? created.previous?.total_amount)} → {fmtMoney(created.current?.total_amount_all ?? created.current?.total_amount)})
              </div>
            </div>

            <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
              <div className="text-[11px] text-[color:var(--sf-text-secondary)]">Created pipeline (# opps)</div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{fmtNum(created.current?.total_opps ?? null)}</div>
              <div className="mt-1 text-[11px] text-[color:var(--sf-text-secondary)]">Prev Qtr: {created.previous?.total_opps == null ? "—" : fmtNum(created.previous.total_opps)}</div>
            </div>

            <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
              <div className="text-[11px] text-[color:var(--sf-text-secondary)]">Created In Quarter Won</div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(created.current?.created_won_amount ?? 0)}</div>
              <div className="mt-1 text-[11px] text-[color:var(--sf-text-secondary)]"># opps: {fmtNum(created.current?.created_won_opps ?? 0)} · Avg health: —</div>
            </div>

            <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
              <div className="text-[11px] text-[color:var(--sf-text-secondary)]">Created In Quarter Lost</div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(created.current?.created_lost_amount ?? 0)}</div>
              <div className="mt-1 text-[11px] text-[color:var(--sf-text-secondary)]"># opps: {fmtNum(created.current?.created_lost_opps ?? 0)} · Avg health: —</div>
            </div>

            <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
              <div className="text-[11px] text-[color:var(--sf-text-secondary)]">Avg age of created opps</div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{fmtDays(km?.predictive?.cycle_mix_created_pipeline?.avg_age_days ?? null)}</div>
              <div className="mt-1 text-[11px] text-[color:var(--sf-text-secondary)]">Leading indicator of close timing</div>
            </div>
          </div>

          {createdMix ? (
            <div className="mt-3">
              <div className="text-[11px] font-semibold text-[color:var(--sf-text-primary)]">Forecast Mix (created opps)</div>
              <div className="mt-2 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                {(["commit", "best_case", "pipeline"] as const).map((k) => {
                  const m = (createdMix as any)?.[k] || null;
                  const amt = Number(m?.value || 0) || 0;
                  const cnt = Number(m?.opps || 0) || 0;
                  const hp = m?.health_pct == null ? null : Number(m.health_pct);
                  const label = k === "commit" ? "Commit" : k === "best_case" ? "Best Case" : "Pipeline";
                  return (
                    <div key={k} className="min-w-0 overflow-hidden rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-2">
                      <div className="text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">{label}</div>
                      <div className="mt-0.5 truncate font-mono text-xs font-semibold leading-tight text-[color:var(--sf-text-primary)]">{fmtMoney(amt)}</div>
                      <div className="mt-0.5 text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">
                        <div># Opps: {fmtNum(cnt)}</div>
                        <div>
                          Health: <span className={healthColorClass(hp == null ? null : Math.round(hp))}>{hp == null ? "—" : `${Math.round(hp)}%`}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

