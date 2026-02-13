export type ClosedOutcome = "Won" | "Lost";

function norm(s: any) {
  return String(s || "").trim().toLowerCase();
}

export function closedOutcomeFromStage(stageLike: any): ClosedOutcome | null {
  const s = norm(stageLike);
  if (!s) return null;
  // Be tolerant of CRM variations: "Closed Won", "WON", "won", etc.
  if (/\bwon\b/.test(s)) return "Won";
  if (/\blost\b/.test(s)) return "Lost";
  return null;
}

export function closedOutcomeFromOpportunityRow(row: any): ClosedOutcome | null {
  // Prefer explicit sales stage, then forecast stage.
  return (
    closedOutcomeFromStage(row?.sales_stage) ||
    closedOutcomeFromStage(row?.stage) ||
    closedOutcomeFromStage(row?.forecast_stage) ||
    null
  );
}

export function isClosedOpportunityRow(row: any) {
  return closedOutcomeFromOpportunityRow(row) != null;
}

