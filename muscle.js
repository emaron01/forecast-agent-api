// muscle.js (ES module)
// Judge + score label + ai_forecast + delegate save to db.js
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

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return undefined;
  return Math.max(0, Math.min(3, x));
}

export async function handleFunctionCall(args, callId) {
  console.log("🛠️ Tool Triggered: save_deal_data");

  const deal = args._deal || {};
  delete args._deal; // never persist internal context

  const currentAccount = deal.account_name || "Unknown Account";

  // 1) Normalize scores + label summaries
  for (const cat of categories) {
    const scoreKey = `${cat}_score`;
    const summaryKey = `${cat}_summary`;

    if (Object.prototype.hasOwnProperty.call(args, scoreKey)) {
      args[scoreKey] = clampScore(args[scoreKey]);
    }

    // If model sent a score, enforce the "Score X (Label): ..." prefix
    if (args[scoreKey] != null) {
      const label = scoreLabels[cat][args[scoreKey]] ?? "";
      const existing = (args[summaryKey] || "").trim();

      // Ensure we don't double-prefix if the model already complied
      const prefix = `Score ${args[scoreKey]} (${label}):`;
      args[summaryKey] = existing.startsWith("Score ")
        ? existing
        : `${prefix} ${existing}`.trim();
    }
  }

  // 2) Phantom AI Forecast
  const scores = categories.map((cat) =>
    Number(args[`${cat}_score`] ?? deal[`${cat}_score`] ?? 0)
  );
  const totalScore = scores.reduce((a, b) => a + b, 0);

  args.ai_forecast =
    totalScore >= 21 ? "Commit" : totalScore >= 15 ? "Best Case" : "Pipeline";

  // 3) Delegate persistence
  const updated = await saveDealData(deal, args);
  console.log(`✅ Saved ${currentAccount} (ai_forecast=${args.ai_forecast})`);

  return updated;
}
