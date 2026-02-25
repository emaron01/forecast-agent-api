/**
 * Centralized AI Forecast formula. Single source of truth for health_score → bucket mapping.
 * ai_verdict may be adjusted by Commit Admission AFTER ai_forecast is computed.
 * Root aiForecast.js mirrors this for muscle.js (Node).
 */

import { isClosedStage, normalizeClosedForecast } from "./opportunityOutcome";

export type AiForecastBucket = "Pipeline" | "Best Case" | "Commit" | "Closed Won" | "Closed Lost";

export interface ComputeAiForecastArgs {
  healthScore: number | null | undefined;
  salesStage?: string | null;
  forecastStage?: string | null;
  salesStageForClosed?: string | null;
}

const COMMIT_THRESHOLD = 24;
const BEST_CASE_THRESHOLD = 18;

/**
 * Compute AI Forecast from health score and stage context.
 * 1) If closed detected from salesStageForClosed ?? salesStage ?? forecastStage => return normalized closed forecast.
 * 2) Else open deal: >=24 Commit, >=18 Best Case, else Pipeline.
 */
export function computeAiForecastFromHealthScore(args: ComputeAiForecastArgs): AiForecastBucket | null {
  const stageForClosed = args.salesStageForClosed ?? args.salesStage ?? args.forecastStage;
  if (isClosedStage(stageForClosed)) {
    const closed = normalizeClosedForecast(stageForClosed);
    return closed ?? null;
  }

  const n = args.healthScore == null ? NaN : Number(args.healthScore);
  if (!Number.isFinite(n)) return null;
  if (n >= COMMIT_THRESHOLD) return "Commit";
  if (n >= BEST_CASE_THRESHOLD) return "Best Case";
  return "Pipeline";
}

export type OpenStage = "Commit" | "Best Case" | "Pipeline";

/** Map AiForecastBucket to open-stage type (closed stages → Pipeline). */
export function toOpenStage(bucket: AiForecastBucket | null): OpenStage | null {
  if (!bucket) return null;
  if (bucket === "Closed Won" || bucket === "Closed Lost") return "Pipeline";
  return bucket;
}
