/**
 * Deterministic confidence computation for deal scoring.
 * No model calls. Used for audit_details.scoring and opportunity_audit_events.meta.scoring.
 * Shared by muscle.js and web/lib/confidence.ts (which re-exports for type safety).
 */

const CATEGORY_KEYS = [
  "pain",
  "metrics",
  "champion",
  "eb",
  "criteria",
  "process",
  "competition",
  "paper",
  "timing",
  "budget",
];

function daysBetween(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

export function computeConfidence(args) {
  const {
    opportunity = {},
    source,
    extractionConfidence,
    commentIngestionId,
    now = new Date(),
  } = args;

  const opp = opportunity;

  // Coverage (0..50)
  let count = 0;
  for (const cat of CATEGORY_KEYS) {
    const key = cat === "eb" ? "eb_score" : `${cat}_score`;
    const v = Number(opp[key] ?? 0);
    if (Number.isFinite(v) && v > 0) count++;
  }
  const coveragePct = count / CATEGORY_KEYS.length;
  const coveragePoints = Math.round(coveragePct * 50);

  // Recency (0..25)
  const updatedAt = opp.updated_at ? new Date(opp.updated_at) : null;
  const daysSinceUpdate = updatedAt ? daysBetween(updatedAt, now) : 999;
  let recencyPoints = 0;
  if (daysSinceUpdate <= 3) recencyPoints = 25;
  else if (daysSinceUpdate <= 7) recencyPoints = 20;
  else if (daysSinceUpdate <= 14) recencyPoints = 12;
  else if (daysSinceUpdate <= 30) recencyPoints = 5;

  // Source (0..15)
  const sourcePoints =
    source === "rep_review" ? 15 : source === "manager_override" ? 12 : source === "ai_notes" ? 8 : 5;

  // Time sensitivity penalty (0..10, applied as negative)
  const closeDate = opp.close_date ? new Date(opp.close_date) : null;
  let timePenalty = 0;
  if (closeDate && Number.isFinite(closeDate.getTime())) {
    const daysToClose = daysBetween(now, closeDate);
    if (daysToClose <= 14 && daysSinceUpdate > 7) timePenalty = 10;
    else if (daysToClose <= 30 && daysSinceUpdate > 14) timePenalty = 5;
  }

  // Evidence quality modifier (ai_notes only, 0..10)
  let evidenceMod = 0;
  if (source === "ai_notes" && extractionConfidence) {
    if (extractionConfidence === "high") evidenceMod = 10;
    else if (extractionConfidence === "medium") evidenceMod = 5;
  }

  const raw = coveragePoints + recencyPoints + sourcePoints + evidenceMod - timePenalty;
  const confidence_score = Math.max(0, Math.min(100, raw));

  const confidence_band =
    confidence_score >= 75 ? "high" : confidence_score >= 45 ? "medium" : "low";

  // Gaps: categories with score == 0 (limit 2)
  const gaps = [];
  const gapLabels = {
    pain: "Pain",
    metrics: "Metrics",
    champion: "Champion",
    eb: "Economic Buyer",
    criteria: "Criteria",
    process: "Process",
    competition: "Competition",
    paper: "Paper Process",
    timing: "Timing",
    budget: "Budget",
  };
  for (const cat of CATEGORY_KEYS) {
    if (gaps.length >= 2) break;
    const key = cat === "eb" ? "eb_score" : `${cat}_score`;
    const v = Number(opp[key] ?? 0);
    if (!Number.isFinite(v) || v === 0) gaps.push(gapLabels[cat] || cat);
  }

  const sourceLabel =
    source === "rep_review"
      ? "Rep Review"
      : source === "ai_notes"
        ? "AI-notes"
        : source === "manager_override"
          ? "Manager Override"
          : "System";

  let confidence_summary;
  if (confidence_band === "high") {
    confidence_summary = `High confidence: ${count}/10 categories scored; updated ${daysSinceUpdate <= 7 ? "recently" : `${daysSinceUpdate} days ago`}; sourced from ${sourceLabel}.`;
  } else if (confidence_band === "medium") {
    confidence_summary = `Medium confidence: ${count}/10 categories scored; updated ${daysSinceUpdate} days ago; sourced from ${sourceLabel}.${gaps.length ? ` Key gaps: ${gaps.join(", ")}.` : ""}`;
  } else {
    confidence_summary = `Low confidence: ${count}/10 categories scored; updated ${daysSinceUpdate > 30 ? "over 30 days ago" : `${daysSinceUpdate} days ago`}; sourced from ${sourceLabel}.${gaps.length ? ` Key gaps: ${gaps.join(", ")}.` : ""}${timePenalty > 0 ? " Close date is near and updates are stale." : ""}`;
  }

  return {
    confidence_score,
    confidence_band,
    confidence_summary,
    score_source: source,
    evidence: { comment_ingestion_id: source === "ai_notes" ? commentIngestionId ?? null : null },
    computed_at: now.toISOString(),
  };
}
