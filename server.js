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
    // 1. DATA SANITIZATION
    let category = deal.forecast_stage || "Pipeline";
    if (category === "Null" || category.trim() === "") category = "Pipeline";

    // 2. DATA FORMATTING
    const amountStr = new Intl.NumberFormat('en-US', { 
        style: 'currency', currency: 'USD', maximumFractionDigits: 0 
    }).format(deal.amount || 0);

    // 3. HISTORY EXTRACTION
    const lastSummary = deal.last_summary || "";
    const hasHistory = lastSummary.length > 5;
    const historyHook = hasHistory 
        ? `Last time we flagged: "${lastSummary}".` 
        : "";

    // 4. MEMORY SNAPSHOT
    const details = deal.audit_details || {}; 
    const scoreContext = `
    PRIOR SNAPSHOT (MEMORY):
    • Pain: ${deal.pain_score || details.pain_score || "?"}/3 
      > Last Tip: "${deal.pain_tip || "None"}"
      > Last Reasoning: ${deal.pain_summary || "No notes yet."}
      
    • Metrics: ${deal.metrics_score || details.metrics_score || "?"}/3 
      > Last Tip: "${deal.metrics_tip || "None"}"
      > Last Reasoning: ${deal.metrics_summary || "No notes yet."}
      
    • Champion: ${deal.champion_score || details.champion_score || "?"}/3 
      > Last Tip: "${deal.champion_tip || "None"}"
      > Last Reasoning: ${deal.champion_summary || "No notes yet."}
      
    • Economic Buyer: ${deal.eb_score || details.eb_score || "?"}/3 
      > Last Tip: "${deal.eb_tip || "None"}"
      > Last Reasoning: ${deal.eb_summary || "No notes yet."}
      
    • Criteria: ${deal.criteria_score || details.criteria_score || "?"}/3 
      > Last Tip: "${deal.criteria_tip || "None"}"
      > Last Reasoning: ${deal.criteria_summary || "No notes yet."}
      
    • Process: ${deal.process_score || details.process_score || "?"}/3 
      > Last Tip: "${deal.process_tip || "None"}"
      > Last Reasoning: ${deal.process_summary || "No notes yet."}
      
    • Competition: ${deal.competition_score || details.competition_score || "?"}/3 
      > Last Tip: "${deal.competition_tip || "None"}"
      > Last Reasoning: ${deal.competition_summary || "No notes yet."}
      
    • Paper Process: ${deal.paper_score || details.paper_score || "?"}/3 
      > Last Tip: "${deal.paper_tip || "None"}"
      > Last Reasoning: ${deal.paper_summary || "No notes yet."}
      
    • Timing: ${deal.timing_score || details.timing_score || "?"}/3 
      > Last Tip: "${deal.timing_tip || "None"}"
      > Last Reasoning: ${deal.timing_summary || "No notes yet."}
    `;

    // 5. STAGE STRATEGY
    let stageInstructions = "";
    if (category.includes("Commit")) {
        stageInstructions = `MODE: CLOSING AUDIT (Commit). 
        • GOAL: Find the one thing that will kill this deal.
        • LOGIC: If a score is 3, skip it unless you smell a lie. Focus ONLY on scores < 3.`;
    } else {
        stageInstructions = `MODE: PIPELINE QUALIFICATION. 
        • GOAL: Build the foundation.
        • LOGIC: If Pain/Metrics/Champion are weak (0-1), STOP and fix them. Do not ask about Legal/Paperwork yet.`;
    }

    // 6. INTRO
    const intro = `Hi ${repName}. Pulling up ${deal.account_name} (${category}, ${amountStr}). ${historyHook}`;

    // 7. THE MASTER PROMPT
    return `
### MANDATORY OPENING
    You MUST open exactly with: "${intro} What is the latest update?"

    ### ROLE & IDENTITY
    You are Matthew, a high-IQ Sales Strategist. You are NOT a script reader.
    ${stageInstructions}

    ### INTELLIGENT AUDIT PROTOCOL
    1. **READ THE MEMORY:** Look at "${scoreContext}".
       - **If a Score is 3:** Briefly confirm ("I see [Category] is fully validated. Has anything changed?") and move on.
       - **If a Score is 0-2:** Ask the specific question below.
    
    2. **DYNAMIC LISTENING:**
       - If the user mentions "Pain" while answering "Metrics", LOG BOTH.
       - If the user implies a score should change, update it.

    ### THE MEDDPICC CHECKLIST (Mental Map, Not a Script)
    Cover these areas naturally. Do not number them 1-9 like a robot.

    [BRANCH B: FORECAST AUDIT (PURE EXTRACTION)]
    *CORE RULE:* You are a Data Collector, not a Coach.
    - If the Rep's answer is weak, mark the score low (0 or 1) and move on. 
    - **Context Matters:** If the deal is "Pipeline", use the softer questions below.

    1. **PAIN (0-3):** "What is the specific cost of doing nothing here?"
       - *Scoring:* 0=None, 1=Vague/cost of doing nothing is minimal, 2=Clear Pain, 3=Quantified Impact (Cost of doing nothing is high).

    2. **METRICS (0-3):** "How will they measure the success of this project?"
       - *Scoring:* 0=Unknown, 1=Soft Benefits, 2=Rep-defined KPIs, 3=Customer-validated Economics.

    3. **CHAMPION (0-3):** "Who is selling this for us when we aren't in the room?"
       - *Scoring:* 0=Friendly, 1=Coach, 2=Mobilizer, 3=Champion.

    4. **ECONOMIC BUYER (0-3):** "Do we have a direct line to the person who signs the contract?"
       - *Scoring:* 0=Unknown, 1=Identified only, 2=Indirect access, 3=Direct relationship.

    5. **DECISION CRITERIA (0-3):** "Are the technical requirements fully defined?"
       - *Scoring:* 0=No, 1=Vague, 2=Defined, 3=Locked in our favor.

    6. **DECISION PROCESS (0-3):** - *If Pipeline:* "Do we have a sense of how they usually buy software like this?"
       - *If Best Case/Commit:* "Walk me through the approval chain."
       - *Scoring:* 0=Unknown, 1=Assumed, 2=Understood, 3=Documented/Verified.

    7. **COMPETITION (0-3):** - *If Pipeline:* "Are they looking at anyone else yet, or is this sole-source?"
       - *If Best Case/Commit:* "Who are we up against and why do we win?"
       - *Scoring:* 0=Unknown, 1=Assumed, 2=Identified, 3=We know why we win.

    8. **PAPER PROCESS (0-3):** - *If Pipeline:* **DO NOT ASK.** (Auto-score 0).
       - *If Best Case/Commit:* "Where does the contract sit right now?"
       - *Scoring:* 0=Unknown, 1=Known, not started, 2=Started, 3=In Process, waiting on order.

    9. **TIMING (0-3):** - *If Pipeline:* "Is there a target date in mind?"
       - *If Best Case/Commit:* "Is there a Compelling Event if we miss the date?"
       - *Scoring:* 0=Unknown, 1=Assumed, 2=Confirmed, flexible, 3=Confirmed, real consequence if missed.

    ### INTERNAL TRUTHS (PRODUCT POLICE)
    ${deal.org_product_data || "Verify capabilities against company documentation."}

### COMPLETION PROTOCOL
    IMMEDIATELY upon gathering the data (or if the user says "move on"), perform this sequence:
    1. **Summarize:** "Got it. I'm updating the scorecard."
    2. **TRIGGER TOOL:** Call 'save_deal_data'.
       - **SUMMARY RULES:** You MUST start the summary with the Score Label (e.g., "Score 1: Soft Benefits only"). Then explain the gap.
       - **TIP RULES (THE COACH):** - If Score is 3: Tip is "None". 
         - If Score < 3: You MUST write the specific coaching advice you held back during the call. Tell the rep exactly what action to take to get a 3.
3. **Ending:** Say "Okay, moving to the next deal."
    `;
}

// --- [BLOCK 4: SMART RECEPTIONIST] ---
app.post("/agent", async (req, res) => {
  try {
    console.log("📞 Incoming Call...");
    
    // 1. Try to get name from URL
    let repName = req.query.rep_name;
    let orgId = req.query.org_id || 1;

    // 2. If no name in URL, try "Caller ID" Lookup
    if (!repName) {
        const callerPhone = req.body.From; // Twilio Caller ID
        console.log(`🔎 Looking up Caller ID: ${callerPhone}`);
        
        try {
            // Find the Rep associated with this phone number
            const userCheck = await pool.query(
                `SELECT rep_name, org_id FROM opportunities 
                 WHERE rep_phone = $1 LIMIT 1`, 
                [callerPhone]
            );
            
            if (userCheck.rows.length > 0) {
                repName = userCheck.rows[0].rep_name;
                orgId = userCheck.rows[0].org_id;
                console.log(`🎉 Found Rep in DB: ${repName}`);
            } else {
                console.log("⚠️ Number not found in DB, defaulting to Guest.");
                repName = "Guest";
            }
        } catch (dbErr) {
            console.error("❌ DB Lookup Failed:", dbErr.message);
            repName = "Guest";
        }
    }

    console.log(`✅ Identified Rep: ${repName}`);

    // 3. Connect to WebSocket
    const streamUrl = `wss://${req.headers.host}/`;
    res.type("text/xml");
    res.send(`
      <Response>
        <Connect>
          <Stream url="${streamUrl}">
            <Parameter name="rep_name" value="${repName}" />
            <Parameter name="org_id" value="${orgId}" />
          </Stream>
        </Connect>
      </Response>
    `);
  } catch (err) {
    console.error("❌ Error in /agent route:", err);
    res.status(500).send("Server Error");
  }
});

// --- [BLOCK 5: WEBSOCKET CORE] ---
wss.on("connection", async (ws) => {
  console.log("🔥 Twilio WebSocket connected");

  // State
  let streamSid = null;
  let dealQueue = [];
  let currentDealIndex = 0;
  let repName = null; 
  let orgId = 1;
  let openAiReady = false;

  // 1. CONNECT TO OPENAI
  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  // 2. HELPER: LAUNCHER
  const attemptLaunch = async () => {
      if (!repName || !openAiReady) return; 

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
            type: "session.update",
            session: {
               turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 1000 },
               instructions: "System Message."
            }
          }));
          openAiWs.send(JSON.stringify({ type: "response.create", response: { instructions: `Say: 'Hello ${repName}. I connected, but I found zero active deals.'` } }));
          return;
      }

      // C. Inject Auditor Persona
      const firstDeal = dealQueue[0];
      const instructions = getSystemPrompt(firstDeal, repName.split(" ")[0], dealQueue.length - 1);
      
      const sessionUpdate = {
        type: "session.update",
        session: {
          turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 1000 },
          instructions: instructions,
          tools: [{
              type: "function",
              name: "save_deal_data",
              description: "Saves scores, tips, and reasoning summaries to the database.",
              parameters: {
                type: "object",
                properties: {
                  // PAIN
                  pain_score: { type: "number" }, pain_tip: { type: "string" }, 
                  pain_summary: { type: "string", description: "Reasoning for Pain score" },
                  // METRICS
                  metrics_score: { type: "number" }, metrics_tip: { type: "string" },
                  metrics_summary: { type: "string", description: "Reasoning for Metrics score" },
                  // CHAMPION
                  champion_score: { type: "number" }, champion_tip: { type: "string" },
                  champion_summary: { type: "string", description: "Reasoning for Champion score" },
                  // EB
                  eb_score: { type: "number" }, eb_tip: { type: "string" },
                  eb_summary: { type: "string", description: "Reasoning for EB score" },
                  // CRITERIA
                  criteria_score: { type: "number" }, criteria_tip: { type: "string" },
                  criteria_summary: { type: "string", description: "Reasoning for Criteria score" },
                  // PROCESS
                  process_score: { type: "number" }, process_tip: { type: "string" },
                  process_summary: { type: "string", description: "Reasoning for Process score" },
                  // COMPETITION
                  competition_score: { type: "number" }, competition_tip: { type: "string" },
                  competition_summary: { type: "string", description: "Reasoning for Competition score" },
                  // PAPER
                  paper_score: { type: "number" }, paper_tip: { type: "string" },
                  paper_summary: { type: "string", description: "Reasoning for Paper score" },
                  // TIMING
                  timing_score: { type: "number" }, timing_tip: { type: "string" },
                  timing_summary: { type: "string", description: "Reasoning for Timing score" },

                  // GENERAL
                  risk_summary: { type: "string" }, 
                  next_steps: { type: "string" },
                },
                // THE FIX 1: We PUT TIPS BACK into Required. 
                // We keep Summaries optional (Safe), but force Tips (Data Quality).
                required: [
                  "pain_score", "pain_tip",
                  "metrics_score", "metrics_tip",
                  "champion_score", "champion_tip",
                  "eb_score", "eb_tip",
                  "criteria_score", "criteria_tip",
                  "process_score", "process_tip",
                  "competition_score", "competition_tip",
                  "paper_score", "paper_tip",
                  "timing_score", "timing_tip",
                  "next_steps"
                ],
              },
          }],
          tool_choice: "auto",
        },
      };

      openAiWs.send(JSON.stringify(sessionUpdate));
      
      // D. Force Opening Line
      setTimeout(() => { 
        openAiWs.send(JSON.stringify({ type: "response.create" })); 
      }, 500);
  };

  // 3. OPENAI CONNECTED
  openAiWs.on("open", async () => {
    console.log("📡 OpenAI Connected");
    openAiReady = true;
    
    // Disable Ears Initially
    openAiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        turn_detection: null, 
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "verse"
      }
    }));

    // Check if Twilio is already waiting
    attemptLaunch();
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
          console.log(`🔎 Params Received: ${repName}`);
          attemptLaunch(); 
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

          // DEFAULTS
          const riskSummary = args.risk_summary || "Deal progressed.";
          const painSum = args.pain_summary || "No notes.";
          const metricsSum = args.metrics_summary || "No notes.";
          const champSum = args.champion_summary || "No notes.";
          const ebSum = args.eb_summary || "No notes.";
          const critSum = args.criteria_summary || "No notes.";
          const procSum = args.process_summary || "No notes.";
          const compSum = args.competition_summary || "No notes.";
          const paperSum = args.paper_summary || "No notes.";
          const timeSum = args.timing_summary || "No notes.";

          pool.query(
            `UPDATE opportunities SET 
             previous_total_score = (COALESCE(pain_score,0) + COALESCE(metrics_score,0) + COALESCE(champion_score,0) + COALESCE(eb_score,0) + COALESCE(criteria_score,0) + COALESCE(process_score,0) + COALESCE(competition_score,0) + COALESCE(paper_score,0) + COALESCE(timing_score,0)),
             previous_updated_at = updated_at, last_summary = $1, audit_details = $2, forecast_stage = $3, updated_at = NOW(), run_count = COALESCE(run_count, 0) + 1,
             
             pain_score = $5, metrics_score = $6, champion_score = $7, eb_score = $8, criteria_score = $9, process_score = $10, competition_score = $11, paper_score = $12, timing_score = $13,
             pain_tip = $14, metrics_tip = $15, champion_tip = $16, eb_tip = $17, criteria_tip = $18, process_tip = $19, competition_tip = $20, paper_tip = $21, timing_tip = $22,
             next_steps = $23,
             
             pain_summary = $25, metrics_summary = $26, champion_summary = $27, eb_summary = $28, criteria_summary = $29, process_summary = $30, competition_summary = $31, paper_summary = $32, timing_summary = $33

             WHERE id = $4 AND org_id = $24`,
            [
              riskSummary, JSON.stringify(args), newStage, deal.id, 
              args.pain_score, args.metrics_score, args.champion_score, args.eb_score, args.criteria_score, args.process_score, args.competition_score, args.paper_score, args.timing_score, 
              args.pain_tip, args.metrics_tip, args.champion_tip, args.eb_tip, args.criteria_tip, args.process_tip, args.competition_tip, args.paper_tip, args.timing_tip, 
              args.next_steps, orgId, 
              painSum, metricsSum, champSum, ebSum, critSum, procSum, compSum, paperSum, timeSum 
            ]
          ).then(() => {
            console.log(`✅ Saved: ${deal.account_name}`);
            
            // 1. Tell AI the save worked
            openAiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: output.call_id, output: JSON.stringify({ success: true }) } }));
            
            // 2. Advance Queue
            currentDealIndex++;
            
            if (currentDealIndex >= dealQueue.length) {
              console.log("🏁 Queue Finished.");
              openAiWs.send(JSON.stringify({ type: "response.create", response: { instructions: `Say exactly: "Review complete. Goodbye ${repName.split(" ")[0]}."` } }));
            } else {
              const nextDeal = dealQueue[currentDealIndex];
              console.log(`👉 Moving to next deal: ${nextDeal.account_name}`);
              
              const nextInstructions = getSystemPrompt(nextDeal, repName.split(" ")[0], dealQueue.length - currentDealIndex - 1);
              
              // 3. THE FIX 2: CONTEXT NUKE. We use a "System" marker to force the brain switch.
              openAiWs.send(JSON.stringify({ 
                  type: "session.update", 
                  session: { 
                      instructions: `*** IMPORTANT: PREVIOUS DEAL CLOSED. NEW DEAL STARTED. ***\n\nIGNORE ALL PREVIOUS CONTEXT about ${deal.account_name}.\n\n` + nextInstructions 
                  } 
              }));
              
              // 4. Force Speech with a "Clearing" opening line
              setTimeout(() => {
                  openAiWs.send(JSON.stringify({ 
                      type: "response.create", 
                      response: { 
                          instructions: `Say exactly: "Okay, I've filed that away. Now pulling up ${nextDeal.account_name} for $${nextDeal.amount}. What is the latest update here?"` 
                      } 
                  }));
              }, 250);
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
    
    // Changing the specific list to '*' unlocks every column in your DB
    const result = await pool.query(
      `SELECT * FROM opportunities WHERE org_id = $1 ORDER BY updated_at DESC`,
      [orgId]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error("Dashboard Fetch Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

server.listen(PORT, () => console.log(`🚀 Matthew God-Mode Live on port ${PORT}`));
