"use client";

import type { PartnerPerformanceRow } from "../../../lib/partnerPerformanceRollups";

function fmtMoney(n: number) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtHealth(score: number | null) {
  if (score == null || !Number.isFinite(score)) return "—";
  const pct = Math.round((score / 30) * 100);
  return `${Math.max(0, Math.min(100, pct))}%`;
}

export function PartnerPerformanceReadOnlyTable(props: { rows: PartnerPerformanceRow[]; emptyHint?: string }) {
  const hint = props.emptyHint ?? "No partner-attributed opportunities in this scope yet.";
  return (
    <div className="overflow-hidden rounded-md border border-[color:var(--sf-border)]">
      <table className="w-full border-collapse text-left text-sm text-[color:var(--sf-text-primary)]">
        <thead className="bg-[color:var(--sf-surface-alt)] text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
          <tr>
            <th className="px-3 py-3">Partner</th>
            <th className="px-3 py-3 text-right">Win rate</th>
            <th className="px-3 py-3 text-right">Avg health</th>
            <th className="px-3 py-3 text-right">Revenue (won)</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.length ? (
            props.rows.map((r) => {
              const wr = r.closed > 0 ? r.won / r.closed : null;
              return (
                <tr key={r.partner_name} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-3 py-3 font-medium">{r.partner_name}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs">
                    {wr == null || !Number.isFinite(wr) ? "—" : `${Math.round(wr * 100)}%`}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs">{fmtHealth(r.avg_health)}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs">{fmtMoney(r.revenue)}</td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-[color:var(--sf-text-disabled)]">
                {hint}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
