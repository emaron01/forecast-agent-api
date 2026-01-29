// muscle.js
// Judge & Scorer: clamps scores, labels summaries, computes ai_forecast, delegates save to db.js.

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
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 3) return 3;
  return n;
}

function withLabel(cat, score, summary) {
  const s = Number.isFinite(Number(score)) ? Number(score) : 0;
  const label = scoreLabels[cat]?.[s] ?? "Unknown";
  const prefix = `Score ${s} (${label}):`;

  if (!summary || typeof summary !== "string" || summary.trim().length === 0) {
    return `${prefix} (no evidence captured)`;
  }

  // Avoid double-prefixing if it’s already labeled
  if (summary.trim().startsWith("Score ")) return summary.trim();
  return `${prefix} ${summary.trim()}`;
}

export async function handleFunctionCall(args, callId) {
  console.log("🛠️ Tool Triggered: save_deal_data");

  const deal = args._deal || {};
  const dealId = deal.id;
  const account = deal.account_name || "Unknown Account";

  // Never persist internal routing fields
  const clean = { ...args };
  delete clean._deal;

  // 1) Clamp any *_score fields to 0–3
  for (const cat of categories) {
    const k = `${cat}_score`;
    if (Object.prototype.hasOwnProperty.call(clean, k)) {
      const c = clampScore(clean[k]);
      if (c === null) {
        delete clean[k]; // ignore junk values
      } else {
        if (Number(clean[k]) !== c) {
          console.log(`⚠️ Clamp ${k}: ${clean[k]} -> ${c}`);
        }
        clean[k] = c;
      }
    }
  }

  // 2) Label summaries consistently (Score X (Label): ...)
  for (const cat of categories) {
    const scoreKey = `${cat}_score`;
    const summaryKey = `${cat}_summary`;

    const scoreToUse =
      Object.prototype.hasOwnProperty.call(clean, scoreKey) ? clean[scoreKey] : deal[scoreKey] ?? 0;

    if (Object.prototype.hasOwnProperty.call(clean, summaryKey) || Object.prototype.hasOwnProperty.call(clean, scoreKey)) {
      clean[summaryKey] = withLabel(cat, scoreToUse, clean[summaryKey] ?? deal[summaryKey]);
    }
  }

  // 3) Compute ai_forecast from final score set (args override deal)
  const scores = categories.map((cat) => {
    const k = `${cat}_score`;
    const v = Object.prototype.hasOwnProperty.call(clean, k) ? clean[k] : (deal[k] ?? 0);
    return Number.isFinite(Number(v)) ? Number(v) : 0;
  });

  const total = scores.reduce((a, b) => a + b, 0);
  clean.ai_forecast = total >= 21 ? "Commit" : total >= 15 ? "Best Case" : "Pipeline";

  // 4) Save safely (db.js preserves existing values)
  try {
    const updated = await saveDealData(deal, clean);
    console.log(`✅ Saved deal id=${dealId} account="${account}" ai_forecast=${updated.ai_forecast} run_count=${updated.run_count}`);
    return updated;
  } catch (err) {
    console.error("❌ Save failed:", err);
    throw err;
  }
}
