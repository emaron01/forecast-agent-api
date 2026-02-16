"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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

function healthPctFrom30(score: any) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  const pct = Math.round((n / 30) * 100);
  return Math.max(0, Math.min(100, pct));
}

function healthColorClass(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-disabled)]";
  if (pct >= 80) return "text-[#2ECC71]";
  if (pct >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

function normalizeForecastBucket(stageLike: any): "Commit" | "Best Case" | "Pipeline" {
  const s = String(stageLike || "").trim().toLowerCase();
  if (s.includes("commit")) return "Commit";
  if (s.includes("best")) return "Best Case";
  return "Pipeline";
}

function isClosedDeal(d: Deal) {
  return closedOutcomeFromStage((d as any)?.forecast_stage) || closedOutcomeFromStage((d as any)?.stage) || null;
}

export function SimpleForecastDashboardClient(props: {
  defaultRepName?: string;
  repFilterLocked?: boolean;
  quotaPeriods?: Array<{ id: string; label: string }>;
  defaultQuotaPeriodId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [search, setSearch] = useState("");
  const [repFilter, setRepFilter] = useState(props.defaultRepName || "");
  const [quotaPeriodId, setQuotaPeriodId] = useState<string>(
    String(searchParams.get("quota_period_id") || props.defaultQuotaPeriodId || "").trim()
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Deal review workflow is rep-only. Managers/executives can still search and open Deal Score Cards.
  const showDealReviewWorkflow = !!props.repFilterLocked;

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedIds = useMemo(() => Object.entries(selected).filter(([, v]) => v).map(([id]) => id), [selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const openOnly = deals.filter((d) => !isClosedDeal(d));
    if (!q) return openOnly;
    return openOnly.filter((d) => {
      const hay = [d.account_name, d.opportunity_name, normalizeForecastBucket(d.forecast_stage), d.ai_verdict, d.ai_forecast]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [deals, search]);

  const avgHealthPct = useMemo(() => {
    const scores = filtered
      .map((d) => Number(d.health_score))
      .filter((n) => Number.isFinite(n) && n > 0) as number[];
    if (!scores.length) return null;
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    return healthPctFrom30(avgScore);
  }, [filtered]);

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (!props.repFilterLocked && repFilter.trim()) params.set("rep_name", repFilter.trim());
      if (quotaPeriodId) params.set("quota_period_id", quotaPeriodId);
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
          if (isClosedDeal(d)) continue;
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
    if (!props.repFilterLocked) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repFilter]);

  useEffect(() => {
    if (quotaPeriodId) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotaPeriodId]);

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
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Sales Opportunities</h1>
              <div className="text-sm text-[color:var(--sf-text-secondary)]">
                Avg Health Score: <span className={`font-semibold ${healthColorClass(avgHealthPct)}`}>{avgHealthPct == null ? "—" : `${avgHealthPct}%`}</span>
              </div>
            </div>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              {showDealReviewWorkflow ? (
                <>
                  Select one or multiple opportunities for your SalesForecaster.IO Review.{" "}
                  <Link
                    className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline"
                    href="/forecast/opportunity-score-cards"
                  >
                    Click here for Opportunity Score Cards View.
                  </Link>
                </>
              ) : (
                <>
                  Search for a specific opportunity and open its Deal Score Card.{" "}
                  <Link
                    className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline"
                    href="/forecast/opportunity-score-cards"
                  >
                    Opportunity Score Cards View.
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm text-[color:var(--sf-text-disabled)] disabled:opacity-60"
              disabled
              title="CRM sync is not configured yet (API integration coming soon)."
            >
              Sync CRM
            </button>
            {showDealReviewWorkflow ? (
              <button
                type="button"
                onClick={() => void startQueueReview()}
                className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-60"
                disabled={busy || !selectedIds.length}
                title="Run the agent through selected deals, one-by-one."
              >
                Review Queue ({selectedIds.length})
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-12">
          <div className="md:col-span-5">
            <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">
              {showDealReviewWorkflow ? "Search Opportunities For Review" : "Search opportunities"}
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search account, opportunity, stages…"
              className="mt-1 w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
            />
          </div>

          {!props.repFilterLocked ? (
            <div className="md:col-span-4">
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Rep (optional)</label>
              <input
                value={repFilter}
                onChange={(e) => setRepFilter(e.target.value)}
                placeholder="Erik M"
                disabled={busy}
                className="mt-1 w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)] disabled:opacity-60"
              />
            </div>
          ) : (
            <div className="md:col-span-4">
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Close Date Selector</label>
              <select
                value={quotaPeriodId}
                onChange={(e) => {
                  const next = String(e.target.value || "");
                  setQuotaPeriodId(next);
                  const nextParams = new URLSearchParams(searchParams.toString());
                  if (next) nextParams.set("quota_period_id", next);
                  else nextParams.delete("quota_period_id");
                  router.push(`${pathname}?${nextParams.toString()}`);
                }}
                disabled={busy}
                className="mt-1 w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)] disabled:opacity-60"
              >
                {(props.quotaPeriods || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {showDealReviewWorkflow ? (
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
                {allVisibleSelected ? "Clear All For Review" : "Select All For Review"}
              </button>
            </div>
          ) : (
            <div className="md:col-span-3" />
          )}
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
              {showDealReviewWorkflow ? <th className="px-4 py-3 w-[56px]">Queue</th> : null}
              <th className="px-4 py-3">Account Name</th>
              <th className="px-4 py-3">Opp Name</th>
              <th className="px-4 py-3">Revenue</th>
              <th className="px-4 py-3">Close Date</th>
              <th className="px-4 py-3">Forecast Stage</th>
              <th className="px-4 py-3">AI Forecast Stage</th>
              <th className="px-4 py-3">Health Score %</th>
              <th className="px-4 py-3 text-right">{showDealReviewWorkflow ? "Review" : "Deal Score Card"}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => {
              const id = String(d.id || "");
              const checked = !!selected[id];
              const bucket = normalizeForecastBucket(d.forecast_stage);
              return (
                <tr key={id} className="border-t border-[color:var(--sf-border)]">
                  {showDealReviewWorkflow ? (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [id]: e.target.checked }))}
                        aria-label="Queue for review"
                      />
                    </td>
                  ) : null}
                  <td className="px-4 py-3">{d.account_name || "—"}</td>
                  <td className="px-4 py-3">{d.opportunity_name || "—"}</td>
                  <td className="px-4 py-3">{fmtMoney(d.amount)}</td>
                  <td className="px-4 py-3">{dateOnly(d.close_date) || "—"}</td>
                  <td className="px-4 py-3">{bucket}</td>
                  <td className="px-4 py-3">{d.ai_verdict || d.ai_forecast || "—"}</td>
                  <td className="px-4 py-3">{healthPct(d)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-xs font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
                      href={`/opportunities/${encodeURIComponent(id)}/deal-review`}
                    >
                      {showDealReviewWorkflow ? "Review" : "View"}
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!filtered.length ? (
              <tr>
                <td className="px-4 py-8 text-center text-[color:var(--sf-text-disabled)]" colSpan={showDealReviewWorkflow ? 9 : 8}>
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

