"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dateOnly } from "../../../../lib/dateOnly";
import { closedOutcomeFromOpportunityRow } from "../../../../lib/opportunityOutcome";
import { DealCoachingCard, type DealCoachingCardDeal } from "../coaching/DealCoachingCard";
import { fetchCommitDealCoachingCard } from "../../../../components/dashboard/executive/CommitIntegrityDealCard";

type Deal = Record<string, any> & {
  id: string;
  account_name?: string | null;
  opportunity_name?: string | null;
  amount?: number | null;
  close_date?: string | null;
  forecast_stage?: string | null;
  ai_verdict?: string | null;
  ai_forecast?: string | null;
  health_score?: number | null;
  updated_at?: string | null;
  rep_name?: string | null;
  partner_name?: string | null;
};

type SortKey = "account" | "opportunity" | "revenue" | "close" | "forecast" | "health";
type SortDir = "asc" | "desc";

function fmtMoney(n: unknown) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "-";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function healthPctFrom30(score: unknown) {
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

function normalizeForecastBucket(stageLike: unknown): "Commit" | "Best Case" | "Pipeline" {
  const s = String(stageLike || "").trim().toLowerCase();
  if (s.includes("commit")) return "Commit";
  if (s.includes("best")) return "Best Case";
  return "Pipeline";
}

const FORECAST_SORT_ORDER: Record<string, number> = {
  Commit: 0,
  "Best Case": 1,
  Pipeline: 2,
};

function isClosedDeal(d: Deal) {
  return closedOutcomeFromOpportunityRow(d) || null;
}

export function ExecutiveSalesOpportunitiesTabClient(props: {
  quotaPeriodId: string;
}) {
  const router = useRouter();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [search, setSearch] = useState("");
  const [repFilter, setRepFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("forecast");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedDealId, setExpandedDealId] = useState<string>("");
  const [dealLoadingId, setDealLoadingId] = useState<string>("");
  const [dealCache, setDealCache] = useState<Record<string, DealCoachingCardDeal>>({});
  const [requestingDealId, setRequestingDealId] = useState<string>("");
  const [requestNote, setRequestNote] = useState("");
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const reviewComposerRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const openOnly = deals.filter((d) => !isClosedDeal(d));
    const base = !q
      ? openOnly
      : openOnly.filter((d) => {
          const hay = [
            d.account_name,
            d.opportunity_name,
            d.partner_name,
            d.rep_name,
            normalizeForecastBucket(d.forecast_stage),
            d.ai_verdict,
            d.ai_forecast,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });

    return [...base].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const s = (v: unknown) => String(v || "").trim().toLowerCase();
      const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);

      let av: string | number | null = null;
      let bv: string | number | null = null;

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

      if (sortKey === "forecast") {
        const ao = FORECAST_SORT_ORDER[String(av)] ?? 99;
        const bo = FORECAST_SORT_ORDER[String(bv)] ?? 99;
        if (ao === bo) return 0;
        return (ao - bo) * dir;
      }

      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * dir;
      }

      const na = Number(av);
      const nb = Number(bv);
      if (!Number.isFinite(na) && !Number.isFinite(nb)) return 0;
      if (!Number.isFinite(na)) return 1;
      if (!Number.isFinite(nb)) return -1;
      if (na === nb) return 0;
      return na < nb ? -1 * dir : 1 * dir;
    });
  }, [deals, search, sortDir, sortKey]);

  const avgHealthPct = useMemo(() => {
    const scores = filtered
      .map((d) => Number(d.health_score))
      .filter((n) => Number.isFinite(n) && n > 0) as number[];
    if (!scores.length) return null;
    return healthPctFrom30(scores.reduce((a, b) => a + b, 0) / scores.length);
  }, [filtered]);

  useLayoutEffect(() => {
    if (!requestingDealId) return;
    requestAnimationFrame(() => {
      reviewComposerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [requestingDealId]);

  useEffect(() => {
    if (expandedDealId && !filtered.some((d) => String(d.id) === expandedDealId)) {
      setExpandedDealId("");
      setRequestingDealId("");
      setRequestNote("");
      setRequestError(false);
    }
  }, [expandedDealId, filtered]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      setBusy(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (props.quotaPeriodId) params.set("quota_period_id", props.quotaPeriodId);
        if (repFilter.trim()) params.set("rep_name", repFilter.trim());
        params.set("limit", "500");
        const res = await fetch(`/api/forecast/deals?${params.toString()}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || `API error (${res.status})`);
        if (cancelled) return;
        setDeals(Array.isArray(json.deals) ? (json.deals as Deal[]) : []);
      } catch (e: any) {
        if (cancelled) return;
        setDeals([]);
        setError(String(e?.message || e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    void refresh();
    return () => {
      cancelled = true;
    };
  }, [props.quotaPeriodId, repFilter]);

  async function toggleDeal(dealId: string) {
    const nextId = expandedDealId === dealId ? "" : dealId;
    setExpandedDealId(nextId);
    if (!nextId) {
      setRequestingDealId("");
      setRequestNote("");
      setRequestError(false);
      return;
    }
    if (dealCache[dealId]) return;
    setDealLoadingId(dealId);
    try {
      const deal = await fetchCommitDealCoachingCard(dealId);
      if (deal) {
        setDealCache((prev) => ({ ...prev, [dealId]: deal }));
      }
    } finally {
      setDealLoadingId("");
    }
  }

  function handleSort(key: SortKey) {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setSortDir("asc");
      return key;
    });
  }

  function openRequestComposer(dealId: string) {
    setExpandedDealId(dealId);
    setRequestingDealId(dealId);
    setRequestNote("");
    setRequestError(false);
  }

  function cancelRequestComposer() {
    setRequestingDealId("");
    setRequestNote("");
    setRequestError(false);
  }

  async function sendRequestReview(dealId: string) {
    setRequestSubmitting(true);
    setRequestError(false);
    try {
      const res = await fetch("/api/coaching/request-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: dealId,
          note: requestNote.trim(),
        }),
      });
      if (!res.ok) {
        setRequestError(true);
        return;
      }
      setRequestingDealId("");
      setRequestNote("");
      setExpandedDealId("");
      router.refresh();
    } catch {
      setRequestError(true);
    } finally {
      setRequestSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Sales Opportunities</h1>
              <div className="text-sm text-[color:var(--sf-text-secondary)]">
                Avg Health Score:{" "}
                <span className={`font-semibold ${healthColorClass(avgHealthPct)}`}>
                  {avgHealthPct == null ? "-" : `${avgHealthPct}%`}
                </span>
              </div>
            </div>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Click any opportunity row to open the rolled-down coaching summary and request a Matthew review for the rep.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-12">
          <div className="md:col-span-7">
            <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Search opportunities</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search account, opportunity, partner, stages..."
              className="mt-1 w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
            />
          </div>
          <div className="md:col-span-5">
            <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Rep (optional)</label>
            <input
              value={repFilter}
              onChange={(e) => setRepFilter(e.target.value)}
              placeholder="Erik M"
              className="mt-1 w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
            />
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-[#E74C3C] bg-[color:var(--sf-surface-alt)] p-3 text-sm text-[color:var(--sf-text-primary)]">
            {error}
          </div>
        ) : null}
      </section>

      <section className="overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">
                <button type="button" onClick={() => handleSort("account")} className="flex items-center gap-1 text-left">
                  <span>Account Name</span>
                  {sortKey === "account" ? <span className="text-xs">{sortDir === "asc" ? "^" : "v"}</span> : null}
                </button>
              </th>
              <th className="px-4 py-3">
                <button type="button" onClick={() => handleSort("opportunity")} className="flex items-center gap-1 text-left">
                  <span>Opp Name</span>
                  {sortKey === "opportunity" ? <span className="text-xs">{sortDir === "asc" ? "^" : "v"}</span> : null}
                </button>
              </th>
              <th className="px-4 py-3">
                <button type="button" onClick={() => handleSort("revenue")} className="flex items-center gap-1 text-left">
                  <span>Revenue</span>
                  {sortKey === "revenue" ? <span className="text-xs">{sortDir === "asc" ? "^" : "v"}</span> : null}
                </button>
              </th>
              <th className="px-4 py-3">
                <button type="button" onClick={() => handleSort("close")} className="flex items-center gap-1 text-left">
                  <span>Close Date</span>
                  {sortKey === "close" ? <span className="text-xs">{sortDir === "asc" ? "^" : "v"}</span> : null}
                </button>
              </th>
              <th className="px-4 py-3">
                <button type="button" onClick={() => handleSort("forecast")} className="flex items-center gap-1 text-left">
                  <span>Forecast</span>
                  {sortKey === "forecast" ? <span className="text-xs">{sortDir === "asc" ? "^" : "v"}</span> : null}
                </button>
              </th>
              <th className="px-4 py-3">
                <button type="button" onClick={() => handleSort("health")} className="flex items-center gap-1 text-left">
                  <span>Health %</span>
                  {sortKey === "health" ? <span className="text-xs">{sortDir === "asc" ? "^" : "v"}</span> : null}
                </button>
              </th>
              <th className="px-4 py-3 text-right">Open</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => {
              const id = String(d.id || "");
              const hp = healthPctFrom30(d.health_score);
              const expanded = expandedDealId === id;
              const requestOpen = requestingDealId === id;
              return (
                <Fragment key={id}>
                  <tr
                    className="cursor-pointer border-t border-[color:var(--sf-border)] hover:bg-[color:var(--sf-surface-alt)]"
                    onClick={() => void toggleDeal(id)}
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="max-w-[220px] whitespace-normal leading-snug text-[color:var(--sf-text-primary)]">
                        {d.account_name || "-"}
                      </div>
                      {d.rep_name ? <div className="text-xs text-[color:var(--sf-text-secondary)]">{d.rep_name}</div> : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="max-w-[240px] whitespace-normal leading-snug text-[color:var(--sf-text-primary)]">
                        {d.opportunity_name || "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-[color:var(--sf-text-primary)]">{fmtMoney(d.amount)}</td>
                    <td className="px-4 py-3 align-top whitespace-nowrap text-[color:var(--sf-text-primary)]">{dateOnly(d.close_date) || "-"}</td>
                    <td className="px-4 py-3 align-top text-[color:var(--sf-text-primary)]">{normalizeForecastBucket(d.forecast_stage)}</td>
                    <td className={`px-4 py-3 align-top whitespace-nowrap ${healthColorClass(hp)}`}>{hp == null ? "-" : `${hp}%`}</td>
                    <td className="px-4 py-3 align-top text-right text-[color:var(--sf-text-secondary)]">{expanded ? "v" : ">"}</td>
                  </tr>
                  {expanded ? (
                    <tr className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                      <td colSpan={7} className="px-4 py-4">
                        {dealLoadingId === id ? (
                          <div className="py-4 text-center text-sm text-[color:var(--sf-text-secondary)]">Loading coaching card...</div>
                        ) : dealCache[id] ? (
                          <>
                            <DealCoachingCard
                              deal={dealCache[id]}
                              showRequestReview={!requestOpen}
                              onRequestReview={openRequestComposer}
                            />
                            {requestOpen ? (
                              <div
                                ref={reviewComposerRef}
                                className="mt-3 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3"
                              >
                                <textarea
                                  value={requestNote}
                                  onChange={(e) => setRequestNote(e.target.value)}
                                  placeholder="e.g. Focus on Decision Process before our 1:1 Thursday"
                                  className="w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] placeholder:text-[color:var(--sf-text-secondary)]"
                                  rows={2}
                                />
                                <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Add a note for the rep (optional)</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void sendRequestReview(id)}
                                    disabled={requestSubmitting}
                                    className="rounded-md border border-[color:var(--sf-accent-primary)] bg-[color:var(--sf-accent-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                                  >
                                    Send Request
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelRequestComposer}
                                    disabled={requestSubmitting}
                                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-1.5 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)] disabled:opacity-60"
                                  >
                                    Cancel
                                  </button>
                                </div>
                                {requestError ? (
                                  <p className="mt-2 text-xs text-red-600">Failed to send request. Please try again.</p>
                                ) : null}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div className="py-2 text-sm text-[#E74C3C]">Unable to load coaching card.</div>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {!filtered.length ? (
              <tr>
                <td className="px-4 py-8 text-center text-[color:var(--sf-text-disabled)]" colSpan={7}>
                  {busy ? "Loading..." : "No deals found."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
