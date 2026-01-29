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

function addLabel(cat, score, summary) {
  const s = Number.isFinite(Number(score)) ? Number(score) : 0;
  const label = scoreLabels[cat]?.[s] ?? "";
  const prefix = `Score ${s} (${label}):`;
  if (!summary || typeof summary !== "string") return `${prefix} (no evidence captured)`;
  const cleaned = summary.trim();
  // Avoid double-prefixing
  if (cleaned.toLowerCase().startsWith("score ")) return cleaned;
  return `${prefix} ${cleaned}`;
}

function cleanseText(text, currentAccount) {
  if (!text || typeof text !== "string") return text;
  // If the model inserts "Company: X" or "Account: X", normalize.
  return text
    .replace(/(company|account)\s*:\s*["']?[^"'\n]+["']?/gi, `Account: ${currentAccount}`)
    .trim();
}

export async function handleFunctionCall(args, callId) {
  console.log("🛠️ Tool Triggered: save_deal_data");

  const deal = args._deal;
  const dealId = deal?.id;
  const currentAccount = deal?.account_name || "Unknown Account";

  if (!dealId) {
    console.error("❌ save_deal_data missing _deal context (refusing to save)");
    return;
  }

  try {
    // 1) Cleanse + label summaries
    for (const cat of categories) {
      const scoreKey = `${cat}_score`;
      const summaryKey = `${cat}_summary`;

      if (args[summaryKey]) {
        args[summaryKey] = cleanseText(args[summaryKey], currentAccount);
      }

      // If a score is present, enforce labeled summary format
      if (Object.prototype.hasOwnProperty.call(args, scoreKey)) {
        args[summaryKey] = addLabel(cat, args[scoreKey], args[summaryKey]);
      }
    }

    // 2) Phantom AI forecast
    const scores = categories.map(cat =>
      Number(args[`${cat}_score`] ?? deal[`${cat}_score`] ?? 0)
    );
    const totalScore = scores.reduce((a, b) => a + b, 0);
    args.ai_forecast = totalScore >= 21 ? "Commit" : totalScore >= 15 ? "Best Case" : "Pipeline";

    // 3) Save
    const updatedDeal = await saveDealData(deal, args);

    console.log(
      `✅ Saved deal id=${dealId} account="${currentAccount}" ai_forecast=${updatedDeal.ai_forecast} run_count=${updatedDeal.run_count}`
    );
  } catch (err) {
    console.error(`❌ Atomic save failed for id=${dealId} account="${currentAccount}":`, err);
  }
}
