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
    const runCount = Number(deal.run_count) || 0;
    const isNewDeal = runCount === 0;
    const category = deal.forecast_stage || "Pipeline";
    const amountStr = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(deal.amount || 0);

    // 1. DYNAMIC GAP FINDER (Focus on Scores < 3)
    const scores = [
        { name: 'Pain', val: deal.pain_score },
        { name: 'Metrics', val: deal.metrics_score },
        { name: 'Champion', val: deal.champion_score },
        { name: 'Economic Buyer', val: deal.eb_score },
        { name: 'Decision Criteria', val: deal.criteria_score },
        { name: 'Decision Process', val: deal.process_score },
        { name: 'Competition', val: deal.competition_score },
        { name: 'Paper Process', val: deal.paper_score },
        { name: 'Timing', val: deal.timing_score }
    ];
    const firstGap = scores.find(s => (Number(s.val) || 0) < 3) || { name: 'Pain' };

    // 2. DYNAMIC OPENING
    let openingLine = isNewDeal 
        ? `Hi ${repName}. Let's look at ${deal.account_name} for ${amountStr}. Since this is new, what product are we selling and what specific challenge are we trying to overcome for the customer?`
        : `Hi ${repName}. Back on ${deal.account_name}. Last time we flagged: "${deal.risk_summary || 'vague project drivers'}". I see ${firstGap.name} is still a risk—have we made any progress there?`;

    return `
### ROLE & IDENTITY
You are Matthew, a high-IQ MEDDPICC Auditor. You are an **Extractor**, not a Coach. You extract evidence with surgical precision.

### MANDATORY OPENING
You MUST open exactly with: "${openingLine}"

### CONVERSATION FLOW RULES (GUARDRAILS)
1. Ask ONE MEDDPICC-advancing question per turn.
2. If the rep’s answer is unclear → ask ONE clarifying question. If still unclear → score low and move on.
3. Never repeat or paraphrase the rep’s answer.
4. Call 'save_deal_data' SILENTLY after EVERY category discussion. Do not wait for the end.
5. **PAIN summary is verbal ONLY if score < 3.** No other summaries are verbal.

### THE EXACT SCORING RUBRIC (0-3)
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
- **SUMMARIES:** explain WHY you gave the score (e.g., "Score 2 (Known Started): Legal confirmed receipt").
- **TIPS:** Provide a specific "Next Step" to reach Score 3.
- **POWER PLAYERS:** You MUST extract Name AND Title for Champion and Economic Buyer.

### COMPLETION PROTOCOL (STRICT ORDER)
When a deal review is finished, deliver the final summary in this EXACT order:
1. **Health Score:** "Your Health Score is [Sum of all 9 scores] out of 27."
2. **Deal Risks:** "Your Deal Risk(s) are: [Summary of categories scored < 3]."
3. **Next Steps:** "Next Steps are: [Critical action from Tips]."
4. **Forecast Verdict:** "You have the deal in ${category}. I recommend [Commit/Best Case/Pipeline] based on the data."

Say: "Okay, saved. Moving to the next deal."`;
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

// --- [BLOCK 5: WEBSOCKET CORE (ATOMIC SAVE UPGRADE)] ---
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

  // 1. THE MUSCLE: Atomic Save + Memory Merge
  const handleFunctionCall = async (args, callId) => {
    console.log("🛠️ Tool Triggered: save_deal_data");
    try {
      const deal = dealQueue[currentDealIndex];
      if (!deal) return;

      // A. Calculate Scores
      const scores = [
        args.pain_score, args.metrics_score, args.champion_score, 
        args.eb_score, args.criteria_score, args.process_score, 
        args.competition_score, args.paper_score, args.timing_score
      ];
      const totalScore = scores.reduce((a, b) => a + (Number(b) || 0), 0);
      const aiOpinion = totalScore >= 21 ? "Commit" : totalScore >= 15 ? "Best Case" : "Pipeline";

      // B. PREPARE DATA (Atomic Logic: Use Args -> Fallback to Local Memory)
      const sqlQuery = `UPDATE opportunities SET 
          pain_score=$1, pain_tip=$2, pain_summary=$3, metrics_score=$4, metrics_tip=$5, metrics_summary=$6,
          champion_score=$7, champion_tip=$8, champion_summary=$9, eb_score=$10, eb_tip=$11, eb_summary=$12,
          criteria_score=$13, criteria_tip=$14, criteria_summary=$15, process_score=$16, process_tip=$17, process_summary=$18,
          competition_score=$19, competition_tip=$20, competition_summary=$21, paper_score=$22, paper_tip=$23, paper_summary=$24,
          timing_score=$25, timing_tip=$26, timing_summary=$27, risk_summary=$28, next_steps=$29, 
          champion_name=$30, champion_title=$31, eb_name=$32, eb_title=$33, rep_comments=$34, manager_comments=$35,
          ai_forecast=$36, run_count = COALESCE(run_count, 0) + 1, updated_at = NOW() WHERE id = $37`;

      // NOTE: Using '??' allows 0 scores to save correctly. '||' would overwrite 0 with old data.
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

      await pool.query(sqlQuery, sqlParams);
      console.log(`✅ Atomic Save: ${deal.account_name}`);
      
      // C. MEMORY MERGE (Crucial for Save-As-You-Go)
      Object.assign(deal, args); 

      // D. HANDSHAKE
      openAiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify({ status: "success" }) } }));
      
      // NOTE: We do NOT increment currentDealIndex here anymore. We wait for the exit phrase.
    } catch (err) { console.error("❌ Atomic Save Error:", err); }
  };

  // 2. THE EAR
  openAiWs.on("message", (data) => {
    try {
      const response = JSON.parse(data);
      if (response.type === "response.function_call_arguments.done") {
        const args = JSON.parse(response.arguments);
        handleFunctionCall(args, response.call_id);
      }
      
      // 3. INDEX ADVANCER (Listens for Exit Phrase)
      if (response.type === "response.done") {
        const transcript = response.response.output[0]?.content[0]?.transcript || "";
        if (transcript.includes("Moving to the next deal") || transcript.includes("concludes our review")) {
          console.log("🚀 Completion Protocol Detected. Advancing Index.");
          currentDealIndex++;
        }
      }
      
      if (response.type === "response.audio.delta" && response.delta && streamSid) {
          ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: response.delta } }));
      }
    } catch (err) { console.error("❌ OpenAI Message Error:", err); }
  });

  // 3. LAUNCHER
  const attemptLaunch = async () => {
    if (!repName || !openAiReady) return; 
    
    try {
      const result = await pool.query(`SELECT o.*, org.product_truths AS org_product_data FROM opportunities o JOIN organizations org ON o.org_id = org.id WHERE o.org_id = $1 AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost') ORDER BY o.id ASC`, [orgId]);
      dealQueue = result.rows;
      console.log(`📊 Loaded ${dealQueue.length} deals for ${repName}`);
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

  openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");
    openAiWs.send(JSON.stringify({ type: "session.update", session: { input_audio_format: "g711_ulaw", output_audio_format: "g711_ulaw", voice: "verse", turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 1000 } } }));
    openAiReady = true;
    attemptLaunch(); 
  });

  // 4. TWILIO LISTENER (Kept inside for safety)
  ws.on("message", (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.event === "start") {
        streamSid = msg.start.streamSid; // <--- The Vital Link
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
      }
    } catch (err) { console.error("❌ Twilio Error:", err); }
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
