// server.js
import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";

// Import your function handler
import { handleFunctionCall } from "./muscle.js";  

import { Pool } from "pg";

const PORT = process.env.PORT || 10000;
const MODEL_URL = process.env.MODEL_API_URL;      // Render env
const MODEL_NAME = process.env.MODEL_NAME;        // Render env
const OPENAI_API_KEY = process.env.MODEL_API_KEY; // Render env
const DATABASE_URL = process.env.DATABASE_URL;

if (!MODEL_URL || !MODEL_NAME || !OPENAI_API_KEY) {
  throw new Error(
    "⚠️ MODEL_API_URL, MODEL_NAME, and MODEL_API_KEY must be set in environment variables!"
  );
}

// --- PostgreSQL
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --- Express server for health checks + Twilio webhook
const app = express();
app.use(express.json()); // parse JSON payloads

app.get("/", (req, res) => res.send("✅ Forecast Agent API is alive!"));

// --- SMART RECEPTIONIST: Twilio POST webhook
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
    res.type("text/xml").send(
      `<Response><Connect><Stream url="wss://${req.headers.host}/" /></Connect></Response>`
    );
  }
});

// --- HTTP server (needed for WebSocket)
const server = http.createServer(app);

// --- WebSocket server
const wss = new WebSocketServer({ server });
console.log("🌐 WebSocket server created");

// --- [BLOCK 5: WEBSOCKET CORE] ---
wss.on("connection", async (ws) => {
  console.log("🔥 Twilio WebSocket connected");

  // Local State
  let streamSid = null;
  let dealQueue = [];
  let currentDealIndex = 0;
  let repName = null;
  let orgId = 1;
  let openAiReady = false;
  let audioBufferQueue = [];

  // --- Connect to OpenAI Realtime
  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  // --- OpenAI connection
  openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");
    openAiReady = true;
    attemptLaunch();
  });

  // --- Handle incoming OpenAI messages
  openAiWs.on("message", (data) => {
    try {
      const response = JSON.parse(data);

      // Function call
      if (response.type === "response.function_call_arguments.done") {
        const args = JSON.parse(response.arguments);
        handleFunctionCall(args, response.call_id);
      }

      // Final transcript
      if (response.type === "response.done") {
        const transcript = (
          response.response?.output
            ?.flatMap((o) => o.content || [])
            .map((c) => c.transcript || c.text || "") || []
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
            openAiWs.send(
              JSON.stringify({ type: "session.update", session: { instructions } })
            );
            setTimeout(() => openAiWs.send(JSON.stringify({ type: "response.create" })), 500);
          }
        }
      }

      // Audio delta
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

  // --- Handle incoming Twilio WebSocket messages
  ws.on("message", async (msg) => {
    const data = JSON.parse(msg);
    console.log("📩 Twilio WS message:", data);

    if (data.event === "start") {
      streamSid = data.streamSid;
      console.log("🎬 Stream started:", streamSid);

      // Flush queued audio
      audioBufferQueue.forEach((delta) =>
        ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: delta } }))
      );
      audioBufferQueue = [];
    }

    if (data.event === "media" && data.media?.payload) {
      const audioBuffer = Buffer.from(data.media.payload, "base64");

      // Send to OpenAI as g711_ulaw
      if (openAiReady) {
        openAiWs.send(
          JSON.stringify({
            type: "input.audio.buffer",
            audio: audioBuffer.toString("base64"),
            encoding: "g711_ulaw",
          })
        );
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

  // --- Launch deals if ready
  function attemptLaunch() {
    if (!openAiReady || !repName) return;
    dealQueue.forEach((deal, idx) => {
      const instructions = getSystemPrompt(
        deal,
        repName.split(" ")[0],
        dealQueue.length - 1 - idx,
        dealQueue.length
      );
      openAiWs.send(JSON.stringify({ type: "session.update", session: { instructions } }));
    });
    setTimeout(() => openAiWs.send(JSON.stringify({ type: "response.create" })), 500);
  }
});

// --- Start server
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
