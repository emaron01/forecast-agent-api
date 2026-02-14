"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { closedOutcomeFromStage } from "../../../lib/opportunityOutcome";
import { dateOnly } from "../../../lib/dateOnly";

type Deal = Record<string, any> & {
  id: string; // public_id
  account_name?: string | null;
  opportunity_name?: string | null;
  amount?: number | null;
  close_date?: string | null;
  forecast_stage?: string | null;
  ai_verdict?: string | null;
  ai_forecast?: string | null;
  health_score?: number | null;
  updated_at?: string | null;
};

function fmtMoney(n: any) {
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

export function SimpleForecastDashboardClient(props: { defaultRepName?: string; repFilterLocked?: boolean }) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [search, setSearch] = useState("");
  const [repFilter, setRepFilter] = useState(props.defaultRepName || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedIds = useMemo(() => Object.entries(selected).filter(([, v]) => v).map(([id]) => id), [selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return deals;
    return deals.filter((d) => {
      const hay = [d.account_name, d.opportunity_name, d.forecast_stage, d.ai_verdict, d.ai_forecast]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [deals, search]);

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (repFilter.trim()) params.set("rep_name", repFilter.trim());
      params.set("limit", "500");
      const res = await fetch(`/api/forecast/deals?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `API error (${res.status})`);
      const list = Array.isArray(json.deals) ? (json.deals as Deal[]) : [];
      setDeals(list);
      // Drop selections for deals no longer present.
      setSelected((prev) => {
        const next: Record<string, boolean> = {};
        for (const d of list) {
          const id = String(d.id || "");
          if (!id) continue;
          if (prev[id]) next[id] = true;
        }
        return next;
      });
    } catch (e: any) {
      setDeals([]);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Rep filter triggers refresh (mirrors main dashboard behavior).
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repFilter]);

  async function startQueueReview() {
    if (!selectedIds.length) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/deal-review/queue/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityIds: selectedIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Queue review start failed");
      const runId = String(json?.run?.runId || "").trim();
      if (!runId) throw new Error("Missing runId");
      window.location.href = `/forecast/review-queue/${encodeURIComponent(runId)}`;
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((d) => selected[String(d.id || "")]);

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Sales Forecaster (Simple)</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Simplified view for deal selection + single/queue review. Uses the same data as{" "}
              <Link
                className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline"
                href="/forecast/opportunity-score-cards"
              >
                Opportunity Score Cards View
              </Link>
              .
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)] disabled:opacity-60"
              disabled={busy}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void startQueueReview()}
              className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-60"
              disabled={busy || !selectedIds.length}
              title="Run the agent through selected deals, one-by-one."
            >
              Review Queue ({selectedIds.length})
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-12">
          <div className="md:col-span-5">
            <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Deal search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search account, opp, stages…"
              className="mt-1 w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
            />
          </div>

          <div className="md:col-span-4">
            <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Rep (optional)</label>
            <input
              value={repFilter}
              onChange={(e) => setRepFilter(e.target.value)}
              placeholder={props.repFilterLocked ? "Locked" : "Erik M"}
              disabled={!!props.repFilterLocked || busy}
              className="mt-1 w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)] disabled:opacity-60"
            />
          </div>

          <div className="md:col-span-3 flex items-end justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)] disabled:opacity-60"
              disabled={busy || !filtered.length}
              onClick={() => {
                setSelected((prev) => {
                  const next = { ...prev };
                  for (const d of filtered) {
                    const id = String(d.id || "");
                    if (!id) continue;
                    next[id] = !allVisibleSelected;
                  }
                  return next;
                });
              }}
              title="Select/deselect all visible deals (after search filter)."
            >
              {allVisibleSelected ? "Clear visible" : "Select visible"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-[#E74C3C] bg-[color:var(--sf-surface-alt)] p-3 text-sm text-[color:var(--sf-text-primary)]">
            {error}
          </div>
        ) : null}
      </section>

      <section className="overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3 w-[56px]">Queue</th>
              <th className="px-4 py-3">Account Name</th>
              <th className="px-4 py-3">Opp Name</th>
              <th className="px-4 py-3">Revenue</th>
              <th className="px-4 py-3">Close Date</th>
              <th className="px-4 py-3">Forecast Stage</th>
              <th className="px-4 py-3">AI Forecast Stage</th>
              <th className="px-4 py-3">Health Score %</th>
              <th className="px-4 py-3 text-right">Review</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => {
              const id = String(d.id || "");
              const checked = !!selected[id];
              const closed = closedOutcomeFromStage(d.forecast_stage) || closedOutcomeFromStage((d as any).stage);
              return (
                <tr key={id} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setSelected((prev) => ({ ...prev, [id]: e.target.checked }))}
                      aria-label="Queue for review"
                    />
                  </td>
                  <td className="px-4 py-3">{d.account_name || "—"}</td>
                  <td className="px-4 py-3">{d.opportunity_name || "—"}</td>
                  <td className="px-4 py-3">{fmtMoney(d.amount)}</td>
                  <td className="px-4 py-3">{dateOnly(d.close_date) || "—"}</td>
                  <td className="px-4 py-3">{d.forecast_stage || "—"}</td>
                  <td className="px-4 py-3">{d.ai_verdict || d.ai_forecast || "—"}</td>
                  <td className="px-4 py-3">{healthPct(d)}</td>
                  <td className="px-4 py-3 text-right">
                    {closed ? (
                      <span className="text-xs text-[color:var(--sf-text-disabled)]" title="Closed deals (Won/Lost) cannot be reviewed.">
                        Closed ({closed})
                      </span>
                    ) : (
                      <Link
                        className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-xs font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
                        href={`/opportunities/${encodeURIComponent(id)}/deal-review`}
                      >
                        Review
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {!filtered.length ? (
              <tr>
                <td className="px-4 py-8 text-center text-[color:var(--sf-text-disabled)]" colSpan={9}>
                  No deals found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

