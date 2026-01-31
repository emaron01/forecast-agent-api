// server.js (ES module)
// Forecast Agent Conductor: Twilio <Stream> + OpenAI Realtime + deal queue + tool routing.
//
// LOCKED BEHAVIOR (DO NOT REFACTOR):
// - Incremental saves per category (Option A) via save_deal_data tool calls
// - Deterministic backend scoring/risk/forecast in muscle.js (model provides evidence only)
// - Score labels + criteria come from score_definitions table (muscle.js)
// - review_now = TRUE only
// - MEDDPICC+TB includes Budget (10 categories, max score 30)
// - Stage-aware questioning; Pipeline focuses ONLY on Pain/Metrics/Champion/Budget
// - Mandatory call pickup greeting (FIRST DEAL ONLY) + mandatory deal opening (SUBSEQUENT DEALS)

import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { Pool } from "pg";

import { handleFunctionCall } from "./muscle.js";

/// ============================================================================
/// SECTION 1: CONFIG
/// ============================================================================
const PORT = process.env.PORT || 10000;

const MODEL_URL = process.env.MODEL_API_URL; // wss://api.openai.com/v1/realtime
const MODEL_NAME = process.env.MODEL_NAME;
const OPENAI_API_KEY = process.env.MODEL_API_KEY;

const DATABASE_URL = process.env.DATABASE_URL;

// Single debug flag (per requirements)
const DEBUG_AGENT = String(process.env.DEBUG_AGENT || "") === "1";
function dlog(...args) {
  if (DEBUG_AGENT) console.log("[DEBUG_AGENT]", ...args);
}

if (!MODEL_URL || !MODEL_NAME || !OPENAI_API_KEY) {
  throw new Error("⚠️ MODEL_API_URL, MODEL_NAME, and MODEL_API_KEY must be set!");
}
if (!DATABASE_URL) {
  throw new Error("⚠️ DATABASE_URL must be set!");
}

/// ============================================================================
/// SECTION 2: DB (read-only in server.js)
/// ============================================================================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/// ============================================================================
/// SECTION 2B: SCORE DEFINITIONS CACHE (READ-ONLY)
// schema: score_definitions(org_id, category, score, label, criteria)
/// ============================================================================
const scoreDefCache = new Map(); // orgId -> { loadedAt, byCategoryScore: Map("pain:2" -> {label, criteria}) }
const SCORE_DEF_TTL_MS = 10 * 60 * 1000;

async function getScoreDefMap(orgId) {
  const now = Date.now();
  const cached = scoreDefCache.get(orgId);
  if (cached && now - cached.loadedAt < SCORE_DEF_TTL_MS) return cached.byCategoryScore;

  const { rows } = await pool.query(
    `
    SELECT category, score, label, criteria
    FROM score_definitions
    WHERE org_id = $1
    ORDER BY category ASC, score ASC
    `,
    [orgId]
  );

  const byCategoryScore = new Map();
  for (const r of rows) {
    const cat = String(r.category || "").trim().toLowerCase();
    const sc = Number(r.score);
    const key = `${cat}:${sc}`;
    byCategoryScore.set(key, {
      label: r.label != null ? String(r.label) : null,
      criteria: r.criteria != null ? String(r.criteria) : null,
    });
  }

  scoreDefCache.set(orgId, { loadedAt: now, byCategoryScore });
  dlog("Loaded score_definitions", { orgId, rows: rows.length });
  return byCategoryScore;
}

function scoreLabel(scoreDefs, categoryKey, score) {
  const key = `${String(categoryKey).toLowerCase()}:${Number(score)}`;
  const rec = scoreDefs?.get(key);
  return rec?.label || `Score ${Number(score)}`;
}

/// ============================================================================
/// SECTION 3: HELPERS
/// ============================================================================
function safeJsonParse(data) {
  const s = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  try {
    return { ok: true, json: JSON.parse(s) };
  } catch (e) {
    return { ok: false, err: e, head: s.slice(0, 200) };
  }
}

function compact(obj, keys) {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out;
}

function safeSend(ws, payload) {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  } catch (e) {
    console.error("❌ WS send error:", e?.message || e);
  }
}

function scoreNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Stage-aware questioning order.
 * STRICT:
 * - Pipeline focuses ONLY on Pain, Metrics, Champion, Budget.
 * - Do NOT ask Paper/Legal/Procurement in Pipeline.
 */
function isDealCompleteForStage(deal, stage) {
  const stageStr = String(stage || deal?.forecast_stage || "Pipeline");

  // Pipeline: only Pain, Metrics, Champion, Budget (do NOT require late-stage fields)
  if (stageStr.includes("Pipeline")) {
    return (
      scoreNum(deal.pain_score) >= 3 &&
      scoreNum(deal.metrics_score) >= 3 &&
      scoreNum(deal.champion_score) >= 3 &&
      scoreNum(deal.budget_score) >= 3
    );
  }

  // Best Case / Commit: keep prior MEDDPICC+TB completeness (all 10 categories)
  const requiredKeys = [
    "pain_score",
    "metrics_score",
    "champion_score",
    "eb_score",
    "criteria_score",
    "process_score",
    "competition_score",
    "paper_score",
    "timing_score",
    "budget_score",
  ];
  return requiredKeys.every((k) => scoreNum(deal?.[k]) >= 3);
}

function applyArgsToLocalDeal(deal, args) {
  for (const [k, v] of Object.entries(args || {})) {
    if (v !== undefined) deal[k] = v;
  }
}

function markTouched(touchedSet, args) {
  for (const k of Object.keys(args || {})) {
    if (k.endsWith("_score") || k.endsWith("_summary") || k.endsWith("_tip")) {
      touchedSet.add(k.split("_")[0]); // e.g. metrics_score -> metrics
    }
  }
}

function okToAdvance(deal, touchedSet) {
  const stage = String(deal?.forecast_stage || "Pipeline");
  if (stage.includes("Pipeline")) {
    const req = ["pain", "metrics", "champion", "budget"];
    return req.every((c) => touchedSet.has(c));
  }
  return true;
}

/**
 * Pipeline category selection for "next <3 categories in stage-based order"
 * STRICT order: Pain → Metrics → Champion → Competition → Budget
 *
 * Selection:
 *  - Prefer categories with score < 3 in that order
 *  - If fewer than 3, fill with remaining categories (including 3s) in order
 */
function pickNextPipelineCategories(deal, maxN = 3) {
  const order = [
    { key: "pain", name: "Pain", score: scoreNum(deal.pain_score) },
    { key: "metrics", name: "Metrics", score: scoreNum(deal.metrics_score) },
    { key: "champion", name: "Champion", score: scoreNum(deal.champion_score) },
    { key: "competition", name: "Competition", score: scoreNum(deal.competition_score) },
    { key: "budget", name: "Budget", score: scoreNum(deal.budget_score) },
  ];

  const needsWork = order.filter((c) => c.score < 3);
  const chosen = [];

  for (const c of needsWork) {
    if (chosen.length >= maxN) break;
    chosen.push(c);
  }
  if (chosen.length < maxN) {
    for (const c of order) {
      if (chosen.length >= maxN) break;
      if (!chosen.find((x) => x.key === c.key)) chosen.push(c);
    }
  }
  return chosen;
}

function categoryPromptQuestion(scoreDefs, cat) {
  const label = scoreLabel(scoreDefs, cat.key, cat.score);

  // score < 3 required spoken pattern:
  if (Number(cat.score) < 3) {
    return `Last review ${cat.name} was ${label}. Have we made progress since the last review?`;
  }

  // score == 3: quick risk check only
  return `Has anything changed that could introduce new risk in ${cat.name}?`;
}

/// ============================================================================
/// SECTION 4: EXPRESS APP
/// ============================================================================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get("/", (req, res) => res.send("✅ Forecast Agent API is alive!"));

/// ============================================================================
/// SECTION 5: TWILIO WEBHOOK -> TwiML to open WS
/// ============================================================================
app.post("/agent", async (req, res) => {
  try {
    const callerPhone = req.body.From || null;
    console.log("📞 Incoming call from:", callerPhone);

    const result = await pool.query(
      "SELECT org_id, rep_name FROM opportunities WHERE rep_phone = $1 LIMIT 1",
      [callerPhone]
    );

    let orgId = 1;
    let repName = "Guest";

    if (result.rows.length > 0) {
      orgId = result.rows[0].org_id;
      repName = result.rows[0].rep_name || "Rep";
      console.log(`✅ Identified Rep: ${repName} (org_id=${orgId})`);
    } else {
      console.log("⚠️ No rep matched this phone; defaulting to Guest/org 1");
    }

    const repFirstName = String(repName || "Rep").trim().split(/\s+/)[0] || "Rep";

    const wsUrl = `wss://${req.headers.host}/`;
    res.type("text/xml").send(
      `<Response>
         <Connect>
           <Stream url="${wsUrl}">
             <Parameter name="org_id" value="${orgId}" />
             <Parameter name="rep_name" value="${repName}" />
           </Stream>
         </Connect>
       </Response>`
    );
  } catch (err) {
    console.error("❌ /agent error:", err?.message || err);
    res.type("text/xml").send(
      `<Response><Connect><Stream url="wss://${req.headers.host}/" /></Connect></Response>`
    );
  }
});

/// ============================================================================
/// SECTION 5B: DEBUG (READ-ONLY)
//  (CORS only for localhost)
/// ============================================================================
app.use("/debug/opportunities", (req, res, next) => {
  const origin = req.headers.origin || "";
  const isLocal =
