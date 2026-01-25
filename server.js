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
              description: "Saves scores, tips, and summaries. ALL FIELDS ARE REQUIRED.",
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
                required: [
                  "pain_score", "pain_tip", "pain_summary",
                  "metrics_score", "metrics_tip", "metrics_summary",
                  "champion_score", "champion_tip", "champion_summary",
                  "eb_score", "eb_tip", "eb_summary",
                  "criteria_score", "criteria_tip", "criteria_summary",
                  "process_score", "process_tip", "process_summary",
                  "competition_score", "competition_tip", "competition_summary",
                  "paper_score", "paper_tip", "paper_summary",
                  "timing_score", "timing_tip", "timing_summary",
                  "risk_summary", "next_steps"
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

  // 3. HELPER: FUNCTION HANDLER (The Muscles)
  const handleFunctionCall = async (args) => {
      console.log("🛠️ Tool Triggered: save_deal_data");
      
      try {
          const deal = dealQueue[currentDealIndex];
          const scores = [args.pain_score, args.metrics_score, args.champion_score, args.eb_score, args.criteria_score, args.process_score, args.competition_score, args.paper_score, args.timing_score];
          const totalScore = scores.reduce((a, b) => a + (Number(b) || 0), 0);
          const newStage = totalScore >= 25 ? "Closed Won" : totalScore >= 20 ? "Commit" : totalScore >= 12 ? "Best Case" : "Pipeline";

          // SAVE TO DB
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
              last_summary=$28, next_steps=$29,
              forecast_stage=$30,
              run_count = run_count + 1,
              updated_at = NOW()
             WHERE id = $31`,
            [
              args.pain_score, args.pain_tip, args.pain_summary,
              args.metrics_score, args.metrics_tip, args.metrics_summary,
              args.champion_score, args.champion_tip, args.champion_summary,
              args.eb_score, args.eb_tip, args.eb_summary,
              args.criteria_score, args.criteria_tip, args.criteria_summary,
              args.process_score, args.process_tip, args.process_summary,
              args.competition_score, args.competition_tip, args.competition_summary,
              args.paper_score, args.paper_tip, args.paper_summary,
              args.timing_score, args.timing_tip, args.timing_summary,
              args.risk_summary, args.next_steps, 
              newStage,
              deal.id
            ]
          );
          console.log(`✅ Saved: ${deal.account_name}`);

          // MOVE TO NEXT DEAL
          currentDealIndex++;

          if (currentDealIndex >= dealQueue.length) {
             console.log("🏁 All deals finished.");
             openAiWs.send(JSON.stringify({
                type: "response.create",
                response: { instructions: "Say: 'That concludes the review. Great work today.' and then hang up." }
             }));
             setTimeout(() => process.exit(0), 5000); 
          } else {
             const nextDeal = dealQueue[currentDealIndex];
             console.log(`➡️ Moving to next: ${nextDeal.account_name}`);
             
             const nextInstructions = getSystemPrompt(nextDeal, repName.split(" ")[0], dealQueue.length - 1 - currentDealIndex);
             
             // UPDATE BRAIN (Context Nuke)
             openAiWs.send(JSON.stringify({
                type: "session.update",
                session: { instructions: nextInstructions }
             }));
             
             // FORCE SPEAKING
             openAiWs.send(JSON.stringify({
                type: "response.create",
                response: { instructions: `Say: 'Okay, saved. Next up is ${nextDeal.account_name}. What is the latest there?'` }
             }));
          }
      } catch (err) {
          console.error("❌ Save Failed:", err);
      }
  };

  // 4. OPENAI EVENT LISTENER
  openAiWs.on("open", async () => {
    console.log("📡 OpenAI Connected");
    openAiReady = true;
    openAiWs.send(JSON.stringify({
      type: "session.update",
      session: { turn_detection: null, input_audio_format: "g711_ulaw", output_audio_format: "g711_ulaw", voice: "verse" }
    }));
    attemptLaunch();
  });

  openAiWs.on("message", (data) => {
    const response = JSON.parse(data);

    // Speak
    if (response.type === "response.audio.delta" && response.delta) {
      ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: response.delta } }));
    }

    // LISTENING FOR TOOL CALLS (The Fix)
    if (response.type === "response.function_call_arguments.done") {
        if (response.name === "save_deal_data") {
            const args = JSON.parse(response.arguments);
            handleFunctionCall(args);
        }
    }
  });

  // 5. TWILIO EVENT LISTENER
  ws.on("message", (message) => {
    const msg = JSON.parse(message);
    if (msg.event === "start") {
      streamSid = msg.start.streamSid;
      const params = msg.start.customParameters;
      if (params) {
          orgId = parseInt(params.org_id) || 1;
          repName = params.rep_name || "Guest";
          console.log(`🔎 Params Received: ${repName}`);
          attemptLaunch(); 
      }
    }
    if (msg.event === "media" && openAiWs.readyState === WebSocket.OPEN) {
      openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));
    }
  });

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
