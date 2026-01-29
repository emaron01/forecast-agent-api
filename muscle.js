// muscle.js (ES module)
/// Tool handler (save_deal_data) + scoring hygiene + label formatting

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

/**
 * Label format: "Label: evidence" (NO score numbers).
 * Only applied when evidence exists; otherwise preserve DB summary (no overwrite).
 */
function labelSummary(cat, score, summary) {
  const s0 = Number(score);
  const s = Number.isFinite(s0) ? s0 : 0; // force 0 if missing
  const label = scoreLabels[cat]?.[s] ?? scoreLabels[cat]?.[0] ?? "Unknown";

  if (!summary || typeof summary !== "string") return undefined;
  const cleaned = summary.trim();
  if (!cleaned) return undefined;

  const lower = cleaned.toLowerCase();
  const labelLower = String(label).toLowerCase() + ":";

  // already labeled correctly
  if (lower.startsWith(labelLower)) return cleaned;

  // already has *some* valid label prefix
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

export async function handleFunctionCall(args, callId) {
  console.log("🛠️ Tool Triggered: save_deal_data");

  const deal = args._deal || {};
  const currentAccount = deal.account_name || "Unknown Account";

  try {
    const updates = { ...args };
    delete updates._deal;

    // Defensive: never persist junk keys
    delete updates.call_id;
    delete updates.type;

    // 1) Clamp any scores present
    for (const cat of categories) {
      const k = `${cat}_score`;
      if (updates[k] !== undefined) updates[k] = clampScore(updates[k]);
    }

    // 2) Label summaries when provided (otherwise preserve DB)
    for (const cat of categories) {
      const scoreK = `${cat}_score`;
      const summaryK = `${cat}_summary`;

      const effectiveScore = updates[scoreK] !== undefined ? updates[scoreK] : deal[scoreK];
      const labeled = labelSummary(cat, effectiveScore, updates[summaryK]);

      if (labeled !== undefined) updates[summaryK] = labeled;
      else delete updates[summaryK]; // critical: never overwrite DB summary with blanks/undefined
    }

    // 3) Compute ai_forecast from merged scores
    const mergedScores = categories.map((cat) => {
      const k = `${cat}_score`;
      const v = updates[k] !== undefined ? updates[k] : deal[k];
      return Number.isFinite(Number(v)) ? Number(v) : 0;
    });

    const totalScore = mergedScores.reduce((a, b) => a + b, 0);
    updates.ai_forecast = computeAiForecast(totalScore);

    // 4) Save (db.js prevents blank overwrites)
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
