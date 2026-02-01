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

// Single debug flag (must not crash if unset)
const DEBUG_AGENT = String(process.env.DEBUG_AGENT || "") === "1";

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


// ----------------------------------------------------------------------------
// Score definition cache (schema: score_definitions(org_id, category, score, label, criteria))
// Used ONLY to speak "Last review <Category> was <Label> ..." without inventing labels.
// ----------------------------------------------------------------------------
const scoreDefCache = new Map(); // orgId -> { loadedAt, byKey: Map("pain:2" -> {label, criteria}) }
const SCORE_DEF_TTL_MS = 10 * 60 * 1000;

async function getScoreDefMap(orgId) {
  const now = Date.now();
  const cached = scoreDefCache.get(orgId);
  if (cached && now - cached.loadedAt < SCORE_DEF_TTL_MS) return cached.byKey;

  const { rows } = await pool.query(
    `
    SELECT category, score, label, criteria
    FROM score_definitions
    WHERE org_id = $1
    ORDER BY category ASC, score ASC
    `,
    [orgId]
  );

  const byKey = new Map();
  for (const r of rows) {
    const cat = String(r.category || "").trim().toLowerCase();
    const sc = Number(r.score);
    byKey.set(`${cat}:${sc}`, {
      label: r.label != null ? String(r.label) : null,
      criteria: r.criteria != null ? String(r.criteria) : null,
    });
  }

  scoreDefCache.set(orgId, { loadedAt: now, byKey });
  if (DEBUG_AGENT) dlog("Loaded score_definitions", { orgId, rows: rows.length });
  return byKey;
}

function getScoreLabel(scoreDefs, categoryKey, score) {
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
function isReviewed(deal, key) {
  const scoreKey = `${key}_score`;
  const summaryKey = `${key}_summary`;
  const tipKey = `${key}_tip`;

  const s = scoreNum(deal?.[scoreKey]);
  if (s > 0) return true;

  const hasSummary = !!(deal?.[summaryKey] && String(deal[summaryKey]).trim().length);
  const hasTip = !!(deal?.[tipKey] && String(deal[tipKey]).trim().length);
  return hasSummary || hasTip;
}

function isDealCompleteForStage(deal, stage) {
  const stageStr = String(stage || deal?.forecast_stage || "Pipeline");

  // Pipeline completeness is about REVIEWED categories, not forcing "3".
  if (stageStr.includes("Pipeline")) {
    const runCount = Number(deal?.run_count || 0);

    const earlyKeys = ["pain", "metrics", "competition", "timing"];
    const lateKeys = ["pain", "metrics", "champion", "competition", "timing", "budget"];

    const earlyDone = earlyKeys.every((k) => isReviewed(deal, k));
    const lateDone = lateKeys.every((k) => isReviewed(deal, k));

    // First-run pipeline: allow either early or late structure to complete.
    // Later runs: expect late structure.
    return runCount < 1 ? (earlyDone || lateDone) : lateDone;
  }

  // Best Case / Commit: all 10 categories reviewed (not necessarily 3+)
  const required = [
    "pain",
    "metrics",
    "champion",
    "criteria",
    "competition",
    "timing",
    "budget",
    "eb",
    "process",
    "paper",
  ];
  return required.every((k) => isReviewed(deal, k));
}

function computeFirstGap(deal, stage) {
  const stageStr = String(stage || deal?.forecast_stage || "Pipeline");

  const pipelineOrder = [
    { name: "Pain", key: "pain_score", val: deal.pain_score },
    { name: "Metrics", key: "metrics_score", val: deal.metrics_score },
    { name: "Champion", key: "champion_score", val: deal.champion_score },
    { name: "Budget", key: "budget_score", val: deal.budget_score },
  ];

  const bestCaseOrder = [
    { name: "Economic Buyer", key: "eb_score", val: deal.eb_score },
    { name: "Decision Process", key: "process_score", val: deal.process_score },
    { name: "Paper Process", key: "paper_score", val: deal.paper_score },
    { name: "Competition", key: "competition_score", val: deal.competition_score },
    { name: "Budget", key: "budget_score", val: deal.budget_score },
    { name: "Decision Criteria", key: "criteria_score", val: deal.criteria_score },
    { name: "Timing", key: "timing_score", val: deal.timing_score },
    { name: "Champion", key: "champion_score", val: deal.champion_score },
    { name: "Pain", key: "pain_score", val: deal.pain_score },
    { name: "Metrics", key: "metrics_score", val: deal.metrics_score },
  ];

  const commitOrder = [
    { name: "Paper Process", key: "paper_score", val: deal.paper_score },
    { name: "Economic Buyer", key: "eb_score", val: deal.eb_score },
    { name: "Decision Process", key: "process_score", val: deal.process_score },
    { name: "Budget", key: "budget_score", val: deal.budget_score },
    { name: "Decision Criteria", key: "criteria_score", val: deal.criteria_score },
    { name: "Champion", key: "champion_score", val: deal.champion_score },
    { name: "Timing", key: "timing_score", val: deal.timing_score },
    { name: "Competition", key: "competition_score", val: deal.competition_score },
    { name: "Pain", key: "pain_score", val: deal.pain_score },
    { name: "Metrics", key: "metrics_score", val: deal.metrics_score },
  ];

  let order = pipelineOrder;
  if (stageStr.includes("Commit")) order = commitOrder;
  else if (stageStr.includes("Best Case")) order = bestCaseOrder;

  return order.find((s) => scoreNum(s.val) < 3) || order[0];
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
    origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");

  if (isLocal) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/debug/opportunities", async (req, res) => {
  try {
    const orgId = parseInt(req.query.org_id, 10) || 1;
    const repName = req.query.rep_name || null;

    let query = `
      SELECT *
      FROM opportunities
      WHERE org_id = $1
    `;
    const params = [orgId];

    if (repName) {
      query += " AND rep_name = $2";
      params.push(repName);
    }

    query += " ORDER BY updated_at DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ /debug/opportunities error:", err?.message || err);
    res.status(500).json({ error: err.message });
  }
});

/// ============================================================================
/// SECTION 6: HTTP SERVER + WS SERVER
/// ============================================================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
console.log("🌐 WebSocket server created");

/// ============================================================================
/// SECTION 7: OpenAI Tool Schema (save_deal_data)
/// ============================================================================
const scoreInt = { type: "integer", minimum: 0, maximum: 3 };

const saveDealDataTool = {
  type: "function",
  name: "save_deal_data",
  description:
    "Save MEDDPICC+TB updates for the CURRENT deal only. Scores MUST be integers 0-3. Do not invent facts. Do not overwrite evidence with blanks.",
  parameters: {
    type: "object",
    properties: {
      pain_score: scoreInt,
      pain_summary: { type: "string" },
      pain_tip: { type: "string" },

      metrics_score: scoreInt,
      metrics_summary: { type: "string" },
      metrics_tip: { type: "string" },

      champion_score: scoreInt,
      champion_summary: { type: "string" },
      champion_tip: { type: "string" },
      champion_name: { type: "string" },
      champion_title: { type: "string" },

      eb_score: scoreInt,
      eb_summary: { type: "string" },
      eb_tip: { type: "string" },
      eb_name: { type: "string" },
      eb_title: { type: "string" },

      criteria_score: scoreInt,
      criteria_summary: { type: "string" },
      criteria_tip: { type: "string" },

      process_score: scoreInt,
      process_summary: { type: "string" },
      process_tip: { type: "string" },

      competition_score: scoreInt,
      competition_summary: { type: "string" },
      competition_tip: { type: "string" },

      paper_score: scoreInt,
      paper_summary: { type: "string" },
      paper_tip: { type: "string" },

      timing_score: scoreInt,
      timing_summary: { type: "string" },
      timing_tip: { type: "string" },

      budget_score: scoreInt,
      budget_summary: { type: "string" },
      budget_tip: { type: "string" },

      risk_summary: { type: "string" },
      next_steps: { type: "string" },
      rep_comments: { type: "string" },
    },
    required: [],
  },
};


const advanceDealTool = {
  type: "function",
  name: "advance_deal",
  description:
    "Advance to the next deal ONLY when you are finished with the current deal. This tool call is silent.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
};

/// ============================================================================
/// SECTION 8: System Prompt Builder (getSystemPrompt)
/// ============================================================================
function pickPipelineOrder(deal) {
  const runCount = Number(deal?.run_count || 0);
  // First-run: model asks early vs beyond discovery question and then follows the right structure.
  // After first run: treat as progressed (late structure).
  const early = ["pain", "metrics", "competition", "timing"];
  const late = ["pain", "metrics", "champion", "competition", "timing", "budget"];
  return runCount < 1 ? { needsModeQuestion: true, early, late } : { needsModeQuestion: false, early: null, late };
}

function stageCategoryOrder(deal) {
  const stageStr = String(deal?.forecast_stage || "Pipeline");

  if (stageStr.includes("Commit") || stageStr.includes("Best Case")) {
    return {
      stage: stageStr,
      needsModeQuestion: false,
      order: ["pain", "metrics", "champion", "criteria", "competition", "timing", "budget", "eb", "process", "paper"],
    };
  }

  // Default: Pipeline
  const p = pickPipelineOrder(deal);
  return {
    stage: stageStr,
    needsModeQuestion: p.needsModeQuestion,
    early: p.early,
    late: p.late,
    order: p.late, // preferred order after mode is known
  };
}

function pickNextCategories(deal, order, maxN = 3) {
  const chosen = [];
  for (const k of order) {
    if (chosen.length >= maxN) break;
    // Prefer categories that are not strong yet (score < 3) OR not yet reviewed (score==0).
    const sc = scoreNum(deal?.[`${k}_score`]);
    if (sc < 3 || !isReviewed(deal, k)) chosen.push(k);
  }
  // If everything is strong/reviewed, still pick first few in order for quick risk check.
  if (chosen.length === 0) {
    for (const k of order) {
      if (chosen.length >= maxN) break;
      chosen.push(k);
    }
  }
  return chosen;
}

function categoryName(key) {
  const map = {
    pain: "Pain",
    metrics: "Metrics",
    champion: "Champion",
    competition: "Competition",
    budget: "Budget",
    timing: "Timing",
    criteria: "Criteria",
    eb: "Economic Buyer",
    process: "Process",
    paper: "Paper",
  };
  return map[key] || key;
}

function questionForCategory(scoreDefs, deal, key) {
  const name = categoryName(key);
  const sc = scoreNum(deal?.[`${key}_score`]);
  const label = getScoreLabel(scoreDefs, key, sc);

  if (sc >= 3) {
    return `Last review ${name} was strong. Has anything changed that could introduce new risk?`;
  }
  return `Last review ${name} was ${label}. Have we made progress since the last review?`;
}

function computeHealthScore(deal) {
  const keys = ["pain","metrics","champion","criteria","competition","timing","budget","eb","process","paper"];
  let total = 0;
  for (const k of keys) total += scoreNum(deal?.[`${k}_score`]);
  const max = keys.length * 3; // current model
  return { total, max };
}

function getSystemPrompt(deal, repName, totalCount, isFirstDeal, scoreDefs) {
  const stage = deal.forecast_stage || "Pipeline";

  const amountStr = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(deal.amount || 0));

  const closeDateStr = deal.close_date
    ? new Date(deal.close_date).toLocaleDateString()
    : "TBD";

  const oppName = (deal.opportunity_name || "").trim();
  const oppNamePart = oppName ? ` — ${oppName}` : "";

  const callPickup =
    `Hi ${repName}, this is Matthew from Sales Forecaster. ` +
    `Today we are reviewing ${totalCount} deals. ` +
    `Let's jump in starting with ${deal.account_name}${oppNamePart} ` +
    `for ${amountStr} in CRM Forecast Stage ${stage} closing ${closeDateStr}.`;

  const dealOpening =
    `Let’s look at ${deal.account_name}${oppNamePart}, ` +
    `${stage}, ${amountStr}, closing ${closeDateStr}.`;

  const opener = isFirstDeal ? callPickup : dealOpening;

  // Spoken intro is strictly limited to Risk + Pain (existing fields).
  const risk = (deal.risk_summary || "").trim();
  const pain = (deal.pain_summary || "").trim();
  const spokenRisk = risk ? `Risk Summary: ${risk}` : "Risk Summary: none captured yet.";
  const spokenPain = pain ? `Pain Summary: ${pain}` : "Pain Summary: not captured yet.";

  // Determine stage order and next categories
  const stagePlan = stageCategoryOrder(deal);

  // First-run Pipeline: ask the mode question first (do not save it).
  const firstQuestion = stagePlan.needsModeQuestion
    ? "Is this opportunity in the early stage, or has it progressed beyond Discovery?"
    : questionForCategory(scoreDefs, deal, pickNextCategories(deal, stagePlan.order, 1)[0]);

  const nextCats = stagePlan.needsModeQuestion
    ? stagePlan.early.slice(0, 3) // after mode question, model will choose early/late; we provide both rules in prompt
    : pickNextCategories(deal, stagePlan.order, 3);

  if (DEBUG_AGENT) {
    dlog("Deal start plan", {
      opportunity_id: deal.id,
      stage,
      run_count: deal.run_count,
      needsModeQuestion: stagePlan.needsModeQuestion,
      nextCats,
    });
  }

  return `
SYSTEM PROMPT — FORECAST REVIEW AGENT

You are Matthew. You are credible, skeptical, and rigorous (VP-level inspection).
You are NOT a boss. You do NOT coach verbally. You keep spoken words short and factual.

NON-NEGOTIABLE SPOKEN RULES
- You may ONLY speak summaries at:
  (1) Deal intro: Risk Summary + Pain Summary only
  (2) Deal wrap: Risk Summary + Health Score + Suggested Next Steps (in that order)
- Do NOT speak coaching, tips, or long recap. Coaching is allowed ONLY in saved *_tip and *_summary fields (silent).
- Do NOT repeat the rep's answer back.

DEAL INTRO (MUST SPEAK EXACTLY IN THIS ORDER)
1) "${opener}"
2) "${spokenRisk}"
3) "${spokenPain}"
Then immediately ask the next question.

CATEGORY ORDER (STRICT)
Pipeline (early): Pain → Metrics → Competition → Timing
Pipeline (late): Pain → Metrics → Champion → Competition → Timing → Budget
Best Case / Commit: Pain → Metrics → Champion → Criteria → Competition → Timing → Budget → EB → Process → Paper

FIRST-RUN PIPELINE MODE (run_count < 1)
- Ask exactly once: "Is this opportunity in the early stage, or has it progressed beyond Discovery?"
- Do NOT save that answer. Use it only to choose the Pipeline order above.

CATEGORY QUESTIONING (STRICT)
- For any category with score < 3:
  Speak: "Last review <Category> was <Label>. Have we made progress since the last review?"
  If unclear/vague: ask ONE challenging follow-up for accuracy.
  If improvement: capture evidence → rescore up → save.
  If no change: confirm briefly → (save optional; do NOT erase existing fields).
- For any category with score >= 3:
  Speak: "Last review <Category> was strong. Has anything changed that could introduce new risk?"
  If no: move on (no save needed).
  If yes: capture → rescore down (any amount if evidence) → silently update summary/tip → save.

SAVING BEHAVIOR
- All tool calls are silent.
- Never say "saving", "updating", or similar.
- Never write empty fields over existing data. Only send fields you intend to update.

WHAT TO DO NEXT
- First, speak the Deal Intro lines exactly as specified above (opener, Risk Summary, Pain Summary).
- Then ask this question now:
"${firstQuestion}"

- After that, proceed through the next categories in strict order (do not skip forward).
- Start with these next categories (max 3 in this pass): ${nextCats.map((k) => categoryName(k)).join(", ")}.

DEAL WRAP (ONLY WHEN ALL REQUIRED CATEGORIES FOR THE STAGE ARE REVIEWED)
When the stage's required categories have been reviewed (regardless of score):
1) Silently generate an updated risk_summary and next_steps grounded ONLY in captured facts.
2) Call save_deal_data with risk_summary and next_steps (do not blank other fields).
3) Then speak ONLY:
   - "Risk Summary: <risk_summary>"
   - "Health score is <TOTAL> out of <MAX>."
   - "Suggested Next Steps: <next_steps>"
4) Then call advance_deal.

HEALTH SCORE
- Compute as sum of category scores; max is ${computeHealthScore(deal).max}.
`.trim();
}

/// ============================================================================
/// SECTION 9: WebSocket Server (Twilio WS <-> OpenAI WS)
/// ============================================================================
wss.on("connection", async (twilioWs) => {
  console.log("🔥 Twilio WebSocket connected");

  let streamSid = null;
  let orgId = 1;
  let repName = null;
  let repFirstName = null;

  let dealQueue = [];
  let currentDealIndex = 0;
  let openAiReady = false;
  let scoreDefsForOrg = null;

  // Turn-control stability
  let awaitingModel = false;
  let responseActive = false;
  let responseCreateQueued = false;
  let responseCreateInFlight = false;
  let responseInProgress = false; // hard guard: one response at a time
  let lastResponseCreateAt = 0;
  let sawSpeechStarted = false;
  let lastSpeechStoppedAt = 0;

  // Advancement gating (prevents premature NEXT_DEAL_TRIGGER in Pipeline)
  let touched = new Set();

  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  openAiWs.on("error", (err) => {
    console.error("❌ OpenAI WebSocket error:", err?.message || err);
  });

  openAiWs.on("unexpected-response", (req, res) => {
    console.error("❌ OpenAI WS unexpected response:", res?.statusCode, res?.statusMessage);
    console.error("Headers:", res?.headers);
  });

  function createResponse(reason) {
    const now = Date.now();

    // Debounce: avoid rapid duplicate triggers (speech_stopped spam, etc.)
    if (now - lastResponseCreateAt < 900) {
      if (DEBUG_AGENT) {
        console.log(`[DEBUG_AGENT] response.create DEBOUNCED (${reason})`);
      }
      return;
    }

    // If a response is already active or in-flight, just mark that we want
    // one more turn AFTER the current response finishes.
    if (responseActive || responseCreateInFlight || responseInProgress) {
      responseCreateQueued = true;
      if (DEBUG_AGENT) {
        console.log(
          `[DEBUG_AGENT] response.create QUEUED (active/in-flight/in-progress) (${reason})`
        );
      }
      return;
    }

    lastResponseCreateAt = now;
    responseCreateInFlight = true;
    responseActive = true;
    responseInProgress = true;

    console.log(`⚡ response.create (${reason})`);
    safeSend(openAiWs, { type: "response.create" });
  }

function kickModel(reason) {
  console.log(`⚡ kickModel (${reason})`);

  // Do NOT create a response here.
  // This only tells the model: "user input is complete — start thinking."
  safeSend(openAiWs, { type: "input_audio_buffer.commit" });
}

  function nudgeModelStayOnDeal(reason) {
    console.log(`⛔ Advance blocked (${reason}). Nudging model to continue current deal.`);
    safeSend(openAiWs, {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Continue reviewing the CURRENT deal. Do NOT move to the next deal yet. Ask the next required question.",
          },
        ],
      },
    });
    awaitingModel = false;
    createResponse("advance_blocked_continue");
  }

  openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");

    safeSend(openAiWs, {
      type: "session.update",
      session: {
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "verse",
        turn_detection: {
          type: "server_vad",
          threshold: 0.6,
          silence_duration_ms: 1100,
        },
        tools: [saveDealDataTool, advanceDealTool],
      },
    });

    openAiReady = true;
    attemptLaunch().catch((e) => console.error("❌ attemptLaunch error:", e));
  });

  /// ---------------- OpenAI inbound frames ----------------
  openAiWs.on("message", async (data) => {
    const parsed = safeJsonParse(data);
    if (!parsed.ok) {
      console.error("❌ OpenAI frame not JSON:", parsed.err?.message, "| head:", parsed.head);
      return;
    }
    const response = parsed.json;

    if (response.type === "error") {
      console.error("❌ OpenAI error frame:", response);
      const code = response?.error?.code;

      if (code === "conversation_already_has_active_response") {
        // Treat as: "okay, something is already running; wait for response.done"
        responseActive = true;
        responseInProgress = true;
        awaitingModel = true;
        responseCreateQueued = true;
        return;
      }

      // For any other error, clear flags so we don't deadlock.
      responseActive = false;
      responseCreateInFlight = false;
      responseInProgress = false;
      awaitingModel = false;
      return;
    }

    if (response.type === "response.created") {
      responseCreateInFlight = false;
      // keep active; we already set it true on create
      awaitingModel = true;
    }



    if (response.type === "input_audio_buffer.speech_started") {
      // Ignore VAD events while the model response is in progress
      if (responseInProgress) return;
      sawSpeechStarted = true;
    }

    if (response.type === "input_audio_buffer.speech_stopped") {
      if (!sawSpeechStarted) return;
      sawSpeechStarted = false;

      const now = Date.now();
      if (now - lastSpeechStoppedAt < 1800) return;
      lastSpeechStoppedAt = now;

      awaitingModel = true;
      createResponse("speech_stopped");
    }

    try {
      if (response.type === "response.function_call_arguments.done") {
        const callId = response.call_id;
        const fnName = response.name || response.function_name || response?.function?.name || null;


        const argsParsed = safeJsonParse(response.arguments || "{}");
        if (!argsParsed.ok) {
          console.error("❌ Tool args not JSON:", argsParsed.err?.message, "| head:", argsParsed.head);
          return;
        }


        // Silent advancement tool (no spoken trigger)
        if (fnName === "advance_deal") {
          console.log("➡️ advance_deal tool received. Advancing deal...");

          safeSend(openAiWs, {
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify({ status: "success" }),
            },
          });

          awaitingModel = false;
          currentDealIndex++;

          if (currentDealIndex < dealQueue.length) {
            const nextDeal = dealQueue[currentDealIndex];
            console.log(`👉 Context switch -> id=${nextDeal.id} account="${nextDeal.account_name}"`);

            const instructions = getSystemPrompt(
              nextDeal,
              repFirstName || repName || "Rep",
              dealQueue.length,
              false
            );

            safeSend(openAiWs, {
              type: "session.update",
              session: { instructions },
            });

            setTimeout(() => {
              awaitingModel = false;
              responseActive = false;
              responseCreateQueued = false;
              createResponse("next_deal_first_question");
            }, 350);
          } else {
            console.log("🏁 All deals done.");
          }
          return;
        }

        const deal = dealQueue[currentDealIndex];
        if (!deal) {
          console.error("❌ Tool fired but no active deal (ignoring).");
          return;
        }

        console.log(
          `🧾 SAVE ROUTE dealIndex=${currentDealIndex}/${Math.max(dealQueue.length - 1, 0)} id=${deal.id} account="${deal.account_name}" callId=${callId}`
        );
        console.log("🔎 args keys:", Object.keys(argsParsed.json));
        console.log(
          "🔎 args preview:",
          compact(argsParsed.json, [
            "pain_score",
            "metrics_score",
            "champion_score",
            "budget_score",
            "eb_score",
            "criteria_score",
            "process_score",
            "competition_score",
            "paper_score",
            "timing_score",
            "risk_summary",
            "rep_comments",
          ])
        );

        markTouched(touched, argsParsed.json);

        // Enrich tool args with required identifiers for muscle.js
        const toolArgs = {
          ...argsParsed.json,
          org_id: deal.org_id,
          opportunity_id: deal.id,
          rep_name: repName,
          call_id: callId,
        };

        // Muscle.js: schema-aligned SAVE + audit
        await handleFunctionCall({
          toolName: "save_deal_data",
          args: toolArgs,
          pool,
        });

        // Keep local in-memory deal in sync for stage checks / NEXT_DEAL_TRIGGER
        applyArgsToLocalDeal(deal, argsParsed.json);

        safeSend(openAiWs, {
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ status: "success" }),
          },
        });

        // Queue a single follow-up response after the current one completes
        responseCreateQueued = true;
        awaitingModel = true;
      }

      if (response.type === "response.done") {
        responseActive = false;
        responseCreateInFlight = false;
        responseInProgress = false;
        awaitingModel = false;
        sawSpeechStarted = false;

        if (responseCreateQueued) {
          responseCreateQueued = false;
          setTimeout(() => createResponse("queued_continue"), 250);
        }

        const transcript = (
          response.response?.output
            ?.flatMap((o) => o.content || [])
            .map((c) => c.transcript || c.text || "")
            .join(" ") || ""
        );

        if (transcript.includes("NEXT_DEAL_TRIGGER")) {
          const current = dealQueue[currentDealIndex];
          const stageNow = current?.forecast_stage || "Pipeline";
          if (current && !isDealCompleteForStage(current, stageNow)) {
            console.log("⛔ Advance blocked (incomplete_for_stage). Forcing continue current deal.");
            // Nudge model to continue the current deal instead of advancing.
            safeSend(openAiWs, {
              type: "conversation.item.create",
              item: {
                type: "message",
                role: "system",
                content: [
                  {
                    type: "text",
                    text:
                      "DO NOT advance to the next deal yet. Continue the CURRENT deal. Ask exactly ONE question to close the next gap based on stage rules.",
                  },
                ],
              },
            });
            setTimeout(() => createResponse("advance_blocked_continue"), 200);
            return;
          }

          const currentDeal = dealQueue[currentDealIndex];
          if (!currentDeal) return;

          if (!okToAdvance(currentDeal, touched)) {
            return nudgeModelStayOnDeal("pipeline_incomplete");
          }

          console.log("🚀 NEXT_DEAL_TRIGGER accepted. Advancing deal...");
          currentDealIndex++;
          touched = new Set();

          if (currentDealIndex < dealQueue.length) {
            const nextDeal = dealQueue[currentDealIndex];
            console.log(`👉 Context switch -> id=${nextDeal.id} account="${nextDeal.account_name}"`);

            const instructions = getSystemPrompt(
              nextDeal,
              repFirstName || repName || "Rep",
              dealQueue.length,
              false
            );

            safeSend(openAiWs, {
              type: "session.update",
              session: { instructions },
            });

            setTimeout(() => {
              awaitingModel = false;
              responseActive = false;
              responseCreateQueued = false;
              createResponse("next_deal_first_question");
            }, 350);
          } else {
            console.log("🏁 All deals done.");
          }
        }
      }

      if (response.type === "response.audio.delta" && response.delta && streamSid) {
        twilioWs.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: response.delta },
          })
        );
      }
    } catch (err) {
      console.error("❌ OpenAI Message Handler Error:", err);
      awaitingModel = false;
    }
  });

  /// ---------------- Twilio inbound frames ----------------
  twilioWs.on("message", async (msg) => {
    const parsed = safeJsonParse(msg);
    if (!parsed.ok) {
      console.error("❌ Twilio frame not JSON:", parsed.err?.message, "| head:", parsed.head);
      return;
    }
    const data = parsed.json;

    try {
      if (data.event === "start") {
        streamSid = data.start?.streamSid || null;
        const params = data.start?.customParameters || {};

        orgId = parseInt(params.org_id, 10) || 1;
        repName = params.rep_name || "Guest";
        repFirstName = String(repName).trim().split(/\s+/)[0] || "Rep";

        console.log("🎬 Stream started:", streamSid);
        console.log(`🔎 Rep: ${repName} | orgId=${orgId}`);

        // Load score definitions for labels (no schema changes)
        scoreDefsForOrg = await getScoreDefMap(orgId);

        await attemptLaunch();
      }

      if (data.event === "media" && data.media?.payload && openAiReady) {
        safeSend(openAiWs, {
          type: "input_audio_buffer.append",
          audio: data.media.payload,
        });
      }

      if (data.event === "stop") {
        console.log("🛑 Stream stopped:", streamSid);
        streamSid = null;
      }
    } catch (err) {
      console.error("❌ Twilio WS message handler error:", err);
    }
  });

  twilioWs.on("close", () => {
    console.log("🔌 Twilio WebSocket closed");
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
  });

  /// ---------------- Deal loading + initial prompt ----------------
  async function attemptLaunch() {
    if (!scoreDefsForOrg) scoreDefsForOrg = await getScoreDefMap(orgId);

    if (!openAiReady || !repName) return;

    if (dealQueue.length === 0) {
      const result = await pool.query(
        `
        SELECT o.*, org.product_truths AS org_product_data
        FROM opportunities o
        JOIN organizations org ON o.org_id = org.id
        WHERE o.org_id = $1
          AND o.rep_name = $2
          AND o.review_now = TRUE
          AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost')
        ORDER BY o.id ASC
        `,
        [orgId, repName]
      );

      dealQueue = result.rows;
      currentDealIndex = 0;
      touched = new Set();

      console.log(`📊 Loaded ${dealQueue.length} review_now deals for ${repName}`);
      if (dealQueue[0]) {
        console.log(
          `👉 Starting deal -> id=${dealQueue[0].id} account="${dealQueue[0].account_name}"`
        );
      }
    }

    if (dealQueue.length === 0) {
      console.log("⚠️ No review_now=TRUE deals found for this rep.");
      return;
    }

    const deal = dealQueue[currentDealIndex];
    const instructions = getSystemPrompt(deal, repFirstName || repName, dealQueue.length, true);

    safeSend(openAiWs, {
      type: "session.update",
      session: { instructions },
    });

    setTimeout(() => {
      awaitingModel = false;
      responseActive = false;
      responseCreateQueued = false;
      createResponse("first_question");
    }, 350);
  }
});

/// ============================================================================
/// SECTION 10: START
/// ============================================================================
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
