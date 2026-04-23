"use client";

import Link from "next/link";
import { useState } from "react";
import { MEDDPICC_CANONICAL } from "../../../../lib/meddpiccCanonical";

export type DealCoachingCardDeal = {
  id: string;
  rep: { rep_id: string | null; rep_public_id: string | null; rep_name: string | null };
  deal_name: { account_name: string | null; opportunity_name: string | null };
  close_date: string | null;
  crm_stage: { forecast_stage: string | null; bucket: "commit" | "best_case" | "pipeline" | null; label: string };
  ai_verdict_stage: "Commit" | "Best Case" | "Pipeline" | null;
  amount: number;
  health: {
    health_score: number | null;
    health_pct: number | null;
    suppression: boolean;
    probability_modifier: number;
    health_modifier: number;
  };
  weighted: {
    stage_probability: number;
    crm_weighted: number;
    ai_weighted: number;
    gap: number;
  };
  meddpicc_tb: Array<{
    key:
      | "pain"
      | "metrics"
      | "champion"
      | "criteria"
      | "competition"
      | "timing"
      | "budget"
      | "economic_buyer"
      | "process"
      | "paper";
    score: number | null;
    score_label: string;
    tip: string | null;
    evidence: string | null;
  }>;
  signals: {
    risk_summary: string | null;
    next_steps: string | null;
  };
  risk_flags: Array<{ key: "pain" | "metrics" | "champion" | "criteria" | "competition" | "timing" | "budget" | "economic_buyer" | "process" | "paper" | "suppressed"; label: string; tip: string | null }>;
  coaching_insights: string[];
  commit_admission_status?: "admitted" | "not_admitted" | "needs_review";
  commit_admission_reasons?: string[];
  verdict_note?: string | null;
  _commit_high_conf_count?: number;
  /** CRM channel / partner field (opportunities.partner_name) */
  partner_name?: string | null;
  confidence_band?: "high" | "medium" | "low" | null;
  confidence_summary?: string | null;
};

function fmtDateMmddyyyy(raw: string | null | undefined) {
  const s = String(raw || "").trim();
  if (!s) return "—";
  // ISO date or timestamp starting with YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, yyyy, mm, dd] = iso;
    return `${mm}-${dd}-${yyyy}`;
  }
  // US-style M/D/YYYY or MM/DD/YYYY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const mm = String(us[1]).padStart(2, "0");
    const dd = String(us[2]).padStart(2, "0");
    const yyyy = us[3];
    return `${mm}-${dd}-${yyyy}`;
  }
  // Fall back: try Date parse, but keep deterministic output.
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${mm}-${dd}-${yyyy}`;
}

function scoreBadgeClass(score: number | null) {
  const s = Number(score == null ? 0 : score);
  // Spec:
  // - Red: 0-1
  // - Yellow: 2
  // - Green: 3
  if (s >= 3) return "border-[#2ECC71]/50 bg-[#2ECC71]/10 text-[#2ECC71]";
  if (s >= 2) return "border-[#F1C40F]/60 bg-[#F1C40F]/10 text-[#F1C40F]";
  return "border-[#E74C3C]/60 bg-[#E74C3C]/10 text-[#E74C3C]";
}

function canonicalTitle(key: string) {
  const row = (MEDDPICC_CANONICAL as any)?.[key] || null;
  return String(row?.titleLine || key).trim() || key;
}

function canonicalMeaning(key: string) {
  const row = (MEDDPICC_CANONICAL as any)?.[key] || null;
  return String(row?.meaningLine || "").trim();
}

function chipLabel(key: string) {
  const k = String(key || "").trim();
  if (k === "economic_buyer") return "Economic Buyer";
  if (k === "paper") return "Paper Process";
  if (k === "process") return "Decision Process";
  if (k === "champion") return "Champion";
  if (k === "criteria") return "Decision Criteria";
  if (k === "competition") return "Competition";
  if (k === "timing") return "Timeline";
  if (k === "budget") return "Budget";
  if (k === "metrics") return "Metrics";
  if (k === "pain") return "Pain";
  return canonicalTitle(k);
}

function isGreenScore(score: number | null) {
  const s = Number(score == null ? 0 : score);
  return Number.isFinite(s) && s >= 3;
}

function stageOrder(s: string | null | undefined) {
  const v = String(s || "").trim().toLowerCase();
  if (v === "commit") return 2;
  if (v === "best case" || v === "best_case" || v === "best") return 1;
  if (v === "pipeline") return 0;
  return null;
}

function stageDeltaBadgeClass(crm: string, ai: string) {
  const crmO = stageOrder(crm);
  const aiO = stageOrder(ai);
  const base = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold";
  if (crmO == null || aiO == null) return `${base} border-[color:var(--sf-border)] text-[color:var(--sf-text-primary)]`;
  if (aiO < crmO) return `${base} border-[#E74C3C]/60 bg-[#E74C3C]/10 text-[#E74C3C]`;
  if (aiO > crmO) return `${base} border-[#2ECC71]/60 bg-[#2ECC71]/10 text-[#2ECC71]`;
  return `${base} border-[#F1C40F]/60 bg-[#F1C40F]/10 text-[#B8860B]`;
}

function confidenceBadgeMeta(band: "high" | "medium" | "low" | null | undefined) {
  const base = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold";
  if (band === "high") {
    return {
      label: "High Confidence",
      className: `${base} border-[#2ECC71]/60 bg-[#2ECC71]/10 text-[#2ECC71]`,
    };
  }
  if (band === "medium") {
    return {
      label: "Med Confidence",
      className: `${base} border-[#F1C40F]/60 bg-[#F1C40F]/10 text-[#B8860B]`,
    };
  }
  if (band === "low") {
    return {
      label: "Low Confidence",
      className: `${base} border-[#E74C3C]/60 bg-[#E74C3C]/10 text-[#E74C3C]`,
    };
  }
  return {
    label: "Confidence —",
    className: `${base} border-[color:var(--sf-border)] text-[color:var(--sf-text-secondary)]`,
  };
}

export type DealCoachingCardProps = {
  deal: DealCoachingCardDeal;
  onRequestReview?: (dealId: string) => void;
  showRequestReview?: boolean;
  /** Channel dashboard: hide deal-review / request-review actions. Partner Name follows AI Verdict Stage in the meta line when set. */
  channelDashboard?: boolean;
};

export function DealCoachingCard(props: DealCoachingCardProps) {
  const [expanded, setExpanded] = useState<Record<string, string | null>>({});

  const title =
    [props.deal.deal_name.account_name, props.deal.deal_name.opportunity_name].filter(Boolean).join(" — ") || "(Untitled deal)";
  const activeKey = String(expanded[props.deal.id] || "").trim();
  const activeCat = props.deal.meddpicc_tb.find((c) => c.key === (activeKey as any)) || null;
  const activeTitle = activeCat ? canonicalTitle(activeCat.key) : "";
  const activeMeaning = activeCat ? canonicalMeaning(activeCat.key) : "";
  const crmStageLabel = String(props.deal.crm_stage.label || "").trim() || "—";
  const aiStageLabel = String(props.deal.ai_verdict_stage || "").trim() || "—";
  const repLabel = String(props.deal.rep?.rep_name || "").trim() || "—";
  const partnerLabel = String(props.deal.partner_name || "").trim();
  const confidenceMeta = confidenceBadgeMeta(props.deal.confidence_band ?? null);
  const channelDash = !!props.channelDashboard;
  const requestReviewBtnClass =
    "inline-flex items-center justify-center rounded-md border border-[color:var(--sf-accent-primary)] px-4 text-xs font-semibold text-[color:var(--sf-accent-primary)] hover:bg-[color:var(--sf-accent-primary)] hover:text-white transition-colors";

  return (
    <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-[color:var(--sf-text-primary)]">{title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-base text-[color:var(--sf-text-secondary)]">
            <span>Sales Rep {repLabel}</span>
            <span>· Close {fmtDateMmddyyyy(props.deal.close_date)}</span>
            <span>
              · CRM Forecast Stage <span className="font-semibold text-[color:var(--sf-text-primary)]">{crmStageLabel}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span>· AI Verdict Stage</span>
              <span className={stageDeltaBadgeClass(crmStageLabel, aiStageLabel)}>{aiStageLabel}</span>
            </span>
            <span
              className="inline-flex items-center gap-1"
              title={props.deal.confidence_summary || undefined}
            >
              <span>· Confidence</span>
              <span className={confidenceMeta.className}>{confidenceMeta.label}</span>
            </span>
            {partnerLabel ? (
              <span>
                · Partner Name <span className="font-semibold text-[color:var(--sf-text-primary)]">{partnerLabel}</span>
              </span>
            ) : null}
            {props.deal.health.suppression ? <span>· Suppressed Best Case (low score)</span> : null}
            {(props.deal.crm_stage.bucket === "commit" || props.deal.ai_verdict_stage === "Commit") && props.deal.commit_admission_status === "not_admitted" ? (
              <span
                className="inline-flex items-center rounded-full border border-[#E74C3C]/60 bg-[#E74C3C]/15 px-2 py-0.5 text-xs font-semibold text-[#E74C3C]"
                title={props.deal.commit_admission_reasons?.slice(0, 2).join("; ") || "Commit not supported"}
              >
                NOT ADMITTED
              </span>
            ) : (props.deal.crm_stage.bucket === "commit" || props.deal.ai_verdict_stage === "Commit") && props.deal.commit_admission_status === "needs_review" ? (
              <span
                className="inline-flex items-center rounded-full border border-[#F1C40F]/60 bg-[#F1C40F]/15 px-2 py-0.5 text-xs font-semibold text-[#B8860B]"
                title={props.deal.commit_admission_reasons?.slice(0, 2).join("; ") || "Commit evidence needs review"}
              >
                NEEDS REVIEW
              </span>
            ) : (props.deal.crm_stage.bucket === "commit" || props.deal.ai_verdict_stage === "Commit") &&
              props.deal.commit_admission_status === "admitted" &&
              (props.deal._commit_high_conf_count ?? 0) >= 2 ? (
              <span
                className="inline-flex items-center rounded-full border border-[#2ECC71]/60 bg-[#2ECC71]/15 px-2 py-0.5 text-xs font-semibold text-[#2ECC71]"
                title="Admitted with ≥2 high-confidence gate categories"
              >
                VERIFIED
              </span>
            ) : null}
          </div>
          {props.deal.verdict_note && (props.deal.crm_stage.bucket === "commit" || props.deal.ai_verdict_stage === "Commit") ? (
            <div
              className="mt-1.5 rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-2 py-1.5 text-xs text-[color:var(--sf-text-secondary)] line-clamp-2"
              title={props.deal.verdict_note}
            >
              {props.deal.verdict_note}
            </div>
          ) : null}
          {!channelDash ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Link
                href={`/opportunities/${encodeURIComponent(props.deal.id)}/deal-review`}
                className="inline-flex h-[34px] items-center justify-center rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 text-sm font-medium text-[color:var(--sf-accent-primary)] hover:bg-[color:var(--sf-surface-alt)]"
              >
                View Full Deal
              </Link>
              {props.showRequestReview ? (
                <button
                  type="button"
                  onClick={() => props.onRequestReview?.(props.deal.id)}
                  className={`${requestReviewBtnClass} h-[34px]`}
                >
                  Request Review
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">MEDDPICC+TB Risk Factors</div>
          <div className="text-xs text-[color:var(--sf-text-secondary)]">Click to view AI assessment</div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {props.deal.meddpicc_tb
            .filter((c) => !isGreenScore(c.score))
            .map((c) => {
            const s = Number(c.score == null ? 0 : c.score);
            const active = activeKey === c.key;
            const label = chipLabel(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() =>
                  setExpanded((prev) => ({
                    ...prev,
                    [props.deal.id]: active ? "" : c.key,
                  }))
                }
                className={[
                  "rounded-full border px-3 py-1 text-xs font-semibold",
                  scoreBadgeClass(Number.isFinite(s) ? s : 0),
                  active ? "ring-2 ring-[color:var(--sf-accent-primary)]/30" : "",
                ].join(" ")}
                title={label}
              >
                {label}
              </button>
            );
          })}
        </div>

        {activeCat ? (
          <div className="mt-3 overflow-hidden rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
            <div className="p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
                    {activeTitle} {activeMeaning ? <span className="font-normal text-[color:var(--sf-text-secondary)]">— {activeMeaning}</span> : null}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[color:var(--sf-accent-primary)]">
                    {activeCat.score_label || "—"}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <div className="rounded-md border border-[#F1C40F]/40 bg-[#F1C40F]/10 p-3 text-sm text-[color:var(--sf-text-primary)]">
                  <div className="text-xs font-semibold text-[#F1C40F]">Tip</div>
                  <div className="mt-1">{activeCat.tip || "—"}</div>
                </div>
                <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3 text-sm text-[color:var(--sf-text-primary)]">
                  <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Evidence</div>
                  <div className="mt-1">{activeCat.evidence || "—"}</div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
            <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Risk Summary</div>
            <div className="mt-1 text-sm text-[color:var(--sf-text-primary)]">{props.deal.signals.risk_summary || "—"}</div>
          </div>
          <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
            <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Next Steps</div>
            <div className="mt-1 text-sm text-[color:var(--sf-text-primary)]">{props.deal.signals.next_steps || "—"}</div>
          </div>
        </div>
      </div>

      {props.deal.coaching_insights.length ? (
        <div className="mt-3">
          <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Coaching insights</div>
          <ul className="mt-1 list-disc pl-5 text-sm text-[color:var(--sf-text-primary)]">
            {props.deal.coaching_insights.slice(0, 6).map((t, idx) => (
              <li key={idx}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {props.showRequestReview && !channelDash ? (
        <button
          type="button"
          onClick={() => props.onRequestReview?.(props.deal.id)}
          className={`mt-3 ${requestReviewBtnClass} py-2`}
        >
          Request Review
        </button>
      ) : null}
    </div>
  );
}

