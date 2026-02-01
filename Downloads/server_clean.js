// server.js (ES module)
// Forecast Agent Conductor: Twilio <Stream> + OpenAI Realtime + deal queue + tool routing.
//
// LOCKED INTENT
// - Incremental saves per category (Option A)
// - Backend (muscle.js) is deterministic: scoring bounds, summary normalization (Label+Criteria+Evidence), risk, forecast
// - Score labels + criteria come from score_definitions (DB), model provides evidence only
// - MEDDPICC+TB (adds Timing + Budget) = 10 categories, max score 30
// - Only review_now = TRUE opportunities are reviewed
// - Pipeline questioning focuses ONLY on Pain / Metrics / Champion / Budget (no paper/legal/procurement)

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
 * - No Paper/Legal/Procurement in Pipeline.
 */
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
    { name: "Budget", key: "budget_score", val: deal.budget_score },
    { name: "Competition", key: "competition_score", val: deal.competition_score },
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
///  MEDDPICC+TB includes Budget
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

      // stored, not debated live
      next_steps: { type: "string" },
      rep_comments: { type: "string" },
    },
    required: [],
  },
};

/// ============================================================================
/// SECTION 8: System Prompt Builder (getSystemPrompt)
/// ============================================================================
function getSystemPrompt(deal, repName, totalCount, isFirstDeal) {
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

  // ☎️ CALL OPENING (MANDATORY — SAY EXACTLY)
  const callPickup = `Hi ${repName}. Matthew here.
We’re reviewing ${totalCount} deals today.
First up: ${deal.account_name}${oppNamePart}, ${stage}, ${amountStr}, closing ${closeDateStr}.`;

  // 🧭 DEAL OPENING (MANDATORY — EVERY DEAL)
  const dealOpening = `Let’s look at ${deal.account_name}${oppNamePart}, ${stage}, ${amountStr}, closing ${closeDateStr}.`;

  // 🧱 STAGE-SPECIFIC STRATEGY (STRICT)
  let stageMode = "";
  let stageFocus = "";
  let stageRules = "";

  if (String(stage).includes("Commit")) {
    stageMode = "MODE: CLOSING ASSISTANT (COMMIT)";
    stageFocus =
      "FOCUS: Paper process, signature authority (EB), decision process, budget approved/allocated.";
    stageRules =
      "Logic: If any of these are weak, the deal does NOT belong in Commit. Do not hope — verify.";
  } else if (String(stage).includes("Best Case")) {
    stageMode = "MODE: DEAL STRATEGIST (BEST CASE)";
    stageFocus =
      "FOCUS: Economic Buyer access, decision process, paper readiness, competitive position, budget confirmation.";
    stageRules =
      "Logic: Identify gaps keeping the deal out of Commit. Probe readiness without pressure.";
  } else {
    stageMode = "MODE: PIPELINE ANALYST (PIPELINE)";
    stageFocus = "FOCUS ONLY: Pain, Metrics, Champion, Budget.";
    stageRules =
      "RULES: Do NOT ask about paper process, legal, contracts, or procurement. Do NOT force completeness. Do NOT act late-stage.";
  }

  // 🔄 Flow: brief recall (1 sentence max)
  const recallBits = [];
  if (deal.pain_summary) recallBits.push(`Pain: ${deal.pain_summary}`);
  if (deal.metrics_summary) recallBits.push(`Metrics: ${deal.metrics_summary}`);
  if (deal.champion_summary) recallBits.push(`Champion: ${deal.champion_summary}`);
  if (deal.budget_summary) recallBits.push(`Budget: ${deal.budget_summary}`);

  const recallLine =
    recallBits.length > 0
      ? `Last review: ${recallBits.slice(0, 3).join(" | ")}.`
      : "Last review: no prior notes captured.";

  const firstGap = computeFirstGap(deal, stage);

  const gapQuestion = (() => {
    // Pipeline: strictly foundation
    if (String(stage).includes("Pipeline")) {
      if (firstGap.name === "Pain")
        return "What specific business problem is the customer trying to solve, and what happens if they do nothing?";
      if (firstGap.name === "Metrics")
        return "What measurable outcome has the customer agreed matters, and who validated it?";
      if (firstGap.name === "Champion")
        return "Who is driving this internally, what is their role, and how have they shown advocacy?";
      if (firstGap.name === "Budget")
        return "Has budget been discussed or confirmed, and at what level?";
      return `What changed since last time on ${firstGap.name}?`;
    }

    // Best Case / Commit: validate readiness and close gaps
    if (String(stage).includes("Commit")) {
      return `This is Commit — what evidence do we have that ${firstGap.name} is fully locked?`;
    }
    if (String(stage).includes("Best Case")) {
      return `What would need to happen to strengthen ${firstGap.name} to a clear 3?`;
    }

    return `What is the latest on ${firstGap.name}?`;
  })();

  return `
SYSTEM PROMPT — SALES LEADER FORECAST REVIEW AGENT
You are Matthew, a calm, credible, experienced enterprise sales leader.
Your role is to review live opportunities with a sales rep in order to:
• Improve forecast accuracy
• Strengthen deal rigor
• Identify and mitigate risk early

You are not a boss, not chatty, and not transactional.
You do not give pep talks, ultimatums, or status requests.
Your job is to ask smart questions, listen carefully, and update the scorecard.
All coaching, evaluation, scoring, and recommendations belong in the scorecard, not spoken aloud.

HARD CONTEXT (NON-NEGOTIABLE)
You are reviewing exactly:
- DEAL_ID: ${deal.id}
- ACCOUNT_NAME: ${deal.account_name}
- OPPORTUNITY_NAME: ${oppName || "(none)"}
Never change deal identity unless the rep explicitly corrects it.

☎️ CALL OPENING (MANDATORY — SAY EXACTLY)
${isFirstDeal ? `At the very start of the call, say exactly:\n"${callPickup}"\nPause briefly, then continue.` : "Do NOT repeat the call opening."}

🧭 DEAL OPENING (MANDATORY — EVERY DEAL)
At the start of every deal, say exactly:
"${dealOpening}"
Then proceed.

🧠 HOW YOU THINK (IMPORTANT)
• You already have the current scorecard (scores, summaries, stage, and risk).
• Your job is to validate what changed and close gaps.
• If nothing changed, say nothing judgmental — just record it.

🔄 GENERAL FLOW (ALL STAGES)
1. Briefly recall what we knew last time (1 sentence max)
2. Ask one clear question at a time
3. Wait for the rep to finish speaking
4. Update the scorecard
5. Move on
Never rapid-fire questions. Never interrupt.

RECALL (MANDATORY — 1 sentence max)
After the deal opening line, say exactly:
"${recallLine}"

🧱 STAGE-SPECIFIC STRATEGY (STRICT)
${stageMode}
${stageFocus}
${stageRules}

🧮 SCORING RULES (CRITICAL)
• You do not invent labels or criteria.
• All labels and criteria come from the scorecard definitions.
• You only decide: which score applies and what evidence supports it.
Every summary must follow:
Label: Criteria. Evidence: what the rep said.
If evidence is weak or unclear:
• Score lower
• Capture uncertainty
• Do not argue with the rep

⚠️ RISK
You do not verbally speculate about risk.
Risk is calculated automatically and recorded in the scorecard.

📝 SAVING BEHAVIOR
• Update the scorecard incrementally after each rep answer.
• Assume the call could end at any time.
If needed, you may say: "Got it — I’m updating the scorecard."
Do not narrate scores or math.

🧠 TONE & CULTURE (DO NOT VIOLATE)
• Supportive • Curious • Calm • Sales-savvy
• Never condescending • Never robotic
• Never managerial ("keep me posted", "circle back", etc.)

🚫 HARD NOs
• No scripts • No lecturing • No pressure • No buzzwords
• No fake enthusiasm • No making up answers
• No forcing categories when irrelevant

✅ TOOL USE (CRITICAL)
After EACH rep answer:
1) Call save_deal_data silently (no spoken preface).
2) Then ask the next single best question.

NEXT SPOKEN LINE (MANDATORY)
Your next spoken line MUST be exactly:
"${gapQuestion}"

🏁 END OF DEAL
When finished with a deal, say:
"Okay — let’s move to the next one. NEXT_DEAL_TRIGGER"
You MUST say NEXT_DEAL_TRIGGER to advance.
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

  let dealQueue = [];
  let currentDealIndex = 0;
  let openAiReady = false;

  // Turn-control stability
  let awaitingModel = false;
  let sawSpeechStarted = false;
  let lastSpeechStoppedAt = 0;

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

  function kickModel(reason) {
    if (awaitingModel) return;
    awaitingModel = true;
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
        turn_detection: {
          type: "server_vad",
          threshold: 0.6,
          silence_duration_ms: 1100,
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

    if (response.type === "input_audio_buffer.speech_started") {
      console.log("🗣️ VAD: speech_started");
      sawSpeechStarted = true;
    }

    if (response.type === "input_audio_buffer.speech_stopped") {
      console.log("🗣️ VAD: speech_stopped");

      if (!sawSpeechStarted) return;
      sawSpeechStarted = false;

      const now = Date.now();
      if (now - lastSpeechStoppedAt < 1200) return;
      lastSpeechStoppedAt = now;

      kickModel("speech_stopped");
    }

    try {
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
            "rep_comments",
          ])
        );

        await handleFunctionCall({ ...argsParsed.json, _deal: deal }, callId);
        applyArgsToLocalDeal(deal, argsParsed.json);

        safeSend(openAiWs, {
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ status: "success" }),
          },
        });

        awaitingModel = false;
        kickModel("post_tool_continue");
      }

      if (response.type === "response.done") {
        awaitingModel = false;

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
              repName || "Rep",
              dealQueue.length,
              false // only first deal gets call pickup
            );

            safeSend(openAiWs, {
              type: "session.update",
              session: { instructions },
            });

            setTimeout(() => {
              awaitingModel = false;
              kickModel("next_deal_first_question");
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

        console.log("🎬 Stream started:", streamSid);
        console.log(`🔎 Rep: ${repName} | orgId=${orgId}`);

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

    // FIRST DEAL: include call pickup
    const instructions = getSystemPrompt(deal, repName, dealQueue.length, true);

    safeSend(openAiWs, {
      type: "session.update",
      session: { instructions },
    });

    setTimeout(() => {
      awaitingModel = false;
      kickModel("first_question");
    }, 350);
  }
});

/// ============================================================================
/// SECTION 10: START
/// ============================================================================
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
