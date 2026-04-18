"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { CommitDealPanelItem } from "../../../lib/commitAdmissionAggregates";
import { DealCoachingCard, type DealCoachingCardDeal } from "../../../app/components/dashboard/coaching/DealCoachingCard";

export async function fetchCommitDealCoachingCard(dealId: string): Promise<DealCoachingCardDeal | null> {
  const res = await fetch(`/api/coaching/deal-card?id=${encodeURIComponent(dealId)}`, { method: "GET" });
  if (!res.ok) return null;
  const j = await res.json();
  if (!j?.ok || !j?.deal) return null;
  return j.deal as DealCoachingCardDeal;
}

export function CommitIntegrityDealCard(props: {
  d: CommitDealPanelItem;
  channelInline: boolean;
  expanded: boolean;
  loading: boolean;
  deal: DealCoachingCardDeal | undefined;
  onToggle: () => void;
  showRequestReview: boolean;
  /** Called when user clicks Request Review on the coaching card — open the note composer (Coaching tab flow). */
  onRequestReview?: (dealId: string) => void;
  /** Note composer open for this deal (below coaching card). */
  requestReviewComposerOpen?: boolean;
  requestReviewNote?: string;
  onRequestReviewNoteChange?: (note: string) => void;
  onRequestReviewSend?: () => void | Promise<void>;
  onRequestReviewCancel?: () => void;
  requestReviewSubmitting?: boolean;
  requestReviewError?: boolean;
  /** `/dashboard/channel` only — hide review CTAs; show partner on coaching card */
  channelDashboard?: boolean;
  kind: "pain" | "verified";
  cardClassName: string;
  title?: string;
  style?: CSSProperties;
}) {
  const {
    d,
    channelInline,
    expanded,
    loading,
    deal,
    onToggle,
    showRequestReview,
    onRequestReview,
    requestReviewComposerOpen = false,
    requestReviewNote = "",
    onRequestReviewNoteChange,
    onRequestReviewSend,
    onRequestReviewCancel,
    requestReviewSubmitting = false,
    requestReviewError = false,
    channelDashboard = false,
    kind,
    cardClassName,
    title,
    style,
  } = props;
  const reviewComposerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!requestReviewComposerOpen) return;
    requestAnimationFrame(() => {
      reviewComposerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    });
  }, [requestReviewComposerOpen]);

  const sharedInner =
    kind === "pain" ? (
      <>
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-medium text-[color:var(--sf-text-primary)]">
            {[d.account, d.name].filter(Boolean).join(" — ") || "(Untitled)"}
          </span>
          <span className="shrink-0 text-xs font-semibold text-[color:var(--sf-text-primary)]">
            {d.amount.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 0,
            })}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              d.commit_admission_status === "not_admitted"
                ? "bg-[#E74C3C]/20 text-[#E74C3C]"
                : "bg-[#F1C40F]/20 text-[#F1C40F]"
            }`}
          >
            {d.commit_admission_status === "not_admitted" ? "NOT ADMITTED" : "NEEDS REVIEW"}
          </span>
          <span className="min-w-0 truncate text-xs text-[color:var(--sf-text-secondary)]">
            {d.commit_admission_status === "not_admitted"
              ? d.commit_admission_reasons[0] || "Paper Process weak"
              : `Low-confidence evidence${
                  d.low_conf_categories?.length ? ` (${d.low_conf_categories.join(", ")})` : ""
                }`}
          </span>
        </div>
        {d.partner_name ? (
          <div className="mt-0.5 truncate text-[10px] text-[color:var(--sf-text-secondary)]">
            Partner Name{" "}
            <span className="font-semibold text-[color:var(--sf-text-primary)]">{d.partner_name}</span>
          </div>
        ) : null}
      </>
    ) : (
      <>
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-medium text-[color:var(--sf-text-primary)]">
            {[d.account, d.name].filter(Boolean).join(" — ") || "(Untitled)"}
          </span>
          <span className="shrink-0 text-xs font-semibold text-[color:var(--sf-text-primary)]">
            {d.amount.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 0,
            })}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="shrink-0 rounded bg-[#2ECC71]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#2ECC71]">
            VERIFIED
          </span>
          {(d.high_conf_categories || []).map((cat) => (
            <span
              key={cat}
              className="rounded bg-[color:var(--sf-surface)] px-1.5 py-0.5 text-[10px] text-[color:var(--sf-text-secondary)]"
            >
              {cat}: High
            </span>
          ))}
        </div>
        {d.partner_name ? (
          <div className="mt-0.5 truncate text-[10px] text-[color:var(--sf-text-secondary)]">
            Partner Name{" "}
            <span className="font-semibold text-[color:var(--sf-text-primary)]">{d.partner_name}</span>
          </div>
        ) : null}
      </>
    );

  if (!channelInline) {
    return (
      <Link
        href={`/opportunities/${encodeURIComponent(d.id)}/deal-review`}
        className={cardClassName}
        title={title}
        style={style}
      >
        {sharedInner}
      </Link>
    );
  }

  return (
    <div className="min-w-0 space-y-2" style={style}>
      <button type="button" onClick={onToggle} className={`${cardClassName} w-full cursor-pointer text-left`} title={title}>
        {sharedInner}
      </button>
      {expanded ? (
        <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3 shadow-sm">
          {loading ? (
            <div className="py-4 text-center text-sm text-[color:var(--sf-text-secondary)]">Loading coaching card...</div>
          ) : deal ? (
            <>
              <DealCoachingCard
                deal={deal}
                showRequestReview={showRequestReview && !requestReviewComposerOpen}
                onRequestReview={onRequestReview}
                channelDashboard={channelDashboard}
              />
              {requestReviewComposerOpen ? (
                <div
                  ref={reviewComposerRef}
                  className="mt-3 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3 scroll-mt-4"
                >
                  <textarea
                    value={requestReviewNote}
                    onChange={(e) => onRequestReviewNoteChange?.(e.target.value)}
                    placeholder="e.g. Focus on Decision Process before our 1:1 Thursday"
                    className="w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] placeholder:text-[color:var(--sf-text-secondary)]"
                    rows={2}
                  />
                  <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Add a note for the rep (optional)</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void onRequestReviewSend?.()}
                      disabled={requestReviewSubmitting}
                      className="rounded-md border border-[color:var(--sf-accent-primary)] bg-[color:var(--sf-accent-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                    >
                      Send Request
                    </button>
                    <button
                      type="button"
                      onClick={() => onRequestReviewCancel?.()}
                      disabled={requestReviewSubmitting}
                      className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-1.5 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)] disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                  {requestReviewError ? (
                    <p className="mt-2 text-xs text-red-600">Failed to send request. Please try again.</p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-sm text-[#E74C3C]">Unable to load coaching card.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
