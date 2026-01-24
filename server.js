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

// --- [BLOCK 3: SYSTEM PROMPT] ---
function getSystemPrompt(deal, repName, dealsLeft) {
    return `
    ### IDENTITY
    You are a rigid sales auditor reviewing opportunities with ${repName}.
    Current Deal: "${deal.account_name}".

    ### STRICT BEHAVIORAL RULES (DO NOT BREAK)
    1. **ONE QUESTION AT A TIME:** asking multiple questions in one turn is FORBIDDEN.
    2. **NO SCORE READING:** Do NOT read the scores back to the rep. Do NOT list the categories.
    3. **NO SUMMARIES:** Do NOT summarize what the rep just said. Just ask the next question.
    4. **STAY IN CHARACTER:** You are not an assistant. You are an auditor. Be direct and concise.

    ### THE AUDIT PATH
    Step 1: Ask about PAIN.
    Step 2: Ask about METRICS (ROI).
    Step 3: Ask about CHAMPION.
    Step 4: Ask about DECISION PROCESS.
    
    ### COMPLETION TRIGGER (CRITICAL)
    When you have enough information to score the deal:
    1. Say ONLY: "Audit complete. Scoring this deal now."
    2. IMMEDIATELY use the tool "save_deal_data".
    3. Say: "Pulling up the next opportunity."

    ### DATA CONTEXT
    - Stage: ${deal.forecast_stage}
    - Close Date: ${deal.close_date}
    - Deals Remaining: ${dealsLeft}
    `;
}

// --- [BLOCK 4: SMART RECEPTIONIST] ---
app.post("/agent", async (req, res) => {
  try {
    const callerPhone = req.body.From || null;
    console.log("📞 Incoming call from:", callerPhone);

    // 1. LOOKUP REP
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
    } else {
      console.log("⚠️ Number not found. Defaulting to Guest.");
    }

    // 2. SEND TWIML (Use <Parameter> to ensure data survives)
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

  // State
  let streamSid = null;
  let dealQueue = [];
  let currentDealIndex = 0;
  let repName = "Unknown";
  let orgId = 1;

  // 1. CONNECT TO OPENAI
  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  // 2. HELPER: ACTIVATE THE AI (Brain Transplant)
  const activateAuditor = async () => {
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
        console.log(`📊 Loaded ${dealQueue.length} deals for ${repName}`);
      } catch (err) {
        console.error("❌ DB Load Error:", err.message);
      }

      // B. Handle Empty Queue
      if (dealQueue.length === 0) {
          // Enable Voice just to say goodbye
          openAiWs.send(JSON.stringify({
            type: "session.update",
            session: {
               turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 1000 },
               instructions: "System Message."
            }
          }));
          openAiWs.send(JSON.stringify({ type: "response.create", response: { instructions: `Say: 'Hello ${repName}. I connected, but I found zero active deals to review.'` } }));
          return;
      }

      // C. Inject Auditor Persona & Enable Voice
      const firstDeal = dealQueue[0];
      const instructions = getSystemPrompt(firstDeal, repName.split(" ")[0], dealQueue.length - 1);
      
      const sessionUpdate = {
        type: "session.update",
        session: {
          // NOW we turn on the ears and the brain
          turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 1000 },
          instructions: instructions,
          tools: [{
              type: "function",
              name: "save_deal_data",
              description: "Saves scores, tips, and next steps to the database.",
              parameters: {
                type: "object",
                properties: {
                  pain_score: { type: "number" }, pain_tip: { type: "string" },
                  metrics_score: { type: "number" }, metrics_tip: { type: "string" },
                  champion_score: { type: "number" }, champion_tip: { type: "string" },
                  eb_score: { type: "number" }, eb_tip: { type: "string" },
                  criteria_score: { type: "number" }, criteria_tip: { type: "string" },
                  process_score: { type: "number" }, process_tip: { type: "string" },
                  competition_score: { type: "number" }, competition_tip: { type: "string" },
                  paper_score: { type: "number" }, paper_tip: { type: "string" },
                  timing_score: { type: "number" }, timing_tip: { type: "string" },
                  risk_summary: { type: "string" }, next_steps: { type: "string" },
                },
                required: ["pain_score", "pain_tip", "metrics_score", "metrics_tip", "champion_score", "champion_tip", "eb_score", "eb_tip", "criteria_score", "criteria_tip", "process_score", "process_tip", "competition_score", "competition_tip", "paper_score", "paper_tip", "timing_score", "timing_tip", "risk_summary", "next_steps"],
              },
          }],
          tool_choice: "auto",
        },
      };

      openAiWs.send(JSON.stringify(sessionUpdate));
      
      // D. Force the Opening Line
      setTimeout(() => { 
        openAiWs.send(JSON.stringify({ type: "response.create" })); 
      }, 500);
  };

  // 3. OPENAI CONNECTED: "THE VAD KILL SWITCH"
  openAiWs.on("open", async () => {
    // 🛑 STOP! DISABLE EARS!
    // We set turn_detection to NULL so it physically CANNOT hear or speak yet.
    openAiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        turn_detection: null, 
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "verse"
      }
    }));
  });

  // 4. TWILIO AUDIO BRIDGE
  ws.on("message", (message) => {
    const msg = JSON.parse(message);

    // A. Start Event (Get Rep Name)
    if (msg.event === "start") {
      streamSid = msg.start.streamSid;
      const params = msg.start.customParameters;
      
      if (params) {
          orgId = parseInt(params.org_id) || 1;
          repName = params.rep_name || "Guest";
          console.log(`🔎 Params Received: ${repName} (Org ${orgId})`);
          
          if (openAiWs.readyState === WebSocket.OPEN) {
              activateAuditor(); // <--- Wake him up now
          }
      }
      return;
    }

    // B. Media (Passthrough)
    if (msg.event === "media" && openAiWs.readyState === WebSocket.OPEN) {
      openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));
    }
  });

  // 5. INCOMING MESSAGE HANDLER (Tools)
  openAiWs.on("message", (data) => {
    const response = JSON.parse(data);

    if (response.type === "response.audio.delta" && response.delta) {
      ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: response.delta } }));
    }

    if (response.type === "response.done" && response.response?.output) {
      response.response.output.forEach((output) => {
        if (output.type === "function_call" && output.name === "save_deal_data") {
          const args = JSON.parse(output.arguments);
          const deal = dealQueue[currentDealIndex];
          console.log(`💾 Saving deal: ${deal.account_name}`);

          const scores = [args.pain_score, args.metrics_score, args.champion_score, args.eb_score, args.criteria_score, args.process_score, args.competition_score, args.paper_score, args.timing_score];
          const totalScore = scores.reduce((a, b) => a + (Number(b) || 0), 0);
          const newStage = totalScore >= 25 ? "Closed Won" : totalScore >= 20 ? "Commit" : totalScore >= 12 ? "Best Case" : "Pipeline";

          pool.query(
            `UPDATE opportunities SET 
             previous_total_score = (COALESCE(pain_score,0) + COALESCE(metrics_score,0) + COALESCE(champion_score,0) + COALESCE(eb_score,0) + COALESCE(criteria_score,0) + COALESCE(process_score,0) + COALESCE(competition_score,0) + COALESCE(paper_score,0) + COALESCE(timing_score,0)),
             previous_updated_at = updated_at, last_summary = $1, audit_details = $2, forecast_stage = $3, updated_at = NOW(), run_count = COALESCE(run_count, 0) + 1,
             pain_score = $5, metrics_score = $6, champion_score = $7, eb_score = $8, criteria_score = $9, process_score = $10, competition_score = $11, paper_score = $12, timing_score = $13,
             pain_tip = $14, metrics_tip = $15, champion_tip = $16, eb_tip = $17, criteria_tip = $18, process_tip = $19, competition_tip = $20, paper_tip = $21, timing_tip = $22, next_steps = $23
             WHERE id = $4 AND org_id = $24`,
            [args.risk_summary, JSON.stringify(args), newStage, deal.id, args.pain_score, args.metrics_score, args.champion_score, args.eb_score, args.criteria_score, args.process_score, args.competition_score, args.paper_score, args.timing_score, args.pain_tip, args.metrics_tip, args.champion_tip, args.eb_tip, args.criteria_tip, args.process_tip, args.competition_tip, args.paper_tip, args.timing_tip, args.next_steps, orgId]
          ).then(() => {
            console.log(`✅ Saved: ${deal.account_name}`);
            openAiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: output.call_id, output: JSON.stringify({ success: true }) } }));
            
            // Advance Queue
            currentDealIndex++;
            if (currentDealIndex >= dealQueue.length) {
              openAiWs.send(JSON.stringify({ type: "response.create", response: { instructions: `Say exactly: "Review complete. Goodbye ${repName.split(" ")[0]}."` } }));
            } else {
              const nextDeal = dealQueue[currentDealIndex];
              const nextInstructions = getSystemPrompt(nextDeal, repName.split(" ")[0], dealQueue.length - currentDealIndex - 1);
              openAiWs.send(JSON.stringify({ type: "session.update", session: { instructions: nextInstructions } }));
              openAiWs.send(JSON.stringify({ type: "response.create", response: { instructions: `Say exactly: "Pulling up ${nextDeal.account_name}."` } }));
            }
          }).catch((err) => console.error("❌ DB ERROR:", err.message));
        }
      });
    }
  });

  // 6. CLEANUP
  ws.on("close", () => {
    console.log("🔌 Call Closed.");
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
  });
});

// --- [BLOCK 6: API ENDPOINTS] ---
app.get("/", (req, res) => res.send("Forecast Agent API is Online 🤖"));
app.get("/debug/opportunities", async (req, res) => {
  try {
    const orgId = parseInt(req.query.org_id) || 1;
    const result = await pool.query(
      `SELECT id, account_name, forecast_stage, run_count, updated_at FROM opportunities WHERE org_id = $1 ORDER BY updated_at DESC`,
      [orgId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

server.listen(PORT, () => console.log(`🚀 Matthew God-Mode Live on port ${PORT}`));