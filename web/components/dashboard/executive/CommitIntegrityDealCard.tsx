"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
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
  /** Same POST flow as Coaching tab / manager queue (`/api/coaching/request-review`). */
  onRequestReview?: (dealId: string) => void | Promise<void>;
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
    channelDashboard = false,
    kind,
    cardClassName,
    title,
    style,
  } = props;
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
            <DealCoachingCard
              deal={deal}
              showRequestReview={showRequestReview}
              onRequestReview={onRequestReview}
              channelDashboard={channelDashboard}
            />
          ) : (
            <div className="text-sm text-[#E74C3C]">Unable to load coaching card.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
