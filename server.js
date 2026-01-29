// server.js (ES module)
// Conductor: Twilio + OpenAI Realtime session + deal queue + tool routing.
// Uses muscle.js for scoring and db.js for persistence (via muscle).

import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { Pool } from "pg";

import { handleFunctionCall } from "./muscle.js";

const PORT = process.env.PORT || 10000;

// Render env vars
const MODEL_URL = process.env.MODEL_API_URL;      // MUST be: wss://api.openai.com/v1/realtime
const MODEL_NAME = process.env.MODEL_NAME;        // Realtime model name
const OPENAI_API_KEY = process.env.MODEL_API_KEY; // API key
const DATABASE_URL = process.env.DATABASE_URL;

if (!MODEL_URL || !MODEL_NAME || !OPENAI_API_KEY) {
  throw new Error("⚠️ MODEL_API_URL, MODEL_NAME, and MODEL_API_KEY must be set in environment variables!");
}
if (!DATABASE_URL) {
  throw new Error("⚠️ DATABASE_URL must be set in environment variables!");
}

// --- PostgreSQL (read-only in server.js; writes happen via db.js called by muscle.js)
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --- Express server
const app = express();
app.use(express.json()); // for your own APIs
app.use(express.urlencoded({ extended: false })); // REQUIRED for Twilio

app.get("/", (req, res) => res.send("✅ Forecast Agent API is alive!"));

// --- SMART RECEPTIONIST: Twilio webhook -> returns TwiML that opens a WS audio stream
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
    console.error("❌ /agent error:", err);
    res.type("text/xml").send(
      `<Response><Connect><Stream url="wss://${req.headers.host}/" /></Connect></Response>`
    );
  }
});

// --- OPTIONAL DEBUG (remove later if you want)
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
    console.error("❌ /debug/opportunities error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- HTTP server (needed for WebSocket)
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
console.log("🌐 WebSocket server created");

// --- Tool schema the model uses to save deal updates
const saveDealDataTool = {
  type: "function",
  name: "save_deal_data",
  description: "Call immediately after every user response to save MEDDPICC updates.",
  parameters: {
    type: "object",
    properties: {
      pain_score: { type: "number" }, pain_summary: { type: "string" }, pain_tip: { type: "string" },
      metrics_score: { type: "number" }, metrics_summary: { type: "string" }, metrics_tip: { type: "string" },
      champion_score: { type: "number" }, champion_summary: { type: "string" }, champion_tip: { type: "string" },
      champion_name: { type: "string" }, champion_title: { type: "string" },
      eb_score: { type: "number" }, eb_summary: { type: "string" }, eb_tip: { type: "string" },
      eb_name: { type: "string" }, eb_title: { type: "string" },
      criteria_score: { type: "number" }, criteria_summary: { type: "string" }, criteria_tip: { type: "string" },
      process_score: { type: "number" }, process_summary: { type: "string" }, process_tip: { type: "string" },
      competition_score: { type: "number" }, competition_summary: { type: "string" }, competition_tip: { type: "string" },
      paper_score: { type: "number" }, paper_summary: { type: "string" }, paper_tip: { type: "string" },
      timing_score: { type: "number" }, timing_summary: { type: "string" }, timing_tip: { type: "string" },
      risk_summary: { type: "string" }, next_steps: { type: "string" }, rep_comments: { type: "string" }
    },
    required: ["risk_summary"]
  }
};

// --- System prompt (restores greeting + discipline from old monolith)
function getSystemPrompt(deal, repName, dealsLeft, totalCount) {
  const runCount = Number(deal.run_count) || 0;
  const isNewDeal = runCount === 0;

  const amountStr = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(deal.amount || 0);

  const closeDateStr = deal.close_date ? new Date(deal.close_date).toLocaleDateString() : "TBD";

  const isSessionStart = (dealsLeft === totalCount - 1) || (dealsLeft === totalCount);

  const scores = [
    { name: "Pain", val: deal.pain_score },
    { name: "Metrics", val: deal.metrics_score },
    { name: "Champion", val: deal.champion_score },
    { name: "Economic Buyer", val: deal.eb_score },
    { name: "Decision Criteria", val: deal.criteria_score },
    { name: "Decision Process", val: deal.process_score },
    { name: "Competition", val: deal.competition_score },
    { name: "Paper Process", val: deal.paper_score },
    { name: "Timing", val: deal.timing_score },
  ];

  const firstGap = scores.find(s => (Number(s.val) || 0) < 3) || { name: "Pain" };

  let openingLine = "";
  if (isSessionStart) {
    openingLine = `Hi ${repName}. Matthew here. We're reviewing ${totalCount} deals. First up: ${deal.account_name}.`;
  } else {
    openingLine = `Okay, saved. Next: ${deal.account_name}.`;
  }

  if (isNewDeal) {
    openingLine += ` ${amountStr}, closing ${closeDateStr}. New deal. What's the specific challenge we are solving?`;
  } else {
    openingLine += ` ${amountStr}. Last risk: "${deal.risk_summary || "None"}". Status on ${firstGap.name}?`;
  }

  return `
### ROLE
You are a **MEDDPICC Scorer**. Your job is to Listen, Judge, and Record.

### MANDATORY OPENING
You MUST open exactly with: "${openingLine}"
**CRITICAL:** Do NOT use the phrase "NEXT_DEAL_TRIGGER" in your opening line.

### THE "DATA INTEGRITY" PROTOCOL (MANDATORY)
1. **ACCOUNT IDENTITY IS SACROSANCT:** You are currently auditing {{account_name}}.
2. **IGNORE LEGACY NOISE:** If existing notes mention a different company, disregard those names. Use ONLY the current {{account_name}}.
3. **CONFLICT RESOLUTION:** If DB notes conflict with user's truth, overwrite notes with user's truth.
4. **CLEANSE ON SAVE:** Every time you call 'save_deal_data', purge summaries and tips of legacy company names.

### THE "JUDGE & SAVE" PROTOCOL (STRICT)
1. After every user response, you MUST call 'save_deal_data'.
2. Even vague answers get a Score 1.
3. Update multiple categories in one tool call if mentioned.
4. Do NOT tell the user you are saving.

### SCORING RUBRIC (EXACT DEFINITIONS)
- PAIN: 0=None, 1=Vague, 2=Clear, 3=Quantified ($$$).
- METRICS: 0=Unknown, 1=Soft, 2=Rep-defined, 3=Customer-validated.
- CHAMPION: 0=None, 1=Coach, 2=Mobilizer, 3=Champion (Power).
- EB: 0=Unknown, 1=Identified, 2=Indirect, 3=Direct relationship.
- CRITERIA: 0=Unknown, 1=Vague, 2=Defined, 3=Locked in favor.
- PROCESS: 0=Unknown, 1=Assumed, 2=Understood, 3=Documented.
- COMPETITION: 0=Unknown, 1=Assumed, 2=Identified, 3=Known edge.
- PAPER: 0=Unknown, 1=Not started, 2=Known Started, 3=Waiting for Signature.
- TIMING: 0=Unknown, 1=Assumed, 2=Flexible, 3=Real Consequence/Event.

### COMPLETION PROTOCOL (STRICT)
ONLY when ready to leave the deal:
Say: "Health Score: [Sum]/27. Risk: [Top Risk]. NEXT_DEAL_TRIGGER."
You MUST say the exact phrase NEXT_DEAL_TRIGGER to advance.
`.trim();
}

// --- WebSocket core: Twilio <Stream> <-> OpenAI Realtime
wss.on("connection", async (twilioWs) => {
  console.log("🔥 Twilio WebSocket connected");

  let streamSid = null;
  let orgId = 1;
  let repName = null;

  let dealQueue = [];
  let currentDealIndex = 0;

  let openAiReady = false;

  // Connect to OpenAI Realtime (MODEL_URL must be wss://.../v1/realtime)
  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  // Prevent “Unhandled error event” crashes
  openAiWs.on("error", (err) => {
    console.error("❌ OpenAI WebSocket error:", err?.message || err);
  });

  openAiWs.on("unexpected-response", (req, res) => {
    console.error("❌ OpenAI WS unexpected response:", res?.statusCode, res?.statusMessage);
    console.error("Headers:", res?.headers);
  });

  openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");

    // Session init: ulaw + voice + VAD
    openAiWs.send(JSON.stringify({
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
    }));

    openAiReady = true;
    attemptLaunch().catch((e) => console.error("❌ attemptLaunch error:", e));
  });

  openAiWs.on("message", (data) => {
    try {
      const response = JSON.parse(data);

      // Tool call arguments (save_deal_data)
      if (response.type === "response.function_call_arguments.done") {
        const args = JSON.parse(response.arguments || "{}");
        const callId = response.call_id;

        const deal = dealQueue[currentDealIndex];
        if (!deal) return;

        // IMPORTANT: pass current deal context into muscle for safe saving
        handleFunctionCall({ ...args, _deal: deal }, callId);

        // Acknowledge tool output to keep the model flowing
        openAiWs.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ status: "success" }),
          },
        }));

        // Force the model to speak
        openAiWs.send(JSON.stringify({ type: "response.create" }));
      }

      // When a response completes, check for NEXT_DEAL_TRIGGER
      if (response.type === "response.done") {
        const transcript = (
          response.response?.output
            ?.flatMap((o) => o.content || [])
            .map((c) => c.transcript || c.text || "") || []
        ).join(" ");

        if (transcript.includes("NEXT_DEAL_TRIGGER")) {
          console.log("🚀 NEXT_DEAL_TRIGGER detected. Advancing deal...");
          currentDealIndex++;

          if (currentDealIndex < dealQueue.length) {
            const nextDeal = dealQueue[currentDealIndex];
            const instructions = getSystemPrompt(
              nextDeal,
              repName.split(" ")[0],
              dealQueue.length - 1 - currentDealIndex,
              dealQueue.length
            );

            openAiWs.send(JSON.stringify({
              type: "session.update",
              session: { instructions },
            }));

            setTimeout(() => openAiWs.send(JSON.stringify({ type: "response.create" })), 500);
          } else {
            console.log("🏁 All deals done.");
          }
        }
      }

      // Audio out (model -> Twilio)
      if (response.type === "response.audio.delta" && response.delta && streamSid) {
        twilioWs.send(JSON.stringify({
          event: "media",
          streamSid,
          media: { payload: response.delta },
        }));
      }
    } catch (err) {
      console.error("❌ OpenAI Message Error:", err);
    }
  });

  // Twilio inbound WS (audio -> model)
  twilioWs.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);

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
        // IMPORTANT: Correct OpenAI Realtime input message
        openAiWs.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: data.media.payload, // base64 g711_ulaw
        }));
      }

      if (data.event === "stop") {
        console.log("🛑 Stream stopped:", streamSid);
        streamSid = null;
      }
    } catch (err) {
      console.error("❌ Twilio WS message error:", err);
    }
  });

  twilioWs.on("close", () => {
    console.log("🔌 Twilio WebSocket closed");
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
  });

  // Load deals + initialize the first instructions
  async function attemptLaunch() {
    if (!openAiReady || !repName) return;

    // Only load once per call
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
    }

    if (dealQueue.length === 0) {
      console.log("⚠️ No active deals found for this rep.");
      return;
    }

    const firstDeal = dealQueue[currentDealIndex];
    const instructions = getSystemPrompt(
      firstDeal,
      repName.split(" ")[0],
      dealQueue.length - 1,
      dealQueue.length
    );

    openAiWs.send(JSON.stringify({
      type: "session.update",
      session: { instructions },
    }));

    setTimeout(() => openAiWs.send(JSON.stringify({ type: "response.create" })), 500);
  }
});

// --- Start server
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
