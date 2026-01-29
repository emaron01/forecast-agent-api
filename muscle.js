const { saveDealData } = require("./db");

// Score labels mapping
const scoreLabels = {
  pain: ["None", "Vague", "Clear", "Quantified ($$$)"],
  metrics: ["Unknown", "Soft", "Rep-defined", "Customer-validated"],
  champion: ["None", "Coach", "Mobilizer", "Champion (Power)"],
  eb: ["Unknown", "Identified", "Indirect", "Direct relationship"],
  criteria: ["Unknown", "Vague", "Defined", "Locked in favor"],
  process: ["Unknown", "Assumed", "Understood", "Documented"],
  competition: ["Unknown", "Assumed", "Identified", "Known edge"],
  paper: ["Unknown", "Not started", "Known Started", "Waiting for Signature"],
  timing: ["Unknown", "Assumed", "Flexible", "Real Consequence/Event"]
};

const categories = Object.keys(scoreLabels);

/**
 * Handles a function call from the AI agent
 * @param {object} args - Scores and summaries sent from the agent
 * @param {string} callId - ID of the AI function call
 */
async function handleFunctionCall(args, callId) {
  console.log("🛠️ Tool Triggered: save_deal_data");

  const deal = args._deal || {}; // must pass current deal
  const currentAccount = deal.account_name || "Unknown Account";

  try {
    // 1️⃣ Enforce current account name in summaries
    categories.forEach(cat => {
      const summaryKey = `${cat}_summary`;
      if (args[summaryKey]) {
        args[summaryKey] = args[summaryKey].replace(/Acme Corp/g, currentAccount);
      }
    });

    // 2️⃣ Add score labels to summaries
    categories.forEach(cat => {
      const scoreKey = `${cat}_score`;
      const summaryKey = `${cat}_summary`;
      if (args.hasOwnProperty(scoreKey) && args[scoreKey] != null) {
        const label = scoreLabels[cat][args[scoreKey]] || "";
        args[summaryKey] = args[summaryKey]
          ? `${args[summaryKey]} (Score: ${label})`
          : `(Score: ${label})`;
      }
    });

    // 3️⃣ Phantom AI Stage
    const scores = categories.map(cat => Number(args[`${cat}_score`] ?? deal[`${cat}_score`] ?? 0));
    const totalScore = scores.reduce((a, b) => a + b, 0);
    const aiOpinion =
      totalScore >= 21 ? "Commit" :
      totalScore >= 15 ? "Best Case" :
      "Pipeline";
    args.ai_forecast = aiOpinion;

    // 4️⃣ Save to DB
    const updatedDeal = await saveDealData(deal, args);
    console.log(`✅ Atomic Save for ${currentAccount}:`, updatedDeal);

  } catch (err) {
    console.error("❌ Atomic save failed:", err);
  }
}

module.exports = { handleFunctionCall }; 
