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

// --- 2. THE GOLD STANDARD SYSTEM PROMPT ---
function getSystemPrompt(deal, repName, dealsLeft) {
    const category = deal.forecast_stage || "Pipeline";
    const hasHistory = (deal.last_summary && deal.last_summary.length > 10);
    const amountStr = new Intl.NumberFormat('en-US', { 
        style: 'currency', 
        currency: 'USD', 
        maximumFractionDigits: 0 
    }).format(deal.amount || 0);

    const intro = `Hi ${repName}, this is Matthew. Reviewing ${dealsLeft} deals, starting with ${deal.account_name} for ${amountStr} in ${category}.`;
    const hook = hasHistory ? `Last update: "${deal.last_summary}". What's changed?` : "This is a new deal. What's the specific Pain?";

    // THIS IS THE FIXED RETURN STRING
    return `
    ### MANDATORY OPENING: START HERE
    You MUST open the call with this exact script: "${intro} ${hook}"
    Do not say "How can I help you" or "I am here to assist."

    ### ROLE & IDENTITY 
    You are Matthew, a VP of Sales and Forecasting Auditor. You are professional, data-driven, and direct. You DO NOT do small talk. Your sole objective is to extract verifiable deal data to determine forecast accuracy. Filter out rep optimism; focus exclusively on objective evidence.

    • THE "NO-COACHING" MANDATE: Do not offer advice or selling tips. If asked for help, redirect: "My role is to qualify the deal. I suggest working with your manager on this. Let's look at the next item..."
    • THE "WHY" RULE: If a rep lacks evidence, state the specific risk (e.g., "Without an EB, the deal cannot be signed") and move on.
    • STALLING / HESITATION: If the rep says "um," "uh," or pauses, do not skip. Ask: "Take your time. Do you actually have visibility into this?"
    • PRODUCT POLICE: Your "Internal Truths" are derived strictly from the Sales Rep’s own company website/documentation. If a rep claims a fake feature, correct them immediately.

    ### INTERACTION PROTOCOL & SEQUENCE
    Investigate in this EXACT ORDER. Do not name categories or provide mid-call scores.

    1. IMPLICATE PAIN: Only real if there is a cost to doing nothing. Probe: "What happens if they do nothing?"
       - CRITICAL: Summarize the "Cost of Inaction" immediately after the rep answers. (Example: "Understood. Because they lack [Feature], they are losing $50k/month. That is the cost of inaction.")
       - Constraint: Do not summarize this again at the end. Do not summarize any other category.
    2. METRICS
    3. CHAMPION: Verify status. Probe for examples of them selling when you are not there.
       - 1 (Coach): Friendly, no power.
       - 2 (Mobilizer): Has influence, but hasn't acted yet.
       - 3 (Champion): Actively sells for us/spends political capital.
    4. ECONOMIC BUYER
    5. DECISION CRITERIA
    6. DECISION PROCESS
    7. COMPETITION
    8. PAPER PROCESS
    9. TIMING: Assess if there is enough or too much time remaining.

    ### OPERATING RULES
    • One Question at a Time: Ask one question, then wait for response.
    • The Evidence Probe: If an answer is vague, probe ONCE. If still vague, score as 1, state the risk, and move to the next item.
    • No Labels: Do not use category names.

    ### DEAL CONTEXT
    - Account: ${deal.account_name}
    - Amount: ${amountStr}
    - Stage: ${category}
    - History: ${hasHistory ? "Reviewed Before. Focus ONLY on what has changed since: " + deal.last_summary : "NEW DEAL. Validate from scratch."}
    
    ### INTERNAL TRUTHS (PRODUCT POLICE)
    ${deal.org_product_data || "Verify capabilities against company documentation."}

    ### FINAL OUTPUT: THE AUDIT REPORT
    Provide ONLY this section. No intro, outro, or Pain summary.
    Deal Summary:
    • Forecast Confidence: [Low/Med/High]
    • Final Health Score: [Total numerical score/27]
    • Factual Risks: A bulleted list of evidence gaps/risks following the audit sequence. Use clinical language.
    • Immediate Next Steps: List only specific data points missing.
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
    const urlParams = new URLSearchParams(req.url.replace('/','')); 
    const oppId = urlParams.get('oppId') || '4';

    let openAIWs = null;
    let streamSid = null;
    let deal = null;
    let openAIReady = false; 
    let twilioReady = false; 
    let greetingSent = false;

    const triggerGreeting = async () => {
        if (openAIReady && twilioReady && deal && !greetingSent) {
            greetingSent = true;
            // Response trigger follows the mandatory session instructions
            openAIWs.send(JSON.stringify({
                type: "response.create",
                response: { modalities: ["text", "audio"] }
            }));
        }
    };

    const fullUrl = `${MODEL_URL}?model=${MODEL_NAME}`;
    openAIWs = new WebSocket(fullUrl, {
        headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" }
    });

    openAIWs.on("open", async () => {
        const dbRes = await pool.query("SELECT * FROM opportunities WHERE id = $1", [oppId]);
        deal = dbRes.rows[0];

        const countRes = await pool.query('SELECT COUNT(*) FROM opportunities WHERE id >= $1', [oppId]);
        const dealsLeft = countRes.rows[0].count;
        const repName = (deal.rep_name || "Rep").split(' ')[0];

        openAIWs.send(JSON.stringify({
            type: "session.update",
            session: {
                modalities: ["text", "audio"],
                instructions: getSystemPrompt(deal, repName, dealsLeft),
                voice: "ash", 
                temperature: 0.6,
                turn_detection: { 
                    type: "server_vad",
                    threshold: 0.8,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 800
                },
                tools: [DATABASE_TOOL],
                tool_choice: "auto"
            }
        }));
        
        openAIReady = true;
        triggerGreeting(); 
    });

    openAIWs.on("message", (data) => {
        const event = JSON.parse(data);
        if (event.type === "response.audio.delta" && streamSid) {
            ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: event.delta } }));
        }
        if (event.type === "input_audio_buffer.speech_started" && streamSid) {
            ws.send(JSON.stringify({ event: "clear", streamSid }));
        }
        if (event.type === "response.function_call_arguments.done") {
            (async () => {
                const args = JSON.parse(event.arguments);
                const result = await updateDatabase(oppId, args);
                openAIWs.send(JSON.stringify({ 
                    type: "conversation.item.create", 
                    item: { type: "function_call_output", call_id: event.call_id, output: JSON.stringify(result) } 
                }));
                openAIWs.send(JSON.stringify({ type: "response.create" }));
            })();
        }
    });

    ws.on("message", (message) => {
        const data = JSON.parse(message);
        if (data.event === "start") {
            streamSid = data.start.streamSid;
            twilioReady = true;
            triggerGreeting();
        } else if (data.event === "media" && openAIWs.readyState === WebSocket.OPEN) {
            openAIWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: data.media.payload }));
        }
    });
});

app.post("/agent", (req, res) => {
    const oppId = req.query.oppId || "4";
    res.type("text/xml").send(`<Response><Connect><Stream url="wss://${req.headers.host}/?oppId=${oppId}" /></Connect></Response>`);
});

server.listen(PORT, () => console.log(`🚀 Server live on ${PORT}`));
