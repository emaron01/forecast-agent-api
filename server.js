// server.js (ES module)
// Forecast Agent Conductor: Twilio <Stream> + OpenAI Realtime + deal queue + tool routing.
// - server.js is READ-ONLY to DB (writes happen in db.js via muscle.js)
// - /debug/opportunities is for your local dashboard and can be removed later.

import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { Pool } from "pg";

import { handleFunctionCall } from "./muscle.js";

/// ============================================================================
/// SECTION 1: CONFIG
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

function computeFirstGap(deal, stage) {
  const stageStr = String(stage || deal?.forecast_stage || "Pipeline");

  // Pipeline: FOUNDATION FIRST (no Paper/Legal questions)
  const pipelineOrder = [
    { name: "Pain", key: "pain_score", val: deal.pain_score },
    { name: "Metrics", key: "metrics_score", val: deal.metrics_score },
    { name: "Champion", key: "champion_score", val: deal.champion_score },
    { name: "Competition", key: "competition_score", val: deal.competition_score },
    { name: "Timing", key: "timing_score", val: deal.timing_score },
    { name: "Economic Buyer", key: "eb_score", val: deal.eb_score },
    { name: "Decision Criteria", key: "criteria_score", val: deal.criteria_score },
    // Intentionally omit Process + Paper in Pipeline mode
  ];

  // Best Case: test gaps that block Commit
  const bestCaseOrder = [
    { name: "Economic Buyer", key: "eb_score", val: deal.eb_score },
    { name: "Decision Criteria", key: "criteria_score", val: deal.criteria_score },
    { name: "Decision Process", key: "process_score", val: deal.process_score },
    { name: "Competition", key: "competition_score", val: deal.competition_score },
    { name: "Paper Process", key: "paper_score", val: deal.paper_score },
    { name: "Timing", key: "timing_score", val: deal.timing_score },
    { name: "Champion", key: "champion_score", val: deal.champion_score },
    { name: "Pain", key: "pain_score", val: deal.pain_score },
    { name: "Metrics", key: "metrics_score", val: deal.metrics_score },
  ];

  // Commit: de-risk; Paper + EB are non-negotiable
  const commitOrder = [
    { name: "Paper Process", key: "paper_score", val: deal.paper_score },
    { name: "Economic Buyer", key: "eb_score", val: deal.eb_score },
    { name: "Decision Process", key: "process_score", val: deal.process_score },
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

  // first category with score < 3, else return first item
  return order.find((s) => scoreNum(s.val) < 3) || order[0];
}

function applyArgsToLocalDeal(deal, args) {
  // Keep local memory aligned with DB so gap logic stays stable.
  // Only copy keys that were actually provided.
  for (const [k, v] of Object.entries(args || {})) {
    if (v !== undefined) deal[k] = v;
  }
}

/// ============================================================================
/// SECTION 4: EXPRESS APP
/// ============================================================================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // REQUIRED for Twilio

app.get("/", (req, res) => res.send("✅ Forecast Agent API is alive!"));

/// ============================================================================
/// SECTION 5: TWILIO WEBHOOK: identify rep by caller phone -> return TwiML to open WS
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
/// SECTION 5B: DEBUG / DASHBOARD SUPPORT (READ-ONLY + LOCAL CORS)
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
/// SECTION 7: OpenAI Tool Schema (save_deal_data) — HARD SCORE GUARDRAILS
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

      // optional; muscle.js computes deterministically anyway
      risk_summary: { type: "string" },

      next_steps: { type: "string" },
      rep_comments: { type: "string" },
    },
    required: [],
  },
};

/// ============================================================================
/// SECTION 8: System Prompt Builder (getSystemPrompt) — SALES-LEADER + STAGE SMART
/// ============================================================================
function getSystemPrompt(deal, repFirstName) {
  const runCount = Number(deal.run_count) || 0;
  const isNewDeal = runCount === 0;

  const amountStr = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(deal.amount || 0));

  const closeDateStr = deal.close_date ? new Date(deal.close_date).toLocaleDateString() : "TBD";
  const stage = deal.forecast_stage || "Pipeline";

  const oppName = (deal.opportunity_name || "").trim();
  const oppNamePart = oppName ? ` — ${oppName}` : "";

  // MANDATORY opening (user-specified)
  const openingLine = `Let’s look at ${deal.account_name}${oppNamePart} — ${stage}, ${amountStr}, closing ${closeDateStr}.`;

  // Stage strategy (your prior logic, made explicit)
  let stageMode = "";
  let stageConstraints = "";

  if (String(stage).includes("Commit")) {
    stageMode = "MODE: CLOSING ASSISTANT (Commit). Goal: Protect the forecast (de-risk).";
    stageConstraints =
      "Scan for ANY category scored 0-2 and challenge the Commit placement. " +
      "Paper Process and EB must be solid 3s; if not, the forecast is at risk.";
  } else if (String(stage).includes("Best Case")) {
    stageMode = "MODE: DEAL STRATEGIST (Best Case). Goal: Validate the upside.";
    stageConstraints =
      "Test the gaps that block Commit. Focus on EB access, process, paper, and competitive edge.";
  } else {
    stageMode = "MODE: PIPELINE ANALYST (Pipeline). Goal: Qualify or disqualify.";
    stageConstraints =
      "FOUNDATION FIRST: validate Pain, Metrics, and Champion. " +
      "Constraint: IGNORE paperwork/legal (do not ask about contracts).";
  }

  // Determine the single next category to ask about
  const firstGap = computeFirstGap(deal, stage);
  const gapQuestion = (() => {
    // Pipeline: avoid vague “what changed” and keep it category-specific and smart
    if (String(stage).includes("Pipeline")) {
      if (firstGap.name === "Pain") return "What is the specific business problem, and what is the quantified impact if it’s not fixed?";
      if (firstGap.name === "Metrics") return "What measurable outcome has the customer agreed they need, and who validated it?";
      if (firstGap.name === "Champion") return "Who is driving this internally, what is their title, and how have they demonstrated advocacy?";
      if (firstGap.name === "Competition") return "Who are we up against, and what is the customer’s stated preference right now?";
      if (firstGap.name === "Timing") return "What event or deadline makes this urgent, and what happens if it slips?";
      if (firstGap.name === "Economic Buyer") return "Who is the Economic Buyer, and do you have direct access or an agreed path to them?";
      if (firstGap.name === "Decision Criteria") return "What decision criteria will the customer use, and do we know what ‘good’ looks like to them?";
    }

    // Best Case / Commit: use “gap challenge” phrasing
    if (String(stage).includes("Commit")) {
      return `This is in Commit — what is the current status of ${firstGap.name}, and what evidence do we have?`;
    }
    if (String(stage).includes("Best Case")) {
      return `What is the latest on ${firstGap.name}, and what would need to happen to strengthen it to a 3?`;
    }

    // Fallback (shouldn’t happen)
    return `What is the latest on ${firstGap.name}?`;
  })();

  // Optional recall line (single sentence) to re-orient the rep without “coaching”
  const recallBits = [];
  if (deal.pain_summary) recallBits.push(`Pain: ${deal.pain_summary}`);
  if (deal.metrics_summary) recallBits.push(`Metrics: ${deal.metrics_summary}`);
  if (deal.champion_summary) recallBits.push(`Champion: ${deal.champion_summary}`);
  const recallLine = recallBits.length > 0 ? `Last review notes: ${recallBits.slice(0, 3).join(" | ")}.` : "";

  return `
### ROLE
You are Matthew, a sales-leader MEDDPICC auditor. You extract facts for a scorecard. You are NOT a coach.

### HARD CONTEXT (NON-NEGOTIABLE)
You are auditing exactly:
- DEAL_ID: ${deal.id}
- ACCOUNT_NAME: ${deal.account_name}
- OPPORTUNITY_NAME: ${oppName || "(none)"}
Never use any other company or opportunity name unless the rep explicitly corrects the deal identity.

### STAGE STRATEGY
${stageMode}
${stageConstraints}

### DEAL OPENING (MANDATORY)
At the start of this deal, you MUST say exactly:
"${openingLine}"

${recallLine ? `After the opening line, you MUST say exactly:\n"${recallLine}"` : ""}

### CONVERSATIONAL CADENCE (NON-ROBOTIC, NOT CHATTY)
- You ask ONE question at a time.
- You wait for the rep’s answer.
- You do NOT rapid-fire multiple questions in one turn.
- You do NOT summarize the rep aloud. (Summaries go into the scorecard via tool.)
- You do NOT “manage” the rep (no “keep me posted”, no “good job”, no bossy language).

### TOOL USE (CRITICAL)
After EACH rep answer:
1) Update the scorecard by calling save_deal_data SILENTLY (no spoken preface).
2) Then ask the next single best question.

### SCORING RUBRIC (0-3 ONLY)
PAIN: 0=None, 1=Vague, 2=Clear, 3=Quantified ($$$).
METRICS: 0=Unknown, 1=Soft, 2=Rep-defined, 3=Customer-validated.
CHAMPION: 0=None, 1=Coach, 2=Mobilizer, 3=Champion (Power).
EB: 0=Unknown, 1=Identified, 2=Indirect, 3=Direct relationship.
CRITERIA: 0=Unknown, 1=Vague, 2=Defined, 3=Locked in favor.
PROCESS: 0=Unknown, 1=Assumed, 2=Understood, 3=Documented.
COMPETITION: 0=Unknown, 1=Assumed, 2=Identified, 3=Known edge.
PAPER: 0=Unknown, 1=Not started, 2=Known Started, 3=Waiting for Signature.
TIMING: 0=Unknown, 1=Assumed, 2=Flexible, 3=Real Consequence/Event.

### DATA ENTRY RULES (SCORECARD)
- Summaries must be: "Label: evidence" (NO score numbers).
- Tips: one concrete next step to reach Score 3.
- POWER PLAYERS: extract Name AND Title for Champion and Economic Buyer when relevant.
- Do not overwrite existing evidence with blanks.

### NEXT QUESTION (MANDATORY)
Your next spoken line MUST be exactly this ONE question:
"${gapQuestion}"

### COMPLETION
Only when ready to leave the deal, say:
"Health Score: [Sum]/27. Risk: [Top Risk]. NEXT_DEAL_TRIGGER."
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

  // Turn-control stability (prevents speech_stopped -> response.create storms)
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

    // Session init: ulaw + voice + VAD + tools (make VAD less twitchy)
    safeSend(openAiWs, {
      type: "session.update",
      session: {
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "verse",
        turn_detection: {
          type: "server_vad",
          threshold: 0.6,            // stricter = fewer false stops
          silence_duration_ms: 1100, // longer pause = fewer cutoffs / storms
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

    // VAD breadcrumbs + kick model after rep stops talking (STABLE GATING)
    if (response.type === "input_audio_buffer.speech_started") {
      console.log("🗣️ VAD: speech_started");
      sawSpeechStarted = true;
    }

    if (response.type === "input_audio_buffer.speech_stopped") {
      console.log("🗣️ VAD: speech_stopped");

      // Gate #1: ignore speech_stopped unless we saw speech_started
      if (!sawSpeechStarted) return;
      sawSpeechStarted = false;

      // Gate #2: debounce to prevent storms
      const now = Date.now();
      if (now - lastSpeechStoppedAt < 1200) return;
      lastSpeechStoppedAt = now;

      // Gate #3: don't create a new response if one is already running
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
          `🧾 SAVE ROUTE dealIndex=${currentDealIndex}/${Math.max(dealQueue.length - 1, 0)} id=${deal.id} account="${deal.account_name}" callId=${callId}`
        );
        console.log("🔎 args keys:", Object.keys(argsParsed.json));
        console.log(
          "🔎 args preview:",
          compact(argsParsed.json, [
            "pain_score",
            "metrics_score",
            "champion_score",
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

        // Save (muscle/db will clamp + compute risk deterministically)
        await handleFunctionCall({ ...argsParsed.json, _deal: deal }, callId);

        // Keep local memory in sync so next gap question is correct
        applyArgsToLocalDeal(deal, argsParsed.json);

        // Ack tool output to keep model flowing
        safeSend(openAiWs, {
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ status: "success" }),
          },
        });

        // Important: let model continue naturally after the tool
        awaitingModel = false;
        kickModel("post_tool_continue");
      }

      // Response done: release lock + check for NEXT_DEAL_TRIGGER
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

            const instructions = getSystemPrompt(nextDeal, (repName || "Rep").split(" ")[0]);

            safeSend(openAiWs, {
              type: "session.update",
              session: { instructions },
            });

            // Ask first question for next deal
            setTimeout(() => {
              awaitingModel = false;
              kickModel("next_deal_first_question");
            }, 350);
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
      awaitingModel = false;
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
        // Rep audio -> OpenAI buffer
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
    const instructions = getSystemPrompt(deal, (repName || "Rep").split(" ")[0]);

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
