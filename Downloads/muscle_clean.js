// muscle.js (ES module)
// Tool handler (save_deal_data) + scoring hygiene + deterministic labeling (from score_definitions) + deterministic risk/forecast
//
// Key behavior:
// - Scores clamped to 0..3
// - Summaries normalized as: "Label: Criteria. Evidence: <rep input>"
// - Label + Criteria come from score_definitions (DB) by org_id/category/score
// - Model provides evidence only (we ignore model-provided label/criteria formats)
// - Deterministic risk_summary by stage (includes Budget)
// - Deterministic ai_forecast from total score (max 30)

import pkg from "pg";
import { saveDealData } from "./db.js";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Stable category list (MEDDPICC+TB)
const categories = [
  "pain",
  "metrics",
  "champion",
  "eb",
  "criteria",
  "process",
  "competition",
  "paper",
  "timing",
  "budget",
];

// Cache score_definitions by org_id
// shape: { [orgId]: { [category]: { [score]: {label, criteria} } } }
const defsCache = new Map();

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

function pruneEmptyStringFields(updates) {
  for (const [k, v] of Object.entries(updates)) {
    if (typeof v === "string" && v.trim() === "") delete updates[k];
  }
}

async function loadScoreDefinitions(orgId) {
  const id = Number(orgId) || 1;
  if (defsCache.has(id)) return defsCache.get(id);

  const defs = {};
  for (const cat of categories) defs[cat] = {};

  const res = await pool.query(
    `
      SELECT category, score, label, criteria
      FROM score_definitions
      WHERE org_id = $1
    `,
    [id]
  );

  for (const row of res.rows || []) {
    const cat = String(row.category || "").trim().toLowerCase();
    const score = Number(row.score);
    if (!categories.includes(cat)) continue;
    if (!Number.isFinite(score) || score < 0 || score > 3) continue;

    defs[cat][score] = {
      label: String(row.label || "Unknown").trim() || "Unknown",
      criteria: String(row.criteria || "").trim(),
    };
  }

  defsCache.set(id, defs);
  return defs;
}

function getDef(defs, cat, score) {
  const s = Number.isFinite(Number(score)) ? Number(score) : 0;
  const fallback = { label: "Unknown", criteria: "" };
  return defs?.[cat]?.[s] || fallback;
}

function mergedScoreFor(deal, updates, cat) {
  const k = `${cat}_score`;
  const v = updates[k] !== undefined ? updates[k] : deal?.[k];
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

/**
 * Extract evidence from an existing summary if it's already in the normalized format.
 * We prefer what comes after the last "Evidence:" token.
 */
function extractEvidence(existingSummary) {
  if (!isMeaningfulString(existingSummary)) return undefined;
  const s = existingSummary.trim();

  const idx = s.toLowerCase().lastIndexOf("evidence:");
  if (idx >= 0) {
    const after = s.slice(idx + "evidence:".length).trim();
    return after.length ? after : undefined;
  }

  // If it isn't in the "Evidence:" format, treat whole string as evidence (legacy data)
  return s;
}

/**
 * Build normalized summary:
 * "Label: Criteria. Evidence: <evidence>"
 *
 * Rules:
 * - Model-provided *_summary is treated as EVIDENCE ONLY (we strip any "Score X..." prefix).
 * - If model omitted summary, we re-use existing DB evidence when possible.
 * - If summary is empty in DB, we still write a criteria-only scaffold once:
 *     "Label: Criteria. Evidence: No evidence provided."
 */
function buildSummary(def, evidence, allowScaffold) {
  const label = def?.label || "Unknown";
  const criteria = def?.criteria ? def.criteria.trim() : "";

  const criteriaPart = criteria ? `${criteria}` : "";
  if (isMeaningfulString(evidence)) {
    return `${label}: ${criteriaPart}${criteriaPart ? " " : ""}Evidence: ${evidence.trim()}`;
  }

  if (allowScaffold) {
    return `${label}: ${criteriaPart}${criteriaPart ? " " : ""}Evidence: No evidence provided.`;
  }

  return undefined;
}

/**
 * Normalize summaries for all categories using score_definitions.
 * - Only overwrite DB if we have meaningful evidence OR the DB summary was empty and we can scaffold.
 */
function normalizeAllSummaries(deal, updates, defs) {
  for (const cat of categories) {
    const scoreK = `${cat}_score`;
    const summaryK = `${cat}_summary`;

    const effectiveScore = updates[scoreK] !== undefined ? updates[scoreK] : deal?.[scoreK];
    const def = getDef(defs, cat, effectiveScore);

    // Evidence source priority:
    // 1) tool call summary (treated as evidence)
    // 2) existing DB summary evidence
    const toolEvidence = stripScorePrefix(updates[summaryK]);
    const existingEvidence = extractEvidence(deal?.[summaryK]);

    const evidence = toolEvidence !== undefined ? toolEvidence : existingEvidence;

    const dbHadSummary = isMeaningfulString(deal?.[summaryK]);
    const allowScaffold = !dbHadSummary; // only scaffold if DB empty/NULL

    const normalized = buildSummary(def, evidence, allowScaffold);

    if (normalized !== undefined) {
      updates[summaryK] = normalized;
    }
    // else: leave untouched (db.js preserves existing)
  }
}

function computeAiForecast(totalScore) {
  // max 30
  // Commit ≈ 80%+  -> 24+
  // Best Case ≈ 55%+ -> 17+
  if (totalScore >= 24) return "Commit";
  if (totalScore >= 17) return "Best Case";
  return "Pipeline";
}

function computeTopRisk(deal, updates) {
  const stage = String(deal?.forecast_stage || "Pipeline");

  const score = (cat) => mergedScoreFor(deal, updates, cat);

  // Commit
  if (stage.includes("Commit")) {
    if (score("paper") < 3) return "Commit risk: Paper process not locked.";
    if (score("eb") < 3) return "Commit risk: Economic Buyer not confirmed/direct.";
    if (score("process") < 3) return "Commit risk: Decision process not documented.";
    if (score("budget") < 3) return "Commit risk: Budget not approved/allocated.";
    return "Commit risk: No material gaps detected.";
  }

  // Best Case
  if (stage.includes("Best Case")) {
    if (score("eb") < 2) return "Best Case risk: Economic Buyer access is weak/unknown.";
    if (score("paper") < 2) return "Best Case risk: Paper process not started/unclear.";
    if (score("process") < 2) return "Best Case risk: Decision process is assumed/unknown.";
    if (score("budget") < 2) return "Best Case risk: Budget is not confirmed/unclear.";
    if (score("competition") < 3) return "Best Case risk: Competitive position not a known edge.";
    return "Best Case risk: Primary gaps appear manageable.";
  }

  // Pipeline (foundation only)
  if (score("pain") < 3) return "Pipeline risk: Pain is not quantified/real enough yet.";
  if (score("metrics") < 3) return "Pipeline risk: Metrics are not customer-validated.";
  if (score("champion") < 3) return "Pipeline risk: No true champion/mobilizer identified.";
  if (score("budget") < 3) return "Pipeline risk: Budget not established early enough.";
  return "Pipeline risk: Foundation looks real; next risk is EB/process progression.";
}

export async function handleFunctionCall(args, callId) {
  console.log("🛠️ Tool Triggered: save_deal_data");

  const deal = args._deal || {};
  const currentAccount = deal.account_name || "Unknown Account";
  const orgId = deal.org_id || 1;

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

    // 2) Load score definitions + normalize ALL summaries (tool summary OR DB summary)
    const defs = await loadScoreDefinitions(orgId);
    normalizeAllSummaries(deal, updates, defs);

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
