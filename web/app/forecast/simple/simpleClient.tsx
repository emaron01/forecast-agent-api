"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { closedOutcomeFromOpportunityRow } from "../../../lib/opportunityOutcome";
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
  return closedOutcomeFromOpportunityRow(d) || null;
}

type SortKey = "account" | "opportunity" | "revenue" | "close" | "forecast" | "health";
type SortDir = "asc" | "desc";

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
  const [sortKey, setSortKey] = useState<SortKey>("forecast");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Deal review workflow is rep-only. Managers/executives can still search and open Deal Score Cards.
  const showDealReviewWorkflow = !!props.repFilterLocked;

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedIds = useMemo(() => Object.entries(selected).filter(([, v]) => v).map(([id]) => id), [selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const openOnly = deals.filter((d) => !isClosedDeal(d));
    const base = !q
      ? openOnly
      : openOnly.filter((d) => {
          const hay = [d.account_name, d.opportunity_name, normalizeForecastBucket(d.forecast_stage), d.ai_verdict, d.ai_forecast]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });

    const sorted = [...base].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const s = (v: any) => String(v || "").trim().toLowerCase();
      const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : null);

      let av: any = null;
      let bv: any = null;

      switch (sortKey) {
        case "account":
          av = s(a.account_name);
          bv = s(b.account_name);
          break;
        case "opportunity":
          av = s(a.opportunity_name);
          bv = s(b.opportunity_name);
          break;
        case "revenue":
          av = n(a.amount);
          bv = n(b.amount);
          break;
        case "close":
          av = a.close_date ? new Date(a.close_date).getTime() : null;
          bv = b.close_date ? new Date(b.close_date).getTime() : null;
          break;
        case "forecast":
          av = normalizeForecastBucket(a.forecast_stage);
          bv = normalizeForecastBucket(b.forecast_stage);
          break;
        case "health":
          av = healthPctFrom30(a.health_score);
          bv = healthPctFrom30(b.health_score);
          break;
      }

      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      if (typeof av === "string" || typeof bv === "string") {
        return av.localeCompare(bv) * dir;
      }

      const na = Number(av);
      const nb = Number(bv);
      if (!Number.isFinite(na) && !Number.isFinite(nb)) return 0;
      if (!Number.isFinite(na)) return 1;
      if (!Number.isFinite(nb)) return -1;
      if (na === nb) return 0;
      return na < nb ? -1 * dir : 1 * dir;
    });

    return sorted;
  }, [deals, search, sortKey, sortDir]);

  const avgHealthPct = useMemo(() => {
    const scores = filtered
      .map((d) => Number(d.health_score))
      .filter((n) => Number.isFinite(n) && n > 0) as number[];
    if (!scores.length) return null;
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    return healthPctFrom30(avgScore);
  }, [filtered]);

  const handleSort = (key: SortKey) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setSortDir("asc");
      return key;
    });
  };

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
                  {" "}
                  <Link
                    className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline"
                    href="/forecast/meddpicc-heatmap"
                  >
                    MEDDPICC+TB Heatmap.
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
                  {" "}
                  <Link
                    className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline"
                    href="/forecast/meddpicc-heatmap"
                  >
                    MEDDPICC+TB Heatmap.
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2" />
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

          <div className="md:col-span-3" />
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
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => handleSort("account")}
                  className="flex items-center gap-1 text-left"
                >
                  <span>Account Name</span>
                  {sortKey === "account" ? (
                    <span className="text-xs">{sortDir === "asc" ? "▲" : "▼"}</span>
                  ) : null}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => handleSort("opportunity")}
                  className="flex items-center gap-1 text-left"
                >
                  <span>Opp Name</span>
                  {sortKey === "opportunity" ? (
                    <span className="text-xs">{sortDir === "asc" ? "▲" : "▼"}</span>
                  ) : null}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => handleSort("revenue")}
                  className="flex items-center gap-1 text-left"
                >
                  <span>Revenue</span>
                  {sortKey === "revenue" ? (
                    <span className="text-xs">{sortDir === "asc" ? "▲" : "▼"}</span>
                  ) : null}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => handleSort("close")}
                  className="flex items-center gap-1 text-left"
                >
                  <span>Close Date</span>
                  {sortKey === "close" ? (
                    <span className="text-xs">{sortDir === "asc" ? "▲" : "▼"}</span>
                  ) : null}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => handleSort("forecast")}
                  className="flex items-center gap-1 text-left"
                >
                  <span>Forecast</span>
                  {sortKey === "forecast" ? (
                    <span className="text-xs">{sortDir === "asc" ? "▲" : "▼"}</span>
                  ) : null}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => handleSort("health")}
                  className="flex items-center gap-1 text-left"
                >
                  <span>Health %</span>
                  {sortKey === "health" ? (
                    <span className="text-xs">{sortDir === "asc" ? "▲" : "▼"}</span>
                  ) : null}
                </button>
              </th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
              <tbody>
            {filtered.map((d) => {
              const id = String(d.id || "");
              const checked = !!selected[id];
              const bucket = normalizeForecastBucket(d.forecast_stage);
              const hp = healthPctFrom30(d.health_score);
              return (
                <tr key={id} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3 align-top">
                    <div className="max-w-[220px] whitespace-normal leading-snug text-[color:var(--sf-text-primary)]">
                      {d.account_name || "—"}
                    </div>
                    {d.rep_name ? (
                      <div className="text-xs text-[color:var(--sf-text-secondary)]">
                        {d.rep_name}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="max-w-[240px] whitespace-normal leading-snug">
                      {d.opportunity_name || "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">{fmtMoney(d.amount)}</td>
                  <td className="px-4 py-3 align-top whitespace-nowrap">{dateOnly(d.close_date) || "—"}</td>
                  <td className="px-4 py-3 align-top">{bucket}</td>
                  <td className={`px-4 py-3 align-top whitespace-nowrap ${healthColorClass(hp)}`}>
                    {hp == null ? "—" : `${hp}%`}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <Link
                      className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-xs font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
                      href={`/opportunities/${encodeURIComponent(id)}/deal-review`}
                    >
                      View
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!filtered.length ? (
              <tr>
                <td className="px-4 py-8 text-center text-[color:var(--sf-text-disabled)]" colSpan={7}>
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

