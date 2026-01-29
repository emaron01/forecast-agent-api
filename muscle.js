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
 * IMPORTANT: Only applied when evidence exists; otherwise preserve DB summary (no overwrite).
 */
function labelSummary(cat, score, summary) {
  const s = Number.isFinite(Number(score)) ? Number(score) : 0;
  const label = scoreLabels[cat]?.[s] ?? "Unknown";

  if (!summary || typeof summary !== "string") return undefined; // do not overwrite
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

    // 1) Clamp any scores present (0-3)
    for (const cat of categories) {
      const k = `${cat}_score`;
      if (updates[k] !== undefined) {
        updates[k] = clampScore(updates[k]);
      }
    }

    // 2) Enforce account name safety in summaries (optional)
    for (const cat of categories) {
      const k = `${cat}_summary`;
      if (typeof updates[k] === "string" && updates[k].includes("Acme Corp")) {
        updates[k] = updates[k].replace(/Acme Corp/g, currentAccount);
      }
    }

    // 3) Apply "Label: evidence" formatting (ONLY if summary provided)
    for (const cat of categories) {
      const scoreK = `${cat}_score`;
      const summaryK = `${cat}_summary`;

      const effectiveScore =
        updates[scoreK] !== undefined ? updates[scoreK] : deal[scoreK];

      const labeled = labelSummary(cat, effectiveScore, updates[summaryK]);
      if (labeled !== undefined) updates[summaryK] = labeled;
      else delete updates[summaryK]; // critical: do not overwrite DB summary
    }

    // 4) Phantom AI stage (based on merged scores: update if score provided)
    const mergedScores = categories.map((cat) => {
      const k = `${cat}_score`;
      const v = updates[k] !== undefined ? updates[k] : deal[k];
      return Number.isFinite(Number(v)) ? Number(v) : 0;
    });

    const totalScore = mergedScores.reduce((a, b) => a + b, 0);
    updates.ai_forecast = computeAiForecast(totalScore);

    // 5) Save (db.js prevents blank overwrites + avoids deleting previous fields)
    const updatedDeal = await saveDealData(deal, updates);

    console.log(`✅ Saved deal id=${updatedDeal.id} account="${currentAccount}" ai_forecast=${updatedDeal.ai_forecast} run_count=${updatedDeal.run_count}`);
    return updatedDeal;
  } catch (err) {
    console.error("❌ save_deal_data failed:", err?.message || err);
    throw err;
  }
}
