require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const WebSocket = require("ws");
const http = require("http");

// --- CONFIGURATION (Abstracted) ---
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.MODEL_API_KEY; 
const MODEL_URL = process.env.MODEL_URL || "wss://api.openai.com/v1/realtime";
// Use the standard Realtime model for best results
const MODEL_NAME = process.env.MODEL_NAME || "gpt-4o-realtime-preview-2024-10-01";

// --- DATABASE CONNECTION ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- 1. TOOL DEFINITION (Unchanged) ---
const DATABASE_TOOL = {
  type: "function",
  name: "update_opportunity",
  description: "Updates the CRM data. Call this IMMEDIATELY when the user provides new facts.",
  parameters: {
    type: "object",
    properties: {
      pain_score: { type: "integer", description: "Score 0-3" },
      metrics_score: { type: "integer", description: "Score 0-3" },
      champion_score: { type: "integer", description: "Score 0-3" },
      economic_buyer_score: { type: "integer", description: "Score 0-3" },
      decision_process_score: { type: "integer", description: "Score 0-3" },
      decision_criteria_score: { type: "integer", description: "Score 0-3" },
      paper_process_score: { type: "integer", description: "Score 0-3" },
      timeline_score: { type: "integer", description: "Score 0-3" },
      competition_score: { type: "integer", description: "Score 0-3" },
      champion_name: { type: "string" },
      champion_title: { type: "string" },
      economic_buyer_name: { type: "string" },
      economic_buyer_title: { type: "string" },
      competitor_name: { type: "string" },
      next_steps: { type: "string" },
      summary: { type: "string" },
      forecast_stage: { type: "string", enum: ["Pipeline", "Best Case", "Commit"] }
    },
    required: [] 
  }
};

// --- 2. SYSTEM PROMPT (Restored & Deep Scanned) ---
function getSystemPrompt(deal) {
  // A. Context Math
  const now = new Date();
  const createdDate = new Date(deal.opp_created_date);
  const closeDate = deal.close_date ? new Date(deal.close_date) : new Date(now.setDate(now.getDate() + 30));
  const ageInDays = Math.floor((new Date() - createdDate) / (1000 * 60 * 60 * 24));
  const daysToClose = Math.floor((closeDate - new Date()) / (1000 * 60 * 60 * 24));
  const productContext = deal.seller_product_rules || "PRODUCT: General SaaS.";
  const category = deal.forecast_stage || "Pipeline";

  // B. RECOVERED: Full Scorecard Injection
  // This allows the agent to see EXACTLY which scores are missing (The 0s and 1s)
  const d = deal.audit_details || {};
  const scorecardContext = `
    [CURRENT MEDDPICC SCORES]
    - Pain: ${d.pain_score || 0}/3
    - Metrics: ${d.metrics_score || 0}/3
    - Champion: ${d.champion_score || 0}/3
    - Econ Buyer: ${d.economic_buyer_score || 0}/3
    - Paper Process: ${d.paper_process_score || 0}/3
    - Decision Process: ${d.decision_process_score || 0}/3
    - Decision Criteria: ${d.decision_criteria_score || 0}/3
    - Competition: ${d.competition_score || 0}/3
    - Timeline: ${d.timeline_score || 0}/3
  `;

  // C. Mode Logic (Restored)
  const isPipeline = ["Pipeline", "Discovery", "Qualification", "Prospecting"].includes(category);
  const isBestCase = ["Best Case", "Upside", "Solution Validation"].includes(category);

  let instructions = "";
  let bannedTopics = "None.";
  
  if (isPipeline) {
     instructions = `
     **MODE: PIPELINE (The Skeptic)**
     - **STRICT CEILING:** This deal CANNOT score > 15.
     - **FOCUS:** Validate Pain & Metrics first.
     - **AUTO-FAIL:** If Pain score is 0, focus ONLY on that.
     - **IGNORED SCORES:** Paper Process and Decision Process are ALWAYS 0/3 in this stage.`;
     bannedTopics = "Do NOT ask about: Legal, Procurement, Signatures, Redlines.";
  } else if (isBestCase) {
     instructions = `
     **MODE: BEST CASE (The Gap Hunter)**
     - **GOAL:** Find the missing link preventing Commit.
     - **LOGIC:** Look at [CURRENT MEDDPICC SCORES]. Attack the categories with '0' or '1'.`;
  } else {
     const scoreConcern = (deal.current_score && deal.current_score < 22) 
        ? "WARNING: Deal is in COMMIT but score is <22. Challenge confidence." 
        : "";
     instructions = `
     **MODE: COMMIT (The Closer)**
     - **GOAL:** Protect the forecast.
     - **FOCUS:** Paper Process, Timeline, Signatures.
     - **SPECIAL RULE:** ${scoreConcern}`;
  }

  return `
    You are "Matthew," a VP of Sales Auditor. You are cynical, direct, and data-driven.
    Your voice should be fast, professional, but slightly impatient.

    ### DEAL CONTEXT
    - Account: ${deal.account_name}
    - Stage: ${category}
    - Amount: $${deal.amount}
    - Age: ${ageInDays} days (Close in: ${daysToClose} days)
    - History: ${deal.last_summary || "None"}
    
    ${scorecardContext}

    ### PRODUCT CONTEXT
    ${productContext}

    ### AUDIT INSTRUCTIONS
    ${instructions}

    ### RULES OF ENGAGEMENT
    1. **INTERRUPTIBLE:** Speak concisely. If interrupted, stop immediately.
    2. **LIVE UPDATES:** As soon as you hear a fact, call 'update_opportunity' INSTANTLY.
    3. **NO FLUFF:** Don't say "Got it." Just ask the next hard question.
    4. **SKEPTICISM:** If the user is vague, challenge them.
    5. **BANNED TOPICS:** ${bannedTopics}

    ### CHAMPION DEFINITIONS
    - 1 (Coach): Friendly, no power.
    - 2 (Mobilizer): Has influence, hasn't acted.
    - 3 (Champion): Power AND is selling for us.

    ### SCORING RUBRIC (0-3)
    0=Missing, 1=Weak, 2=Gathering, 3=Validated.
  `;
}

// --- 3. HELPER: DB UPDATE (Unchanged) ---
async function updateDatabase(oppId, args) {
    try {
        console.log(`⚡ UPDATING DB for Opp ${oppId}:`, args);
        const res = await pool.query("SELECT audit_details FROM opportunities WHERE id = $1", [oppId]);
        let currentDetails = res.rows[0]?.audit_details || {};
        
        Object.keys(args).forEach(key => {
            if (key.includes("_score") || key.includes("_name") || key.includes("_title") || key.includes("competitor")) {
                currentDetails[key] = args[key];
            }
        });

        let query = "UPDATE opportunities SET audit_details = $1, last_updated = NOW()";
        const params = [currentDetails];
        let paramIdx = 2;

        if (args.summary) { query += `, last_summary = $${paramIdx}`; params.push(args.summary); paramIdx++; }
        if (args.next_steps) { query += `, next_steps = $${paramIdx}`; params.push(args.next_steps); paramIdx++; }
        if (args.forecast_stage) { query += `, forecast_stage = $${paramIdx}`; params.push(args.forecast_stage); paramIdx++; }

        query += ` WHERE id = $${paramIdx}`;
        params.push(oppId);

        await pool.query(query, params);
        return { success: true, message: "CRM Updated" };
    } catch (e) {
        console.error("DB Error:", e);
        return { success: false, error: e.message };
    }
}

// --- 4. WEBSOCKET ROUTE ---
wss.on("connection", (ws, req) => {
    console.log("Client Connected");
    const urlParams = new URLSearchParams(req.url.replace('/','')); 
    const oppId = urlParams.get('oppId') || '4';

    let openAIWs = null;
    let streamSid = null;

    const fullUrl = `${MODEL_URL}?model=${MODEL_NAME}`;
    
    openAIWs = new WebSocket(fullUrl, {
        headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "realtime=v1"
        }
    });

    openAIWs.on("open", async () => {
        console.log("✅ Connected to Realtime Model");
        
        // RECOVERED: "Deals Left" Count Logic
        const dbRes = await pool.query("SELECT * FROM opportunities WHERE id = $1", [oppId]);
        const deal = dbRes.rows[0];
        const countRes = await pool.query('SELECT COUNT(*) FROM opportunities WHERE id >= $1', [oppId]);
        const dealsLeft = countRes.rows[0].count;

        // Custom Greeting Logic
        const firstName = (deal.rep_name || "Rep").split(' ')[0];
        const greetingContext = `
            Your first line must be exactly: 
            "Hi ${firstName}, Matthew here. Reviewing ${dealsLeft} deals. Starting with ${deal.account_name} in ${deal.forecast_stage}."
            Then, immediately read the Summary: "${deal.last_summary || 'No summary'}" and ask for an update.
        `;

        const sessionConfig = {
            type: "session.update",
            session: {
                modalities: ["text", "audio"],
                instructions: getSystemPrompt(deal),
                voice: "ash", 
                input_audio_format: "g711_ulaw",
                output_audio_format: "g711_ulaw",
                turn_detection: { type: "server_vad" },
                tools: [DATABASE_TOOL],
                tool_choice: "auto"
            }
        };
        openAIWs.send(JSON.stringify(sessionConfig));
        
        // Trigger Greeting with specific context
        openAIWs.send(JSON.stringify({
            type: "response.create",
            response: {
                modalities: ["text", "audio"],
                instructions: greetingContext
            }
        }));
    });

    openAIWs.on("message", async (data) => {
        const event = JSON.parse(data);
        if (event.type === "response.audio.delta" && event.delta) {
            ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: event.delta } }));
        }
        if (event.type === "response.function_call_arguments.done") {
            const args = JSON.parse(event.arguments);
            const result = await updateDatabase(oppId, args);
            openAIWs.send(JSON.stringify({
                type: "conversation.item.create",
                item: { type: "function_call_output", call_id: event.call_id, output: JSON.stringify(result) }
            }));
            openAIWs.send(JSON.stringify({ type: "response.create" }));
        }
    });

    ws.on("message", (message) => {
        const data = JSON.parse(message);
        if (data.event === "start") streamSid = data.start.streamSid;
        if (data.event === "media" && openAIWs.readyState === WebSocket.OPEN) {
            openAIWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: data.media.payload }));
        }
    });
});

app.post("/agent", (req, res) => {
    const oppId = req.query.oppId || "4";
    const twiml = `<Response><Connect><Stream url="wss://${req.headers.host}/?oppId=${oppId}" /></Connect></Response>`;
    res.type("text/xml").send(twiml);
});

app.get("/get-deal", async (req, res) => {
  const { oppId } = req.query;
  try {
    const result = await pool.query("SELECT * FROM opportunities WHERE id = $1", [oppId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    const deal = result.rows[0];
    res.json({
      ...deal, 
      forecast_category: deal.forecast_stage, 
      summary: deal.last_summary || deal.summary,
      next_steps: deal.next_steps,
      audit_details: deal.audit_details || { metrics_score: 0, pain_score: 0 }
    });
  } catch (err) { console.error("Dash Error:", err); res.status(500).send("DB Error"); }
});

server.listen(PORT, () => console.log(`🚀 Realtime Server live on port ${PORT}`));