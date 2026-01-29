require("dotenv").config();
const http = require("http");
const express = require("express");
const { Pool } = require("pg");
const WebSocket = require("ws");
const cors = require("cors");

// --- IMPORT MUSCLE (Background Save + Score Labels + AI Phantom Stage)
const { handleFunctionCall } = require("./muscle");

// --- [BLOCK 1: CONFIGURATION] ---
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.MODEL_API_KEY;
const MODEL_URL = process.env.MODEL_URL || "wss://api.openai.com/v1/realtime";
const MODEL_NAME = process.env.MODEL_NAME || "gpt-4o-realtime-preview-2024-10-01";

if (!OPENAI_API_KEY) {
  console.error("❌ Missing MODEL_API_KEY in environment");
  process.exit(1);
}

// --- [BLOCK 2: SERVER CONFIGURATION] ---
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static("public"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- [BLOCK 3: SYSTEM PROMPT] ---
function getSystemPrompt(deal, repName, dealsLeft, totalCount) {
    const runCount = Number(deal.run_count) || 0;
    const isNewDeal = runCount === 0;
    const firstGap = "Pain"; // simplified for brevity; can use your scores logic

    let openingLine = isNewDeal
        ? `Hi ${repName}. New deal: ${deal.account_name}. What's the specific challenge we are solving?`
        : `Okay, saved. Next: ${deal.account_name}. Last risk: "${deal.risk_summary || 'None'}". Status on ${firstGap}?`;

    return `
### ROLE
You are a **MEDDPICC Scorer**. Your job is to Listen, Judge, and Record.

### MANDATORY OPENING
You MUST open exactly with: "${openingLine}"

### SCORING & SAVE PROTOCOL
You must call 'save_deal_data' silently after every user response. Do not read the scores out loud.
    `;
}

// --- [BLOCK 4: SMART RECEPTIONIST] ---
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
    console.error("❌ /agent error:", err.message);
    res.type("text/xml").send(`<Response><Connect><Stream url="wss://${req.headers.host}/" /></Connect></Response>`);
  }
});


// --- [BLOCK 5: WEBSOCKET CORE] ---
wss.on("connection", async (ws) => {
  console.log("🔥 Twilio WebSocket connected");

  let streamSid = null;
  let dealQueue = [];
  let currentDealIndex = 0;
  let repName = null;
  let orgId = 1;
  let openAiReady = false;

  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
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
        const transcript = (
          response.response?.output?.flatMap(o => o.content || []).map(c => c.transcript || c.text || "") || []
        ).join(" ");
        console.log("📝 FINAL TRANSCRIPT:", transcript);

        if (transcript.includes("NEXT_DEAL_TRIGGER")) {
          currentDealIndex++;
          if (currentDealIndex < dealQueue.length) {
            const nextDeal = dealQueue[currentDealIndex];
            const instructions = getSystemPrompt(
              nextDeal,
              repName.split(" ")[0],
              dealQueue.length - 1 - currentDealIndex,
              dealQueue.length
            );
            openAiWs.send(JSON.stringify({ type: "session.update", session: { instructions } }));
            setTimeout(() => openAiWs.send(JSON.stringify({ type: "response.create" })), 500);
          }
        }
      }

      // --- Audio streaming TO Twilio (base64 μ-law ONLY)
      if (response.type === "response.audio.delta" && response.delta && streamSid) {
        ws.send(JSON.stringify({
          event: "media",
          streamSid,
          media: { payload: response.delta } // ✅ no encoding field
        }));
      }

    } catch (err) {
      console.error("❌ OpenAI Message Error:", err);
    }
  });

  ws.on("message", async (msg) => {
    const data = JSON.parse(msg);

    if (data.event === "start") {
      streamSid = data.streamSid;
      repName = data.repName || "Unknown Rep";
      dealQueue = data.deals || [];
      currentDealIndex = 0;
      console.log("🎬 Stream started:", streamSid);
      attemptLaunch();
    }

    if (data.event === "media" && data.media && data.media.payload) {
      const audioBuffer = Buffer.from(data.media.payload, "base64");

      if (openAiReady) {
        openAiWs.send(JSON.stringify({
          type: "input.audio.buffer",
          audio: audioBuffer.toString("base64"),
          encoding: "g711_ulaw" // only for sending to OpenAI
        }));
      }
    }

    if (data.event === "stop") {
      console.log("🛑 Stream stopped:", streamSid);
      streamSid = null;
    }
  });

  ws.on("close", () => {
    console.log("❌ Twilio WebSocket closed");
    streamSid = null;
  });

  ws.on("error", (err) => {
    console.error("❌ Twilio WebSocket error:", err);
    streamSid = null;
  });

  function attemptLaunch() {
    if (!openAiReady || !repName) return;
    dealQueue.forEach((deal, idx) => {
      const instructions = getSystemPrompt(deal, repName.split(" ")[0], dealQueue.length - 1 - idx, dealQueue.length);
      openAiWs.send(JSON.stringify({ type: "session.update", session: { instructions } }));
    });
    setTimeout(() => openAiWs.send(JSON.stringify({ type: "response.create" })), 500);
  }
});
  // --- Twilio WebSocket: incoming audio ---
  ws.on("message", async (msg) => {
    const event = JSON.parse(msg);

    // --- Incoming audio from Twilio ---
    if (event.event === "media" && openAiReady) {
      openAiWs.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: event.media.payload,
        encoding: "g711_ulaw"
      }));
    }

    // --- Call start ---
    if (event.event === "start") {
      streamSid = event.start.streamSid;
      repName = event.start.representativeName || null;
      console.log(`📞 Incoming call: ${repName || "Unknown Rep"}`);
    }

    // --- Call end ---
    if (event.event === "stop") {
      if (openAiReady) {
        openAiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        openAiWs.send(JSON.stringify({ type: "response.create" }));
      }
      console.log("🔌 Call Closed.");
    }
  });

  // --- Handle Twilio WS close/error ---
  ws.on("close", () => {
    console.log("⚠️ Twilio WebSocket closed");
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
  });

  ws.on("error", (err) => console.error("❌ Twilio WS error:", err));
});

  // --- Launch deals for rep
  const attemptLaunch = async () => {
    if (!repName || !openAiReady) return;

    try {
      const result = await pool.query(
        `SELECT o.*, org.product_truths AS org_product_data 
         FROM opportunities o 
         JOIN organizations org ON o.org_id = org.id 
         WHERE o.org_id = $1 AND o.rep_name = $2 AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost') 
         ORDER BY o.id ASC`, 
        [orgId, repName]
      );

      dealQueue = result.rows;
      console.log(`📊 Loaded ${dealQueue.length} deals for ${repName}`);
      if (dealQueue.length > 0) {
        const firstDeal = dealQueue[0];
        const instructions = getSystemPrompt(firstDeal, repName.split(" ")[0], dealQueue.length - 1, dealQueue.length);
        openAiWs.send(JSON.stringify({ type: "session.update", session: { instructions } }));
        setTimeout(() => openAiWs.send(JSON.stringify({ type: "response.create" })), 500);
      }

    } catch (err) { console.error("❌ DB Error:", err.message); }
  };

  // --- Twilio WebSocket messages
  ws.on("message", (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.event === "start") {
        streamSid = msg.start.streamSid;
        const params = msg.start.customParameters;
        if (params) {
          orgId = parseInt(params.org_id) || 1;
          repName = params.rep_name || "Guest";
          console.log(`🔎 Identified ${repName}`);
          attemptLaunch();
        }
      }

      if (msg.event === "media" && openAiWs.readyState === WebSocket.OPEN) {
        openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));
      }

    } catch (err) { console.error("❌ Twilio Error:", err); }
  });

  ws.on("close", () => {
    console.log("🔌 Call Closed.");
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
  });
});

// --- [BLOCK 6: API ENDPOINTS] ---
app.get("/debug/opportunities", async (req, res) => {
  try {
    const orgId = parseInt(req.query.org_id) || 1;
    const result = await pool.query(`SELECT * FROM opportunities WHERE org_id = $1 ORDER BY updated_at DESC`, [orgId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- START SERVER ---
server.listen(PORT, () => console.log(`🚀 Matthew God-Mode Live on port ${PORT}`));
