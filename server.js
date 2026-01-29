// server.js (ES module)
// Forecast Agent Conductor: Twilio <Stream> + OpenAI Realtime + deal queue + tool routing.
//
// Design goals:
// - STABLE: no watchdog loops, no response storms
// - SPEAKS: always sends first response AFTER instructions are loaded
// - SAVES: save_deal_data is model-driven; server just routes tool calls reliably
// - SALES-SMART: stage strategy in system prompt; Pipeline ignores paperwork/legal

import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { Pool } from "pg";

import { handleFunctionCall } from "./muscle.js";

/// ============================================================================
/// CONFIG
/// ============================================================================
const PORT = process.env.PORT || 10000;

// Render env vars (IMPORTANT: MODEL_API_URL must be wss://api.openai.com/v1/realtime)
const MODEL_URL = process.env.MODEL_API_URL;
const MODEL_NAME = process.env.MODEL_NAME;
const OPENAI_API_KEY = process.env.MODEL_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!MODEL_URL || !MODEL_NAME || !OPENAI_API_KEY) {
  throw new Error("⚠️ MODEL_API_URL, MODEL_NAME, and MODEL_API_KEY must be set!");
}
if (!DATABASE_URL) {
  throw new Error("⚠️ DATABASE_URL must be set!");
}

/// ============================================================================
/// DB (read-only in server.js)
/// ============================================================================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/// ============================================================================
/// HELPERS
/// ============================================================================
function safeJsonParse(data) {
  const s = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  try {
    return { ok: true, json: JSON.parse(s) };
  } catch (e) {
    return { ok: false, err: e, head: s.slice(0, 250) };
  }
}

function compact(obj, keys) {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out;
}

function formatMoney(amount) {
  const n = Number(amount) || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(d) {
  if (!d) return "TBD";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return "TBD";
  }
}

// First category with score < 3 (deterministic ordering)
function computeFirstGap(deal) {
  const scores = [
    { name: "Pain", key: "pain_score", val: deal.pain_score },
    { name: "Metrics", key: "metrics_score", val: deal.metrics_score },
    { name: "Champion", key: "champion_score", val: deal.champion_score },
    { name: "Economic Buyer", key: "eb_score", val: deal.eb_score },
    { name: "Decision Criteria", key: "criteria_score", val: deal.criteria_score },
    { name: "Decision Process", key: "process_score", val: deal.process_score },
    { name: "Competition", key: "competition_score", val: deal.competition_score },
    { name: "Paper Process", key: "paper_score", val: deal.paper_score },
    { name: "Timing", key: "timing_score", val: deal.timing_score },
  ];

  return scores.find((s) => (Number(s.val) || 0) < 3) || scores[0];
}

function applyArgsToLocalDeal(deal, args) {
  // Keep local memory aligned with DB so gap logic stays stable.
  for (const [k, v] of Object.entries(args || {})) {
    if (v !== undefined) deal[k] = v;
  }
}

/// ============================================================================
/// EXPRESS APP
/// ============================================================================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // REQUIRED for Twilio

app.get("/", (req, res) => res.send("✅ Forecast Agent API is alive!"));

/// ============================================================================
/// TWILIO WEBHOOK: identify rep by caller phone -> return TwiML to open WS
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
/// DEBUG / DASHBOARD SUPPORT (READ-ONLY + LOCAL CORS)
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
/// TOOL SCHEMA (save_deal_data) — HARD SCORE GUARDRAILS
/// ============================================================================
const scoreInt = { type: "integer", minimum: 0, maximum: 3 };

const saveDealDataTool = {
  type: "function",
  name: "save_deal_data",
  description:
    "Save MEDDPICC updates for the CURRENT deal only. Scores MUST be integers 0-3. Do not invent facts. Do not overwrite evidence with blanks.",
  parameters: {
    type: "object",
    properties: {
      pain_score: scoreInt, pain_summary: { type: "string" }, pain_tip: { type: "string" },
      metrics_score: scoreInt, metrics_summary: { type: "string" }, metrics_tip: { type: "string" },
      champion_score: scoreInt, champion_summary: { type: "string" }, champion_tip: { type: "string" },
      champion_name: { type: "string" }, champion_title: { type: "string" },
      eb_score: scoreInt, eb_summary: { type: "string" }, eb_tip: { type: "string" },
      eb_name: { type: "string" }, eb_title: { type: "string" },
      criteria_score: scoreInt, criteria_summary: { type: "string" }, criteria_tip: { type: "string" },
      process_score: scoreInt, process_summary: { type: "string" }, process_tip: { type: "string" },
      competition_score: scoreInt, competition_summary: { type: "string" }, competition_tip: { type: "string" },
      paper_score: scoreInt, paper_summary: { type: "string" }, paper_tip: { type: "string" },
      timing_score: scoreInt, timing_summary: { type: "string" }, timing_tip: { type: "string" },

      // Optional (muscle.js will compute deterministically anyway if you keep that behavior)
      risk_summary: { type: "string" },

      next_steps: { type: "string" },
      rep_comments: { type: "string" },
    },
    required: [],
  },
};

/// ============================================================================
/// SYSTEM PROMPT BUILDER (stage-smart, not chatty, but human)
/// ============================================================================
function buildStageStrategy(stageText) {
  const stage = String(stageText || "Pipeline");

  if (stage.includes("Commit")) {
    return `
MODE: CLOSING ASSISTANT (Commit).
- Goal: Protect the forecast (de-risk).
- Logic: If ANY category is 0-2, challenge the integrity of Commit silently (do NOT lecture).
- Focus: Economic Buyer, Paper Process, and Decision Process must be solid.
`;
  }

  if (stage.includes("Best Case")) {
    return `
MODE: DEAL STRATEGIST (Best Case).
- Goal: Validate upside and identify what must be true to move to Commit.
- Focus: Champion strength, EB access, Decision Process, Paper Process, and Competitive edge.
`;
  }

  return `
MODE: PIPELINE ANALYST (Pipeline).
- Goal: Qualify or disqualify quickly.
- FOUNDATION FIRST: Pain, Metrics, Champion.
- Constraint: IGNORE paperwork & legal. Do NOT ask about contracts, SOW, procurement, or paper process unless the rep volunteers the deal is already in procurement.
`;
}

function getSystemPrompt(deal, repFirstName) {
  const stage = deal.forecast_stage || "Pipeline";
  const amountStr = formatMoney(deal.amount);
  const closeDateStr = formatDate(deal.close_date);

  const account = deal.account_name || "Unknown Account";
  const oppName = deal.opportunity_name || "Unknown Opportunity";

  // Mandatory deal opening (exact)
  const dealOpening = `Let’s look at ${account} — ${oppName}, ${stage}, ${amountStr}, closing ${closeDateStr}.`;

  // What to ask next: focus lowest gap; but for Pipeline we keep foundation-first logic in strategy
  const firstGap = computeFirstGap(deal);
  const gapQuestion = `Has anything changed since last review regarding ${firstGap.name}?`;

  const stageStrategy = buildStageStrategy(stage);

  return `
### ROLE
You are Matthew, a sales leader MEDDPICC auditor. You are friendly and professional, but not chatty.
You are an extractor (for forecasting rigor), not a coach in spoken dialogue.

### HARD CONTEXT (NON-NEGOTIABLE)
- DEAL_ID: ${deal.id}
- ACCOUNT_NAME: ${account}
- OPPORTUNITY_NAME: ${oppName}
Never use any other account/opportunity name unless the rep explicitly corrects it.

### DEAL OPENING (MANDATORY)
At the start of THIS deal, you MUST say exactly:
"${dealOpening}"

### STAGE STRATEGY (MANDATORY)
${stageStrategy}

### SPOKEN OUTPUT RULES (MANDATORY)
- Spoken output is ONLY questions.
- One sentence per turn, ending with a question mark.
- Do NOT summarize the rep out loud.
- Do NOT give advice out loud (tips go into saved fields only).
- Do NOT “manage” the rep (no boss talk like “keep me posted”).

### FLOW (MANDATORY)
- You will focus only on categories with score < 3, consistent with STAGE STRATEGY.
- Each turn:
  1) Ask ONE surgical question about the next most important gap.
  2) If unclear, ask ONE clarifier.
  3) Then call save_deal_data silently immediately (no narration).
- Only when ready to leave the deal, say exactly:
"Health Score: [Sum]/27. Risk: [Top Risk]. NEXT_DEAL_TRIGGER."

### NEXT QUESTION (MANDATORY)
Your next question MUST be exactly:
"${gapQuestion}"
`.trim();
}

/// ============================================================================
/// HTTP SERVER + WS SERVER
/// ============================================================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
console.log("🌐 WebSocket server created");

/// ============================================================================
/// WS CORE: Twilio <-> OpenAI
/// ============================================================================
wss.on("connection", async (twilioWs) => {
  console.log("🔥 Twilio WebSocket connected");

  let streamSid = null;
  let orgId = 1;
  let repName = null;

  let dealQueue = [];
  let currentDealIndex = 0;

  let openAiReady = false;
  let instructionsReady = false;

  // Response.create debounce (prevents storms)
  let lastSpeechStoppedAt = 0;

  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  function safeSend(payload) {
    try {
      if (openAiWs.readyState === WebSocket.OPEN) {
        openAiWs.send(JSON.stringify(payload));
      }
    } catch (e) {
      console.error("❌ OpenAI WS send error:", e?.message || e);
    }
  }

  function kickModel(reason) {
    if (!openAiReady || !instructionsReady) return;
    console.log(`⚡ response.create (${reason})`);
    safeSend({ type: "response.create" });
  }

  openAiWs.on("error", (err) => {
    console.error("❌ OpenAI WebSocket error:", err?.message || err);
  });

  openAiWs.on("unexpected-response", (req, res) => {
    console.error("❌ OpenAI WS unexpected response:", res?.statusCode, res?.statusMessage);
    console.error("Headers:", res?.headers);
  });

  openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");

    // Session init ONLY (no instructions yet)
    safeSend({
      type: "session.update",
      session: {
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "verse",
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          silence_duration_ms: 600,
        },
        tools: [saveDealDataTool],
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

    // VAD: rep stopped speaking => request next model response (debounced)
    if (response.type === "input_audio_buffer.speech_stopped") {
      const now = Date.now();
      if (now - lastSpeechStoppedAt < 700) return;
      lastSpeechStoppedAt = now;

      console.log("🗣️ VAD: speech_stopped -> response.create");
      kickModel("speech_stopped");
    }

    try {
      // Tool call args complete
      if (response.type === "response.function_call_arguments.done") {
        const callId = response.call_id;

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
          `🧾 SAVE ROUTE dealIndex=${currentDealIndex}/${Math.max(
            dealQueue.length - 1,
            0
          )} id=${deal.id} account="${deal.account_name}" callId=${callId}`
        );
        console.log("🔎 args keys:", Object.keys(argsParsed.json));
        console.log(
          "🔎 args preview:",
          compact(argsParsed.json, [
            "pain_score","metrics_score","champion_score","eb_score",
            "criteria_score","process_score","competition_score","paper_score","timing_score",
            "risk_summary","rep_comments",
          ])
        );

        await handleFunctionCall({ ...argsParsed.json, _deal: deal }, callId);

        // Keep local memory aligned so computeFirstGap stays stable
        applyArgsToLocalDeal(deal, argsParsed.json);

        // Ack tool output to keep model flowing
        safeSend({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ status: "success" }),
          },
        });

        // Give the model a nudge to continue talking after tool call
        kickModel("post_tool_continue");
      }

      // Response done: check for NEXT_DEAL_TRIGGER
      if (response.type === "response.done") {
        const transcript = (
          response.response?.output
            ?.flatMap((o) => o.content || [])
            .map((c) => c.transcript || c.text || "")
            .join(" ") || ""
        );

        if (transcript.includes("NEXT_DEAL_TRIGGER")) {
          console.log("🚀 NEXT_DEAL_TRIGGER detected. Advancing deal...");
          currentDealIndex++;

          if (currentDealIndex < dealQueue.length) {
            const nextDeal = dealQueue[currentDealIndex];
            console.log(`👉 Context switch -> id=${nextDeal.id} account="${nextDeal.account_name}"`);

            const instructions = getSystemPrompt(
              nextDeal,
              (repName || "Rep").split(" ")[0]
            );

            instructionsReady = false;
            safeSend({ type: "session.update", session: { instructions } });
            instructionsReady = true;

            setTimeout(() => kickModel("next_deal_first_question"), 250);
          } else {
            console.log("🏁 All deals done.");
          }
        }
      }

      // Audio out (model -> Twilio)
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
    }
  });

  /// ---------------- Twilio inbound frames (rep audio) ----------------
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

        console.log("🎬 Stream started:", streamSid);
        console.log(`🔎 Rep: ${repName} | orgId=${orgId}`);

        await attemptLaunch();
      }

      if (data.event === "media" && data.media?.payload && openAiReady) {
        safeSend({
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
    if (!openAiReady || !repName) return;

    if (dealQueue.length === 0) {
      const result = await pool.query(
        `
        SELECT o.*, org.product_truths AS org_product_data
        FROM opportunities o
        JOIN organizations org ON o.org_id = org.id
        WHERE o.org_id = $1
          AND o.rep_name = $2
          AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost')
        ORDER BY o.id ASC
        `,
        [orgId, repName]
      );

      dealQueue = result.rows;
      currentDealIndex = 0;

      console.log(`📊 Loaded ${dealQueue.length} deals for ${repName}`);
      if (dealQueue[0]) {
        console.log(`👉 Starting deal -> id=${dealQueue[0].id} account="${dealQueue[0].account_name}"`);
      }
    }

    if (dealQueue.length === 0) {
      console.log("⚠️ No active deals found for this rep.");
      return;
    }

    const deal = dealQueue[currentDealIndex];

    // IMPORTANT: instructions must be set BEFORE we kick response.create
    const instructions = getSystemPrompt(
      deal,
      (repName || "Rep").split(" ")[0]
    );

    instructionsReady = false;
    safeSend({ type: "session.update", session: { instructions } });
    instructionsReady = true;

    setTimeout(() => kickModel("first_question"), 250);
  }
});

/// ============================================================================
/// START
/// ============================================================================
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
