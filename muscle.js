// muscle.js (ES module)
// Tool handler (save_deal_data)
// Goals:
// - Clamp scores 0–3 (integers)
// - Build deterministic summaries that ALWAYS include: Label + Criteria + (optional) Evidence
// - Deterministic risk_summary (stage-aware)
// - Deterministic ai_forecast from total score
// - Avoid junk overwrites (empty strings, "Unknown", placeholders)

import pkg from "pg";
import { saveDealData } from "./db.js";
const { Pool } = pkg;

// ---- Score definition cache (per org) ----
const defPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const defsCache = new Map(); // orgId -> { at:number, map: Map("cat|score"-> {label,criteria}) }
const DEF_TTL_MS = 5 * 60 * 1000;

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

function pruneEmptyStringFields(updates) {
  for (const [k, v] of Object.entries(updates)) {
    if (typeof v === "string" && v.trim() === "") delete updates[k];
  }
}

function scrubUnknown(v) {
  if (!isMeaningfulString(v)) return undefined;
  const t = v.trim();
  const lower = t.toLowerCase();
  if (lower === "unknown") return undefined;
  if (t === "[Champion's Name]" || t === "[Champion's Title]") return undefined;
  if (t === "[Economic Buyer's Name]" || t === "[Economic Buyer's Title]") return undefined;
  return t;
}

/**
 * Strips model junk like:
 *  - "Score 3 (Customer-validated): blah"
 *  - "Score 2: blah"
 *  - "Customer-validated: blah" (we strip any known "Label:" prefix later)
 */
function stripScorePrefix(text) {
  if (!isMeaningfulString(text)) return "";
  let s = text.trim();

  // Remove leading "Score X (...):"
  s = s.replace(/^Score\s*[0-3]\s*(\([^)]+\))?\s*:\s*/i, "");
  // Remove leading "Score X -" or "Score X —"
  s = s.replace(/^Score\s*[0-3]\s*[-—]\s*/i, "");

  return s.trim();
}

async function getScoreDefinitions(orgId) {
  const now = Date.now();
  const cached = defsCache.get(orgId);
  if (cached && now - cached.at < DEF_TTL_MS) return cached.map;

  const map = new Map();
  const q = `
    SELECT category, score, label, criteria
    FROM score_definitions
    WHERE org_id = $1
  `;
  const res = await defPool.query(q, [orgId]);

  for (const row of res.rows) {
    const cat = String(row.category || "").trim().toLowerCase();
    const score = Number(row.score);
    if (!cat || !Number.isFinite(score)) continue;

    map.set(`${cat}|${score}`, {
      label: row.label || "",
      criteria: row.criteria || "",
    });
  }

  defsCache.set(orgId, { at: now, map });
  return map;
}

function mergedScoreFor(deal, updates, cat) {
  const k = `${cat}_score`;
  const v = updates[k] !== undefined ? updates[k] : deal?.[k];
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

function computeAiForecast(totalScore, maxScore) {
  // Keep simple + stable. Tune later in one place.
  // Defaults: Commit ~= 80%+, Best Case ~= 55%+
  const commitCut = Math.round(maxScore * 0.8);
  const bestCaseCut = Math.round(maxScore * 0.55);

  if (totalScore >= commitCut) return "Commit";
  if (totalScore >= bestCaseCut) return "Best Case";
  return "Pipeline";
}

function computeTopRisk(deal, updates) {
  const stage = String(deal?.forecast_stage || "Pipeline");

  const gap = (cat) => mergedScoreFor(deal, updates, cat);

  if (stage.includes("Commit")) {
    if (gap("paper") < 3) return "Commit risk: Paper process not locked.";
    if (gap("eb") < 3) return "Commit risk: Economic Buyer not confirmed/direct.";
    if (gap("process") < 3) return "Commit risk: Decision process not documented.";
    if (gap("budget") < 3) return "Commit risk: Budget not confirmed/locked.";
    return "Commit risk: No material gaps detected.";
  }

  if (stage.includes("Best Case")) {
    if (gap("eb") < 2) return "Best Case risk: Economic Buyer access is weak/unknown.";
    if (gap("paper") < 2) return "Best Case risk: Paper process not started/unclear.";
    if (gap("process") < 2) return "Best Case risk: Decision process is assumed/unknown.";
    if (gap("budget") < 2) return "Best Case risk: Budget is unclear/unconfirmed.";
    if (gap("competition") < 3) return "Best Case risk: Competitive position not a known edge.";
    return "Best Case risk: Primary gaps appear manageable.";
  }

  // Pipeline: foundation-first
  if (gap("pain") < 3) return "Pipeline risk: Pain is not quantified/real enough yet.";
  if (gap("metrics") < 3) return "Pipeline risk: Metrics are not customer-validated.";
  if (gap("champion") < 3) return "Pipeline risk: No true champion/mobilizer identified.";
  if (gap("budget") < 2) return "Pipeline risk: Budget not established early enough.";
  return "Pipeline risk: Foundation looks real; next risk is EB/process progression.";
}

/**
 * Build deterministic summary:
 *   "<Label>: <Criteria> Evidence: <evidence>"
 * Evidence is optional, but Label+Criteria always included.
 *
 * Evidence sourcing:
 * - Prefer tool-provided summary (updates)
 * - Else use existing DB summary as evidence (deal)
 * - Strip any "Score X..." prefixes
 * - Strip any leading "<some label>:" prefix if it matches the label from definitions
 */
function buildSummary({ label, criteria, evidenceRaw }) {
  const labelClean = isMeaningfulString(label) ? label.trim() : "Unknown";
  const criteriaClean = isMeaningfulString(criteria) ? criteria.trim() : "No criteria defined.";

  let ev = stripScorePrefix(evidenceRaw);
  if (isMeaningfulString(ev)) {
    // If evidence starts with "Label:" already, strip it (normalize)
    const lower = ev.toLowerCase();
    const ll = `${labelClean.toLowerCase()}:`;
    if (lower.startsWith(ll)) ev = ev.slice(ll.length).trim();
  } else {
    ev = "";
  }

  return `${labelClean}: ${criteriaClean}${ev ? ` Evidence: ${ev}` : ""}`;
}

export async function handleFunctionCall(args, callId) {
  console.log("🛠️ Tool Triggered: save_deal_data");

  const deal = args._deal || {};
  const orgId = Number(deal.org_id) || 1;
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

    // 1) Clamp any scores present (0–3)
    for (const cat of categories) {
      const k = `${cat}_score`;
      if (updates[k] !== undefined) updates[k] = clampScore(updates[k]);
    }

    // 2) Pull definitions for Label + Criteria
    const defMap = await getScoreDefinitions(orgId);

    // 3) Force summaries to always include Label + Criteria (+ optional Evidence)
    //    Evidence comes from:
    //      - updates[cat_summary] if provided
    //      - else deal[cat_summary] (existing) as evidence
    for (const cat of categories) {
      const scoreK = `${cat}_score`;
      const summaryK = `${cat}_summary`;

      const effectiveScore =
        updates[scoreK] !== undefined ? updates[scoreK] : deal?.[scoreK];
      const s = Number.isFinite(Number(effectiveScore)) ? Number(effectiveScore) : 0;

      const def = defMap.get(`${cat}|${s}`) || { label: "Unknown", criteria: "No criteria defined." };

      const evidenceRaw =
        updates[summaryK] !== undefined ? updates[summaryK] : deal?.[summaryK];

      updates[summaryK] = buildSummary({
        label: def.label,
        criteria: def.criteria,
        evidenceRaw,
      });
    }

    // 4) Deterministic risk_summary (ignore model free-writing)
    updates.risk_summary = computeTopRisk(deal, updates);

    // 5) Deterministic ai_forecast (from merged total score)
    const totalScore = categories
      .map((cat) => mergedScoreFor(deal, updates, cat))
      .reduce((a, b) => a + b, 0);

    const maxScore = categories.length * 3; // MEDDPICC + Timing + Budget => 10 * 3 = 30
    updates.ai_forecast = computeAiForecast(totalScore, maxScore);

    // 6) HARD STABILITY: ignore truly empty calls (should not happen now, but keep)
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
