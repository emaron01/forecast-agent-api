require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const WebSocket = require("ws");
const http = require("http");

// --- CONFIGURATION ---
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 

// --- DATABASE CONNECTION ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- EXPRESS APP SETUP ---
const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- SERVER SETUP (HTTP + WS) ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- 1. TOOL DEFINITION (The "Sniper" Logic) ---
const DATABASE_TOOL = {
  type: "function",
  name: "update_opportunity",
  description: "Updates the CRM data. Call this IMMEDIATELY when the user provides new facts. Do not wait.",
  parameters: {
    type: "object",
    properties: {
      pain_score: { type: "integer", description: "Score 0-3 for Identify Pain" },
      metrics_score: { type: "integer", description: "Score 0-3 for Metrics" },
      champion_score: { type: "integer", description: "Score 0-3 for Champion" },
      economic_buyer_score: { type: "integer", description: "Score 0-3 for Economic Buyer" },
      decision_process_score: { type: "integer", description: "Score 0-3 for Decision Process" },
      decision_criteria_score: { type: "integer", description: "Score 0-3 for Decision Criteria" },
      paper_process_score: { type: "integer", description: "Score 0-3 for Paper Process" },
      timeline_score: { type: "integer", description: "Score 0-3 for Timeline" },
      competition_score: { type: "integer", description: "Score 0-3 for Competition" },
      champion_name: { type: "string", description: "Full name of the Champion" },
      champion_title: { type: "string", description: "Job title of the Champion" },
      economic_buyer_name: { type: "string", description: "Full name of the Economic Buyer" },
      economic_buyer_title: { type: "string", description: "Job title of the Economic Buyer" },
      competitor_name: { type: "string", description: "Name of the competitor" },
      next_steps: { type: "string", description: "Specific action items agreed upon" },
      summary: { type: "string", description: "Brief summary of the latest update" },
      forecast_stage: { type: "string", enum: ["Pipeline", "Best Case", "Commit"], description: "Update stage if criteria met" }
    },
    required: [] 
  }
};

// --- 2. SYSTEM PROMPT (The "Lost" Logic Restored) ---
function getSystemPrompt(deal) {
  // A. Calculate Context (Age, etc)
  const now = new Date();
  const createdDate = new Date(deal.opp_created_date);
  const closeDate = deal.close_date ? new Date(deal.close_date) : new Date(now.setDate(now.getDate() + 30));
  const ageInDays = Math.floor((new Date() - createdDate) / (1000 * 60 * 60 * 24));
  const daysToClose = Math.floor((closeDate - new Date()) / (1000 * 60 * 60 * 24));
  
  const avgSize = deal.seller_avg_deal_size || 10000;
  const productContext = deal.seller_product_rules || "PRODUCT: Unknown.";
  const category = deal.forecast_stage || "Pipeline";
  
  // B. Determine Mode
  const isPipeline = ["Pipeline", "Discovery", "Qualification", "Prospecting"].includes(category);
  const isBestCase = ["Best Case", "Upside", "Solution Validation"].includes(category);
  // const isCommit = ["Commit", "Closing", "Negotiation"].includes(category); // Implied else

  let instructions = "";
  let bannedTopics = "None.";
  
  if (isPipeline) {
     instructions = `
     **MODE: PIPELINE (The Skeptic)**
     - **STRICT CEILING:** This deal CANNOT score > 15.
     - **FOCUS:** Pain, Metrics, Champion.
     - **AUTO-FAIL:** If they don't know the Pain, score is 0.
     - **IGNORED SCORES:** Paper Process and Decision Process are ALWAYS 0/3.`;
     bannedTopics = "Do NOT ask about: Legal, Procurement, Signatures, Redlines, Close Date specifics.";
  } else if (isBestCase) {
     instructions = `
     **MODE: BEST CASE (The Gap Hunter)**
     - **GOAL:** Find the missing link preventing Commit.
     - **LOGIC:** Look at [HISTORY]. If a category is '3', DO NOT ASK about it. Attack the '1s'.`;
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

  // C. Assemble Prompt
  return `
    You are "Matthew," a VP of Sales Auditor. You are cynical, direct, and data-driven.
    Your voice should be fast, professional, but slightly impatient.

    ### DEAL CONTEXT
    - Account: ${deal.account_name}
    - Stage: ${category}
    - Value: $${deal.amount} (Avg: $${avgSize})
    - Age: ${ageInDays} days (Close in: ${daysToClose} days)
    - History: ${deal.last_summary || "None"}
    - Current Health: ${deal.current_score || 0}/27

    ### PRODUCT CONTEXT
    ${productContext}

    ### AUDIT INSTRUCTIONS
    ${instructions}

    ### RULES OF ENGAGEMENT
    1. **INTERRUPTIBLE:** Speak concisely. If interrupted, stop immediately.
    2. **LIVE UPDATES:** As soon as you hear a fact (e.g., "The pain is high costs"), call 'update_opportunity' INSTANTLY. Do not wait for end of thought.
    3. **NO FLUFF:** Don't say "Got it" or "Understood." Just ask the next hard question.
    4. **SKEPTICISM:** If the user is vague, challenge them. Treat vagueness as RISK (Score 1).
    5. **BANNED TOPICS:** ${bannedTopics}
    6. **NO COACHING:** Never ask for feedback.

    ### CHAMPION DEFINITIONS (CRITICAL)
    - **1 (Coach):** Friendly, no power.
    - **2 (Mobilizer):** Has influence, hasn't acted.
    - **3 (Champion):** Power AND is selling for us.

    ### SCORING RUBRIC (0-3)
    0=Missing, 1=Weak, 2=Gathering, 3=Validated.
  `;
}

// --- 3. HELPER: DB UPDATE ---
async function updateDatabase(oppId, args) {
    try {
        console.log(`⚡ UPDATING DB for Opp ${oppId}:`, args);
        
        // 1. Fetch current JSON to merge
        const res = await pool.query("SELECT audit_details FROM opportunities WHERE id = $1", [oppId]);
        let currentDetails = res.rows[0]?.audit_details || {};
        
        // 2. Merge new scores/names into JSON
        const keys = Object.keys(args);
        keys.forEach(key => {
            if (key.includes("_score") || key.includes("_name") || key.includes("_title") || key.includes("competitor")) {
                currentDetails[key] = args[key];
            }
        });

        // 3. Build SQL Update
        let query = "UPDATE opportunities SET audit_details = $1, last_updated = NOW()";
        const params = [currentDetails];
        let paramIdx = 2;

        if (args.summary) {
            query += `, last_summary = $${paramIdx}`;
            params.push(args.summary);
            paramIdx++;
        }
        if (args.next_steps) {
            query += `, next_steps = $${paramIdx}`;
            params.push(args.next_steps);
            paramIdx++;
        }
        if (args.forecast_stage) {
            query += `, forecast_stage = $${paramIdx}`;
            params.push(args.forecast_stage);
            paramIdx++;
        }

        query += ` WHERE id = $${paramIdx}`;
        params.push(oppId);

        await pool.query(query, params);
        return { success: true, message: "CRM Updated" };
    } catch (e) {
        console.error("DB Error:", e);
        return { success: false, error: e.message };
    }
}

// --- 4. WEBSOCKET ROUTE (The Realtime Stream) ---
wss.on("connection", (ws, req) => {
    console.log("Client Connected");
    
    // Extract OppId from URL params (passed from Twilio)
    const urlParams = new URLSearchParams(req.url.replace('/','')); 
    const oppId = urlParams.get('oppId') || '4';

    let openAIWs = null;
    let streamSid = null;

    // A. Connect to OpenAI Realtime
    const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17";
    openAIWs = new WebSocket(url, {
        headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "realtime=v1"
        }
    });

    // B. Handle OpenAI Events
    openAIWs.on("open", async () => {
        console.log("✅ Connected to OpenAI Realtime");
        
        // Load Deal Context
        const dbRes = await pool.query("SELECT * FROM opportunities WHERE id = $1", [oppId]);
        const deal = dbRes.rows[0];

        // Send Session Config
        const sessionConfig = {
            type: "session.update",
            session: {
                modalities: ["text", "audio"],
                instructions: getSystemPrompt(deal),
                voice: "alloy", // "alloy" is deep/professional. "echo" is softer.
                input_audio_format: "g711_ulaw",
                output_audio_format: "g711_ulaw",
                turn_detection: { type: "server_vad" },
                tools: [DATABASE_TOOL],
                tool_choice: "auto"
            }
        };
        openAIWs.send(JSON.stringify(sessionConfig));
        
        // Trigger the first greeting
        openAIWs.send(JSON.stringify({
            type: "response.create",
            response: {
                modalities: ["text", "audio"],
                instructions: `Greet the user by reading the summary: "${deal.last_summary || 'No update'}" and asking for the latest.`
            }
        }));
    });

    openAIWs.on("message", async (data) => {
        const event = JSON.parse(data);

        // 1. Audio Delta (Agent Speaking) -> Send to Twilio
        if (event.type === "response.audio.delta" && event.delta) {
            const audioPayload = {
                event: "media",
                streamSid: streamSid,
                media: { payload: event.delta }
            };
            ws.send(JSON.stringify(audioPayload));
        }

        // 2. Function Call (Agent wants to save data)
        if (event.type === "response.function_call_arguments.done") {
            const args = JSON.parse(event.arguments);
            const callId = event.call_id;
            
            // Execute DB Update
            const result = await updateDatabase(oppId, args);

            // Tell OpenAI it's done
            openAIWs.send(JSON.stringify({
                type: "conversation.item.create",
                item: {
                    type: "function_call_output",
                    call_id: callId,
                    output: JSON.stringify(result)
                }
            }));
            
            // Trigger a response so he acknowledges it naturally
            openAIWs.send(JSON.stringify({ type: "response.create" }));
        }
    });

    // C. Handle Twilio Events
    ws.on("message", (message) => {
        const data = JSON.parse(message);

        if (data.event === "start") {
            streamSid = data.start.streamSid;
            console.log(`📞 Stream Started: ${streamSid}`);
        } else if (data.event === "media") {
            // Send audio to OpenAI
            if (openAIWs.readyState === WebSocket.OPEN) {
                openAIWs.send(JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: data.media.payload
                }));
            }
        } else if (data.event === "stop") {
            console.log("Call Ended");
            if (openAIWs.readyState === WebSocket.OPEN) openAIWs.close();
        }
    });

    ws.on("close", () => {
        if (openAIWs.readyState === WebSocket.OPEN) openAIWs.close();
    });
});

// --- 5. INITIAL HTTP ROUTE (Twilio hits this first) ---
app.post("/agent", (req, res) => {
    const oppId = req.query.oppId || "4";
    // TwiML to start the WebSocket Stream
    const twiml = `
    <Response>
        <Connect>
            <Stream url="wss://${req.headers.host}/?oppId=${oppId}" />
        </Connect>
    </Response>
    `;
    res.type("text/xml").send(twiml);
});

// --- 6. DASHBOARD ROUTE (Unchanged) ---
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

// --- START SERVER ---
server.listen(PORT, () => console.log(`🚀 Realtime Server live on port ${PORT}`));