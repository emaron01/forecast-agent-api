"use client";

import Link from "next/link";

export type HeatmapDealRow = {
  id: string;
  riskTone: "high" | "medium" | "low" | "muted";
  riskLabel: string;
  dealColor?: string | null;
  dealName: string;
  repName: string;
  bucketLabel: string;
  amount: number;
  healthPct: number | null;
  gap: number;
};

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function deltaTextClass(n: number) {
  if (!Number.isFinite(n) || n === 0) return "text-[color:var(--sf-text-secondary)]";
  return n > 0 ? "text-[#2ECC71]" : "text-[#E74C3C]";
}

function riskPillClass(tone: HeatmapDealRow["riskTone"]) {
  if (tone === "high") return "border-[#E74C3C]/40 bg-[#E74C3C]/10 text-[#E74C3C]";
  if (tone === "medium") return "border-[#F1C40F]/40 bg-[#F1C40F]/10 text-[#F1C40F]";
  if (tone === "low") return "border-[#2ECC71]/40 bg-[#2ECC71]/10 text-[#2ECC71]";
  return "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]";
}

function healthTextClass(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-disabled)]";
  if (pct >= 80) return "text-[#2ECC71]";
  if (pct >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

export function DealsDrivingGapHeatmap(props: {
  rows: HeatmapDealRow[];
  viewFullHref: string;
  rowHref?: (row: HeatmapDealRow) => string;
  onRowClick?: (row: HeatmapDealRow) => void;
  title?: string;
  subtitle?: string;
}) {
  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{props.title || "Deals Driving the Gap"}</div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">{props.subtitle || "Top impact deals (click a row to drill into the deal view)."}</div>
        </div>
        <Link
          href={props.viewFullHref}
          className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
        >
          View Full Risk Analysis
        </Link>
      </div>

      <div className="mt-4 overflow-auto rounded-lg border border-[color:var(--sf-border)]">
        <div className="min-w-[980px]">
          <div className="grid grid-cols-[120px_1.6fr_140px_140px_120px_110px_140px_40px] gap-0 bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
            <div className="px-3 py-2">Risk</div>
            <div className="px-3 py-2">Deal</div>
            <div className="px-3 py-2">Sales Rep</div>
            <div className="px-3 py-2">Stage</div>
            <div className="px-3 py-2 text-right">Amount</div>
            <div className="px-3 py-2 text-right">Health</div>
            <div className="px-3 py-2 text-right">Gap</div>
            <div className="px-3 py-2 text-right" aria-hidden="true">
              &nbsp;
            </div>
          </div>

          {props.rows.length ? (
            props.rows.map((r) => (
              props.onRowClick ? (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => props.onRowClick?.(r)}
                  className="grid w-full grid-cols-[120px_1.6fr_140px_140px_120px_110px_140px_40px] items-center border-t border-[color:var(--sf-border)] text-left text-sm text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)] focus:outline-none focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
                >
                  <div className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {r.dealColor ? (
                        <span
                          className="h-2.5 w-2.5 rounded-full border border-[color:var(--sf-border)]"
                          style={{ background: r.dealColor }}
                          aria-hidden="true"
                        />
                      ) : null}
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${riskPillClass(r.riskTone)}`}>{r.riskLabel}</span>
                    </div>
                  </div>
                  <div className="px-3 py-2 font-medium">{r.dealName}</div>
                  <div className="px-3 py-2 text-xs text-[color:var(--sf-text-secondary)]">{r.repName}</div>
                  <div className="px-3 py-2 text-xs text-[color:var(--sf-text-secondary)]">{r.bucketLabel}</div>
                  <div className="px-3 py-2 text-right font-mono text-xs">{fmtMoney(r.amount)}</div>
                  <div className={`px-3 py-2 text-right font-mono text-xs ${healthTextClass(r.healthPct)}`}>{r.healthPct == null ? "—" : `${r.healthPct}%`}</div>
                  <div className={`px-3 py-2 text-right font-mono text-xs ${deltaTextClass(r.gap)}`}>{fmtMoney(r.gap)}</div>
                  <div className="px-3 py-2 text-right text-[color:var(--sf-text-secondary)]">›</div>
                </button>
              ) : (
                <Link
                  key={r.id}
                  href={props.rowHref ? props.rowHref(r) : `/opportunities/${encodeURIComponent(r.id)}/deal-review`}
                  className="grid grid-cols-[120px_1.6fr_140px_140px_120px_110px_140px_40px] items-center border-t border-[color:var(--sf-border)] text-sm text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)] focus:outline-none focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
                >
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {r.dealColor ? (
                      <span
                        className="h-2.5 w-2.5 rounded-full border border-[color:var(--sf-border)]"
                        style={{ background: r.dealColor }}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${riskPillClass(r.riskTone)}`}>{r.riskLabel}</span>
                  </div>
                </div>
                <div className="px-3 py-2 font-medium">{r.dealName}</div>
                <div className="px-3 py-2 text-xs text-[color:var(--sf-text-secondary)]">{r.repName}</div>
                <div className="px-3 py-2 text-xs text-[color:var(--sf-text-secondary)]">{r.bucketLabel}</div>
                <div className="px-3 py-2 text-right font-mono text-xs">{fmtMoney(r.amount)}</div>
                <div className={`px-3 py-2 text-right font-mono text-xs ${healthTextClass(r.healthPct)}`}>{r.healthPct == null ? "—" : `${r.healthPct}%`}</div>
                <div className={`px-3 py-2 text-right font-mono text-xs ${deltaTextClass(r.gap)}`}>{fmtMoney(r.gap)}</div>
                <div className="px-3 py-2 text-right text-[color:var(--sf-text-secondary)]">›</div>
                </Link>
              )
            ))
          ) : (
            <div className="border-t border-[color:var(--sf-border)] p-5 text-sm text-[color:var(--sf-text-secondary)]">No deals found for the current filters.</div>
          )}
        </div>
      </div>
    </section>
  );
}

