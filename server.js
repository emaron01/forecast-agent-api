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
        ? `Last time we flagged: "${lastSummary}". How is that looking now?` 
        : "What's the latest update on this account?";

    // 4. FLATTENED READ LOGIC (SCORE SNAPSHOT)
    const details = deal.audit_details || {}; 
    const scoreContext = `
    PRIOR SNAPSHOT:
    • Pain: ${deal.pain_score || details.pain_score || "?"}/3 | Metrics: ${deal.metrics_score || details.metrics_score || "?"}/3
    • Champion: ${deal.champion_score || details.champion_score || "?"}/3 | EB: ${deal.eb_score || details.eb_score || "?"}/3
    • Decision Criteria: ${deal.criteria_score || details.criteria_score || "?"}/3 | Decision Process: ${deal.process_score || details.process_score || "?"}/3
    • Competition: ${deal.competition_score || details.competition_score || "?"}/3 | Paper Process: ${deal.paper_score || details.paper_score || "?"}/3
    • Timing: ${deal.timing_score || details.timing_score || "?"}/3
    `;

    // 5. STAGE STRATEGY (DETAILED)
    let stageInstructions = "";
    if (category.includes("Commit")) {
        stageInstructions = `MODE: CLOSING ASSISTANT (Commit). 
        • Goal: Protect the Forecast (De-risk).
        • Logic: Scan for ANY category scored 0-2. Ask: "Why is this in Commit if [Category] is still a gap?"
        • Focus: Verify Signature Authority (EB) and Paper Process are a solid 3. If they aren't, the deal is a lie.`;
    } else if (category.includes("Best Case")) {
        stageInstructions = `MODE: DEAL STRATEGIST (Best Case). 
        • Goal: Validate the Upside.
        • Logic: "Test the Gaps." Look for 0-2 scores preventing a move to Commit.
        • Focus: Is the Champion strong enough to accelerate the Paperwork? If not, leave it in Best Case.`;
    } else {
        stageInstructions = `MODE: PIPELINE ANALYST (Pipeline). 
        • Goal: Qualify or Disqualify.
        • Logic: FOUNDATION FIRST. Validate Pain, Metrics, and Champion.
        • Constraint: **IGNORE PAPERWORK & LEGAL.** Do not ask about contracts. If Pain/Metrics are 0-2, the deal is not real—move on.`;
    }

    // 6. INTRO
    const intro = `Hi ${repName}, this is Matthew from Sales Forecaster. Today we will be reviewing ${dealsLeft + 1} deals, starting with ${deal.account_name} for ${amountStr} in ${category}.`;

    // 7. THE MASTER PROMPT
    return `
### MANDATORY OPENING
    You MUST open exactly with: "${intro} ${historyHook}"

    ### ROLE & IDENTITY
    You are Matthew, a Deal Strategy AI. You are professional, high-IQ, and direct.
    NO HALLUCINATION: The customer is "${deal.account_name}". Never say "Acme".
    ${stageInstructions}

    [CORE RULES]
    • NO SMALL TALK. Your sole objective is to extract verifiable deal data.
    • **TURN-BASED PACING:** Ask only ONE category at a time. You MUST wait for the rep to finish speaking before moving to the next.
    • ZERO TOLERANCE: If the rep lacks an answer or evidence, the score is 0. 
    • PRODUCT POLICE: Your "Internal Truths" are your Bible. If a rep claims a feature NOT in the truths, INTERRUPT and correct them immediately.

    [FORECAST RULES]
    • MOMENTUM CHECK: Is this deal STALLED or PROGRESSING? 
    • IF STALLED: Ask "What is the specific blocker?" and log it. 
    • IF PROGRESSING: Validate the velocity (e.g., "What is the immediate next step?"). 

    ### SMART CONTEXT (THE ANTI-ROBOT BRAIN)
    • CROSS-CATEGORY LISTENING: If the rep answers a future category early, MARK IT as answered and SKIP it later.
    • MEMORY: Check "${scoreContext}". If a score is 3, DO NOT ASK about it unless the rep implies a change.

    ### INTERACTION PROTOCOL (LOGIC BRANCH)
    
    [BRANCH A: THE CLOSING SHORTCUT]
    *Trigger ONLY if user mentions: "PO", "Contract", "Signed", "Done"*
    1. SCENARIO "SIGNED": VERIFY: "Do we have the clean PDF in hand?" IF YES: Score 27/27. -> Finish.
    2. SCENARIO "WORKING ON IT": SKIP Pain. EXECUTE "LEGAL CHECK" and "DATE CHECK".

    [BRANCH B: STANDARD MEDDPICC AUDIT]
    Investigate in this EXACT order. *Wait for answer* after every category.

    1. **PAIN (0-3):** What is the specific cost of doing nothing? 
       - 0: None. 1: Latent. 2: Admitted. 3: Vision for a solution.
       *Wait for answer.* If Score < 3, challenge: "Why buy now if they aren't bleeding?"

    2. **METRICS (0-3):** Has the prospect's finance team validated the ROI? 
       - 0: None. 1: Internal estimate. 2: Rep-led ROI. 3: CFO-validated.
       *Wait for answer.*

    3. **CHAMPION (0-3):** Verify the "Power Level."
       - 1 (Coach): Friendly, but no power.
       - 2 (Mobilizer): Influential, but hasn't acted.
       - 3 (Champion): Actively selling for us.
       - *THE TEST:* "Give me an example of them spending political capital for us."
       *Wait for answer.*

    4. **ECONOMIC BUYER (0-3):** Do we have a direct line to signature authority?
       - 0: No access. 1: Identified. 2: Indirect influence. 3: Direct contact/Signer.
       *Wait for answer.*

    5. **DECISION CRITERIA (0-3):** Technical requirements vs. our solution.
       - *TEST:* Call out gaps vs. Internal Truths.
       *Wait for answer.*

    6. **DECISION PROCESS (0-3):** Who exactly is in the approval chain?
       *Wait for answer.*

    7. **COMPETITION (0-3):** Who else are they looking at? Do not accept "Nobody."
       *Wait for answer.*

    8. **PAPER PROCESS (0-3):** *SKIP IF PIPELINE.*
       - 1: Drafted. 2: In Legal/Procurement. 3: Signed.
       *Wait for answer.*

    9. **TIMING (0-3):** Is there a Compelling Event or just a target date?
       *Wait for answer.*

    ### INTERNAL TRUTHS (PRODUCT POLICE)
    ${deal.org_product_data || "Verify capabilities against company documentation."}

### COMPLETION PROTOCOL
    When you have gathered the data, perform this EXACT sequence:
    1. **Verbal Confirmation:** Say exactly: "Based on today's discussion, this opportunity's Health Score is [Total] out of 27. Just one moment while I update your scorecard."
    2. **Trigger Tool:** Immediately trigger the save_deal_data tool. 
    3. **Final Hand-off:** After the tool triggers, say: "Okay, moving to the next opportunity."    `;
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

  // State
  let streamSid = null;
  let dealQueue = [];
  let currentDealIndex = 0;
  let repName = null; // Null means "We don't know who this is yet"
  let orgId = 1;
  let openAiReady = false;

  // 1. CONNECT TO OPENAI
  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  // 2. HELPER: LAUNCHER (Runs only when BOTH connections are ready)
  const attemptLaunch = async () => {
      if (!repName || !openAiReady) return; // Wait for the other half

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
          attemptLaunch(); // Check if OpenAI is already waiting
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
