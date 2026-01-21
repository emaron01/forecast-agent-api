require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const WebSocket = require("ws");
const http = require("http");

// --- CONFIGURATION ---
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.MODEL_API_KEY; 
const MODEL_URL = process.env.MODEL_URL || "wss://api.openai.com/v1/realtime";
// Using Mini for speed/cost, but reinforced with strict prompts
const MODEL_NAME = process.env.MODEL_NAME || "gpt-4o-mini-realtime-preview-2024-12-17"; 

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

// --- 1. TOOL DEFINITION ---
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

// --- 2. SYSTEM PROMPT (THE BRAIN) ---
function getSystemPrompt(deal) {
  const now = new Date();
  const createdDate = new Date(deal.opp_created_date);
  const closeDate = deal.close_date ? new Date(deal.close_date) : new Date(now.setDate(now.getDate() + 30));
  const ageInDays = Math.floor((new Date() - createdDate) / (1000 * 60 * 60 * 24));
  const daysToClose = Math.floor((closeDate - new Date()) / (1000 * 60 * 60 * 24));
  
  // Normalize Stage
  let category = deal.forecast_stage || "Pipeline";
  if (category.toLowerCase().includes("upside")) category = "Best Case";

  const d = deal.audit_details || {};
  const productContext = deal.seller_product_rules || "PRODUCT: General SaaS.";
  const hasHistory = (deal.last_summary && deal.last_summary.length > 10);

  // Scorecard Injection
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

  // --- STAGE LOGIC (SCRUB LEVEL) ---
  let modeInstructions = "";
  let bannedTopics = "None.";

  if (["Commit", "Closing"].includes(category)) {
     // HARD SCRUB
     modeInstructions = `
     **MODE: COMMIT (The Protector).**
     - **Goal:** Protect the forecast. 
     - **Tone:** Stern, urgent. 
     - **Focus:** Attack Paper Process and Timeline. Ask "Why isn't this signed yet?"`;
  } else if (["Best Case", "Upside", "Solution Validation"].includes(category)) {
     // SOFT/STRATEGIC SCRUB
     modeInstructions = `
     **MODE: BEST CASE (The Gap Hunter).**
     - **Goal:** Find the path to Commit.
     - **Tone:** Collaborative but probing.
     - **Focus:** Identify the ONE missing criteria (Scores of 0 or 1).`;
  } else {
     // PIPELINE/SKEPTIC SCRUB
     modeInstructions = `
     **MODE: PIPELINE (The Skeptic).**
     - **Goal:** Disqualify early.
     - **Tone:** Fast, impatient.
     - **Focus:** PAIN and METRICS. If they don't exist, score is 0. 
     - **Constraint:** Do NOT ask about legal/signatures (Banned).`;
     bannedTopics = "Do NOT ask about: Legal, Procurement, Signatures, Redlines.";
  }

  // --- HISTORY LOGIC (RESTORED) ---
  let historyInstructions = "";
  if (hasHistory) {
      historyInstructions = `**HISTORY RULE:** This deal has been reviewed before. Do NOT re-ask about established facts. Focus ONLY on what has changed since the "Last Summary".`;
  } else {
      historyInstructions = `**HISTORY RULE:** This is a NEW deal. Assume nothing. You must validate the core pillars (Pain/Champion) from scratch.`;
  }

  return `
    You are "Matthew," a VP of Sales Auditor with Sales Forecaster. 
    **PERSONA:** Professional, data-driven, direct. You do not do small talk.
    
    ### DEAL CONTEXT
    - Account: ${deal.account_name}
    - Stage: ${category}
    - Age: ${ageInDays} days (Close in: ${daysToClose})
    - History: ${hasHistory ? "Reviewed Before" : "New Deal"}
    ${scorecardContext}

    ### PRODUCT CONTEXT
    ${productContext}

    ### INSTRUCTIONS
    1. ${modeInstructions}
    2. ${historyInstructions}

    ### RULES
    1. **SCRIPT:** Read the greeting script EXACTLY as provided in the first turn.
    2. **LIVE UPDATES:** Call 'update_opportunity' INSTANTLY when hearing facts.
    3. **INTERRUPTIONS:** Stop speaking immediately if the user interrupts.
    4. **BANNED TOPICS:** ${bannedTopics}

    ### CHAMPION DEFINITIONS
    - 1 (Coach): Friendly, no power.
    - 2 (Mobilizer): Has influence, hasn't acted.
    - 3 (Champion): Power AND is selling for us.

    ### SCORING RUBRIC (0-3)
    0=Missing, 1=Weak, 2=Gathering, 3=Validated.
  `;
}

// --- 3. HELPER: DB UPDATE ---
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
    let deal = null;
    let openAIReady = false; 
    let twilioReady = false; 
    let greetingSent = false;

    // --- THE DYNAMIC GREETING GENERATOR ---
    const triggerGreeting = async () => {
        if (openAIReady && twilioReady && deal && !greetingSent) {
            greetingSent = true;
            console.log("🗣️ BOTH READY -> Triggering Greeting...");
            
            // 1. Fetch Stats
            const countRes = await pool.query('SELECT COUNT(*) FROM opportunities WHERE id >= $1', [oppId]);
            const dealsLeft = countRes.rows[0].count;
            
            // 2. Format Variables
            let repName = (deal.rep_name || "Rep").split(' ')[0];
            if (repName.toLowerCase() === "matthew") repName = "Rep"; 
            
            const closeDateRaw = new Date(deal.close_date);
            const closeDateStr = closeDateRaw.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
            const amountStr = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(deal.amount);
            
            // 3. Check History & Stage
            const hasHistory = (deal.last_summary && deal.last_summary.length > 10);
            let stage = deal.forecast_stage || "Pipeline";
            if (stage.toLowerCase().includes("upside")) stage = "Best Case";

            // 4. Construct Intro (Verbatim)
            const intro = `Hi ${repName}, this is Matthew with Sales Forecaster. We will be reviewing ${dealsLeft} of your deals today, starting with ${deal.account_name}, ${deal.opportunity_name || 'the opportunity'}, for ${amountStr}, in ${stage} with a close date of ${closeDateStr}.`;

            // 5. Construct Hook (Logic Based)
            let hook = "";
            if (hasHistory) {
                hook = `Last time we noted: "${deal.last_summary}". What is the update?`;
            } else {
                if (["Commit", "Closing"].includes(stage)) {
                    hook = "This is in Commit, but I haven't reviewed it. Why isn't this signed yet?";
                } else if (["Best Case", "Upside"].includes(stage)) {
                    hook = "This is in Best Case. What is the one thing preventing it from Committing?";
                } else {
                    hook = "This is early pipeline. What is the specific Pain you have identified?";
                }
            }

            // 6. Send Command
            openAIWs.send(JSON.stringify({
                type: "response.create",
                response: { 
                    modalities: ["text", "audio"], 
                    instructions: `You must say exactly this phrase word-for-word: "${intro} ${hook}"` 
                }
            }));
        }
    };

    const fullUrl = `${MODEL_URL}?model=${MODEL_NAME}`;
    openAIWs = new WebSocket(fullUrl, {
        headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" }
    });

    openAIWs.on("open", async () => {
        console.log("✅ Connected to Realtime Model");
        const dbRes = await pool.query("SELECT * FROM opportunities WHERE id = $1", [oppId]);
        deal = dbRes.rows[0];

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
        
        openAIReady = true;
        triggerGreeting(); 
    });

    openAIWs.on("message", async (data) => {
        const event = JSON.parse(data);

        // A. HANDLE AUDIO OUTPUT
        if (event.type === "response.audio.delta" && event.delta) {
            if (streamSid) ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: event.delta } }));
        }

        // B. HANDLE INTERRUPTION
        if (event.type === "input_audio_buffer.speech_started") {
            console.log("⚡ Interrupt detected: Clearing Twilio buffer");
            if (streamSid) ws.send(JSON.stringify({ event: "clear", streamSid: streamSid }));
        }

        // C. HANDLE DB UPDATES
        if (event.type === "response.function_call_arguments.done") {
            const args = JSON.parse(event.arguments);
            const result = await updateDatabase(oppId, args);
            openAIWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: event.call_id, output: JSON.stringify(result) } }));
            openAIWs.send(JSON.stringify({ type: "response.create" }));
        }
    });

    ws.on("message", async (message) => {
        const data = JSON.parse(message);
        if (data.event === "start") {
            streamSid = data.start.streamSid;
            twilioReady = true;
            triggerGreeting();
        } 
        else if (data.event === "media" && openAIWs.readyState === WebSocket.OPEN) {
            openAIWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: data.media.payload }));
        } 
        else if (data.event === "stop") {
            if (openAIWs.readyState === WebSocket.OPEN) openAIWs.close();
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
    res.json({ ...deal, audit_details: deal.audit_details || {} });
  } catch (err) { console.error(err); res.status(500).send("DB Error"); }
});

server.listen(PORT, () => console.log(`🚀 Realtime Server live on port ${PORT}`));