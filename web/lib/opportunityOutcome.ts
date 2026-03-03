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

/** Outcome from row using BOTH forecast_stage and sales_stage; Won wins over Lost. */
export function outcomeFromOpportunityRow(row: any): Outcome {
  const a = outcomeFromStageLike(row?.forecast_stage);
  const b = outcomeFromStageLike(row?.sales_stage);
  if (a === "Won" || b === "Won") return "Won";
  if (a === "Lost" || b === "Lost") return "Lost";
  return "Open";
}

export function closedOutcomeFromOpportunityRow(row: any): ClosedOutcome | null {
  // Forecast reporting standard: forecast_stage drives all “closed” detection.
  // (We intentionally do NOT use sales_stage here.)
  // forecast_stage takes precedence, then sales_stage
  const o = outcomeFromOpportunityRow(row);
  if (o === "Won") return "Won";
  if (o === "Lost") return "Lost";
  return null;
}

export function isClosedOpportunityRow(row: any) {
  return closedOutcomeFromOpportunityRow(row) != null;
}

function getLastTwoCompletedQuartersWindowUTC(now: Date): { start: Date; endExclusive: Date } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-11
  const currentQuarter = Math.floor(month / 3) + 1; // 1-4

  let lastQuarter = currentQuarter - 1;
  let lastQuarterYear = year;
  if (lastQuarter === 0) {
    lastQuarter = 4;
    lastQuarterYear = year - 1;
  }

  let prevQuarter = lastQuarter - 1;
  let prevQuarterYear = lastQuarterYear;
  if (prevQuarter === 0) {
    prevQuarter = 4;
    prevQuarterYear = lastQuarterYear - 1;
  }

  const start = new Date(Date.UTC(prevQuarterYear, (prevQuarter - 1) * 3, 1));
  const endExclusive = new Date(Date.UTC(year, (currentQuarter - 1) * 3, 1));
  return { start, endExclusive };
}

export function isClosedDealInLastTwoCompletedQuarters(
  row: { forecast_stage?: string | null; sales_stage?: string | null; close_date?: string | Date | null },
  now?: Date
): boolean {
  const closed = closedOutcomeFromOpportunityRow(row);
  if (!closed) return false;

  const rawClose = row.close_date;
  if (!rawClose) return false;

  const closeDate = new Date(rawClose as any);
  if (!Number.isFinite(closeDate.getTime())) return false;

  const ref = now ?? new Date();
  const { start, endExclusive } = getLastTwoCompletedQuartersWindowUTC(ref);
  const t = closeDate.getTime();
  return t >= start.getTime() && t < endExclusive.getTime();
}


