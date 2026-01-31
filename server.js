import express from "express";
import http from "http";
import WebSocket from "ws";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/* ------------------------------------------------------------------ */
/*  HEALTH CHECK                                                       */
/* ------------------------------------------------------------------ */
app.get("/", (_, res) => res.send("✅ Forecast Agent API is alive"));

/* ------------------------------------------------------------------ */
/*  TWILIO ENTRYPOINT                                                  */
/* ------------------------------------------------------------------ */
app.post("/agent", (req, res) => {
  res.json({
    websocket: {
      url: `wss://${req.headers.host}/twilio`
    }
  });
});

/* ------------------------------------------------------------------ */
/*  WEBSOCKET HANDLER                                                  */
/* ------------------------------------------------------------------ */
wss.on("connection", (twilioWs) => {
  console.log("🔥 Twilio WebSocket connected");

  const openAiWs = new WebSocket(process.env.OPENAI_WS_URL, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1"
    }
  });

  /* ------------------------- STATE FLAGS -------------------------- */
  let responseActive = false;
  let responseCreateInFlight = false;

  /* ------------------------- UTILITIES ---------------------------- */
  function safeSend(ws, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function kickModel(reason) {
    console.log(`⚡ kickModel (${reason})`);
    // ONLY signal input completion — NEVER create a response
    safeSend(openAiWs, { type: "input_audio_buffer.commit" });
  }

  /* ---------------------------------------------------------------- */
  /*  TWILIO → SERVER                                                  */
  /* ---------------------------------------------------------------- */
  twilioWs.on("message", (msg) => {
    const event = JSON.parse(msg);

    if (event.event === "media") {
      safeSend(openAiWs, {
        type: "input_audio_buffer.append",
        audio: event.media.payload
      });
    }

    if (event.event === "speech_stopped") {
      console.log("🛑 Twilio: speech_stopped");
      kickModel("speech_stopped");
      return;
    }
  });

  /* ---------------------------------------------------------------- */
  /*  OPENAI → SERVER                                                  */
  /* ---------------------------------------------------------------- */
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
          threshold: 0.5,
          silence_duration_ms: 1500
        }
      }
    });

    // First question is model-initiated ONCE
    safeSend(openAiWs, { type: "response.create" });
    responseActive = true;
    responseCreateInFlight = true;
    console.log("⚡ response.create (first_question)");
  });

  openAiWs.on("message", (msg) => {
    const event = JSON.parse(msg);

    /* ---------------- RESPONSE LIFECYCLE ---------------- */
    if (event.type === "response.created") {
      responseCreateInFlight = false;
      responseActive = true;
    }

    if (event.type === "response.done") {
      responseActive = false;
    }

    /* ---------------- MODEL REQUESTS TO SPEAK ------------ */
    if (event.type === "response.create") {
      if (responseActive || responseCreateInFlight) {
        console.log("🚫 Blocked duplicate response.create");
        return;
      }

      responseCreateInFlight = true;
      responseActive = true;
      safeSend(openAiWs, event);
      console.log("⚡ response.create (model_requested)");
      return;
    }

    /* ---------------- TOOL CALLS (SAVE) ------------------ */
    if (event.type === "response.function_call") {
      console.log("🛠️ Tool Triggered:", event.name);
      // DO NOT block — saves must always succeed
      handleFunctionCall(event);
    }

    /* ---------------- AUDIO BACK TO TWILIO --------------- */
    if (event.type === "response.output_audio.delta") {
      safeSend(twilioWs, {
        event: "media",
        media: { payload: event.delta }
      });
    }
  });

  openAiWs.on("error", (err) => {
    console.error("❌ OpenAI WS error:", err);
  });

  twilioWs.on("close", () => {
    console.log("🔌 Twilio WebSocket closed");
    openAiWs.close();
  });
});

/* ------------------------------------------------------------------ */
/*  TOOL HANDLER (UNCHANGED SAVE LOGIC)                                */
/* ------------------------------------------------------------------ */
async function handleFunctionCall(event) {
  // YOUR EXISTING save_deal_data logic goes here
  // DO NOT gate, debounce, or delay this
  console.log("💾 Saving:", event.arguments);
}

/* ------------------------------------------------------------------ */
/*  START SERVER                                                       */
/* ------------------------------------------------------------------ */
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
