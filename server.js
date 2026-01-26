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
function getSystemPrompt(deal, repName, dealsLeft, totalCount) {
  // 1. DATA SANITIZATION
  let category = deal.forecast_stage || "Pipeline";
  if (category === "Null" || category.trim() === "") category = "Pipeline";

  // 2. DATA FORMATTING
  const amountStr = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
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
• GOAL: Identify the strength of the foundation, Pipeline is a light review because the sales processes is new. 
• LOGIC: Capture the status of Pain, Metrics, and Champion. Even if they are weak (0-1), continue the extraction to get a full picture of the deal.`; 
  }

  // 6. INTRO
  const closeDateStr = deal.close_date
    ? new Date(deal.close_date).toLocaleDateString()
    : "TBD";

  const intro = `Hi ${repName}. My name is Matthew, I am your Sales Forecaster assistant. Today, we will review ${totalCount} deals, starting with ${deal.account_name} (${category}, for ${amountStr}) with a close date of ${closeDateStr}. ${historyHook}`;

  // 7. THE MASTER PROMPT
  return `
### MANDATORY OPENING
   You MUST open exactly with: "${intro} So, lets jump right in - please share the latest update?"
   ### ROLE & IDENTITY
   You are Matthew, a high-IQ Sales Strategist. You are an **Extractor**, not a Coach.
   
   **CRITICAL RULE:** Do NOT stop the call to fix weak areas. Your job is to assess, record evidence, and move through the categories.
   
   **SKEPTICISM RULE:** Never assume a category is "strong" unless the representative provides evidence. If they are vague, assume it is a RISK and probe deeper.
   
   ${stageInstructions}
   ### INTELLIGENT AUDIT PROTOCOL
   1. **INTERNAL DATA REVIEW (DO NOT READ ALOUD):**
       - The following is your memory of the previous call: "${scoreContext}".
       - **CRITICAL:** Do NOT read these scores, tips, or summaries to the user. They are for your logic only.
    
   2. **EXECUTION LOGIC:**
       - **If a Score is 3 (from memory):** Briefly confirm ("I see [Category] is fully validated. Has anything changed?") and move on.
       - **If a Score is 0-2 (from memory):** Ask the specific question from the checklist below.

   3. **DYNAMIC LISTENING:**
       - If the user mentions "Pain" while answering "Metrics", LOG BOTH.

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

### COMPLETION PROTOCOL (CRITICAL)
   When you have gathered the data (or if the user says "move on"), you MUST follow this EXACT sequence. Do not deviate.
   1. **Say:** "Got it. I'm updating the scorecard."
   2. **ACTION:** Call the function 'save_deal_data'. 
      - **SUMMARY RULES:** Start every summary field (e.g., pain_summary) with the Score Label (e.g., "Score 1: Soft Benefits only"). Then explain the gap.
      - **TIP RULES (THE COACH):** For every category: If Score is 3, Tip is "None". If Score < 3, you MUST write the specific coaching advice you held back during the call in the 'tip' field (e.g., pain_tip).
      - **VERDICT:** Use the 'risk_summary' field to provide the "Full Agent Verdict."
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

  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");

    // Configure session before setting ready flag
    openAiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "verse",
        turn_detection: { 
          type: "server_vad", 
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500 
        }
      }
    }));

    openAiReady = true;
    attemptLaunch();
  });

  openAiWs.on("error", (err) => {
    console.error("❌ OpenAI WebSocket Error:", err.message);
  });

  // 2. HELPER: LAUNCHER
  const attemptLaunch = async () => {
      if (!repName || !openAiReady) return; 

      console.log(`🚀 Launching Session for ${repName}`);

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

      if (dealQueue.length === 0) {
         openAiWs.send(JSON.stringify({ type: "session.update", session: { instructions: "System Message." } }));
         openAiWs.send(JSON.stringify({ type: "response.create", response: { instructions: `Say: 'Hello ${repName}. I connected, but I found zero active deals.'` } }));
         return;
      }

      const firstDeal = dealQueue[0];
      const instructions = getSystemPrompt(firstDeal, repName.split(" ")[0], dealQueue.length - 1, dealQueue.length);     

      const sessionUpdate = {
        type: "session.update",
        session: {
          turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 1000 },
          instructions: instructions,
          tools: [{
              type: "function",
              {
  name: "save_deal_data",
  description: "Saves scores, tips, and summaries. ALL FIELDS ARE OPTIONAL - only save what is mentioned.",
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
      risk_summary: { type: "string" },
      next_steps: { type: "string" },
      // --- NEW POWER MAP FIELDS ---
      champion_name: { type: "string", description: "The full name of the Champion if mentioned." },
      champion_title: { type: "string", description: "The job title of the Champion." },
      eb_name: { type: "string", description: "The full name of the Economic Buyer if mentioned." },
      eb_title: { type: "string", description: "The job title of the Economic Buyer." },
      // --- NEW COACHING FIELDS ---
      rep_comments: { type: "string", description: "Blunt coaching for the rep." },
      manager_comments: { type: "string", description: "The #1 risk for the manager." }
    },
    required: [] 
  }
}

      openAiWs.send(JSON.stringify(sessionUpdate));
      setTimeout(() => { openAiWs.send(JSON.stringify({ type: "response.create" })); }, 500);
  };

// 3. HELPER: FUNCTION HANDLER (The Muscle)
async function handleFunctionCall(args) {
    console.log(`Saving full deal audit for: ${deal.account_name}`);

    try {
        // THE SQL QUERY - All 36 fields mapped in order
        const query = `
            UPDATE opportunities SET 
                pain_score = $1, pain_tip = $2, pain_summary = $3,
                metrics_score = $4, metrics_tip = $5, metrics_summary = $6,
                champion_score = $7, champion_tip = $8, champion_summary = $9,
                eb_score = $10, eb_tip = $11, eb_summary = $12,
                criteria_score = $13, criteria_tip = $14, criteria_summary = $15,
                process_score = $16, process_tip = $17, process_summary = $18,
                competition_score = $19, competition_tip = $20, competition_summary = $21,
                paper_score = $22, paper_tip = $23, paper_summary = $24,
                timing_score = $25, timing_tip = $26, timing_summary = $27,
                risk_summary = $28, next_steps = $29,
                champion_name = $30, champion_title = $31,
                eb_name = $32, eb_title = $33,
                rep_comments = $34, manager_comments = $35,
                updated_at = NOW(),
                run_count = run_count + 1
            WHERE id = $36;
        `;

        // THE VALUES - Mapping the AI's "thoughts" to your DB columns
        const values = [
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
            args.champion_name || null, args.champion_title || null,
            args.eb_name || null, args.eb_title || null,
            args.rep_comments || "Coaching will appear here.",
            args.manager_comments || "Critical risks will appear here.",
            deal.id // The current deal being audited
        ];

        const dbResult = await pool.query(query, values);

        if (dbResult.rowCount > 0) {
            console.log(`✅ DATABASE UPDATED: ${deal.account_name}`);
        }

        // --- 4. PROCEED TO NEXT DEAL LOGIC ---
        currentDealIndex++;
        
        if (currentDealIndex >= dealQueue.length) {
            // No more deals left in the list
            openAiWs.send(JSON.stringify({
                type: "response.create",
                response: { instructions: "Say: 'Saved. That's all for today.' and hang up." }
            }));
        } else {
            // Move to the next deal in the queue
            const nextDeal = dealQueue[currentDealIndex];
            const remaining = dealQueue.length - currentDealIndex;
            const nextInstructions = getSystemPrompt(nextDeal, repName.split(" ")[0], remaining - 1, dealQueue.length);

            // Update the AI's context for the new deal
            openAiWs.send(JSON.stringify({
                type: "session.update",
                session: { instructions: nextInstructions }
            }));

            // Tell the AI to announce the next deal
            openAiWs.send(JSON.stringify({
                type: "response.create",
                response: { instructions: `Say: 'Saved. Next is ${nextDeal.account_name}. What's the latest?'` }
            }));
        }

    } catch (err) {
        console.error("❌ CRITICAL DATABASE ERROR:", err.message);
        openAiWs.send(JSON.stringify({
            type: "response.create",
            response: { instructions: "Say: 'I had trouble hitting the database. Let me try again.'" }
        }));
    }
}
// 4. OPENAI EVENT LISTENER (The Ear)
openAiWs.on("message", (data) => {
    const response = JSON.parse(data);

    // 1. Audio Passthrough
    if (response.type === "response.audio.delta" && response.delta) {
        ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: response.delta } }));
    }

    // 2. THE TRIGGER: Fast & Reliable
    if (response.type === "response.function_call_arguments.done" && response.name === "save_deal_data") {
        console.log("🛠️ Save Triggered by OpenAI");
        try {
            const args = JSON.parse(response.arguments);

            // CRITICAL FIX: Tell OpenAI the tool finished so it can clear its "wait" state
            openAiWs.send(JSON.stringify({
                type: "conversation.item.create",
                item: {
                    type: "function_call_output",
                    call_id: response.call_id, // Match the ID from the event
                    output: JSON.stringify({ status: "success", message: "Deal saved." })
                }
            }));

            // Now run the Muscle
            handleFunctionCall(args); 
        } catch (error) {
            console.error("❌ Error parsing tool arguments:", error);
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
