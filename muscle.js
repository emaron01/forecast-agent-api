/// muscle.js (ES module)
/// Judge & Scorer: validates tool args, clamps scores,
/// computes ai_forecast and risk_summary deterministically,
/// and (optionally) emits audit_log_entry for db.js to append.

import { saveDealData } from "./db.js";

/// ------------------------------
/// SECTION: Scoring Labels
/// ------------------------------
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

/// ------------------------------
/// SECTION: Helpers (sanitize / clamp / labeling)
/// ------------------------------
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function clampScoreInt0to3(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return undefined; // undefined => "no update"
  if (n < 0) return 0;
  if (n > 3) return 3;
  return Math.round(n);
}

function cleanseText(text, currentAccount) {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/(company|account)\s*:\s*["']?[^"'\n]+["']?/gi, `Account: ${currentAccount}`)
    .trim();
}

/**
 * Label format: "Label: evidence" (NO score numbers).
 * IMPORTANT: This function should ONLY be applied when evidence exists,
 * otherwise we preserve the existing DB summary (no overwrite).
 */
/**
 * Label format: "Label: evidence" (NO score numbers).
 * IMPORTANT: Only apply when evidence exists; otherwise return undefined (no overwrite).
 */
function labelSummary(cat, score, summary) {
  const s = Number.isFinite(Number(score)) ? Number(score) : 0;
  const label = scoreLabels[cat]?.[s] ?? "Unknown";

  if (!summary || typeof summary !== "string") return undefined; // critical: don't overwrite
  let cleaned = summary.trim();
  if (!cleaned) return undefined; // critical: don't overwrite

  // ---- Strip common "Score X" / "(Score X)" / "Score X:" prefixes from older behavior ----
  cleaned = cleaned
    .replace(/^["']?score\s*\d+\s*[:\-–—]\s*/i, "")                  // Score 2: blah
    .replace(/^\(?\s*score\s*\d+\s*\)?\s*[:\-–—]\s*/i, "")           // (Score 2): blah
    .replace(/^score\s*\d+\s*/i, "")                                 // Score 2 blah
    .trim();

  const lower = cleaned.toLowerCase();
  const labelLower = String(label).toLowerCase() + ":";

  // If already correctly prefixed with the chosen label, keep it.
  if (lower.startsWith(labelLower)) return cleaned;

  // If prefixed with ANY valid label already, keep it (do not relabel).
  const anyLabelPrefix = (scoreLabels[cat] || [])
    .filter(Boolean)
    .some((lbl) => lower.startsWith(String(lbl).toLowerCase() + ":"));

  if (anyLabelPrefix) return cleaned;

  // Otherwise prefix with the computed label
  return `${label}: ${cleaned}`;
}

/// ------------------------------
/// SECTION: Risk selection (deterministic)
/// ------------------------------
const riskPriority = ["eb", "champion", "competition", "paper", "process", "criteria", "timing", "metrics", "pain"];

function scoreFor(cat, args, deal) {
  const key = `${cat}_score`;
  const fromArgs = args[key];
  if (fromArgs !== undefined) return Number(fromArgs) || 0;
  return Number(deal?.[key]) || 0;
}

function pickTopRiskCategory(args, deal) {
  let minScore = Infinity;
  for (const cat of categories) {
    const s = scoreFor(cat, args, deal);
    if (s < minScore) minScore = s;
  }
  if (!Number.isFinite(minScore)) minScore = 0;

  for (const cat of riskPriority) {
    if (scoreFor(cat, args, deal) === minScore) return cat;
  }
  return "pain";
}

function computeRiskSummary(args, deal, currentAccount) {
  const cat = pickTopRiskCategory(args, deal);
  const score = scoreFor(cat, args, deal);

  const summaryKey = `${cat}_summary`;
  const existing = deal?.[summaryKey];
  const incoming = args?.[summaryKey];

  const bestSummary =
    (typeof incoming === "string" && incoming.trim().length > 0)
      ? incoming.trim()
      : (typeof existing === "string" && existing.trim().length > 0)
        ? existing.trim()
        : "";

  if (bestSummary) return cleanseText(bestSummary, currentAccount);

  const label = scoreLabels[cat]?.[score] ?? "Unknown";
  return `${label}: Risk not validated yet in ${cat.toUpperCase()}.`;
}

/// ------------------------------
/// SECTION: Main entry — tool handler
/// ------------------------------
export async function handleFunctionCall(args, callId) {
  console.log("🛠️ Tool Triggered: save_deal_data");

  const deal = args?._deal;
  const dealId = deal?.id;
  const currentAccount = deal?.account_name || "Unknown Account";

  if (!dealId) {
    console.error("❌ save_deal_data missing _deal context (refusing to save)");
    return;
  }

  try {
    /// 1) Clamp + cleanse + (conditionally) label summaries
    for (const cat of categories) {
      const scoreKey = `${cat}_score`;
      const summaryKey = `${cat}_summary`;

      if (hasOwn(args, scoreKey)) {
        const clamped = clampScoreInt0to3(args[scoreKey]);
        if (clamped === undefined) {
          delete args[scoreKey];
        } else {
          args[scoreKey] = clamped;
        }
      }

      if (typeof args[summaryKey] === "string") {
        args[summaryKey] = cleanseText(args[summaryKey], currentAccount);
      }

      // Only label if evidence was provided. This avoids "deletes" / overwrites.
      if (hasOwn(args, scoreKey)) {
        const labeled = labelSummary(cat, args[scoreKey], args[summaryKey]);
        if (typeof labeled === "string") args[summaryKey] = labeled;
        else delete args[summaryKey]; // ensure db.js doesn't overwrite old summary
      }
    }

    /// 2) Phantom AI forecast (based on merged scores)
    const mergedScores = categories.map((cat) => Number(args[`${cat}_score`] ?? deal[`${cat}_score`] ?? 0));
    const totalScore = mergedScores.reduce((a, b) => a + b, 0);

    args.ai_forecast = totalScore >= 21 ? "Commit" : totalScore >= 15 ? "Best Case" : "Pipeline";

    /// 3) Deterministic risk_summary
    args.risk_summary = computeRiskSummary(args, deal, currentAccount);

    /// 4) Optional audit log entry (db.js will append if column exists)
    args.audit_log_entry = {
      ts: new Date().toISOString(),
      deal_id: dealId,
      account: currentAccount,
      call_id: callId,
      rep_forecast_stage: deal?.forecast_stage ?? null,
      ai_forecast: args.ai_forecast,
      top_risk_category: pickTopRiskCategory(args, deal),
      changed_keys: Object.keys(args).filter((k) => k !== "_deal" && k !== "_meta"),
    };

    /// 5) Save
    const updatedDeal = await saveDealData(deal, args);

    console.log(
      `✅ Saved deal id=${dealId} account="${currentAccount}" ai_forecast=${updatedDeal.ai_forecast} run_count=${updatedDeal.run_count}`
    );
  } catch (err) {
    console.error(`❌ Atomic save failed for id=${dealId} account="${currentAccount}":`, err);
  }
}
