"use client";

import { computeExecutiveProductRows, type ExecutiveProductPerformanceData } from "../../../lib/executiveProductInsights";
import { ExecutiveProductPerformanceAiTakeawayClient } from "./ExecutiveProductPerformanceAiTakeawayClient";

function fmtMoney0(n: number) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct01(p: number | null) {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${Math.round(p * 100)}%`;
}

function healthTone(pct: number | null) {
  if (pct == null) return { label: "—", dot: "bg-[color:var(--sf-text-disabled)]", badge: "border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] text-[color:var(--sf-text-secondary)]" };
  if (pct >= 80) return { label: "Good", dot: "bg-[#16A34A]", badge: "border-[#16A34A]/35 bg-[#16A34A]/10 text-[#16A34A]" };
  if (pct >= 50) return { label: "Watch", dot: "bg-[#F1C40F]", badge: "border-[#F1C40F]/45 bg-[#F1C40F]/10 text-[#F1C40F]" };
  return { label: "Risk", dot: "bg-[#E74C3C]", badge: "border-[#E74C3C]/45 bg-[#E74C3C]/10 text-[#E74C3C]" };
}

export function ExecutiveProductPerformance(props: { data: ExecutiveProductPerformanceData; quotaPeriodId: string }) {
  const rows = computeExecutiveProductRows(props.data);
  const dotColors = ["#2ECC71", "var(--sf-accent-primary)", "#E74C3C"] as const;

  return (
    <section className="w-full rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Product Revenue Mix</div>
        </div>
      </div>

      {rows.length ? (
        <div className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
          <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Revenue Mix</div>
          <div className="mt-2">
            <div className="relative h-[10px] w-full rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]" aria-hidden="true">
              {rows.slice(0, 3).map((r, idx) => {
                const pct = r.revenue_pct == null ? null : Math.max(0, Math.min(1, Number(r.revenue_pct)));
                const left = pct == null ? 0 : pct * 100;
                const c = dotColors[Math.min(dotColors.length - 1, idx)];
                return (
                  <span
                    key={r.name}
                    className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-[color:var(--sf-border)]"
                    style={{ left: `calc(${left}% - 6px)`, background: c }}
                    aria-hidden="true"
                  />
                );
              })}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta">
              {rows.slice(0, 3).map((r, idx) => {
                const c = dotColors[Math.min(dotColors.length - 1, idx)];
                return (
                  <span key={r.name} className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: c }} aria-hidden="true" />
                    <span className="truncate">
                      {r.name} <span className="num-tabular font-[500] text-[color:var(--sf-text-primary)]">{fmtPct01(r.revenue_pct)}</span>
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r, idx) => {
          const tone = healthTone(r.health_score);
          const spread = r.spread_pct;
          const spreadBadge =
            spread == null
              ? null
              : spread >= 0.08
                ? { t: "Pricing power", cls: "border-[#16A34A]/35 bg-[#16A34A]/10 text-[#16A34A]" }
                : spread <= -0.08
                  ? { t: "Effort gap", cls: "border-[#E74C3C]/45 bg-[#E74C3C]/10 text-[#E74C3C]" }
                  : { t: "Balanced", cls: "border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] text-[color:var(--sf-text-secondary)]" };
          const dot = dotColors[Math.min(dotColors.length - 1, idx)] || "var(--sf-accent-primary)";

          return (
            <div key={r.name} className="rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-[color:var(--sf-border)]" style={{ background: dot }} aria-hidden="true" />
                    <div className="truncate text-sm font-semibold text-[color:var(--sf-text-primary)]">{r.name}</div>
                  </div>
                  {spreadBadge ? (
                    <div className="mt-2">
                      <span className={["inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", spreadBadge.cls].join(" ")}>
                        {spreadBadge.t}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">% of Mix</div>
                  <div className="mt-1 font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{fmtPct01(r.revenue_pct)}</div>
                </div>
              </div>

              <div className="mt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Revenue (Closed Won)</div>
                <div className="mt-1 font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney0(r.revenue)}</div>
              </div>

              <div className="mt-3 grid gap-2 text-meta">
                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <span>Volume</span>
                  <span className="font-mono font-[600] text-[color:var(--sf-text-primary)]">
                    {r.orders} <span className="font-sans font-normal text-[color:var(--sf-text-secondary)]">({fmtPct01(r.volume_pct)})</span>
                  </span>
                </div>
                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <span>Avg. Deal Size</span>
                  <span className="font-mono font-[600] text-[color:var(--sf-text-primary)]">{r.acv == null ? "—" : fmtMoney0(r.acv)}</span>
                </div>
                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <span>Deal Health</span>
                  <span className={["inline-flex items-center justify-end gap-2 rounded-full border px-2 py-0.5 text-[11px] font-semibold", tone.badge].join(" ")}>
                    <span className="relative flex h-2.5 w-2.5">
                      {r.health_score != null && r.health_score >= 80 ? (
                        <span className={["absolute inline-flex h-full w-full animate-ping rounded-full opacity-30", tone.dot].join(" ")} />
                      ) : null}
                      <span className={["relative inline-flex h-2.5 w-2.5 rounded-full", tone.dot].join(" ")} />
                    </span>
                    <span>
                      {tone.label}
                      {r.health_score == null ? "" : ` (${Math.round(r.health_score)}%)`}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ExecutiveProductPerformanceAiTakeawayClient quotaPeriodId={props.quotaPeriodId} payload={props.data} />
    </section>
  );
}

