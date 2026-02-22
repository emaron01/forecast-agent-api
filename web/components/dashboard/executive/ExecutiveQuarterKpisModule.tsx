"use client";

import type { PipelineMomentumData } from "../../../lib/pipelineMomentum";
import type { QuarterKpisSnapshot } from "../../../lib/quarterKpisSnapshot";

function fmtMoney(n: any) {
  if (n == null) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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
  return Math.round(v).toLocaleString("en-US");
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
  return `${v.toLocaleString("en-US")} day${v === 1 ? "" : "s"}`;
}

function healthColorClass(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-disabled)]";
  if (pct >= 80) return "text-[#2ECC71]";
  if (pct >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

function deltaColorClass(p01: number | null) {
  if (p01 == null || !Number.isFinite(p01)) return "text-[color:var(--sf-text-disabled)]";
  if (p01 > 0.0001) return "text-[#2ECC71]";
  if (p01 < -0.0001) return "text-[#E74C3C]";
  return "text-[#F1C40F]";
}

function coverageStatus(r: number | null) {
  if (r == null || !Number.isFinite(r)) {
    return { label: "—", cls: "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]" };
  }
  if (r < 3.31) return { label: "HIGH RISK", cls: "border-[#E74C3C]/50 bg-[#E74C3C]/10 text-[#E74C3C]" };
  if (r < 3.5) return { label: "MEDIUM RISK", cls: "border-[#F1C40F]/50 bg-[#F1C40F]/10 text-[#F1C40F]" };
  return { label: "PIPELINE COVERED", cls: "border-[#2ECC71]/40 bg-[#2ECC71]/10 text-[#2ECC71]" };
}

export function ExecutiveRemainingQuarterlyForecastBlock(props: {
  crmTotals: { commit_amount: number; best_case_amount: number; pipeline_amount: number; won_amount: number };
  quota: number;
  pipelineMomentum: PipelineMomentumData | null;
}) {
  const km = props.pipelineMomentum;

  const commitAmt = Number(props.crmTotals?.commit_amount ?? NaN);
  const bestAmt = Number(props.crmTotals?.best_case_amount ?? NaN);
  const pipeAmt = Number(props.crmTotals?.pipeline_amount ?? NaN);
  const totalPipelineAmt = Number.isFinite(commitAmt) && Number.isFinite(bestAmt) && Number.isFinite(pipeAmt) ? commitAmt + bestAmt + pipeAmt : null;
  const mixTotal = totalPipelineAmt != null && Number.isFinite(totalPipelineAmt) && totalPipelineAmt > 0 ? totalPipelineAmt : null;
  const mixCommitPct01 = mixTotal ? Math.max(0, Math.min(1, commitAmt / mixTotal)) : null;
  const mixBestPct01 = mixTotal ? Math.max(0, Math.min(1, bestAmt / mixTotal)) : null;
  const mixPipePct01 = mixTotal ? Math.max(0, Math.min(1, pipeAmt / mixTotal)) : null;
  const fmtMixPct = (p01: number | null) => (p01 == null || !Number.isFinite(p01) ? "—" : `${Math.round(p01 * 100)}%`);

  const commitCount = km?.current_quarter?.mix?.commit?.opps ?? null;
  const bestCount = km?.current_quarter?.mix?.best_case?.opps ?? null;
  const pipeCount = km?.current_quarter?.mix?.pipeline?.opps ?? null;
  const totalPipelineCount =
    km?.current_quarter?.total_opps ??
    (commitCount != null && bestCount != null && pipeCount != null ? commitCount + bestCount + pipeCount : null);

  const commitHealthPct = km?.current_quarter?.mix?.commit?.health_pct ?? null;
  const bestHealthPct = km?.current_quarter?.mix?.best_case?.health_pct ?? null;
  const pipeHealthPct = km?.current_quarter?.mix?.pipeline?.health_pct ?? null;
  const totalHealthPct = km?.current_quarter?.avg_health_pct ?? null;

  const closedWonAmt = Number(props.crmTotals?.won_amount ?? NaN);
  const quota = Number(props.quota || 0) || 0;
  const remainingQuota = quota > 0 && Number.isFinite(closedWonAmt) ? Math.max(0, quota - closedWonAmt) : null;
  const coverage =
    remainingQuota != null && remainingQuota > 0 && totalPipelineAmt != null && totalPipelineAmt > 0 ? totalPipelineAmt / remainingQuota : null;
  const covStatus = coverageStatus(coverage);

  // Match HERO card styling (ex: "Blended ACV")
  const heroCard = "h-full min-h-[124px] rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm";
  const heroVal = "mt-2 text-kpiValue text-[color:var(--sf-text-primary)]";
  const mixBar = (
    <div
      className="h-[10px] w-full overflow-hidden rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]"
      aria-label={`Forecast mix: Commit ${fmtMixPct(mixCommitPct01)}, Best Case ${fmtMixPct(mixBestPct01)}, Pipeline ${fmtMixPct(mixPipePct01)}`}
      title={`Commit ${fmtMixPct(mixCommitPct01)} · Best Case ${fmtMixPct(mixBestPct01)} · Pipeline ${fmtMixPct(mixPipePct01)}`}
    >
      <div className="flex h-full w-full flex-row">
        <div
          className="h-full bg-[#2ECC71]"
          style={{ width: mixCommitPct01 == null ? "0%" : `${Math.max(0, Math.min(100, mixCommitPct01 * 100))}%` }}
        />
        <div
          className="h-full bg-[color:var(--sf-accent-primary)]"
          style={{ width: mixBestPct01 == null ? "0%" : `${Math.max(0, Math.min(100, mixBestPct01 * 100))}%` }}
        />
        <div
          className="h-full bg-[#E74C3C]/80"
          style={{ width: mixPipePct01 == null ? "0%" : `${Math.max(0, Math.min(100, mixPipePct01 * 100))}%` }}
        />
      </div>
    </div>
  );

  const cards = [
    { key: "commit", label: "Commit", amount: commitAmt, count: commitCount, healthPct: commitHealthPct },
    { key: "best", label: "Best Case", amount: bestAmt, count: bestCount, healthPct: bestHealthPct },
    { key: "pipe", label: "Pipeline", amount: pipeAmt, count: pipeCount, healthPct: pipeHealthPct },
    { key: "total", label: "Total Pipeline", amount: totalPipelineAmt, count: totalPipelineCount, healthPct: totalHealthPct },
  ];

  return (
    <div>
      <div className="text-sectionTitle text-[color:var(--sf-text-primary)]">Remaining Quarterly Forecast</div>
      {mixTotal ? <div className="mt-2">{mixBar}</div> : null}

      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.key} className={heroCard}>
            <div className="inline-flex items-center gap-2 text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">
              {c.key === "commit" ? <span className="h-2 w-2 rounded-full bg-[#2ECC71]" aria-hidden="true" /> : null}
              {c.key === "best" ? <span className="h-2 w-2 rounded-full bg-[color:var(--sf-accent-primary)]" aria-hidden="true" /> : null}
              {c.key === "pipe" ? <span className="h-2 w-2 rounded-full bg-[#E74C3C]/80" aria-hidden="true" /> : null}
              <span>{c.label}</span>
            </div>
            <div className={heroVal}>{fmtMoney(c.amount)}</div>
            <div className="mt-2 text-meta">
              # Opps: <span className="num-tabular font-[500] text-[color:var(--sf-text-primary)]">{c.count == null ? "—" : fmtNum(c.count)}</span>
            </div>
            <div className="mt-1 text-meta">
              Avg Health:{" "}
              <span className={healthColorClass(c.healthPct)}>
                {c.healthPct == null ? "—" : `${Math.max(0, Math.min(100, Math.round(Number(c.healthPct) || 0)))}%`}
              </span>
            </div>
          </div>
        ))}

        <div className={heroCard}>
          <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Pipeline Coverage</div>
          <div className={heroVal}>{fmtCoverageRatio(coverage, { digits: 1 })}</div>
          <div className="mt-2">
            <span className={["inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold", covStatus.cls].join(" ")}>{covStatus.label}</span>
          </div>
        </div>
      </div>
    </div>
  );
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

  const titleLeft = period
    ? `${String(period.period_name || "").trim() || "Quarter"} (FY${period.fiscal_year} Q${period.fiscal_quarter}) Current`
    : "Quarter KPIs (Current)";
  const dateRange = period ? `${String(period.period_start)} \u2192 ${String(period.period_end)}` : "";

  const createdFromKpis = kpis?.createdPipeline || null;
  const created = km?.predictive?.created_pipeline || null;
  const createdMix = created?.current?.mix || null;
  const createdQoq = created?.qoq_total_amount_all_pct01 ?? created?.qoq_total_amount_pct01 ?? null;
  const createdActiveQoq = created?.qoq_total_amount_pct01 ?? null;
  const boxClass = "min-w-0 overflow-hidden rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2";

  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sectionTitle text-[color:var(--sf-text-primary)]">{titleLeft}</div>
          {dateRange ? <div className="mt-1 text-meta">{dateRange}</div> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3">
      </div>

      {createdFromKpis ? (
        <div className="mt-3 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-sectionTitle text-[color:var(--sf-text-primary)]">Forecast Mix</div>
            </div>
          </div>

          <div className="mt-3 grid items-start gap-2 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
            {(() => {
              const cp = createdFromKpis;
              const Card = (p: { label: string; mix: number | null; amount: number; count: number; health: number | null }) => (
                <div className={boxClass}>
                  <div className="text-tableLabel leading-tight">
                    {p.label} {p.mix == null ? "" : `(${fmtPct(p.mix)})`}
                  </div>
                  <div className="mt-0.5 truncate text-tableValue leading-tight text-[color:var(--sf-text-primary)]">{fmtMoney(p.amount)}</div>
                  <div className="mt-0.5 text-meta leading-tight">
                    <div>
                      # Opps: <span className="num-tabular font-[500] text-[color:var(--sf-text-primary)]">{fmtNum(p.count)}</span>
                    </div>
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
              <div className="text-sectionTitle text-[color:var(--sf-text-primary)]">Pipeline Created This Quarter</div>
            </div>
          </div>

          <div className="mt-3 grid auto-rows-fr items-stretch gap-2 lg:grid-cols-3">
            <div className="h-full rounded-md border border-[color:var(--sf-text-secondary)]/20 bg-[color:var(--sf-surface-alt)] px-3 py-2">
              <div className="text-tableLabel">Created pipeline (value)</div>
              <div className={["mt-0.5 text-tableValue", deltaColorClass(createdActiveQoq)].join(" ")}>{fmtMoney(created.current?.total_amount)}</div>
              <div className="mt-1 text-tableLabel">Created pipeline (Active)</div>
              <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-2 text-meta">
                <div>Prev (carried into current)</div>
                <div className="text-right num-tabular font-[500] text-[color:var(--sf-text-primary)]">
                  {created.previous?.total_amount == null ? "—" : fmtMoney(created.previous.total_amount)}
                </div>
                <div>Previous Quarter</div>
                <div className={["text-right num-tabular font-[700]", deltaColorClass(createdActiveQoq)].join(" ")}>
                  {createdActiveQoq == null ? "—" : `${createdActiveQoq < 0 ? "↓" : createdActiveQoq > 0 ? "↑" : "•"} ${fmtSignedPct(createdActiveQoq, { digits: 0 })}`}
                </div>
              </div>
              <div className="mt-1 text-meta">Excludes won and lost</div>
            </div>

            <div className="h-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
              <div className="text-tableLabel">Previous Quarter velocity</div>
              <div className={["mt-0.5 text-tableValue", deltaColorClass(createdQoq)].join(" ")}>{fmtSignedPct(createdQoq, { digits: 0 })}</div>
              <div className="mt-1 text-meta">
                Created pipeline ({fmtMoney(created.previous?.total_amount_all ?? created.previous?.total_amount)} → {fmtMoney(created.current?.total_amount_all ?? created.current?.total_amount)})
              </div>
            </div>

            <div className="h-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
              <div className="text-tableLabel">Created pipeline (# opps)</div>
              <div className="mt-0.5 text-tableValue text-[color:var(--sf-text-primary)]">{fmtNum(created.current?.total_opps ?? null)}</div>
              <div className="mt-1 text-meta">Prev Qtr: {created.previous?.total_opps == null ? "—" : fmtNum(created.previous.total_opps)}</div>
            </div>

            <div className="h-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
              <div className="text-tableLabel">Created In Quarter Won</div>
              <div className="mt-0.5 text-tableValue text-[color:var(--sf-text-primary)]">{fmtMoney(created.current?.created_won_amount ?? 0)}</div>
              <div className="mt-1 text-meta"># opps: {fmtNum(created.current?.created_won_opps ?? 0)} · Avg health: —</div>
            </div>

            <div className="h-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
              <div className="text-tableLabel">Created In Quarter Lost</div>
              <div className="mt-0.5 text-tableValue text-[color:var(--sf-text-primary)]">{fmtMoney(created.current?.created_lost_amount ?? 0)}</div>
              <div className="mt-1 text-meta"># opps: {fmtNum(created.current?.created_lost_opps ?? 0)} · Avg health: —</div>
            </div>
          </div>

        </div>
      ) : null}
    </section>
  );
}

