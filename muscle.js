// muscle.js (ES module)
/// SECTION: Tool handler (save_deal_data) + scoring hygiene + summary formatting

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
 * Only apply when evidence exists; otherwise preserve DB summary (no overwrite).
 */
function labelSummary(cat, score, summary) {
  const s = Number.isFinite(Number(score)) ? Number(score) : 0;
  const label = scoreLabels[cat]?.[s] ?? "Unknown";

  if (!summary || typeof summary !== "string") return undefined;
  const cleaned = summary.trim();
  if (!cleaned) return undefined;

  const lower = cleaned.toLowerCase();
  const labelLower = String(label).toLowerCase() + ":";

  if (lower.startsWith(labelLower)) return cleaned;

  const anyLabelPrefix = (scoreLabels[cat] || [])
    .filter(Boolean)
    .some((lbl) => lower.startsWith(String(lbl).toLowerCase() + ":"));

  if (anyLabelPrefix) return cleaned;

  return `${label}: ${cleaned}`;
}

function computeAiForecast(totalScore) {
  if (totalScore >= 21) return "Commit";
  if (totalScore >= 15) return "Best Case";
  return "Pipeline";
}

export async function handleFunctionCall(args /* callId not used */) {
  console.log("🛠️ Tool Triggered: save_deal_data");

  const deal = args._deal || {};
  const currentAccount = deal.account_name || "Unknown Account";

  try {
    const updates = { ...args };
    delete updates._deal;

    // Defensive: never persist unknown transport keys
    delete updates.call_id;
    delete updates.type;

    // Clamp scores present
    for (const cat of categories) {
      const k = `${cat}_score`;
      if (updates[k] !== undefined) {
        updates[k] = clampScore(updates[k]);
      }
    }

    // Label summaries only if provided
    for (const cat of categories) {
      const scoreK = `${cat}_score`;
      const summaryK = `${cat}_summary`;

      const effectiveScore =
        updates[scoreK] !== undefined ? updates[scoreK] : deal[scoreK];

      const labeled = labelSummary(cat, effectiveScore, updates[summaryK]);
      if (labeled !== undefined) updates[summaryK] = labeled;
      else delete updates[summaryK]; // do not overwrite DB summary
    }

    // AI forecast from merged scores
    const mergedScores = categories.map((cat) => {
      const k = `${cat}_score`;
      const v = updates[k] !== undefined ? updates[k] : deal[k];
      return Number.isFinite(Number(v)) ? Number(v) : 0;
    });

    const totalScore = mergedScores.reduce((a, b) => a + b, 0);
    updates.ai_forecast = computeAiForecast(totalScore);

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
