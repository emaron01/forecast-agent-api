// server.js
import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { handleFunctionCall } from "./muscle.js"; // your tool
import { Pool } from "pg";

dotenv.config();

// --- Config
const PORT = process.env.PORT || 10000;
const MODEL_URL = process.env.MODEL_URL;
const MODEL_NAME = process.env.MODEL_NAME;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- Postgres Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --- Express server for health checks + Twilio webhook
const app = express();
app.use(express.json());

app.get("/", (req, res) => res.send("✅ Forecast Agent API is alive!"));

// --- SMART RECEPTIONIST
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
      console.log(`✅ Identified Rep: ${repName}`);
    }

    const wsUrl = `wss://${req.headers.host}/`;
    res.type("text/xml").send(`
      <Response>
        <Connect>
          <Stream url="${wsUrl}">
            <Parameter name="org_id" value="${orgId}" />
            <Parameter name="rep_name" value="${repName}" />
          </Stream>
        </Connect>
      </Response>
    `);
  } catch (err) {
    console.error("❌ /agent error:", err.message);
    res.type("text/xml").send(`<Response><Connect><Stream url="wss://${req.headers.host}/" /></Connect></Response>`);
  }
});

// --- HTTP + WebSocket server
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

console.log("🌐 WebSocket server created");

// --- SYSTEM PROMPT
function getSystemPrompt(deal, repName, dealsLeft, totalCount) {
  const runCount = Number(deal.run_count) || 0;
  const isNewDeal = runCount === 0;
  const category = deal.forecast_stage || "Pipeline";
  const amountStr = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(deal.amount || 0);
  const closeDateStr = deal.close_date ? new Date(deal.close_date).toLocaleDateString() : "TBD";
  const isSessionStart = (dealsLeft === totalCount - 1) || (dealsLeft === totalCount);

  const scores = [
    { name: 'Pain', val: deal.pain_score }, { name: 'Metrics', val: deal.metrics_score },
    { name: 'Champion', val: deal.champion_score }, { name: 'Economic Buyer', val: deal.eb_score },
    { name: 'Decision Criteria', val: deal.criteria_score }, { name: 'Decision Process', val: deal.process_score },
    { name: 'Competition', val: deal.competition_score }, { name: 'Paper Process', val: deal.paper_score },
    { name: 'Timing', val: deal.timing_score }
  ];
  const firstGap = scores.find(s => (Number(s.val) || 0) < 3) || { name: 'Pain' };

  let openingLine = "";
  if (isSessionStart) {
    openingLine = `Hi ${repName}. This is Matthew, your sales forecaster agent. Today we are going to review ${totalCount} opportunities, starting with ${deal.account_name}, ${deal.name}.`;
  } else {
    openingLine = `Okay, moving on. Let's look at ${deal.account_name}, ${deal.name}.`;
  }
  if (isNewDeal) {
    openingLine += ` It's in ${category} for ${amountStr}, closing ${closeDateStr}. Since this is new, what product are we selling and what specific challenge are we trying to overcome for the customer?`;
  } else {
    openingLine += ` It's in ${category} for ${amountStr}. Last time we flagged: "${deal.risk_summary || 'vague project drivers'}". I see ${firstGap.name} is still a risk—have we made any progress there?`;
  }

  return `
### ROLE & IDENTITY
You are Matthew, a high-IQ MEDDPICC Auditor. You are an **Extractor**, not a Coach.

### MANDATORY OPENING
You MUST open exactly with: "${openingLine}"

### CONVERSATION FLOW RULES (GUARDRAILS)
1. Ask ONE MEDDPICC-advancing question per turn.
2. If the rep’s answer is unclear → ask ONE clarifying question. If still unclear → score low and move on.
3. Never repeat or paraphrase the rep’s answer.
4. **ATOMIC SAVES:** Call 'save_deal_data' SILENTLY immediately after the rep answers a question about a category. Do not wait.
`;
}

// --- [BLOCK 5: WEBSOCKET CORE]
wss.on("connection", async (ws, req) => {
  console.log("🔥 Twilio WebSocket connected");

  // Local state
  let streamSid = null;
  let repName = "Guest";
  let orgId = 1;
  let dealQueue = [];
  let currentDealIndex = 0;
  let openAiReady = false;
  let audioBufferQueue = [];

  // --- Capture Twilio Stream parameters
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.event === "connected") {
        if (data.parameters?.rep_name) repName = data.parameters.rep_name;
        if (data.parameters?.org_id) orgId = data.parameters.org_id;
        console.log(`✅ WebSocket handshake complete for ${repName}`);
      }
    } catch (err) {}
  });

  // --- Connect to OpenAI Realtime
  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1"
    }
  });

  openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");
    openAiReady = true;
    attemptLaunch();
  });

  openAiWs.on("message", (data) => {
    try {
      const response = JSON.parse(data);

      if (response.type === "response.function_call_arguments.done") {
        const args = JSON.parse(response.arguments);
        handleFunctionCall(args, response.call_id);
      }

      if (response.type === "response.done") {
        const transcript = (response.response?.output?.flatMap(o => o.content || []).map(c => c.transcript || c.text || "") || []).join(" ");
        console.log("📝 FINAL TRANSCRIPT:", transcript);

        if (transcript.includes("NEXT_DEAL_TRIGGER")) {
          currentDealIndex++;
          if (currentDealIndex < dealQueue.length) {
            const nextDeal = dealQueue[currentDealIndex];
            const instructions = getSystemPrompt(nextDeal, repName, dealQueue.length - 1 - currentDealIndex, dealQueue.length);
            openAiWs.send(JSON.stringify({ type: "session.update", session: { instructions } }));
            setTimeout(() => openAiWs.send(JSON.stringify({ type: "response.create" })), 500);
          }
        }
      }

      if (response.type === "response.audio.delta" && response.delta) {
        if (streamSid) {
          ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: response.delta } }));
        } else {
          audioBufferQueue.push(response.delta);
        }
      }
    } catch (err) {
      console.error("❌ OpenAI Message Error:", err);
    }
  });

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    if (data.event === "start") {
      streamSid = data.streamSid;
      console.log("🎬 Stream started:", streamSid);

      audioBufferQueue.forEach(delta => ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: delta } })));
      audioBufferQueue = [];
    }

    if (data.event === "media" && data.media?.payload) {
      const audioBuffer = Buffer.from(data.media.payload, "base64");
      if (openAiReady) {
        openAiWs.send(JSON.stringify({
          type: "input.audio.buffer",
          audio: audioBuffer.toString("base64"),
          encoding: "g711_ulaw"
        }));
      }
    }

    if (data.event === "stop") {
      console.log("🛑 Stream stopped:", streamSid);
      streamSid = null;
    }
  });

  ws.on("close", () => console.log("❌ Twilio WebSocket closed"));
  ws.on("error", (err) => console.error("❌ Twilio WebSocket error:", err));

  function attemptLaunch() {
    if (!openAiReady || !repName) return;
    dealQueue.forEach((deal, idx) => {
      const instructions = getSystemPrompt(deal, repName, dealQueue.length - 1 - idx, dealQueue.length);
      openAiWs.send(JSON.stringify({ type: "session.update", session: { instructions } }));
    });
    setTimeout(() => openAiWs.send(JSON.stringify({ type: "response.create" })), 500);
  }
});

// --- Start server
server.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
