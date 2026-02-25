/**
 * Commit Admission evaluation for deals in CRM Commit or AI Forecast Commit.
 * Used to drive AI Verdict (deal-level judgment) without changing AI Forecast rollups.
 */

import { closedOutcomeFromOpportunityRow } from "./opportunityOutcome";

export type CommitAdmissionStatus = "admitted" | "not_admitted" | "needs_review";

const COMMIT_CATEGORIES = [
  { key: "paper", displayName: "Paper Process", scoreKey: "paper_score", confKey: "paper_confidence" },
  { key: "process", displayName: "Decision Process", scoreKey: "process_score", confKey: "process_confidence" },
  { key: "timing", displayName: "Timing", scoreKey: "timing_score", confKey: "timing_confidence" },
  { key: "budget", displayName: "Budget", scoreKey: "budget_score", confKey: "budget_confidence" },
] as const;

export type CrmBucket = "commit" | "best_case" | "pipeline";

/**
 * Compute CRM forecast bucket from forecast_stage + sales_stage.
 * Returns null for closed deals.
 */
export function computeCrmBucket(row: {
  forecast_stage?: string | null;
  sales_stage?: string | null;
}): CrmBucket | null {
  const closed = closedOutcomeFromOpportunityRow(row);
  if (closed) return null;

  const fs = String(
    (row.forecast_stage ?? "") + " " + (row.sales_stage ?? "")
  )
    .replace(/[^a-zA-Z]+/g, " ")
    .toLowerCase()
    .trim();
  const padded = " " + fs + " ";

  if (padded.includes(" commit ")) return "commit";
  if (padded.includes(" best ")) return "best_case";
  return "pipeline";
}

/**
 * Check if Commit Admission applies: open deal AND (CRM bucket is Commit OR ai_forecast is Commit).
 */
export function isCommitAdmissionApplicable(
  row: { forecast_stage?: string | null; sales_stage?: string | null },
  aiForecast: string | null
): boolean {
  const closed = closedOutcomeFromOpportunityRow(row);
  if (closed) return false;

  const crmBucket = computeCrmBucket(row);
  const aiCommit = aiForecast && String(aiForecast).trim().toLowerCase() === "commit";

  return crmBucket === "commit" || !!aiCommit;
}

export type CommitAdmissionResult = {
  status: CommitAdmissionStatus;
  reasons: string[];
};

/**
 * Evaluate Commit Admission for a deal.
 * Only meaningful when isCommitAdmissionApplicable returns true; otherwise returns admitted with empty reasons.
 */
export function computeCommitAdmission(
  row: {
    paper_score?: number | null;
    process_score?: number | null;
    timing_score?: number | null;
    budget_score?: number | null;
    paper_confidence?: string | null;
    process_confidence?: string | null;
    timing_confidence?: string | null;
    budget_confidence?: string | null;
  },
  applicable: boolean
): CommitAdmissionResult {
  if (!applicable) {
    return { status: "admitted", reasons: [] };
  }

  const reasons: string[] = [];

  for (const cat of COMMIT_CATEGORIES) {
    const score = Number(row[cat.scoreKey as keyof typeof row]);
    const scoreInt = Number.isFinite(score) ? Math.trunc(score) : null;

    if (scoreInt != null && scoreInt <= 1) {
      return {
        status: "not_admitted",
        reasons: [`${cat.displayName} weak for Commit`],
      };
    }
  }

  let highConfCount = 0;
  for (const cat of COMMIT_CATEGORIES) {
    const conf = String(row[cat.confKey as keyof typeof row] ?? "").trim().toLowerCase();
    if (conf === "high") highConfCount++;
  }

  if (highConfCount >= 2) {
    return { status: "admitted", reasons: [] };
  }

  reasons.push("Commit support relies on low-confidence evidence");
  return { status: "needs_review", reasons };
}
