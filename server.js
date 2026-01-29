// server.js
import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 10000;
const MODEL_URL = process.env.MODEL_URL;
const MODEL_NAME = process.env.MODEL_NAME;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- Express server for health checks
const app = express();
app.get("/", (req, res) => res.send("✅ Forecast Agent API is alive!"));

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

  // Connect to OpenAI Realtime
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

      // Handle function calls
      if (response.type === "response.function_call_arguments.done") {
        const args = JSON.parse(response.arguments);
        handleFunctionCall(args, response.call_id);
      }

      // Handle final text transcript
      if (response.type === "response.done") {
        const transcript =
          (response.response?.output
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

      // Handle audio delta
      if (response.type === "response.audio.delta" && response.delta && streamSid) {
        ws.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: response.delta }, // NO encoding field for Twilio
          })
        );
      }
    } catch (err) {
      console.error("❌ OpenAI Message Error:", err);
    }
  });

  // --- Handle incoming Twilio WebSocket messages
  ws.on("message", async (msg) => {
    const data = JSON.parse(msg);

    if (data.event === "start") {
      streamSid = data.streamSid;
      console.log("🎬 Stream started:", streamSid);
    }

    if (data.event === "media" && data.media && data.media.payload) {
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
