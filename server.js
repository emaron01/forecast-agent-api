require("dotenv").config();
const http = require("http");
const express = require("express");
const { Pool } = require("pg");
const WebSocket = require("ws");
const cors = require("cors");

// --- [BLOCK 1: CONFIGURATION] ---
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.MODEL_API_KEY;
const MODEL_URL = process.env.MODEL_URL || "wss://api.openai.com/v1/realtime";
const MODEL_NAME = process.env.MODEL_NAME || "gpt-4o-mini-realtime-preview-2024-12-17";

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

// --- [BLOCK DB: POSTGRES POOL] ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --- [BLOCK X: SERVER + WEBSOCKET INIT] ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

### COMPLETION PROTOCOL (CRITICAL)
   When you have gathered the data (or if the user says "move on"), you MUST follow this EXACT sequence. Do not deviate.

   1. **Say:** "Got it. I'm updating the scorecard."
   2. **ACTION:** Call the function 'save_deal_data'. 
      - **SUMMARY RULES:** You MUST start the summary string with the Score Label (e.g., "Score 1: Soft Benefits only"). Then explain the gap.
      - **TIP RULES (THE COACH):** - If Score is 3: Tip is "None". 
         - If Score < 3: You MUST write the specific coaching advice you held back during the call. Tell the rep exactly what action to take to get a 3.
      - **WARNING:** You are FORBIDDEN from pretending to save. You must execute the tool physically.
      - **WAIT:** You must wait for the tool to return success before speaking again.
   3. **After Tool Success:** Say "Okay, saved. Moving to the next deal."
   `;

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
    res
      .type("text/xml")
      .send(
        `<Response><Connect><Stream url="wss://${req.headers.host}/" /></Connect></Response>`
      );
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
  
  // NEW: The Audio Gate (Closed by default)
  let isSessionInitialized = false; 

  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  // 1. OPEN EVENT (THE MUZZLE)
  openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");
    
    // Muzzle: Set voice immediately and tell it to shut up.
    openAiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: "You are Matthew. Remain silent.",
        voice: "verse",
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        turn_detection: null // Mute the microphone logic on OpenAI side
      }
    }));

    openAiReady = true;
    if (repName) attemptLaunch();
  });

  openAiWs.on("error", (err) => {
    console.error("❌ OpenAI WebSocket Error:", err.message);
  });

  // 2. LAUNCHER (THE BRAIN)
  const attemptLaunch = async () => {
    if (!openAiReady || !repName) return;
    console.log(`🚀 Launching Session for ${repName}`);

    // A. Load Data
    try {
      const result = await pool.query(
        `SELECT o.*, org.product_truths AS org_product_data
         FROM opportunities o
         JOIN organizations org ON o.org_id = org.id
         WHERE o.org_id = $1 AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost')
         ORDER BY o.id ASC`,
        [orgId]
      );
      dealQueue = result.rows;
      console.log(`📊 Loaded ${dealQueue.length} deals`);
    } catch (err) {
      console.error("❌ DB Load Error:", err.message);
    }

    // B. Handle Empty Queue
    if (dealQueue.length === 0) {
      openAiWs.send(JSON.stringify({
        type: "response.create",
        response: { instructions: `Say: 'Hello ${repName}. I connected, but I found zero active deals.'` },
      }));
      return;
    }

    // C. Generate Instructions
    const firstDeal = dealQueue[0];
    const instructions = getSystemPrompt(
      firstDeal,
      repName.split(" ")[0],
      dealQueue.length - 1,
      dealQueue.length
    );

    // D. Session Configuration (VAD REMAINS OFF)
    const sessionUpdate = {
        type: "session.update",
        session: {
          instructions: instructions,
          turn_detection: null, // <--- CRITICAL: Keep ears closed!
          tools: [{
              type: "function",
              name: "save_deal_data",
              description: "Saves scores. Call immediately when done.",
              parameters: {
                type: "object",
                properties: {
                  pain_score: { type: "number" }, pain_tip: { type: "string" }, pain_summary: { type: "string" },
                  metrics_score: { type: "number" }, metrics_tip: { type: "string" }, metrics_summary: { type: "string" },
                  champion_score: { type: "number" }, champion_tip: { type: "string" }, champion_summary: { type: "string" },
                  eb_score: { type: "number" }, eb_tip: { type: "string" }, eb_summary: { type: "string" },
                  criteria_score: { type: "number" }, criteria_tip: { type: "string" }, criteria_summary: { type: "string" },
                  process_score: { type: "number" }, process_tip: { type: "string" }, process_summary: { type: "string" },
                  competition_score: { type: "number" }, competition_tip: { type: "string" }, competition_summary: { type: "string" },
                  paper_score: { type: "number" }, paper_tip: { type: "string" }, paper_summary: { type: "string" },
                  timing_score: { type: "number" }, timing_tip: { type: "string" }, timing_summary: { type: "string" },
                  risk_summary: { type: "string" }, next_steps: { type: "string" },
                },
                required: [], 
              },
          }],
          tool_choice: "auto",
        },
      };
    openAiWs.send(JSON.stringify(sessionUpdate));

    // E. The Trigger (Mouth FIRST, Ears SECOND)
    setTimeout(() => {
      // 1. Queue the Intro (The Mouth)
      openAiWs.send(JSON.stringify({
        type: "response.create",
        response: { 
            instructions: "Please begin immediately by speaking the opening intro defined in your system instructions." 
        },
      }));

      // 2. Enable the Ears (The Ears)
      // We turn this on AFTER the mouth instruction is sent.
      openAiWs.send(JSON.stringify({
        type: "session.update",
        session: {
            turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 1000 }
        }
      }));
      
      // 3. Open Audio Gate (Twilio Flow)
      console.log("🔓 Audio Gate Opened");
      isSessionInitialized = true; 
    }, 500);
  };

  // 3. HELPER: FUNCTION HANDLER (The Muscle)
  const handleFunctionCall = async (args) => {
    console.log("🛠️ Tool Triggered: save_deal_data");

    try {
      const deal = dealQueue[currentDealIndex];
      const scores = [
        args.pain_score, args.metrics_score, args.champion_score,
        args.eb_score, args.criteria_score, args.process_score,
        args.competition_score, args.paper_score, args.timing_score,
      ];

      const totalScore = scores.reduce((a, b) => a + (Number(b) || 0), 0);
      const newStage = totalScore >= 25 ? "Closed Won" : totalScore >= 20 ? "Commit" : totalScore >= 12 ? "Best Case" : "Pipeline";

      await pool.query(
        `UPDATE opportunities SET 
          pain_score=$1, pain_tip=$2, pain_summary=$3,
          metrics_score=$4, metrics_tip=$5, metrics_summary=$6,
          champion_score=$7, champion_tip=$8, champion_summary=$9,
          eb_score=$10, eb_tip=$11, eb_summary=$12,
          criteria_score=$13, criteria_tip=$14, criteria_summary=$15,
          process_score=$16, process_tip=$17, process_summary=$18,
          competition_score=$19, competition_tip=$20, competition_summary=$21,
          paper_score=$22, paper_tip=$23, paper_summary=$24,
          timing_score=$25, timing_tip=$26, timing_summary=$27,
          last_summary=$28, next_steps=$29, forecast_stage=$30,
          run_count = run_count + 1, updated_at = NOW()
         WHERE id = $31`,
        [
          args.pain_score || 0, args.pain_tip || null, args.pain_summary || null,
          args.metrics_score || 0, args.metrics_tip || null, args.metrics_summary || null,
          args.champion_score || 0, args.champion_tip || null, args.champion_summary || null,
          args.eb_score || 0, args.eb_tip || null, args.eb_summary || null,
          args.criteria_score || 0, args.criteria_tip || null, args.criteria_summary || null,
          args.process_score || 0, args.process_tip || null, args.process_summary || null,
          args.competition_score || 0, args.competition_tip || null, args.competition_summary || null,
          args.paper_score || 0, args.paper_tip || null, args.paper_summary || null,
          args.timing_score || 0, args.timing_tip || null, args.timing_summary || null,
          args.risk_summary || "No summary provided", 
          args.next_steps || "No next steps", 
          newStage, 
          deal.id,
        ]
      );

      console.log(`✅ Saved: ${deal.account_name}`);
      currentDealIndex++;

      if (currentDealIndex >= dealQueue.length) {
        console.log("🏁 All deals finished.");
        openAiWs.send(JSON.stringify({
          type: "response.create",
          response: { instructions: "Say: 'That concludes the review. Great work today.' and then hang up." },
        }));
        setTimeout(() => process.exit(0), 5000);
      } else {
        const nextDeal = dealQueue[currentDealIndex];
        const remaining = dealQueue.length - currentDealIndex;
        const nextInstructions = getSystemPrompt(nextDeal, repName.split(" ")[0], remaining - 1, dealQueue.length);
        
        const nukeInstructions = `*** SYSTEM ALERT: PREVIOUS DEAL CLOSED. ***\n\nFORGET ALL context about the previous account. FOCUS ONLY on this new deal:\n\n` + nextInstructions;

        openAiWs.send(JSON.stringify({
          type: "session.update",
          session: { instructions: nukeInstructions }
        }));

        openAiWs.send(JSON.stringify({
          type: "response.create",
          response: { 
            instructions: `Say: 'Okay, saved. We have ${remaining} ${remaining === 1 ? "deal" : "deals"} left to review. Next up is ${nextDeal.account_name}. What is the latest update there?'` 
          },
        }));
      }
    } catch (err) {
      console.error("❌ Save Failed:", err);
      openAiWs.send(JSON.stringify({
        type: "response.create",
        response: { instructions: "Say: 'I ran into an issue saving those details. Let me try that again.'" },
      }));
    }
  };

  // 4. THE EAR (OPENAI LISTENER)
  openAiWs.on("message", (data) => {
    const response = JSON.parse(data);

    // Audio Passthrough
    if (response.type === "response.audio.delta" && response.delta) {
      ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: response.delta } }));
    }

    // THE TRIGGER
    if (response.type === "response.function_call_arguments.done" && response.name === "save_deal_data") {
      console.log(`🛠️ AI Finished Generating Data: ${response.name}`);
      try {
        const args = JSON.parse(response.arguments);
        openAiWs.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: response.call_id,
            output: JSON.stringify({ status: "success" }),
          },
        }));
        handleFunctionCall(args); 
      } catch (error) {
        console.error("❌ JSON Parse Error on Tool Args:", error);
      }
    }
  });

  // 5. TWILIO LISTENER (WITH AUDIO GATE)
  ws.on("message", (message) => {
    const msg = JSON.parse(message);
    if (msg.event === "start") {
      streamSid = msg.start.streamSid;
      const params = msg.start.customParameters;
      if (params) {
        orgId = parseInt(params.org_id) || 1;
        repName = params.rep_name || "Guest";
        console.log(`🔎 Params Received: ${repName}`);
        if (openAiReady) attemptLaunch();
      }
    }
    
    // ✋ AUDIO GATE CHECK
    if (msg.event === "media" && openAiWs.readyState === WebSocket.OPEN) {
      if (isSessionInitialized) {
        openAiWs.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: msg.media.payload,
        }));
      }
      // Else: Drop the audio packet to prevent "Hello" race condition
    }
  });

  ws.on("close", () => {
    console.log("🔌 Call Closed.");
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
  });
}); 

// --- [BLOCK 6: SERVER LISTEN] ---
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
