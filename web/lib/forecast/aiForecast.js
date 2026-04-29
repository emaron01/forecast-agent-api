/**
 * Centralized AI Forecast formula. Shared by muscle.js and web/lib/aiForecast.ts.
 * Single source of truth for health_score → bucket mapping.
 */

function isClosedStage(stageLike) {
  const s = String(stageLike || "").trim().toLowerCase();
  if (!s) return false;
  return /\bwon\b/.test(s) || /\blost\b/.test(s) || /\bclosed\b/.test(s);
}

function normalizeClosedForecast(stageLike) {
  const s = String(stageLike || "").trim().toLowerCase();
  if (!s) return null;
  if (/\bwon\b/.test(s)) return "Closed Won";
  if (/\blost\b/.test(s) || /\bclosed\b/.test(s)) return "Closed Lost";
  return null;
}

/**
 * Compute AI Forecast from health score and stage context.
 * 1) If closed detected from salesStageForClosed ?? salesStage ?? forecastStage => return normalized closed forecast.
 * 2) Else open deal: >=24 Commit, >=18 Best Case, else Pipeline.
 */
export function computeAiForecastFromHealthScore(args) {
  const stageForClosed = args.salesStageForClosed ?? args.salesStage ?? args.forecastStage;
  if (isClosedStage(stageForClosed)) {
    const closed = normalizeClosedForecast(stageForClosed);
    return closed ?? null;
  }

  const n = args.healthScore == null ? NaN : Number(args.healthScore);
  if (!Number.isFinite(n)) return null;
  if (n >= 24) return "Commit";
  if (n >= 18) return "Best Case";
  return "Pipeline";
}
