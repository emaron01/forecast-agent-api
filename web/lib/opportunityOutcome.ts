export type ClosedOutcome = "Won" | "Lost";
export type Outcome = "Open" | "Won" | "Lost";

function norm(s: any) {
  return String(s || "").trim().toLowerCase();
}

/**
 * CRO-safe outcome. Case-insensitive, word-boundary safe.
 * WON → "Won"; LOST → "Lost"; CLOSED (standalone) → "Lost"; else → "Open"
 */
export function outcomeFromStageLike(stageLike: any): Outcome {
  const s = norm(stageLike);
  if (!s) return "Open";
  if (/\bwon\b/.test(s)) return "Won";
  if (/\blost\b/.test(s)) return "Lost";
  if (/\bclosed\b/.test(s)) return "Lost";
  return "Open";
}

export function closedOutcomeFromStage(stageLike: any): ClosedOutcome | null {
  const o = outcomeFromStageLike(stageLike);
  if (o === "Won") return "Won";
  if (o === "Lost") return "Lost";
  return null;
}

/** True if sales_stage (or forecast_stage) indicates Closed Won or Closed Lost. */
export function isClosedStage(stageLike: any): boolean {
  return closedOutcomeFromStage(stageLike) != null;
}

/** Canonical ai_forecast/ai_verdict for closed stages. Closed Won => "Closed Won", Closed Lost => "Closed Lost". */
export function normalizeClosedForecast(stageLike: any): "Closed Won" | "Closed Lost" | null {
  const outcome = closedOutcomeFromStage(stageLike);
  if (outcome === "Won") return "Closed Won";
  if (outcome === "Lost") return "Closed Lost";
  return null;
}

export function closedOutcomeFromOpportunityRow(row: any): ClosedOutcome | null {
  // Forecast reporting standard: forecast_stage drives all “closed” detection.
  // (We intentionally do NOT use sales_stage here.)
  // forecast_stage takes precedence, then sales_stage
  return closedOutcomeFromStage(row?.forecast_stage) || closedOutcomeFromStage(row?.sales_stage) || null;
}

export function isClosedOpportunityRow(row: any) {
  return closedOutcomeFromOpportunityRow(row) != null;
}

