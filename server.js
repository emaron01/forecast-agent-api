// server.js (ES module)
// Minimal “clean restore” of: greeting + prompt discipline + deal loading + tool wiring + NEXT_DEAL_TRIGGER
// Works with Twilio <Stream> WebSocket + OpenAI Realtime

import "dotenv/config";
import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { Pool } from "pg";

import { handleFunctionCall } from "./muscle.js";

const PORT = process.env.PORT || 10000;

// Expect these env vars (Render-friendly)
const MODEL_URL = process.env.MODEL_API_URL || "wss://api.openai.com/v1/realtime";
const MODEL_NAME = process.env.MODEL_NAME || "gpt-4o-realtime-preview-2024-10-01";
const OPENAI_API_KEY = process.env.MODEL_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!OPENAI_API_KEY) throw new Error("Missing MODEL_API_KEY");
if (!DATABASE_URL) throw new Error("Missing DATABASE_URL");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // REQUIRED for Twilio

app.get("/", (req, res) => res.send("✅ Forecast Agent API is alive!"));

// --- SMART RECEPTIONIST: Twilio POST webhook -> returns TwiML that opens the WS stream
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

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/** Tool schema (reuse of your old monolith, slightly cleaned). */
const saveDealDataTool = {
  type: "function",
  name: "save_deal_data",
  description:
    "Call immediately after every user response to save updated MEDDPICC scores/summaries/tips/risk/next steps.",
  parameters: {
    type: "object",
    properties: {
      pain_score: { type: "number" },
      pain_summary: { type: "string" },
      pain_tip: { type: "string" },

      metrics_score: { type: "number" },
      metrics_summary: { type: "string" },
      metrics_tip: { type: "string" },

      champion_score: { type: "number" },
      champion_summary: { type: "string" },
      champion_tip: { type: "string" },
      champion_name: { type: "string" },
      champion_title: { type: "string" },

      eb_score: { type: "number" },
      eb_summary: { type: "string" },
      eb_tip: { type: "string" },
      eb_name: { type: "string" },
      eb_title: { type: "string" },

      criteria_score: { type: "number" },
      criteria_summary: { type: "string" },
      criteria_tip: { type: "string" },

      process_score: { type: "number" },
      process_summary: { type: "string" },
      process_tip: { type: "string" },

      competition_score: { type: "number" },
      competition_summary: { type: "string" },
      competition_tip: { type: "string" },

      paper_score: { type: "number" },
      paper_summary: { type: "string" },
      paper_tip: { type: "string" },

      timing_score: { type: "number" },
      timing_summary: { type: "string" },
      timing_tip: { type: "string" },

      risk_summary: { type: "string" },
      next_steps: { type: "string" },
      rep_comments: { type: "string" },
    },
    required: ["risk_summary"],
  },
};

function getSystemPrompt(deal, repName, dealsLeft, totalCount) {
  const runCount = Number(deal.run_count) || 0;
  const isNewDeal = runCount === 0;
  const amountStr = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(deal.amount || 0);

  const closeDateStr = deal.close_date
    ? new Date(deal.close_date).toLocaleDateString()
    : "TBD";

  // session start detection (kept from your old logic)
  const isSessionStart =
    dealsLeft === totalCount - 1 || dealsLeft === totalCount;

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

  const firstGap = scores.find((s) => (Number(s.val) || 0) < 3) || {
    name: "Pain",
  };

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
2. **IGNORE LEGACY NOISE:** If existing notes mention a different company, DISREGARD those names. Use ONLY the current {{account_name}}.
3. **CONFLICT RESOLUTION:** If DB notes conflict with the user's truth, overwrite notes with user's truth.
4. **CLEANSE ON SAVE:** Every time you call 'save_deal_data', purge summaries/tips of legacy company names.

### THE "JUDGE & SAVE" PROTOCOL (STRICT)
1. **EVERY RESPONSE COUNTS:** After every user response, you MUST call 'save_deal_data'.
2. **DON'T BE SHY:** Even vague answers get a Score 1.
3. **MULTI-SAVE:** Update multiple categories in one tool call if mentioned.
4. **SILENT AUDITOR:** Do NOT tell the user you are saving.

### SCORING RUBRIC (EXACT DEFINITIONS)
- **PAIN:** 0=None, 1=Vague, 2=Clear, 3=Quantified ($$$).
- **METRICS:** 0=Unknown, 1=Soft, 2=Rep-defined, 3=Customer-validated.
- **CHAMPION:** 0=None, 1=Coach, 2=Mobilizer, 3=Champion (Power).
- **EB:** 0=Unknown, 1=Identified, 2=Indirect, 3=Direct relationship.
- **CRITERIA:** 0=Unknown, 1=Vague, 2=Defined, 3=Locked in favor.
- **PROCESS:** 0=Unknown, 1=Assumed, 2=Understood, 3=Documented.
- **COMPETITION:** 0=Unknown, 1=Assumed, 2=Identified, 3=Known edge.
- **PAPER:** 0=Unknown, 1=Not started, 2=Known Started, 3=Waiting for Signature.
- **TIMING:** 0=Unknown, 1=Assumed, 2=Flexible, 3=Real Consequence/Event.

### DATA EXTRACTION RULES
- **SUMMARIES:** Start every summary field with: "Score X (Label): ..."
- **TIPS:** Provide a specific next step to reach Score 3.
- **POWER PLAYERS:** Extract Name AND Title for Champion and Economic Buyer.

### COMPLETION PROTOCOL (STRICT)
**ONLY** when ready to leave the deal:
1. CHECK: Did I save the scores?
2. SAY: "Health Score: [Sum]/27. Risk: [Top Risk]. NEXT_DEAL_TRIGGER."

**CRITICAL:** You MUST say the exact phrase "NEXT_DEAL_TRIGGER" to advance.
`.trim();
}

wss.on("connection", async (twilioWs) => {
  console.log("🔥 Twilio WebSocket connected");

  // Per-call state
  let streamSid = null;
  let orgId = 1;
  let repName = null;
  let dealQueue = [];
  let currentDealIndex = 0;
  let openAiReady = false;

  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");

    // ✅ Restore session init (voice + ulaw + VAD)
    openAiWs.send(
      JSON.stringify({
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
        },
      })
    );

    openAiReady = true;
    attemptLaunch().catch((e) => console.error("❌ attemptLaunch error:", e));
  });

  openAiWs.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);

      // --- TOOL CALL ARGS DONE -> run muscle + ack tool output
      if (msg.type === "response.function_call_arguments.done") {
        const args = JSON.parse(msg.arguments || "{}");
        const callId = msg.call_id;

        const deal = dealQueue[currentDealIndex];
        if (!deal) {
          console.warn("⚠️ Tool call received but no active deal.");
          return;
        }

        // Fire and forget save logic (don’t stall conversation)
        handleFunctionCall({ ...args, _deal: deal }, callId).catch((e) =>
          console.error("❌ handleFunctionCall failed:", e)
        );

        // ✅ Always acknowledge tool output so the model continues smoothly
        openAiWs.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify({ status: "success" }),
            },
          })
        );

        // ✅ Nudge the model to speak (prevents dead air)
        openAiWs.send(JSON.stringify({ type: "response.create" }));
      }

      // --- DONE -> check for NEXT_DEAL_TRIGGER and advance
      if (msg.type === "response.done") {
        const transcript =
          msg.response?.output?.[0]?.content?.[0]?.transcript ||
          msg.response?.output
            ?.flatMap((o) => o.content || [])
            .map((c) => c.transcript || c.text || "")
            .join(" ") ||
          "";

        if (transcript.includes("NEXT_DEAL_TRIGGER")) {
          console.log("🚀 NEXT_DEAL_TRIGGER detected -> advance deal");

          currentDealIndex++;
          if (currentDealIndex < dealQueue.length) {
            const nextDeal = dealQueue[currentDealIndex];
            const instructions = getSystemPrompt(
              nextDeal,
              repName.split(" ")[0],
              dealQueue.length - 1 - currentDealIndex,
              dealQueue.length
            );

            openAiWs.send(
              JSON.stringify({
                type: "session.update",
                session: { instructions },
              })
            );

            setTimeout(
              () => openAiWs.send(JSON.stringify({ type: "response.create" })),
              400
            );
          } else {
            console.log("🏁 All deals complete.");
          }
        }
      }

      // --- AUDIO OUT -> Twilio
      if (msg.type === "response.audio.delta" && msg.delta && streamSid) {
        twilioWs.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: msg.delta },
          })
        );
      }
    } catch (err) {
      console.error("❌ OpenAI Message Error:", err);
    }
  });

  // Twilio inbound audio/messages
  twilioWs.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.event === "start") {
        streamSid = msg.start?.streamSid || msg.streamSid || null;

        const params = msg.start?.customParameters || {};
        orgId = parseInt(params.org_id, 10) || 1;
        repName = params.rep_name || "Guest";

        console.log(`🎬 Stream started: ${streamSid}`);
        console.log(`🔎 Rep: ${repName} | orgId=${orgId}`);

        await attemptLaunch();
      }

      if (msg.event === "media" && msg.media?.payload && openAiReady) {
        // ✅ Correct OpenAI realtime input message (matching your working monolith)
        openAiWs.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: msg.media.payload, // already base64 ulaw
          })
        );
      }

      if (msg.event === "stop") {
        console.log("🛑 Stream stopped:", streamSid);
        streamSid = null;
      }
    } catch (e) {
      console.error("❌ Twilio WS message parse/error:", e);
    }
  });

  twilioWs.on("close", () => {
    console.log("🔌 Twilio WebSocket closed");
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
  });

  async function attemptLaunch() {
    if (!openAiReady || !repName) return;

    // Load deal queue ONLY once per call (or reload if empty)
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
        console.log(`👉 Starting with: ${dealQueue[0].account_name} (id=${dealQueue[0].id})`);
      }
    }

    if (dealQueue.length === 0) {
      console.log("⚠️ No active deals found.");
      return;
    }

    const firstDeal = dealQueue[currentDealIndex];
    const instructions = getSystemPrompt(
      firstDeal,
      repName.split(" ")[0],
      dealQueue.length - 1,
      dealQueue.length
    );

    // ✅ Provide instructions + tools
    openAiWs.send(
      JSON.stringify({
        type: "session.update",
        session: {
          instructions,
          tools: [saveDealDataTool],
        },
      })
    );

    setTimeout(() => openAiWs.send(JSON.stringify({ type: "response.create" })), 500);
  }
});
// --- DEBUG / DASHBOARD SUPPORT (READ-ONLY)
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


server.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
