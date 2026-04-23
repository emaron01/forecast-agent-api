"use client";

import { useRouter } from "next/navigation";
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DealCoachingCard, type DealCoachingCardDeal } from "../coaching/DealCoachingCard";

export type ManagerReviewQueueProps = {
  deals: {
    id: string;
    opp_name: string;
    account_name: string;
    rep_name: string;
    health_score: number | null;
    forecast_stage: string | null;
    amount: number | null;
    last_reviewed_at: string | null;
    score_before_request: number | null;
    score_after_request: number | null;
    reviewed_after_at: string | null;
    review_requested_by: number | null;
    review_requested_at: string | null;
    review_request_note: string | null;
    requester_name: string | null;
  }[];
  currentUserId: number;
};

type ReviewQueueDeal = ManagerReviewQueueProps["deals"][number];

function fmtMoney(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function healthPct(score: number | null) {
  if (score == null || !Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, Math.round((score / 30) * 100)));
}

function healthColorClass(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-disabled)]";
  if (pct >= 80) return "text-[#2ECC71]";
  if (pct >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

function riskPillMeta(score: number | null) {
  const pct = healthPct(score);
  if (pct == null) {
    return {
      label: "Unknown",
      className: "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]",
    };
  }
  if (pct >= 80) {
    return {
      label: "Low Risk",
      className: "border-[#2ECC71]/60 bg-[#2ECC71]/10 text-[#2ECC71]",
    };
  }
  if (pct >= 50) {
    return {
      label: "Med Risk",
      className: "border-[#F1C40F]/60 bg-[#F1C40F]/10 text-[#B8860B]",
    };
  }
  return {
    label: "High Risk",
    className: "border-[#E74C3C]/60 bg-[#E74C3C]/10 text-[#E74C3C]",
  };
}

function statusMeta(deal: ReviewQueueDeal, delta: number | null, justSent: boolean) {
  if (deal.review_requested_at) {
    if (deal.score_after_request == null) {
      return {
        shortText: "Pending review",
        fullText: deal.review_request_note
          ? `Review Requested — not reviewed yet. Note: ${deal.review_request_note}`
          : "Review Requested — not reviewed yet",
        className: "bg-yellow-500/10 text-yellow-600",
      };
    }
    if (deal.score_before_request == null) {
      return {
        shortText: "No baseline",
        fullText: deal.review_request_note
          ? `Review Requested — no baseline yet. Note: ${deal.review_request_note}`
          : "Review Requested — no baseline yet",
        className: "bg-yellow-500/10 text-yellow-600",
      };
    }
    if (delta != null) {
      if (delta > 0) {
        return {
          shortText: `+${delta}pp`,
          fullText: `Score +${delta}pp after review`,
          className: "bg-green-500/10 text-green-600",
        };
      }
      if (delta === 0) {
        return {
          shortText: "No change",
          fullText: "No change after review",
          className: "bg-yellow-500/10 text-yellow-600",
        };
      }
      return {
        shortText: `-${Math.abs(delta)}pp`,
        fullText: `Score -${Math.abs(delta)}pp after review`,
        className: "bg-red-500/10 text-red-600",
      };
    }
  }

  if (justSent) {
    return {
      shortText: "Requested",
      fullText: "Review Requested",
      className: "bg-green-500/10 text-green-500",
    };
  }

  return {
    shortText: "—",
    fullText: "No active review status",
    className: "bg-transparent text-[color:var(--sf-text-secondary)]",
  };
}

function formatDate(s: string | null) {
  if (!s || !s.trim()) return "Never";
  try {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { dateStyle: "short" }) : "Never";
  } catch {
    return "Never";
  }
}

type SortKey = "account" | "opportunity" | "rep" | "health" | "stage" | "lastReview";
type SortDir = "asc" | "desc";

export function ManagerReviewQueueClient(props: ManagerReviewQueueProps) {
  const { currentUserId } = props;
  const deals = Array.isArray(props.deals) ? props.deals : [];
  const router = useRouter();
  const [requestingDealId, setRequestingDealId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successDealIds, setSuccessDealIds] = useState<Set<string>>(new Set());
  const [errorDealId, setErrorDealId] = useState<string | null>(null);
  const [expandedDealId, setExpandedDealId] = useState<string | null>(null);
  const [dealCache, setDealCache] = useState<Record<string, DealCoachingCardDeal>>({});
  const [dealLoading, setDealLoading] = useState<string | null>(null);
  const [clearedDealIds, setClearedDealIds] = useState<Set<string>>(new Set());
  const [activeFilters, setActiveFilters] = useState<{ repName: string; reviewRequestedOnly: boolean }>({
    repName: "",
    reviewRequestedOnly: false,
  });
  const [sortKey, setSortKey] = useState<SortKey>("lastReview");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const reviewRequestFormRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!requestingDealId) return;
    requestAnimationFrame(() => {
      reviewRequestFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    });
  }, [requestingDealId]);

  async function fetchDealCoachingCard(dealId: string) {
    const res = await fetch(`/api/coaching/deal-card?id=${encodeURIComponent(dealId)}`, { method: "GET" });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j?.ok || !j?.deal) return null;
    return j.deal as DealCoachingCardDeal;
  }

  async function toggleDealExpand(dealId: string) {
    setErrorDealId(null);
    setExpandedDealId((prev) => (prev === dealId ? null : dealId));
    if (expandedDealId === dealId) return;
    if (dealCache[dealId]) return;

    setDealLoading(dealId);
    try {
      const found = await fetchDealCoachingCard(dealId);
      if (found) {
        setDealCache((prev) => ({ ...prev, [dealId]: found }));
      }
    } finally {
      setDealLoading(null);
    }
  }

  async function handleSendRequest(dealId: string) {
    setSubmitting(true);
    setErrorDealId(null);
    try {
      const res = await fetch("/api/coaching/request-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId: dealId, note: noteText }),
      });
      if (!res.ok) {
        setErrorDealId(dealId);
        return;
      }
      setSuccessDealIds((prev) => new Set(prev).add(dealId));
      setRequestingDealId(null);
      setNoteText("");
    } catch {
      setErrorDealId(dealId);
    } finally {
      setSubmitting(false);
    }
  }

  const filteredAndSortedDeals = useMemo(() => {
    let list = deals.filter((d) => {
      if (activeFilters.repName.trim()) {
        const rep = (d.rep_name ?? "").toLowerCase();
        const q = activeFilters.repName.trim().toLowerCase();
        if (!rep.includes(q)) return false;
      }
      if (activeFilters.reviewRequestedOnly && !d.review_requested_at) return false;
      if (clearedDealIds.has(d.id) && d.review_requested_at) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "account":
          cmp = (a.account_name ?? "").localeCompare(b.account_name ?? "");
          break;
        case "opportunity":
          cmp = (a.opp_name ?? "").localeCompare(b.opp_name ?? "");
          break;
        case "rep":
          cmp = (a.rep_name ?? "").localeCompare(b.rep_name ?? "");
          break;
        case "health": {
          const ha = healthPct(a.health_score) ?? -1;
          const hb = healthPct(b.health_score) ?? -1;
          cmp = ha - hb;
          break;
        }
        case "stage":
          cmp = (a.forecast_stage ?? "").localeCompare(b.forecast_stage ?? "");
          break;
        case "lastReview": {
          const ta = a.review_requested_at ?? a.last_reviewed_at ?? "";
          const tb = b.review_requested_at ?? b.last_reviewed_at ?? "";
          cmp = ta.localeCompare(tb);
          break;
        }
        default:
          break;
      }
      return cmp * dir;
    });
    return list;
  }, [deals, activeFilters.repName, activeFilters.reviewRequestedOnly, sortKey, sortDir, clearedDealIds]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <span className="ml-0.5 opacity-40">↕</span>;
    return <span className="ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  return (
    <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <h2 className="text-cardLabel text-[color:var(--sf-text-primary)] mb-4">Manager Review Queue</h2>
      <div aria-label="Filter and sort" className="mb-4 flex min-h-[2.5rem] flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Filter by rep name"
          value={activeFilters.repName}
          onChange={(e) => setActiveFilters((f) => ({ ...f, repName: e.target.value }))}
          className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-1.5 text-sm text-[color:var(--sf-text-primary)] placeholder:text-[color:var(--sf-text-secondary)]"
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
          <input
            type="checkbox"
            checked={activeFilters.reviewRequestedOnly}
            onChange={(e) => setActiveFilters((f) => ({ ...f, reviewRequestedOnly: e.target.checked }))}
            className="rounded border-[color:var(--sf-border)]"
          />
          Review requested only
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
            <tr>
              <th
                className="cursor-pointer select-none px-3 py-2 text-left text-xs font-semibold hover:bg-[color:var(--sf-border)]"
                onClick={() => toggleSort("account")}
              >
                Account Name <SortIcon column="account" />
              </th>
              <th
                className="cursor-pointer select-none px-3 py-2 text-left text-xs font-semibold hover:bg-[color:var(--sf-border)]"
                onClick={() => toggleSort("opportunity")}
              >
                Opportunity <SortIcon column="opportunity" />
              </th>
              <th
                className="cursor-pointer select-none px-3 py-2 text-left text-xs font-semibold hover:bg-[color:var(--sf-border)]"
                onClick={() => toggleSort("rep")}
              >
                Rep <SortIcon column="rep" />
              </th>
              <th
                className="cursor-pointer select-none px-3 py-2 text-right text-xs font-semibold hover:bg-[color:var(--sf-border)]"
                onClick={() => toggleSort("health")}
              >
                Health % <SortIcon column="health" />
              </th>
              <th className="px-3 py-2 text-right text-xs font-semibold">Amt</th>
              <th
                className="cursor-pointer select-none px-3 py-2 text-left text-xs font-semibold hover:bg-[color:var(--sf-border)]"
                onClick={() => toggleSort("stage")}
              >
                Stage <SortIcon column="stage" />
              </th>
              <th
                className="cursor-pointer select-none px-3 py-2 text-left text-xs font-semibold hover:bg-[color:var(--sf-border)]"
                onClick={() => toggleSort("lastReview")}
              >
                Last Review <SortIcon column="lastReview" />
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold">Status</th>
              <th className="px-3 py-2 text-left text-xs font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="text-[color:var(--sf-text-primary)]">
            {filteredAndSortedDeals.map((d) => {
              const pct = healthPct(d.health_score);
              const hasRequest = !!d.review_requested_at;
              const justSent = successDealIds.has(d.id);
              const isOpen = requestingDealId === d.id;
              const scoreBefore = d.score_before_request;
              const scoreAfter = d.score_after_request;
              const delta =
                scoreBefore != null && scoreAfter != null ? Math.round(((scoreAfter - scoreBefore) / 30) * 100) : null;
              const risk = riskPillMeta(d.health_score);
              const status = statusMeta(d, delta, justSent);
              return (
                <Fragment key={d.id}>
                  <tr className="border-t border-[color:var(--sf-border)]">
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${risk.className}`}
                          title={risk.label}
                        >
                          {risk.label}
                        </span>
                        <span className="truncate">{d.account_name ?? "—"}</span>
                      </div>
                    </td>
                    <td
                      className="cursor-pointer px-3 py-2 hover:text-[color:var(--sf-accent-primary)]"
                      onClick={() => toggleDealExpand(d.id)}
                    >
                      <span className="flex items-center gap-1">
                        {d.opp_name ?? "—"}
                        <span className="text-xs">{expandedDealId === d.id ? "▲" : "▼"}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2">{d.rep_name ?? "—"}</td>
                    <td className={`px-3 py-2 text-right font-mono ${healthColorClass(pct)}`}>
                      {pct != null ? `${pct}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{fmtMoney(d.amount)}</td>
                    <td className="px-3 py-2">{d.forecast_stage ?? "—"}</td>
                    <td className="px-3 py-2">{formatDate(d.last_reviewed_at)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex max-w-[170px] items-center truncate rounded-full px-2 py-0.5 text-xs ${status.className}`}
                        title={status.fullText}
                      >
                        {status.shortText}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {hasRequest && d.score_after_request != null ? (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const res = await fetch("/api/coaching/request-review", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ opportunityId: d.id, action: "clear" }),
                              });
                              if (res.ok) {
                                setClearedDealIds((prev) => new Set(prev).add(d.id));
                                router.refresh();
                              }
                            } catch {}
                          }}
                          className="rounded-md border border-green-500 px-2 py-1 text-xs font-semibold text-green-500 hover:bg-green-500 hover:text-white transition-colors"
                        >
                          Mark Done
                        </button>
                      ) : !hasRequest && !justSent ? (
                        <button
                          type="button"
                          onClick={() => {
                            setNoteText("");
                            setErrorDealId(null);
                            setRequestingDealId(d.id);
                          }}
                          className="rounded-md border border-[color:var(--sf-accent-primary)] bg-[color:var(--sf-accent-primary)] px-2 py-1 text-xs font-semibold text-white hover:opacity-90"
                        >
                          Request Review
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {expandedDealId === d.id && (
                    <tr>
                      <td colSpan={9} className="px-3 py-2">
                        {dealLoading === d.id ? (
                          <div className="text-sm text-[color:var(--sf-text-secondary)] py-4 text-center">Loading coaching card...</div>
                        ) : dealCache[d.id] ? (
                          <DealCoachingCard
                            deal={dealCache[d.id]}
                            showRequestReview={!isOpen}
                            onRequestReview={() => {
                              setNoteText("");
                              setErrorDealId(null);
                              setRequestingDealId(d.id);
                            }}
                          />
                        ) : (
                          <div className="text-sm text-red-500 py-2">Unable to load coaching card.</div>
                        )}
                      </td>
                    </tr>
                  )}
                  {isOpen ? (
                    <tr key={`${d.id}-form`} className="border-t border-[color:var(--sf-border)]">
                      <td colSpan={9} className="px-3 py-2 align-top">
                        <div
                          ref={reviewRequestFormRef}
                          className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3 scroll-mt-4"
                        >
                          <textarea
                            value={noteText}
                            onChange={(e) => setNoteText(e.target.value)}
                            placeholder="e.g. Focus on Decision Process before our 1:1 Thursday"
                            className="w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] placeholder:text-[color:var(--sf-text-secondary)]"
                            rows={2}
                          />
                          <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Add a note for the rep (optional)</p>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleSendRequest(d.id)}
                              disabled={submitting}
                              className="rounded-md border border-[color:var(--sf-accent-primary)] bg-[color:var(--sf-accent-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                            >
                              Send Request
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRequestingDealId(null);
                                setNoteText("");
                                setErrorDealId(null);
                              }}
                              disabled={submitting}
                              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-1.5 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)] disabled:opacity-60"
                            >
                              Cancel
                            </button>
                          </div>
                          {errorDealId === d.id ? (
                            <p className="mt-2 text-xs text-red-600">Failed to send request. Please try again.</p>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {filteredAndSortedDeals.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-center text-sm text-[color:var(--sf-text-secondary)]">
                  No open opportunities in the current quarter for your team.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
