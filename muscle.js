// muscle.js (ES module)
// Tool handler (save_deal_data) + scoring hygiene + deterministic labeling + deterministic risk

import { saveDealData } from "./db.js";

const scoreLabels = {
  pain: ["None", "Vague", "Clear", "Quantified ($$$)"],
  metrics: ["Unknown", "Soft", "Rep-defined", "Customer-validated"],
  champion: ["None", "Coach", "Mobilizer", "Champion (Power)"],
  eb: ["Unknown", "Identified", "Indirect", "Direct relationship"],
  criteria: ["Unknown", "Vague", "Defined", "Locked in favor"],
  process: ["Unknown", "Assumed", "Understood", "Documented"],
  competition: ["Unknown", "Assumed", "Identified", "Known edge"],
  paper: ["Unknown", "Not started", "Known Started", "Waiting for Signature"],
  timing: ["Unknown", "Assumed", "Flexible", "Real Consequence/Event"],
};

const categories = Object.keys(scoreLabels);

function clampScore(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return undefined;
  if (n < 0) return 0;
  if (n > 3) return 3;
  return Math.round(n);
}

function isMeaningfulString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function scrubUnknown(v) {
  if (!isMeaningfulString(v)) return undefined;
  const t = v.trim();
  const low = t.toLowerCase();
  if (low === "unknown") return undefined;
  if (t === "[Champion's Name]" || t === "[Champion's Title]") return undefined;
  return t;
}

/**
 * Strips model junk like:
 *  - "Score 3 (Customer-validated): blah"
 *  - "Score 2: blah"
 *  - "Score 1 — blah"
 */
function stripScorePrefix(text) {
  if (!isMeaningfulString(text)) return undefined;
  let s = text.trim();

  // "Score X (...):"
  s = s.replace(/^Score\s*[0-3]\s*(\([^)]+\))?\s*:\s*/i, "");

  // "Score X -" or "Score X —"
  s = s.replace(/^Score\s*[0-3]\s*[-—]\s*/i, "");

  return s.trim();
}

/**
 * Enforce: "Label: evidence" (NO score numbers).
 * Returns undefined when evidence is missing so we never overwrite.
 */
function labelSummary(cat, effectiveScore, summary) {
  const cleanedRaw = stripScorePrefix(summary);
  if (!isMeaningfulString(cleanedRaw)) return undefined;

  const s = Number.isFinite(Number(effectiveScore)) ? Number(effectiveScore) : 0;
  const label = scoreLabels[cat]?.[s] ?? "Unknown";

  const cleaned = cleanedRaw.trim();
  const lower = cleaned.toLowerCase();
  const labelLower = String(label).toLowerCase() + ":";

  // already correctly labeled
  if (lower.startsWith(labelLower)) return cleaned;

  // already has some valid label prefix (accept it; do not relabel)
  const anyLabelPrefix = (scoreLabels[cat] || [])
    .filter(Boolean)
    .some((lbl) => lower.startsWith(String(lbl).toLowerCase() + ":"));

  if (anyLabelPrefix) return cleaned;

  return `${label}: ${cleaned}`;
}

function computeAiForecast(totalScore) {
  // 27 max
  if (totalScore >= 21) return "Commit";
  if (totalScore >= 15) return "Best Case";
  return "Pipeline";
}

function mergedScoreFor(deal, updates, cat) {
  const k = `${cat}_score`;
  const v = updates[k] !== undefined ? updates[k] : deal?.[k];
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

function computeTopRisk(deal, updates) {
  const stage = String(deal?.forecast_stage || "Pipeline");

  const scores = categories.map((cat) => ({
    cat,
    score: mergedScoreFor(deal, updates, cat),
  }));

  const gap = (cat) => scores.find((s) => s.cat === cat)?.score ?? 0;

  // Commit
  if (stage.includes("Commit")) {
    if (gap("paper") < 3) return "Commit risk: Paper process not locked.";
    if (gap("eb") < 3) return "Commit risk: Economic Buyer not confirmed/direct.";
    if (gap("process") < 3) return "Commit risk: Decision process not documented.";
    return "Commit risk: No material gaps detected.";
  }

  // Best Case
  if (stage.includes("Best Case")) {
    if (gap("eb") < 2) return "Best Case risk: Economic Buyer access is weak/unknown.";
    if (gap("paper") < 2) return "Best Case risk: Paper process not started/unclear.";
    if (gap("process") < 2) return "Best Case risk: Decision process is assumed/unknown.";
    if (gap("competition") < 3) return "Best Case risk: Competitive position not a known edge.";
    return "Best Case risk: Primary gaps appear manageable.";
  }

  // Pipeline
  if (gap("pain") < 3) return "Pipeline risk: Pain is not quantified/real enough yet.";
  if (gap("metrics") < 3) return "Pipeline risk: Metrics are not customer-validated.";
  if (gap("champion") < 3) return "Pipeline risk: No true champion/mobilizer identified.";
  return "Pipeline risk: Foundation looks real; next risk is EB/process progression.";
}

function pruneEmptyStringFields(updates) {
  for (const [k, v] of Object.entries(updates)) {
    if (typeof v === "string" && v.trim() === "") delete updates[k];
  }
}

/**
 * Key fix:
 * Normalize summaries EVEN when the model didn't send *_summary in this tool call.
 * We use: tool summary if present, else existing DB summary.
 * We only write back if we can produce a meaningful labeled value.
 */
function normalizeAllSummaries(deal, updates) {
  for (const cat of categories) {
    const scoreK = `${cat}_score`;
    const summaryK = `${cat}_summary`;

    const effectiveScore =
      updates[scoreK] !== undefined ? updates[scoreK] : deal?.[scoreK];

    const sourceSummary =
      updates[summaryK] !== undefined ? updates[summaryK] : deal?.[summaryK];

    const labeled = labelSummary(cat, effectiveScore, sourceSummary);

    // If we can label (meaningful evidence exists), persist it.
    // This fixes your “no label” issue even when model omits *_summary.
    if (labeled !== undefined) {
      updates[summaryK] = labeled;
    }
    // else: leave it untouched (db.js pick() preserves existing)
  }
}

export async function handleFunctionCall(args, callId) {
  console.log("🛠️ Tool Triggered: save_deal_data");

  const deal = args._deal || {};
  const currentAccount = deal.account_name || "Unknown Account";

  try {
    const updates = { ...args };
    delete updates._deal;

    // Defensive: never persist unknown keys
    delete updates.call_id;
    delete updates.type;

    // Normalize “Unknown” placeholders for name/title fields (avoid overwrites)
    if ("champion_name" in updates) updates.champion_name = scrubUnknown(updates.champion_name);
    if ("champion_title" in updates) updates.champion_title = scrubUnknown(updates.champion_title);
    if ("eb_name" in updates) updates.eb_name = scrubUnknown(updates.eb_name);
    if ("eb_title" in updates) updates.eb_title = scrubUnknown(updates.eb_title);

    // Strip empty strings so db.js won't overwrite
    pruneEmptyStringFields(updates);

    // 1) Clamp any scores present (0-3)
    for (const cat of categories) {
      const k = `${cat}_score`;
      if (updates[k] !== undefined) updates[k] = clampScore(updates[k]);
    }

    // 2) Normalize + label ALL summaries (tool summary OR DB summary)
    normalizeAllSummaries(deal, updates);

    // 3) Deterministic risk_summary (ignore model free-writing)
    updates.risk_summary = computeTopRisk(deal, updates);

    // 4) Deterministic ai_forecast (from merged score)
    const totalScore = categories
      .map((cat) => mergedScoreFor(deal, updates, cat))
      .reduce((a, b) => a + b, 0);

    updates.ai_forecast = computeAiForecast(totalScore);

    // 5) HARD STABILITY: ignore truly empty tool calls (no DB writes)
    const meaningfulKeys = Object.keys(updates).filter((k) => updates[k] !== undefined);
    if (meaningfulKeys.length === 0) {
      console.log("⚠️ Ignoring empty save_deal_data call (no-op).");
      return deal;
    }

    const updatedDeal = await saveDealData(deal, updates);

    console.log(
      `✅ Saved deal id=${updatedDeal.id} account="${currentAccount}" ai_forecast=${updatedDeal.ai_forecast} run_count=${updatedDeal.run_count}`
    );

    return updatedDeal;
  } catch (err) {
    console.error("❌ save_deal_data failed:", err?.message || err);
    throw err;
  }
}
