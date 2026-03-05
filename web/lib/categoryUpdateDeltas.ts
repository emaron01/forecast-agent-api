/**
 * Delta detection for category update: only emit "No material change" when
 * there is truly no new evidence, no score change, and no actionability change.
 * New evidence includes explicit negative statements (e.g. "we have not discussed pricing").
 */

export type CategoryKey =
  | "metrics"
  | "economic_buyer"
  | "criteria"
  | "process"
  | "paper"
  | "pain"
  | "champion"
  | "competition"
  | "timing"
  | "budget";

/** Phrases that indicate explicit negative evidence for budget; must score low and produce a tip. */
const BUDGET_NEGATIVE_PATTERNS = [
  /\b(haven't|have not|hasn't|has not)\s+(discussed|talked about|covered)\s+(pricing|budget|cost)/i,
  /\b(not|never)\s+discussed\s+(pricing|budget|any pricing)/i,
  /\bnot\s+discussed\b/i,
  /\bno\s+budget\b/i,
  /\b(not|never|un)\s*confirmed\b/i,
  /\bunconfirmed\b/i,
  /\bdon't\s+know\s+(the\s+)?approval\s+path\b/i,
  /\bdo not\s+know\s+(the\s+)?approval\s+path\b/i,
  /\bunknown\s+approval\s+path\b/i,
  /\bno\s+approval\s+path\b/i,
  /\b(we\s+)?have\s+not\s+discussed\s+any\s+pricing\b/i,
  /\b(we\s+)?haven't\s+discussed\s+(any\s+)?pricing\b/i,
  /\bno\s+pricing\s+(discussion|discussed)/i,
  /\bapproval\s+(path\s+)?(not\s+)?(confirmed|known)/i,
];

function normalizedEvidence(s: string | undefined | null): string {
  return String(s ?? "").trim().toLowerCase();
}

/** True if normalized strings are equal or one includes the other; reduces paraphrase churn. */
export function evidenceEquivalent(a: string, b: string): boolean {
  const na = normalizedEvidence(a);
  const nb = normalizedEvidence(b);
  if (!na || !nb) return na === nb;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** True if text contains explicit negative evidence for budget (unconfirmed / not discussed). */
export function hasBudgetNegativeEvidence(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return BUDGET_NEGATIVE_PATTERNS.some((re) => re.test(t));
}

/** True if there is new factual info relevant to the category (including negative evidence). */
export function evidenceDelta(args: {
  category: CategoryKey;
  userText: string;
  lastEvidence: string;
  llmEvidence?: string | null;
  lastScore?: number;
}): boolean {
  const { category, userText, lastEvidence, llmEvidence, lastScore } = args;
  const user = String(userText ?? "").trim();
  const last = normalizedEvidence(lastEvidence);
  const llm = normalizedEvidence(llmEvidence);

  // Prior score 0 (Unknown): any substantive answer is new evidence by definition.
  if (lastScore === 0 && user && !/^(no|nope|nah|unchanged|no change|nothing changed|nothing new|same)\s*$/i.test(user)) return true;

  // Trivial no-change replies are not new evidence.
  if (!user) return false;
  if (/^(no|nope|nah|unchanged|no change|nothing changed|nothing new|same)\s*$/i.test(user)) return false;

  // Budget: explicit negative phrases count as NEW evidence only if not already present in stored evidence.
  if (category === "budget" && hasBudgetNegativeEvidence(user)) {
    if (evidenceEquivalent(lastEvidence, user)) return false;
    return true;
  }
  if (category === "budget" && llm && hasBudgetNegativeEvidence(llm)) {
    if (evidenceEquivalent(last, llm)) return false;
    return true;
  }

  // LLM produced evidence that materially differs from stored (equivalence avoids paraphrase churn).
  if (llm && !evidenceEquivalent(last, llm)) return true;

  // User said something substantive and we have no stored evidence yet.
  const substantive = user.length > 2 && user.split(/\s+/).length >= 2;
  if (substantive && last === "") return true;

  return false;
}

/** True if numeric score or confidence meaningfully changed. */
export function scoreDelta(lastScore: number, llmScore: number | undefined | null): boolean {
  if (llmScore === undefined || llmScore === null) return false;
  const a = Math.max(0, Math.min(3, Math.round(Number(lastScore) || 0)));
  const b = Math.max(0, Math.min(3, Math.round(Number(llmScore) || 0)));
  return a !== b;
}

/** True if tip/next-step should change (different tip or score < 3 and no tip exists). */
export function actionabilityDelta(args: {
  lastTip: string;
  llmTip: string | undefined | null;
  score: number;
}): boolean {
  const { lastTip, llmTip, score } = args;
  const last = String(lastTip ?? "").trim();
  const llm = String(llmTip ?? "").trim();
  if (llm && last !== llm) return true;
  if (score < 3 && !llm && !last) return true; // gap and no tip from LLM and no prior tip → must add tip
  if (score < 3 && !llm && last) return false; // gap but we already have a tip
  return false;
}

/** Only "no material change" when all three deltas are false. */
export function shouldEmitNoMaterialChange(deltas: {
  evidence_delta: boolean;
  score_delta: boolean;
  actionability_delta: boolean;
}): boolean {
  return !deltas.evidence_delta && !deltas.score_delta && !deltas.actionability_delta;
}

const BUDGET_TIP =
  "Identify the funding source, approval path, and exact amount required; secure the approver's acknowledgement.";

const DEFAULT_TIP: Record<CategoryKey, string> = {
  budget: BUDGET_TIP,
  champion: "Confirm the internal sponsor's influence and actions this cycle, and secure a concrete next step they will drive.",
  competition: "Document the competitive alternative and your differentiation in the buyer's words, then validate it with the sponsor.",
  criteria: "Get the decision criteria prioritized by the buyer and map how you meet the top two in their language.",
  economic_buyer: "Identify the economic buyer, confirm their priorities, and secure direct access or a committed intro.",
  metrics: "Define one measurable outcome with a baseline and target, and get the buyer to confirm it in writing.",
  pain: "Quantify the business impact, clarify who feels it most, and tie it to a deadline the buyer owns.",
  paper: "Confirm contracting steps, legal review owner, and the earliest signature date the buyer will commit to.",
  process: "Map the decision process step‑by‑step, owners and dates, and validate where the deal can stall.",
  timing: "Anchor the close to a buyer‑owned event and validate the critical path milestones to reach it.",
};

/** Fallback evidence/score/tip when we have evidence_delta but LLM returned material_change=false with no payload. */
export function fallbackForEvidenceOnly(args: { category: CategoryKey; userText: string }): {
  evidence: string;
  score: number;
  tip: string;
} {
  const { category, userText } = args;
  const text = String(userText ?? "").trim();
  const tip = DEFAULT_TIP[category] ?? "Validate the critical evidence and confirm ownership for this category.";
  if (category === "budget" && hasBudgetNegativeEvidence(text)) {
    return {
      evidence: text,
      score: 0,
      tip: BUDGET_TIP,
    };
  }
  return {
    evidence: text || "Rep provided update; no detail captured.",
    score: 1,
    tip,
  };
}
