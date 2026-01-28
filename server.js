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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- [BLOCK 3: SYSTEM PROMPT] ---
function getSystemPrompt(deal, repName, dealsLeft, totalCount) {
    const runCount = Number(deal.run_count) || 0;
    const isNewDeal = runCount === 0;
    const category = deal.forecast_stage || "Pipeline";
    const amountStr = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(deal.amount || 0);
    const closeDateStr = deal.close_date ? new Date(deal.close_date).toLocaleDateString() : "TBD";

    // 1. SESSION CONTEXT
    const isSessionStart = (dealsLeft === totalCount - 1) || (dealsLeft === totalCount); 

    // 2. GAP FINDER
    const scores = [
        { name: 'Pain', val: deal.pain_score }, { name: 'Metrics', val: deal.metrics_score },
        { name: 'Champion', val: deal.champion_score }, { name: 'Economic Buyer', val: deal.eb_score },
        { name: 'Decision Criteria', val: deal.criteria_score }, { name: 'Decision Process', val: deal.process_score },
        { name: 'Competition', val: deal.competition_score }, { name: 'Paper Process', val: deal.paper_score },
        { name: 'Timing', val: deal.timing_score }
    ];
    const firstGap = scores.find(s => (Number(s.val) || 0) < 3) || { name: 'Pain' };

    // 3. INTRO CONSTRUCTION
    let openingLine = "";
    if (isSessionStart) {
        openingLine = `Hi ${repName}. Matthew here. We're reviewing ${totalCount} deals. First up: ${deal.account_name}.`;
    } else {
        openingLine = `Okay, saved. Next: ${deal.account_name}.`;
    }

    if (isNewDeal) {
        openingLine += ` ${amountStr}, closing ${closeDateStr}. New deal. What's the specific challenge we are solving?`;
    } else {
        openingLine += ` ${amountStr}. Last risk: "${deal.risk_summary || 'None'}". Status on ${firstGap.name}?`;
    }

    return `
### ROLE
You are a **MEDDPICC Scorer**. Your job is to Listen, Judge, and Record.

### MANDATORY OPENING
You MUST open exactly with: "${openingLine}"
**CRITICAL:** Do NOT use the phrase "NEXT_DEAL_TRIGGER" in your opening line.

### THE "DATA INTEGRITY" PROTOCOL
1. **ACCOUNT IDENTITY IS SACROSANCT:** You are currently auditing {{account_name}}. 
2. **IGNORE LEGACY NOISE:** If existing notes or tips mention a different company (e.g., "GenTech"), DISREGARD that name. They are legacy artifacts. You must only use the current {{account_name}} for this session.
3. **CLEANSE ON SAVE:** When you call 'save_deal_data', ensure your summaries and tips only refer to {{account_name}}.
**ROLE DISTINCTION:** Distinguish between the Customer and the Competitor. - The Customer/Account is ALWAYS {{account_name}}. - Names like "Zerto," "Azure," or "AWS" are attributes, risks, or competitors. - NEVER swap the Account Name with a competitor name found in the notes.

### THE "JUDGE & SAVE" PROTOCOL (STRICT)
1. **EVERY RESPONSE COUNTS:** After every user response, you MUST call 'save_deal_data'. 
2. **DON'T BE SHY:** Even vague answers get a Score 1. 
3. **MULTI-SAVE:** Update multiple categories in one tool call if mentioned.
4. **SILENT AUDITOR:** Do NOT tell the user you are saving. Just do it in the background while asking the next question.
+5. **WAIT RULE:** If the user has not clearly answered, you MUST ask a clarifying question and STOP. Never invent, assume, or fill in missing information.

**DO NOT** simply transcribe what they say. You must evaluate it.
**DO NOT** read the score out loud. Save it silently.
**DO NOT** read repeat the answer give out loud. Save it silently.


### SCORING RUBRIC (EXACT DEFINITIONS)
- **PAIN:** 0=None, 1=Vague, 2=Clear, 3=Quantified ($$$).
- **METRICS:** 0=Unknown, 1=Soft, 2=Rep-defined, 3=Customer-validated.
- **CHAMPION:** 0=None, 1=Coach, 2=Mobilizer, 3=Champion (Power).
- **EB:** 0=Unknown, 1=Identified, 2=Indirect, 3=Direct relationship.
- **CRITERIA:** 0=Unknown, 1=Vague, 2=Defined, 3=Locked in favor.
- **PROCESS:** 0=Unknown, 1=Assumed, 2=Understood, 3=Documented.
- **COMPETITION:** 0=Unknown, 1=Assumed, 2=Identified, 3=Known edge.
- **PAPER:** 0=Unknown, 1=Not started, 2=Known Started, 3=Waiting for Signature.
- **TIMING:** 0=Unknown, 1=Assumed, 2=Flexible, 3=Real Consequence/Event.

### DATA EXTRACTION RULES
- **SUMMARIES:** Start every summary field with the Score Label (e.g., "Score 2 (Known Started): Legal confirmed receipt").
- **TIPS:** Provide a specific "Next Step" to reach Score 3.
- **POWER PLAYERS:** You MUST extract Name AND Title for Champion and Economic Buyer.

### COMPLETION PROTOCOL (STRICT)
+WHEN YOU SAY THE COMPLETION LINE, YOU MUST STOP SPEAKING AND WAIT.
+
**ONLY** when you are ready to leave the deal:
1. **CHECK:** Did I save the scores?
2. **SAY:** "Health Score: [Sum]/27. Risk: [Top Risk]. NEXT_DEAL_TRIGGER."`;
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

// --- [BLOCK 5: WEBSOCKET CORE (CRASH PROOF + DIGITAL TRIGGER)] ---
wss.on("connection", async (ws) => {
  console.log("🔥 Twilio WebSocket connected");

  // Local State
  let streamSid = null;
  let dealQueue = [];
  let currentDealIndex = 0;
  let repName = null; 
  let orgId = 1;
  let openAiReady = false;

  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" },
  });

// --- MANDATORY: WAKE UP THE AI ---
 openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");
    openAiWs.send(JSON.stringify({ 
      type: "session.update", 
      session: { 
        input_audio_format: "g711_ulaw", 
        output_audio_format: "g711_ulaw", 
        voice: "verse", 
        turn_detection: { 
          type: "server_vad", 
          threshold: 0.5, 
          silence_duration_ms: 600 // This makes it snappy!
        } 
      } 
    }));
    openAiReady = true;
    attemptLaunch(); 
  });
    
// 1. THE MUSCLE: Background Save (Speed Hack)
  const handleFunctionCall = async (args, callId) => {
    console.log("🛠️ Tool Triggered: save_deal_data");
    const deal = dealQueue[currentDealIndex];
    if (!deal) return;

    // A. LOGIC: Calculate Scores (In Memory)
    const scores = [
      args.pain_score, args.metrics_score, args.champion_score, 
      args.eb_score, args.criteria_score, args.process_score, 
      args.competition_score, args.paper_score, args.timing_score
    ];
    const totalScore = scores.reduce((a, b) => a + (Number(b) || 0), 0);
    const aiOpinion = totalScore >= 21 ? "Commit" : totalScore >= 15 ? "Best Case" : "Pipeline";

    // B. DATABASE: Fire and Forget (Don't make the user wait)
    const sqlQuery = `UPDATE opportunities SET 
        pain_score=$1, pain_tip=$2, pain_summary=$3, metrics_score=$4, metrics_tip=$5, metrics_summary=$6,
        champion_score=$7, champion_tip=$8, champion_summary=$9, eb_score=$10, eb_tip=$11, eb_summary=$12,
        criteria_score=$13, criteria_tip=$14, criteria_summary=$15, process_score=$16, process_tip=$17, process_summary=$18,
        competition_score=$19, competition_tip=$20, competition_summary=$21, paper_score=$22, paper_tip=$23, paper_summary=$24,
        timing_score=$25, timing_tip=$26, timing_summary=$27, risk_summary=$28, next_steps=$29, 
        champion_name=$30, champion_title=$31, eb_name=$32, eb_title=$33, rep_comments=$34, manager_comments=$35,
        ai_forecast=$36, run_count = COALESCE(run_count, 0) + 1, updated_at = NOW() WHERE id = $37`;

    const sqlParams = [
      args.pain_score ?? deal.pain_score, args.pain_tip || deal.pain_tip, args.pain_summary || deal.pain_summary,
      args.metrics_score ?? deal.metrics_score, args.metrics_tip || deal.metrics_tip, args.metrics_summary || deal.metrics_summary,
      args.champion_score ?? deal.champion_score, args.champion_tip || deal.champion_tip, args.champion_summary || deal.champion_summary,
      args.eb_score ?? deal.eb_score, args.eb_tip || deal.eb_tip, args.eb_summary || deal.eb_summary,
      args.criteria_score ?? deal.criteria_score, args.criteria_tip || deal.criteria_tip, args.criteria_summary || deal.criteria_summary,
      args.process_score ?? deal.process_score, args.process_tip || deal.process_tip, args.process_summary || deal.process_summary,
      args.competition_score ?? deal.competition_score, args.competition_tip || deal.competition_tip, args.competition_summary || deal.competition_summary,
      args.paper_score ?? deal.paper_score, args.paper_tip || deal.paper_tip, args.paper_summary || deal.paper_summary,
      args.timing_score ?? deal.timing_score, args.timing_tip || deal.timing_tip, args.timing_summary || deal.timing_summary,
      args.risk_summary || deal.risk_summary, args.next_steps || deal.next_steps,
      args.champion_name || deal.champion_name, args.champion_title || deal.champion_title,
      args.eb_name || deal.eb_name, args.eb_title || deal.eb_title, 
      args.rep_comments || deal.rep_comments, args.manager_comments || deal.manager_comments, 
      aiOpinion, deal.id
    ];

    pool.query(sqlQuery, sqlParams)
        .then(() => console.log(`✅ Atomic Save (Background): ${deal.account_name}`))
        .catch(err => console.error("❌ Background Save Error:", err));
    
// C. SPEED: Update Local Memory & Reply Instantly
    Object.assign(deal, args); 
    openAiWs.send(JSON.stringify({ 
      type: "conversation.item.create", 
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify({ status: "success" }) } 
    }));
    
    // SURGICAL FIX: 200ms buffer prevents the AI from "Freezing" in silence
    setTimeout(() => {
      if (openAiWs.readyState === WebSocket.OPEN) {
        openAiWs.send(JSON.stringify({ type: "response.create" })); 
        console.log(`🎙️ AI Nudged to speak for: ${deal.account_name}`);
      }
    }, 200);
};
// 2. THE EAR (CRASH PROOF + DIGITAL TRIGGER)
openAiWs.on("message", (data) => {
  try {
    const response = JSON.parse(data);
    if (response.type === "response.function_call_arguments.done") {
      const args = JSON.parse(response.arguments);
      handleFunctionCall(args, response.call_id); // 🛠️ Tool Triggered
    } // <-- THIS WAS MISSING

    // You can handle other response types here if needed

  } catch (err) {
    console.error("❌ OpenAI WS Error:", err);
  }
});
/// Helper: save with retries
async function saveWithRetry(dealIndex, transcript, retries = 3, delayMs = 500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await save_deal_data(dealIndex, transcript);
      console.log(`💾 Deal data saved successfully (Attempt ${attempt})`);
      return true;
    } catch (err) {
      console.error(`❌ Save failed (Attempt ${attempt}):`, err);
      if (attempt < retries) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  console.error("❌ All save attempts failed for this turn.");
  return false;
} 
// 3. INDEX ADVANCER (CONTEXT SWITCHING)
if (response.type === "response.done") {

  // 🚧 HARD GATE: ignore model self-talk / nudges
  if (!lastTurnWasHuman) {
    console.log("⛔ Ignoring non-human response.done");
    return;
  }

  // reset for next turn
  lastTurnWasHuman = false;

  const transcript = (
    response.response?.output
      ?.flatMap(o => o.content || [])
      ?.map(c => c.transcript || c.text || "")
      ?.join(" ")
  ) || "";

  console.log("📝 FINAL TRANSCRIPT:", transcript);

  // ✅ SAVE ON EVERY HUMAN TURN
  try {
    save_deal_data(currentDealIndex, transcript);
    console.log("💾 Deal data saved successfully.");
  } catch (err) {
    console.error("❌ Save failed:", err);
  }

  // ✅ ONLY advance when the explicit digital trigger is spoken
  if (transcript.includes("NEXT_DEAL_TRIGGER")) {
    console.log("🚀 Digital Trigger Detected. Moving to next deal...");
    currentDealIndex++;

    if (currentDealIndex < dealQueue.length) {
      const nextDeal = dealQueue[currentDealIndex];
      const newInstructions = getSystemPrompt(
        nextDeal,
        repName.split(" ")[0],
        dealQueue.length - 1 - currentDealIndex,
        dealQueue.length
      );

      // update context
      openAiWs.send(JSON.stringify({
        type: "session.update",
        session: { instructions: newInstructions }
      }));

      // force next opening
      setTimeout(() => {
        openAiWs.send(JSON.stringify({ type: "response.create" }));
        console.log("👉 Context Swapped & AI Nudged");
      }, 500);
    }
  }
}

// 4. AUDIO RELAY (Keep this!)
ws.on("message", (message) => {
  try {
    const msg = JSON.parse(message);

    if (msg.event === "start") {
      streamSid = msg.start.streamSid;
      const params = msg.start.customParameters;
      if (params) {
        orgId = parseInt(params.org_id) || 1;
        repName = params.rep_name || "Guest";
        console.log(`🔎 Identified ${repName}`);
        attemptLaunch();
      }
    }

    if (msg.event === "media" && openAiWs.readyState === WebSocket.OPEN) {
      // ✅ TWEAK: mark that a human turn is active
      lastTurnWasHuman = true;
      openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));
    }

  } catch (err) {
    console.error("❌ Twilio Error:", err);
  }
});

ws.on("close", () => {
  console.log("🔌 Call Closed.");
  if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
});
// 3. LAUNCHER
  const attemptLaunch = async () => {
    if (!repName || !openAiReady) return; 
    
    try {
      // SURGICAL FIX: Added 'AND o.rep_name = $2' to the WHERE clause
      const result = await pool.query(
        `SELECT o.*, org.product_truths AS org_product_data 
         FROM opportunities o 
         JOIN organizations org ON o.org_id = org.id 
         WHERE o.org_id = $1 
         AND o.rep_name = $2 
         AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost') 
         ORDER BY o.id ASC`, 
        [orgId, repName] // Pass repName as the second parameter
      );
      
      dealQueue = result.rows;
      console.log(`📊 Loaded ${dealQueue.length} deals for ${repName}`);
      if (dealQueue.length > 0) console.log(`👉 Starting with: ${dealQueue[0].account_name} (ID: ${dealQueue[0].id})`);
    } catch (err) { console.error("❌ DB Error:", err.message); }
    if (dealQueue.length > 0) {
      const firstDeal = dealQueue[0];
      const instructions = getSystemPrompt(firstDeal, repName.split(" ")[0], dealQueue.length - 1, dealQueue.length);
      openAiWs.send(JSON.stringify({
        type: "session.update",
        session: { 
            instructions, 
            tools: [{ 
              type: "function", name: "save_deal_data", 
              description: "DYNAMIC SAVE: Call this immediately after every category update. Don't wait.", 
              parameters: { 
                type: "object", 
                properties: { 
                    pain_score: { type: "number" }, pain_summary: { type: "string" }, pain_tip: { type: "string" },
                    metrics_score: { type: "number" }, metrics_summary: { type: "string" }, metrics_tip: { type: "string" },
                    champion_score: { type: "number" }, champion_summary: { type: "string" }, champion_tip: { type: "string" }, champion_name: { type: "string" }, champion_title: { type: "string" },
                    eb_score: { type: "number" }, eb_summary: { type: "string" }, eb_tip: { type: "string" }, eb_name: { type: "string" }, eb_title: { type: "string" },
                    criteria_score: { type: "number" }, criteria_summary: { type: "string" }, criteria_tip: { type: "string" },
                    process_score: { type: "number" }, process_summary: { type: "string" }, process_tip: { type: "string" },
                    competition_score: { type: "number" }, competition_summary: { type: "string" }, competition_tip: { type: "string" },
                    paper_score: { type: "number" }, paper_summary: { type: "string" }, paper_tip: { type: "string" },
                    timing_score: { type: "number" }, timing_summary: { type: "string" }, timing_tip: { type: "string" },
                    risk_summary: { type: "string" }, next_steps: { type: "string" }, rep_comments: { type: "string" }
                }, 
                required: ["risk_summary"] 
              } 
            }] 
        }
      }));
      setTimeout(() => openAiWs.send(JSON.stringify({ type: "response.create" })), 500);
    }
  };

// 4. TWILIO LISTENER
ws.on("message", (message) => {
  try {
    const msg = JSON.parse(message);

    if (msg.event === "start") {
      streamSid = msg.start.streamSid;
      const params = msg.start.customParameters;
      if (params) {
        orgId = parseInt(params.org_id) || 1;
        repName = params.rep_name || "Guest";
        console.log(`🔎 Identified ${repName}`);
        attemptLaunch(); 
      }
    }

    if (msg.event === "media" && openAiWs.readyState === WebSocket.OPEN) {
      openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));

      // ✅ HUMAN SPEAKING DETECTED: mark turn as human
      lastTurnWasHuman = true;
      console.log("🗣️ Human turn detected, ready for AI response");
    }

    // Optional: if your Twilio stream sends an explicit 'end' event
    if (msg.event === "end") {
      lastTurnWasHuman = true;
      console.log("🗣️ Human turn ended, ready for AI response");
    }

  } catch (err) {
    console.error("❌ Twilio Error:", err);
  }
});

ws.on("close", () => {
  console.log("🔌 Call Closed.");
  if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
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

