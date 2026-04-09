"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { closedOutcomeFromOpportunityRow } from "../../../lib/opportunityOutcome";
import { dateOnly } from "../../../lib/dateOnly";

type Deal = Record<string, unknown> & {
  id?: string;
  account_name?: string | null;
  partner_name?: string | null;
  amount?: number | null;
  close_date?: string | null;
  ai_verdict?: string | null;
  forecast_stage?: string | null;
  health_score?: number | null;
};

function fmtMoney(n: unknown) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function healthPct(deal: Deal) {
  const hs = Number(deal.health_score);
  if (!Number.isFinite(hs) || hs <= 0) return "—";
  const pct = Math.round((hs / 30) * 100);
  return `${Math.max(0, Math.min(100, pct))}%`;
}

function forecastLabel(d: Deal) {
  const v = String(d.ai_verdict || d.forecast_stage || "").trim();
  return v || "—";
}

export function ChannelMyPipelineTableClient(props: { quotaPeriodId?: string }) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const q = new URLSearchParams();
      q.set("limit", "2000");
      const qp = String(props.quotaPeriodId || "").trim();
      if (qp) q.set("quota_period_id", qp);
      const res = await fetch(`/api/forecast/deals?${q.toString()}`);
      const j = (await res.json()) as { ok?: boolean; deals?: Deal[]; error?: string };
      if (!res.ok || !j?.ok) {
        setError(j?.error || "Could not load deals.");
        setDeals([]);
        return;
      }
      setDeals(Array.isArray(j.deals) ? j.deals : []);
    } catch {
      setError("Could not load deals.");
      setDeals([]);
    } finally {
      setBusy(false);
    }
  }, [props.quotaPeriodId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openRows = useMemo(
    () => (deals || []).filter((d) => closedOutcomeFromOpportunityRow(d) == null),
    [deals]
  );

  return (
    <div className="space-y-2">
      {error ? <p className="text-sm text-[#E74C3C]">{error}</p> : null}
      {busy ? (
        <p className="text-sm text-[color:var(--sf-text-secondary)]">Loading pipeline…</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[color:var(--sf-border)]">
          <table className="min-w-[720px] w-full border-collapse text-left text-sm text-[color:var(--sf-text-primary)]">
            <thead className="bg-[color:var(--sf-surface-alt)] text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
              <tr>
                <th className="px-3 py-3">Account</th>
                <th className="px-3 py-3">Partner</th>
                <th className="px-3 py-3 text-right">Revenue</th>
                <th className="px-3 py-3">Close date</th>
                <th className="px-3 py-3">Forecast</th>
                <th className="px-3 py-3 text-right">Health</th>
              </tr>
            </thead>
            <tbody>
              {openRows.length ? (
                openRows.map((d) => (
                  <tr key={String(d.id ?? `${d.account_name}-${d.close_date}`)} className="border-t border-[color:var(--sf-border)]">
                    <td className="px-3 py-3">{String(d.account_name || "").trim() || "—"}</td>
                    <td className="px-3 py-3">{String(d.partner_name || "").trim() || "—"}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{fmtMoney(d.amount)}</td>
                    <td className="px-3 py-3 font-mono text-xs">{dateOnly(d.close_date) || "—"}</td>
                    <td className="px-3 py-3">{forecastLabel(d)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{healthPct(d)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[color:var(--sf-text-disabled)]">
                    No open opportunities in your channel scope.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
