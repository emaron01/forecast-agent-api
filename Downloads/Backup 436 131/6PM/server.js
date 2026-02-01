// server.js (ES module)
// Forecast Agent Conductor: Twilio <Stream> + OpenAI Realtime + deal queue + tool routing.
//
// HARD RULES honored:
// - DO NOT refactor save pipeline. SAVE remains via save_deal_data tool calls.
// - Multi-tenant by org_id
// - Deals loaded only from review_now=TRUE for rep
// - Save after every category answer (tool call)
//
// This patch permanently prevents duplicate response.create while one is active,
// which otherwise blocks tool calls and results in "no saves".

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
/// schema: score_definitions(org_id, category, score, label, criteria)
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
 * Pipeline category selection for "next <3 categories in stage-based order"
 * STRICT order: Pain → Metrics → Champion → Competition → Budget
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
  if (Number(cat.score) < 3) {
    return `Last review ${cat.name} was ${label}. Have we made progress since the last review?`;
  }
  return `Has anything changed that could introduce new risk in ${cat.name}?`;
}

function applyArgsToLocalDeal(deal, args) {
  for (const [k, v] of Object.entries(args || {})) {
    if (v !== undefined) deal[k] = v;
  }
}

function markTouched(touchedSet, args) {
  for (const k of Object.keys(args || {})) {
    if (k.endsWith("_score") || k.endsWith("_summary") || k.endsWith("_tip")) {
      touchedSet.add(k.split("_")[0]);
    }
  }
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

/// ============================================================================
/// SECTION 8: System Prompt Builder (minimal, stage-based first 3)
/// ============================================================================
function getSystemPrompt(deal, repName, totalCount, isFirstDeal, scoreDefsForOrg) {
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

  const firstLine = isFirstDeal ? callPickup : dealOpening;

  const risk = (deal.risk_summary || "").trim();
  const pain = (deal.pain_summary || "").trim();
  const riskPart = risk ? `Risk: ${risk}` : "Risk: none captured.";
  const painPart = pain ? `Pain: ${pain}` : "Pain: not captured.";
  const secondLine = `${riskPart} ${painPart}`;

  const chosen = pickNextPipelineCategories(deal, 3);
  const firstCat = chosen[0] || { key: "pain", name: "Pain", score: scoreNum(deal.pain_score) };
  const firstQuestion = categoryPromptQuestion(scoreDefsForOrg, firstCat);

  dlog("Before system prompt", {
    opportunity_id: deal.id,
    stage,
    chosen: chosen.map((c) => ({
      key: c.key,
      score: c.score,
      label: scoreLabel(scoreDefsForOrg, c.key, c.score),
    })),
  });

  return `
SYSTEM PROMPT — FORECAST REVIEW AGENT

You are Matthew. Speak minimal lines. No verbal coaching. No verbal next steps.

MANDATORY SPOKEN ORDER (EVERY NEW DEAL):
1) "${firstLine}"
2) "${secondLine}"
Then immediately ask the next question.

PIPELINE CATEGORY ORDER:
Pain → Metrics → Champion → Competition → Budget

RULES:
- If score < 3: say exactly:
  "Last review <Category> was <Label>. Have we made progress since the last review?"
  If vague: challenge with follow-up.
  Then call save_deal_data silently.
- If score == 3: ask only:
  "Has anything changed that could introduce new risk in <Category>?"
  Then call save_deal_data silently.

NOW ASK THIS QUESTION:
"${firstQuestion}"
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

  // Cached score definitions for this org (read-only)
  let scoreDefsForOrg = null;

  // Turn-control stability flags
  let awaitingModel = false;
  let responseActive = false;
  let responseCreateQueued = false;
  let responseCreateInFlight = false;
  let responseInProgress = false; // SINGLE SOURCE OF TRUTH: prevents duplicate response.create
  let lastResponseCreateAt = 0;

  let sawSpeechStarted = false;
  let lastSpeechStoppedAt = 0;

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

  function createResponse(reason) {
    const now = Date.now();

    // Strong guard: OpenAI allows only one active response at a time.
    // If a response is already in progress, queue exactly one follow-up.
    if (responseInProgress) {
      responseCreateQueued = true;
      return;
    }

    // Debounce: some environments emit multiple triggers rapidly
    if (now - lastResponseCreateAt < 900) return;

    // Legacy guard (kept)
    if (responseActive || responseCreateInFlight) {
      responseCreateQueued = true;
      console.log(`⏭️ response.create queued (${reason})`);
      return;
    }

    lastResponseCreateAt = now;
    responseCreateInFlight = true;
    responseActive = true;
    responseInProgress = true;

    console.log(`⚡ response.create (${reason})`);
    safeSend(openAiWs, { type: "response.create" });
  }

  openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");

    safeSend(openAiWs, {
      type: "session.update",
      session: {
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "verse",
        turn_detection: { type: "server_vad", threshold: 0.6, silence_duration_ms: 1100 },
        tools: [saveDealDataTool],
      },
    });

    openAiReady = true;
    attemptLaunch().catch((e) => console.error("❌ attemptLaunch error:", e));
  });

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
        // Keep responseInProgress true; queue one follow-up.
        responseInProgress = true;
        responseCreateQueued = true;
        return;
      }
    }

    if (response.type === "response.created") {
      responseCreateInFlight = false;
      awaitingModel = true;
    }

    if (response.type === "input_audio_buffer.speech_started") {
      // Ignore spurious speech events while the model is still speaking.
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

      // If the model is still responding, queue a single follow-up and wait for response.done.
      if (responseInProgress) {
        responseCreateQueued = true;
        return;
      }

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
            "competition_score",
            "risk_summary",
            "rep_comments",
          ])
        );

        markTouched(touched, argsParsed.json);

        // IMPORTANT: muscle.js contract requires { toolName, args, pool } and args.org_id + args.opportunity_id
        const argsForSave = {
          ...argsParsed.json,
          org_id: orgId,
          opportunity_id: deal.id,
          rep_name: repName,
          call_id: callId,
        };

        await handleFunctionCall({
          toolName: fnName || "save_deal_data",
          args: argsForSave,
          pool,
        });

        applyArgsToLocalDeal(deal, argsParsed.json);

        safeSend(openAiWs, {
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ status: "success" }),
          },
        });

        // Ask next question after tool completes (one at a time)
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

        scoreDefsForOrg = await getScoreDefMap(orgId);

        await attemptLaunch();
      }

      if (data.event === "media" && data.media?.payload && openAiReady) {
        safeSend(openAiWs, { type: "input_audio_buffer.append", audio: data.media.payload });
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

  async function attemptLaunch() {
    if (!openAiReady || !repName) return;

    if (!scoreDefsForOrg) scoreDefsForOrg = await getScoreDefMap(orgId);

    if (dealQueue.length === 0) {
      const result = await pool.query(
        `
        SELECT o.*, org.product_truths AS org_product_data
        FROM opportunities o
        JOIN organizations org ON o.org_id = org.id
        WHERE o.org_id = $1
          AND o.rep_name = $2
          AND o.review_now = TRUE
        ORDER BY o.id ASC
        `,
        [orgId, repName]
      );

      dealQueue = result.rows;
      currentDealIndex = 0;
      touched = new Set();

      console.log(`📊 Loaded ${dealQueue.length} review_now deals for ${repName}`);
      if (dealQueue[0]) {
        console.log(`👉 Starting deal -> id=${dealQueue[0].id} account="${dealQueue[0].account_name}"`);
      }
    }

    if (dealQueue.length === 0) {
      console.log("⚠️ No review_now=TRUE deals found for this rep.");
      return;
    }

    const deal = dealQueue[currentDealIndex];
    const instructions = getSystemPrompt(
      deal,
      repFirstName || repName,
      dealQueue.length,
      true,
      scoreDefsForOrg
    );

    dlog("Sending system prompt", { opportunity_id: deal.id, stage: deal.forecast_stage || "Pipeline" });

    safeSend(openAiWs, { type: "session.update", session: { instructions } });

    setTimeout(() => {
      awaitingModel = false;
      responseActive = false;
      responseCreateQueued = false;
      responseCreateInFlight = false;
      responseInProgress = false;
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
