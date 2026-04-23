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

const GAP_LABELS: Record<(typeof CATEGORY_KEYS)[number], string> = {
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

  let scoredCount = 0;
  let evidencePoints = 0;
  let highCount = 0;
  let medCount = 0;
  let lowCount = 0;
  const gaps: string[] = [];

  for (const cat of CATEGORY_KEYS) {
    const scoreKey = cat === "eb" ? "eb_score" : `${cat}_score`;
    const confidenceKey = cat === "eb" ? "eb_confidence" : `${cat}_confidence`;
    const score = Number(opp[scoreKey] ?? 0);
    if (Number.isFinite(score) && score > 0) scoredCount++;

    const confidence = String(opp[confidenceKey] ?? "").trim().toLowerCase();
    if (confidence === "high") {
      evidencePoints += 6;
      highCount++;
    } else if (confidence === "medium") {
      evidencePoints += 3;
      medCount++;
      if (gaps.length < 2) gaps.push(GAP_LABELS[cat]);
    } else {
      lowCount++;
      if (gaps.length < 2) gaps.push(GAP_LABELS[cat]);
    }
  }

  let coverageModifier = 0;
  if (scoredCount >= 9) coverageModifier = 15;
  else if (scoredCount >= 7) coverageModifier = 10;
  else if (scoredCount >= 5) coverageModifier = 5;

  const updatedAt = opp.updated_at ? new Date(opp.updated_at as string) : null;
  const daysSinceUpdate = updatedAt ? daysBetween(updatedAt, now) : 999;
  let recencyModifier = 0;
  if (daysSinceUpdate <= 3) recencyModifier = 15;
  else if (daysSinceUpdate <= 7) recencyModifier = 12;
  else if (daysSinceUpdate <= 14) recencyModifier = 7;
  else if (daysSinceUpdate <= 30) recencyModifier = 3;

  const sourceModifier =
    source === "rep_review" ? 10 : source === "manager_override" ? 8 : source === "ai_notes" ? 5 : 3;

  const closeDate = opp.close_date ? new Date(opp.close_date as string) : null;
  let nearCloseAndStale = false;
  if (closeDate && Number.isFinite(closeDate.getTime())) {
    const daysToClose = daysBetween(now, closeDate);
    nearCloseAndStale = (daysToClose <= 14 && daysSinceUpdate > 7) || (daysToClose <= 30 && daysSinceUpdate > 14);
  }

  const raw = evidencePoints + coverageModifier + recencyModifier + sourceModifier;
  const confidence_score = Math.max(0, Math.min(100, raw));

  const confidence_band: ConfidenceBand =
    confidence_score >= 70 ? "high" : confidence_score >= 40 ? "medium" : "low";

  const sourceLabel =
    source === "rep_review"
      ? "Rep Review"
      : source === "ai_notes"
        ? "AI Notes"
        : source === "manager_override"
          ? "Manager Override"
          : "System";

  let confidence_summary: string;
  if (confidence_band === "high") {
    confidence_summary = `High confidence: strong evidence across ${highCount}/10 categories; updated ${daysSinceUpdate} days ago; sourced from ${sourceLabel}.`;
  } else if (confidence_band === "medium") {
    confidence_summary = `Medium confidence: mixed evidence quality — ${highCount} strong, ${medCount} partial, ${lowCount} weak/missing across 10 categories.`;
  } else {
    confidence_summary = `Low confidence: evidence quality insufficient — ${highCount} strong, ${medCount} partial, ${lowCount} weak/missing.${nearCloseAndStale ? ` Close date is near and updates are stale.${gaps.length ? ` Key gaps: ${gaps.join(", ")}.` : ""}` : ""}`;
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
