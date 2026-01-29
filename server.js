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
  throw new Error("⚠️ MODEL_API_URL, MODEL_NAME, and MODEL_API_KEY must be set!");
}
if (!DATABASE_URL) {
  throw new Error("⚠️ DATABASE_URL must be set!");
}

// --- PostgreSQL (read-only in server.js; writes happen via db.js called by muscle.js)
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ----------------- Helpers: safer logging + parsing -----------------

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

// ----------------- Express server -----------------

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

// ============================================================
// DEBUG / DASHBOARD SUPPORT (READ-ONLY + LOCAL CORS)
// Remove this entire block when you no longer need the local dashboard.
// Allows browser dashboard at http://localhost:* to fetch from Render.
// ============================================================

app.use("/debug/opportunities", (req, res, next) => {
  const origin = req.headers.origin || "";
  if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
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
    console.error("❌ /debug/opportunities error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------- HTTP server + WS server -----------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
console.log("🌐 WebSocket server created");

// ----------------- Tool schema the model uses to save deal updates -----------------

const saveDealDataTool = {
  type: "function",
  name: "save_deal_data",
  description:
    "Call immediately after every user response to save MEDDPICC updates. Do NOT invent facts. Update only what user provided.",
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
      risk_summary: { type: "string" },
      next_steps: { type: "string" },
      rep_comments: { type: "string" },
    },
    required: ["risk_summary"],
  },
};

// ----------------- System prompt (greeting + discipline) -----------------

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
You are a MEDDPICC Scorer. Listen, judge, and record.

### HARD CONTEXT (NON-NEGOTIABLE)
You are auditing exactly:
- DEAL_ID: ${deal.id}
- ACCOUNT_NAME: ${deal.account_name}

You MUST NOT mention or use any other company name as the account. If the user says a different company, treat it as a correction ONLY if they explicitly say "this deal is actually X". Otherwise, keep ACCOUNT_NAME as the deal name.

### MANDATORY OPENING
You MUST open exactly with: "${openingLine}"
Do NOT say NEXT_DEAL_TRIGGER in the opening line.

### SAVE-AS-YOU-GO RULE (STRICT)
After every user response, you MUST call save_deal_data to store updated scores/summaries/tips. Do not invent facts; if unknown, score low and write "unknown".

### COMPLETION PROTOCOL
Only when ready to leave the deal:
Say: "Health Score: [Sum]/27. Risk: [Top Risk]. NEXT_DEAL_TRIGGER."
You MUST say NEXT_DEAL_TRIGGER to advance.
`.trim();
}

// ----------------- WebSocket core: Twilio <Stream> <-> OpenAI Realtime -----------------

wss.on("connection", async (twilioWs) => {
  console.log("🔥 Twilio WebSocket connected");

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

  openAiWs.on("error", (err) => {
    console.error("❌ OpenAI WebSocket error:", err?.message || err);
  });

  openAiWs.on("unexpected-response", (req, res) => {
    console.error("❌ OpenAI WS unexpected response:", res?.statusCode, res?.statusMessage);
    console.error("Headers:", res?.headers);
  });

  openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");

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
    const parsed = safeJsonParse(data);
    if (!parsed.ok) {
      console.error("❌ OpenAI frame not JSON:", parsed.err?.message, "| head:", parsed.head);
      return;
    }

    const response = parsed.json;

    try {
      // Tool call arguments (save_deal_data)
      if (response.type === "response.function_call_arguments.done") {
        const callId = response.call_id;
        const args = safeJsonParse(response.arguments || "{}");
        if (!args.ok) {
          console.error("❌ Tool args not JSON:", args.err?.message, "| head:", args.head);
          return;
        }

        const deal = dealQueue[currentDealIndex];
        if (!deal) {
          console.error("❌ Tool fired but no active deal (ignoring).");
          return;
        }

        // Audit breadcrumb: what deal we believe we are on
        console.log(
          `🧾 SAVE ROUTE dealIndex=${currentDealIndex}/${Math.max(dealQueue.length - 1, 0)} id=${deal.id} account="${deal.account_name}" callId=${callId}`
        );
        console.log("🔎 args keys:", Object.keys(args.json));
        console.log("🔎 args preview:", compact(args.json, [
          "risk_summary",
          "pain_score",
          "metrics_score",
          "champion_score",
          "eb_score",
          "criteria_score",
          "process_score",
          "competition_score",
          "paper_score",
          "timing_score",
        ]));

        // IMPORTANT: pass locked deal context into muscle for safe saving
        handleFunctionCall({ ...args.json, _deal: deal }, callId);

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
            console.log(`👉 Context switch -> id=${nextDeal.id} account="${nextDeal.account_name}"`);

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
      console.error("❌ OpenAI Message Handler Error:", err);
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
        // Correct OpenAI Realtime input message
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

  // Load deals + initialize first instructions
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
