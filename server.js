require("dotenv").config();
const http = require("http");
const express = require("express");
const { Pool } = require("pg");
const WebSocket = require("ws");
const cors = require("cors");

// --- [BLOCK 1: CONFIGURATION] ---
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.MODEL_API_KEY; // Using your specific Env Var
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

// --- [BLOCK DB: POSTGRES POOL] ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --- [BLOCK X: SERVER + WEBSOCKET INIT] ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- [BLOCK 3: SYSTEM PROMPT] ---
function getSystemPrompt(deal, repName, dealsLeft, totalCount) {

    // 1. DATA SANITIZATION
    let category = deal.forecast_stage || "Pipeline";
    if (category === "Null" || category.trim() === "") category = "Pipeline";

    // 2. DATA FORMATTING
    const amountStr = new Intl.NumberFormat('en-US', { 
        style: 'currency', currency: 'USD', maximumFractionDigits: 0 
    }).format(deal.amount || 0);

    // 3. HISTORY EXTRACTION (CRITICAL FIX: Use risk_summary)
    const lastSummary = deal.risk_summary || ""; 
    const hasHistory = lastSummary.length > 5;
    const historyHook = hasHistory ? `Last time we flagged: "${lastSummary}".` : "";

    // 4. MEMORY SNAPSHOT
    const details = deal.audit_details || {}; 
    const scoreContext = `
    PRIOR SNAPSHOT (MEMORY):
    • Pain: ${deal.pain_score || details.pain_score || "?"}/3 (Tip: "${deal.pain_tip || "None"}")
    • Metrics: ${deal.metrics_score || details.metrics_score || "?"}/3 (Tip: "${deal.metrics_tip || "None"}")
    • Champion: ${deal.champion_score || details.champion_score || "?"}/3 (Name: "${deal.champion_name || "Unknown"}")
    • Economic Buyer: ${deal.eb_score || details.eb_score || "?"}/3 (Name: "${deal.eb_name || "Unknown"}")
    • Criteria: ${deal.criteria_score || details.criteria_score || "?"}/3
    • Process: ${deal.process_score || details.process_score || "?"}/3
    • Competition: ${deal.competition_score || details.competition_score || "?"}/3
    • Paper Process: ${deal.paper_score || details.paper_score || "?"}/3
    • Timing: ${deal.timing_score || details.timing_score || "?"}/3
    `;

    // 5. STAGE STRATEGY
    let stageInstructions = "";

    if (category.includes("Commit")) {
        stageInstructions = `MODE: CLOSING AUDIT (Commit). 
    • GOAL: Find the one thing that will kill this deal.
    • LOGIC: If a score is 3, skip it unless you smell a lie. Focus ONLY on scores < 3.`;
    } else {
        stageInstructions = `MODE: PIPELINE QUALIFICATION
    GOAL: Perform a lightweight MEDDICC qualification pass appropriate for early‑stage pipeline.
        BRANCHING LOGIC:
    • If the Forecast Stage is Pipeline and the conversation has just started, ASK:: “Is this deal beyond the discovery phase, or is it an early stage opportunity?”
        IF early stage opportunity (still in discovery):
    • Only assess: Pain, Metrics, Competition, Timing.
    • Do NOT assess: Champion, EB, Criteria, Process, Paper.
    
    IF BEYOND DISCOVERY PHASE:
    • Assess: Pain, Metrics, Champion, Competition, EB, Criteria, Timing.
    • Do NOT assess: Process, Paper.
    
    ADDITIONAL RULES:
- METRIC VALIDATION RULE: If the rep provides qualitative metrics (e.g., "speed," "efficiency," "saving money"), acknowledge them immediately. 
- TWO-STRIKE LIMIT: You may ask for a specific number OR a calculation once. If the rep repeats the qualitative metric or says "I already gave you that," YOU MUST ACCEPT IT, categorize it as "Low Evidence," and move to the next MEDDPICC category.
- CONCURRENCY: Call the 'update_opportunity' tool in the background as soon as a metric is mentioned. Do not wait for the end of the conversation.
- FLOW CONTROL: After receiving a metric, your very next sentence must start with: "Got it, I've noted [Metric]. Now, moving on to [Next Category]..."
    • Even if answers are weak (0–1), continue extraction to build a full picture.
    • Ask only one MEDDICC‑advancing question per turn.
    • Do not coach, explain, or ask follow‑ups during the qualification sequence.`;
    }

    // 6. INTRO
    const closeDateStr = deal.close_date ? new Date(deal.close_date).toLocaleDateString() : "TBD";
    const intro = `Hi ${repName}. This is Matthew, from Sales Forecaster. Today, we will review ${totalCount} deals, starting with ${deal.account_name} (${category}, for ${amountStr}) with a close date of ${closeDateStr}. ${historyHook}`;

    // 7. THE MASTER PROMPT
    return `
### MANDATORY OPENING
   You MUST open exactly with: "${intro} So, lets jump right in - please share the latest update?"

### ROLE & IDENTITY (STRICT MODE)
   You are Matthew, a high‑IQ MEDDPICC extraction agent. You are an **Extractor**, not a Coach.
   You speak ONLY to:
   • Ask the next MEDDPICC question 
   • Ask ONE clarifying question if needed 
   • Deliver the PAIN summary (ONLY if score < 3) 
   • Say: “Got it. I'm updating the scorecard.” 
   • Say: “Okay, saved. Moving to the next deal.”

   You NEVER:
   • Repeat or paraphrase the rep’s answer 
   • Verbally summarize any category except PAIN (<3) 
   • Read scores aloud 
   • Coach verbally 
   • Add filler commentary 

   All summaries, tips, and scores go directly into their fields **silently**.

### CONVERSATION FLOW RULES
   1. Ask ONE MEDDPICC‑advancing question per turn.
   2. If the rep’s answer is unclear → ask ONE clarifying question.
   3. If still unclear → score low and move on.
   4. Never repeat the rep’s answer.
   5. Log everything silently into the correct fields.
   6. PAIN summary is verbal ONLY if score < 3.
   7. No other category summaries are verbal.

### INTELLIGENT AUDIT PROTOCOL
   **Internal Data Review (Silent):** "${scoreContext}" (Do NOT read aloud).
   **Score‑Driven Behavior:** If memory score = 3, ask: “Has anything changed with [Category]?” then move on. If 0–2, ask the MEDDPICC question.

${stageInstructions}

### THE MEDDPICC CHECKLIST (Power Players & Labels)
   
   1. **PAIN (0-3):** "What is the specific cost of doing nothing?"
      - *Labels:* 0=None, 1=Vague, 2=Clear Pain, 3=Quantified Impact ($$$).

   2. **METRICS (0-3):** "How will they measure success?"
      - *Labels:* 0=Unknown, 1=Soft Benefits, 2=Rep-defined KPIs, 3=Customer-validated Economics.

   3. **CHAMPION (POWER PLAYER 1) (0-3):** "Who is selling this when we aren't in the room?"
      - **POWER MOVE:** You MUST ask for their **Name and Title**.
      - *Labels:* 0=Friendly, 1=Coach, 2=Mobilizer, 3=Champion (Has Power).

   4. **ECONOMIC BUYER (POWER PLAYER 2) (0-3):** "Who signs the contract?"
      - **POWER MOVE:** You MUST ask for their **Name and Title**.
      - *Labels:* 0=Unknown, 1=Identified, 2=Indirect access, 3=Direct relationship.

   5. **DECISION CRITERIA (0-3):** "Are technical requirements defined?"
      - *Labels:* 0=No, 1=Vague, 2=Defined, 3=Locked in our favor.

   6. **DECISION PROCESS (0-3):** "How do they buy?"
      - *Labels:* 0=Unknown, 1=Assumed, 2=Understood, 3=Documented.

   7. **COMPETITION (0-3):** "Who are we up against?"
      - *Labels:* 0=Unknown, 1=Assumed, 2=Identified, 3=We know why we win.

   8. **PAPER PROCESS (0-3):** "Where is the contract?"
      - *Labels:* 0=Unknown, 1=Not started, 2=Started, 3=Waiting for signature.

   9. **TIMING (0-3):** "Is there a Compelling Event?"
      - *Labels:* 0=Unknown, 1=Assumed, 2=Flexible, 3=Real consequence.

### INTERNAL TRUTHS (PRODUCT POLICE)
   ${deal.org_product_data || "Verify capabilities against company documentation."}

## COMPLETION PROTOCOL (CRITICAL)
   When you have gathered the data (or if the user says "move on"), you MUST follow this EXACT sequence.
   
   1. **Say:** "Got it. I'm updating the scorecard."
   
   2. **ACTION:** Call the function 'save_deal_data'. 
      - **DATA EXTRACTION RULES (STRICT):**
        - **Champion:** Extract the **Full Name** into 'champion_name' and **Job Title** into 'champion_title'.
        - **Economic Buyer:** Extract the **Full Name** into 'eb_name' and **Job Title** into 'eb_title'.
        - **Coaching:** Write your specific advice in 'rep_comments'.
      - **SUMMARY RULES:** Start every summary field with the Score Label (e.g., "Score 1: ...").
      - **VERDICT:** Use 'risk_summary' for the Full Agent Verdict.
      
   3. **After Tool Success:** Say "Okay, saved. Moving to the next deal."
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

// --- [BLOCK 5: WEBSOCKET CORE (Refactored for Safety)] ---
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

  // 1. HELPER: THE MUSCLE (Clean & Safe)
  const handleFunctionCall = async (args, callId) => {
    console.log("🛠️ Tool Triggered: save_deal_data");
    try {
      const deal = dealQueue[currentDealIndex];
      
      // LOG FOR DEBUGGING
      console.log(`DEBUG: Saving Deal ID ${deal.id}`);

      // Calculate Scores
      const scores = [
        args.pain_score, args.metrics_score, args.champion_score, 
        args.eb_score, args.criteria_score, args.process_score, 
        args.competition_score, args.paper_score, args.timing_score
      ];
      const totalScore = scores.reduce((a, b) => a + (Number(b) || 0), 0);
      const aiOpinion = totalScore >= 21 ? "Commit" : totalScore >= 15 ? "Best Case" : "Pipeline";

      // PREPARE DATA (Separated for Safety)
      const sqlQuery = `
        UPDATE opportunities SET 
          pain_score=$1, pain_tip=$2, pain_summary=$3,
          metrics_score=$4, metrics_tip=$5, metrics_summary=$6,
          champion_score=$7, champion_tip=$8, champion_summary=$9,
          eb_score=$10, eb_tip=$11, eb_summary=$12,
          criteria_score=$13, criteria_tip=$14, criteria_summary=$15,
          process_score=$16, process_tip=$17, process_summary=$18,
          competition_score=$19, competition_tip=$20, competition_summary=$21,
          paper_score=$22, paper_tip=$23, paper_summary=$24,
          timing_score=$25, timing_tip=$26, timing_summary=$27,
          risk_summary=$28, next_steps=$29, 
          champion_name=$30, champion_title=$31, eb_name=$32, eb_title=$33, 
          rep_comments=$34, manager_comments=$35,
          ai_forecast=$36, 
          run_count = COALESCE(run_count, 0) + 1, updated_at = NOW()
          WHERE id = $37`;

      const sqlParams = [
        args.pain_score || 0, args.pain_tip || "", args.pain_summary || "",
        args.metrics_score || 0, args.metrics_tip || "", args.metrics_summary || "",
        args.champion_score || 0, args.champion_tip || "", args.champion_summary || "",
        args.eb_score || 0, args.eb_tip || "", args.eb_summary || "",
        args.criteria_score || 0, args.criteria_tip || "", args.criteria_summary || "",
        args.process_score || 0, args.process_tip || "", args.process_summary || "",
        args.competition_score || 0, args.competition_tip || "", args.competition_summary || "",
        args.paper_score || 0, args.paper_tip || "", args.paper_summary || "",
        args.timing_score || 0, args.timing_tip || "", args.timing_summary || "",
        args.risk_summary || "Audit incomplete", args.next_steps || "TBD",
        args.champion_name || "Unknown", args.champion_title || "Unknown",
        args.eb_name || "Unknown", args.eb_title || "Unknown", 
        args.rep_comments || "", args.manager_comments || "", 
        aiOpinion, deal.id
      ];

      // EXECUTE SQL
      await pool.query(sqlQuery, sqlParams);

      console.log(`✅ Saved: ${deal.account_name}`);

      // THE HANDSHAKE
      openAiWs.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ status: "success" })
        }
      }));

      // NEXT DEAL
      currentDealIndex++;
      if (currentDealIndex < dealQueue.length) {
        const nextDeal = dealQueue[currentDealIndex];
        openAiWs.send(JSON.stringify({
          type: "response.create",
          response: { instructions: `Say: 'Okay, saved. Next is ${nextDeal.account_name}. What's the update?'` }
        }));
      } else {
        openAiWs.send(JSON.stringify({
          type: "response.create",
          response: { instructions: "Say: 'All deals finished. Great work.' and hang up." }
        }));
      }

    } catch (err) {
      console.error("❌ handleFunctionCall Error:", err);
    }
  };

  // 2. THE EAR: Listen for OpenAI messages
  openAiWs.on("message", (data) => {
    try {
      const response = JSON.parse(data);

      if (response.type === "response.function_call_arguments.done") {
        const args = JSON.parse(response.arguments);
        handleFunctionCall(args, response.call_id);
      }

      if (response.type === "response.audio.delta" && response.delta) {
        if (streamSid) {
          ws.send(JSON.stringify({ event: "media", streamSid: streamSid, media: { payload: response.delta } }));
        }
      }
    } catch (err) {
      console.error("❌ OpenAI Message Error:", err);
    }
  });

  // 3. LAUNCHER
  openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");
    openAiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "verse",
        turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 1000 }
      }
    }));
    openAiReady = true;
    attemptLaunch();
  });

  const attemptLaunch = async () => {
    if (!repName || !openAiReady) return; 
    try {
      const result = await pool.query(`SELECT o.*, org.product_truths AS org_product_data FROM opportunities o JOIN organizations org ON o.org_id = org.id WHERE o.org_id = $1 AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost') ORDER BY o.id ASC`, [orgId]);
      dealQueue = result.rows;
    } catch (err) { console.error("❌ DB Error:", err.message); }

    if (dealQueue.length > 0) {
      const firstDeal = dealQueue[0];
      const instructions = getSystemPrompt(firstDeal, repName.split(" ")[0], dealQueue.length - 1, dealQueue.length);
      openAiWs.send(JSON.stringify({
        type: "session.update",
        session: { 
            instructions, 
            tools: [{ type: "function", name: "save_deal_data", description: "Saves deal data", parameters: { type: "object", properties: { pain_score: { type: "number" }, metrics_score: { type: "number" }, champion_score: { type: "number" }, eb_score: { type: "number" }, criteria_score: { type: "number" }, process_score: { type: "number" }, competition_score: { type: "number" }, paper_score: { type: "number" }, timing_score: { type: "number" }, pain_tip: { type: "string" }, pain_summary: { type: "string" }, metrics_tip: { type: "string" }, metrics_summary: { type: "string" }, champion_tip: { type: "string" }, champion_summary: { type: "string" }, eb_tip: { type: "string" }, eb_summary: { type: "string" }, criteria_tip: { type: "string" }, criteria_summary: { type: "string" }, process_tip: { type: "string" }, process_summary: { type: "string" }, competition_tip: { type: "string" }, competition_summary: { type: "string" }, paper_tip: { type: "string" }, paper_summary: { type: "string" }, timing_tip: { type: "string" }, timing_summary: { type: "string" }, risk_summary: { type: "string" }, next_steps: { type: "string" }, champion_name: { type: "string" }, champion_title: { type: "string" }, eb_name: { type: "string" }, eb_title: { type: "string" }, rep_comments: { type: "string" }, manager_comments: { type: "string" } }, required: ["pain_score", "risk_summary"] } }] 
        }
      }));
      setTimeout(() => openAiWs.send(JSON.stringify({ type: "response.create" })), 500);
    }
  };

  // 4. TWILIO EVENT LISTENER
  ws.on("message", (message) => {
    try {
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
    } catch (err) {
      console.error("❌ Twilio Message Error:", err);
    }
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
    const result = await pool.query(
      `SELECT * FROM opportunities WHERE org_id = $1 ORDER BY updated_at DESC`,
      [orgId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
server.listen(PORT, () => console.log(`🚀 Matthew God-Mode Live on port ${PORT}`));
