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

  const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue));

  return (
    <section className="w-full rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Product Revenue Mix</div>
        </div>
      </div>

      <ExecutiveProductPerformanceAiTakeawayClient quotaPeriodId={props.quotaPeriodId} payload={props.data} />

      <div className="mt-4 overflow-x-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
        <table className="min-w-[980px] w-full table-auto border-collapse text-sm">
          <thead className="bg-[color:var(--sf-surface)] text-xs text-[color:var(--sf-text-secondary)]">
            <tr className="text-left">
              <th className="border-b border-[color:var(--sf-border)] px-3 py-2">Product</th>
              <th className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right">Revenue (Closed Won)</th>
              <th className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right">% of Mix</th>
              <th className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right">Volume</th>
              <th className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right">Avg. Deal Size</th>
              <th className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right">Deal Health</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const barPct = Math.round((r.revenue / maxRevenue) * 100);
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

              return (
                <tr
                  key={r.name}
                  className={[
                    "text-[color:var(--sf-text-primary)]",
                    idx % 2 === 0 ? "bg-transparent" : "bg-[color:var(--sf-surface)]/20",
                    "hover:bg-[color:var(--sf-surface)]/35",
                  ].join(" ")}
                >
                  <td className="border-b border-[color:var(--sf-border)] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{r.name}</div>
                        {spreadBadge ? (
                          <div className="mt-1">
                            <span className={["inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", spreadBadge.cls].join(" ")}>
                              {spreadBadge.t}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>

                  <td className="border-b border-[color:var(--sf-border)] px-3 py-2">
                    <div className="relative flex items-center justify-end">
                      <div
                        className="absolute left-0 top-1/2 h-[10px] -translate-y-1/2 rounded-full bg-[color:var(--sf-accent-primary)]/20"
                        style={{ width: `${Math.max(6, barPct)}%` }}
                        aria-hidden="true"
                      />
                      <span className="relative font-mono text-xs font-semibold">{fmtMoney0(r.revenue)}</span>
                    </div>
                  </td>

                  <td className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right font-mono text-xs">{fmtPct01(r.revenue_pct)}</td>
                  <td className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right">
                    <span className="font-mono text-xs font-semibold">{r.orders}</span>{" "}
                    <span className="text-xs text-[color:var(--sf-text-secondary)]">({fmtPct01(r.volume_pct)})</span>
                  </td>
                  <td className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right font-mono text-xs">
                    {r.acv == null ? "—" : fmtMoney0(r.acv)}
                  </td>
                  <td className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right">
                    <span className={["inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-[11px] font-semibold", tone.badge].join(" ")}>
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

