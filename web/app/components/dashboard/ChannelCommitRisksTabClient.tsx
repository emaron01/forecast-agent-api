"use client";

import { useState } from "react";
import type { CommitAdmissionAggregates, CommitAdmissionDealPanels } from "../../../lib/commitAdmissionAggregates";
import type { DealCoachingCardDeal } from "./coaching/DealCoachingCard";
import {
  CommitIntegrityDealCard,
  fetchCommitDealCoachingCard,
} from "../../../components/dashboard/executive/CommitIntegrityDealCard";

function fmtBucketDelta(n: number) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function deltaClass(n: number) {
  if (!Number.isFinite(n) || n === 0) return "text-[color:var(--sf-text-secondary)]";
  return n > 0 ? "text-[#2ECC71]" : "text-[#E74C3C]";
}

/**
 * Channel Sales Opportunities tab: same Commit Integrity + Top Commit Risks experience as the executive
 * forecast module, fed only by {@link loadChannelPartnerHeroProps} (territory reps + partner_name scoping).
 */
export function ChannelCommitRisksTabClient(props: {
  commitAdmission: CommitAdmissionAggregates | null;
  commitDealPanels: CommitAdmissionDealPanels | null;
  /** Optional CRM vs AI bucket deltas for the scoped partner hero (gap awareness). */
  bucketDeltas?: { commit: number; best_case: number; pipeline: number } | null;
}) {
  const { commitAdmission, commitDealPanels, bucketDeltas } = props;
  const [commitIntegrityExpandedId, setCommitIntegrityExpandedId] = useState<string | null>(null);
  const [commitDealLoadingId, setCommitDealLoadingId] = useState<string | null>(null);
  const [commitDealCache, setCommitDealCache] = useState<Record<string, DealCoachingCardDeal>>({});

  const commitIntegrityCardClass =
    "block rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-2 text-sm hover:bg-[color:var(--sf-surface-alt)]";

  const pain = commitDealPanels?.topPainDeals ?? [];
  const verified = commitDealPanels?.topVerifiedDeals ?? [];
  const hasPanels = pain.length > 0 || verified.length > 0;
  const bd = bucketDeltas;
  const admission = commitAdmission;

  const hasAnyCommitKpi =
    admission &&
    (admission.totalCommitCrmAmount > 0 ||
      admission.unsupportedCommitAmount > 0 ||
      admission.commitNeedsReviewAmount > 0 ||
      admission.aiSupportedCommitAmount > 0);

  const showIntegrityBlock = admission && (hasAnyCommitKpi || hasPanels);

  async function handleToggleDeal(dealId: string) {
    const wasOpen = commitIntegrityExpandedId === dealId;
    setCommitIntegrityExpandedId(wasOpen ? null : dealId);
    if (wasOpen) return;
    if (commitDealCache[dealId]) return;
    setCommitDealLoadingId(dealId);
    try {
      const found = await fetchCommitDealCoachingCard(dealId);
      if (found) setCommitDealCache((prev) => ({ ...prev, [dealId]: found }));
    } finally {
      setCommitDealLoadingId(null);
    }
  }

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Sales Opportunities</h2>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
          Partner-scoped commit intelligence for your territory — at-risk commit deals, evidence coverage, and verified commit
          highlights. Use this for partner activation conversations; forecast ownership stays with sales.
        </p>
        {bd ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Commit bucket Δ (AI − CRM weighted)</div>
              <div className={`mt-1 text-lg font-semibold font-[tabular-nums] ${deltaClass(bd.commit)}`}>{fmtBucketDelta(bd.commit)}</div>
            </div>
            <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Best case Δ</div>
              <div className={`mt-1 text-lg font-semibold font-[tabular-nums] ${deltaClass(bd.best_case)}`}>{fmtBucketDelta(bd.best_case)}</div>
            </div>
            <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Pipeline Δ</div>
              <div className={`mt-1 text-lg font-semibold font-[tabular-nums] ${deltaClass(bd.pipeline)}`}>{fmtBucketDelta(bd.pipeline)}</div>
            </div>
          </div>
        ) : null}
      </section>

      {!showIntegrityBlock ? (
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-6 text-sm text-[color:var(--sf-text-secondary)]">
          No commit intelligence loaded for your scoped partner deals this period. Adjust territory or period filters, or confirm
          partner assignments and open pipeline with{" "}
          <span className="font-medium text-[color:var(--sf-text-primary)]">partner_name</span> set on opportunities.
        </section>
      ) : null}

      {showIntegrityBlock && admission ? (
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
          <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Commit Integrity</div>
          {hasAnyCommitKpi ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Total Commit (CRM) $</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">
                  {admission.totalCommitCrmAmount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">AI-Supported Commit $</div>
                <div className="mt-1 text-lg font-semibold text-[#2ECC71]">
                  {admission.aiSupportedCommitAmount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Unsupported Commit $</div>
                <div
                  className={`mt-1 text-lg font-semibold ${
                    admission.unsupportedCommitAmount > 0 ? "text-[#E74C3C]" : "text-[color:var(--sf-text-primary)]"
                  }`}
                >
                  {admission.unsupportedCommitAmount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Needs Review $</div>
                <div
                  className={`mt-1 text-lg font-semibold ${
                    admission.commitNeedsReviewAmount > 0 ? "text-[#F1C40F]" : "text-[color:var(--sf-text-primary)]"
                  }`}
                >
                  {admission.commitNeedsReviewAmount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>
          ) : null}
          {hasAnyCommitKpi &&
          (admission.commitEvidenceCoveragePct != null || (admission.verifiedCommitAmount != null && admission.verifiedCommitAmount > 0)) ? (
            <div
              className="mt-2 text-xs text-[color:var(--sf-text-secondary)]"
              title="% of Commit deals backed by verified evidence (≥2 of Timing, Paper, Decision, Budget)."
            >
              Commit Evidence Coverage:{" "}
              {admission.commitEvidenceCoveragePct != null ? `${Math.round(admission.commitEvidenceCoveragePct)}%` : "—"}
              {admission.verifiedCommitAmount != null && admission.verifiedCommitAmount > 0 ? (
                <span className="ml-2">
                  · Verified Commit:{" "}
                  {admission.verifiedCommitAmount.toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                  })}
                </span>
              ) : null}
            </div>
          ) : null}
          {hasPanels ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {pain.length > 0 ? (
                <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
                  <div className="text-xs font-semibold uppercase text-[color:var(--sf-text-secondary)]">Top Commit Risks</div>
                  <div className="mt-2 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
                    {pain.map((d) => (
                      <CommitIntegrityDealCard
                        key={d.id}
                        d={d}
                        channelInline={true}
                        expanded={commitIntegrityExpandedId === d.id}
                        loading={commitDealLoadingId === d.id}
                        deal={commitDealCache[d.id]}
                        onToggle={() => void handleToggleDeal(d.id)}
                        showRequestReview={false}
                        channelDashboard={true}
                        kind="pain"
                        cardClassName={commitIntegrityCardClass}
                        title={d.commit_admission_reasons?.slice(0, 2).join("; ") || undefined}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {verified.length > 0 ? (
                <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
                  <div className="text-xs font-semibold uppercase text-[color:var(--sf-text-secondary)]">Top Verified Commit</div>
                  <div className="mt-2 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
                    {verified.map((d) => (
                      <CommitIntegrityDealCard
                        key={d.id}
                        d={d}
                        channelInline={true}
                        expanded={commitIntegrityExpandedId === d.id}
                        loading={commitDealLoadingId === d.id}
                        deal={commitDealCache[d.id]}
                        onToggle={() => void handleToggleDeal(d.id)}
                        showRequestReview={false}
                        channelDashboard={true}
                        kind="verified"
                        cardClassName={commitIntegrityCardClass}
                        title={d.commit_admission_reasons?.slice(0, 2).join("; ") || undefined}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
