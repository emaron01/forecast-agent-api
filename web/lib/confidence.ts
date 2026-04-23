/**
 * Deterministic confidence computation for deal scoring.
 * No model calls. Used for audit_details.scoring and opportunity_audit_events.meta.scoring.
 */

export type ScoreSource = "rep_review" | "ai_notes" | "manager_override" | "system";
export type ConfidenceBand = "high" | "medium" | "low";

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
] as const;

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

export function computeConfidence(args: {
  opportunity: Record<string, unknown>;
  source: ScoreSource;
  extractionConfidence?: "high" | "medium" | "low";
  commentIngestionId?: number | null;
  now?: Date;
}): {
  confidence_score: number;
  confidence_band: ConfidenceBand;
  confidence_summary: string;
  score_source: ScoreSource;
  evidence: { comment_ingestion_id: number | null };
  computed_at: string;
} {
  const { opportunity, source, extractionConfidence, commentIngestionId, now = new Date() } = args;
  const opp = opportunity || {};
  void extractionConfidence;

  let evidenceScore = 0;
  let strongCount = 0;
  let partialCount = 0;
  let weakCount = 0;
  let missingCount = 0;

  for (const cat of CATEGORY_KEYS) {
    const evidenceKey = cat === "eb" ? "eb_evidence_strength" : `${cat}_evidence_strength`;
    const evidenceStrength = String(opp[evidenceKey] ?? "").trim().toLowerCase();

    if (evidenceStrength === "explicit_verified") {
      evidenceScore += 6;
      strongCount++;
    } else if (evidenceStrength === "credible_indirect") {
      evidenceScore += 3;
      partialCount++;
    } else if (evidenceStrength === "vague_rep_assertion") {
      evidenceScore += 1;
      weakCount++;
    } else {
      missingCount++;
    }
  }

  const updatedAt = opp.updated_at ? new Date(opp.updated_at as string) : null;
  const daysSinceUpdate = updatedAt ? daysBetween(updatedAt, now) : 999;
  let recencyPoints = 0;
  if (daysSinceUpdate <= 3) recencyPoints = 15;
  else if (daysSinceUpdate <= 7) recencyPoints = 10;
  else if (daysSinceUpdate <= 14) recencyPoints = 5;
  else if (daysSinceUpdate <= 30) recencyPoints = 2;

  const rawSource = String(source ?? "").trim().toLowerCase();
  const sourceMultiplier = rawSource === "rep_review" ? 1.0 : 0.5;

  const closeDate = opp.close_date ? new Date(opp.close_date as string) : null;
  let staleNearClose = false;
  if (closeDate && Number.isFinite(closeDate.getTime())) {
    const daysToClose = daysBetween(now, closeDate);
    staleNearClose = daysToClose <= 14 && daysSinceUpdate > 7;
  }

  const raw = evidenceScore * sourceMultiplier + recencyPoints;
  const confidence_score = Math.max(0, Math.min(100, raw));

  const confidence_band: ConfidenceBand =
    confidence_score >= 65 ? "high" : confidence_score >= 35 ? "medium" : "low";

  const sourceLabel =
    rawSource === "rep_review"
      ? "Matthew Review"
      : rawSource === "ai_notes"
        ? "AI Notes"
        : "CRM Ingest";

  let confidence_summary: string;
  if (confidence_band === "high") {
    confidence_summary = `High confidence: ${strongCount} verified, ${partialCount} partial across 10 categories; sourced from ${sourceLabel}; updated ${daysSinceUpdate} days ago.`;
  } else if (confidence_band === "medium") {
    confidence_summary = `Medium confidence: ${strongCount} verified, ${partialCount} partial, ${weakCount} weak, ${missingCount} missing across 10 categories; sourced from ${sourceLabel}.`;
  } else {
    confidence_summary = `Low confidence: insufficient verified evidence — ${strongCount} verified, ${partialCount} partial, ${weakCount} weak, ${missingCount} missing across 10 categories; sourced from ${sourceLabel}.${staleNearClose ? " Close date is near and evidence is stale." : ""}`;
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
