require('dotenv').config();
const http = require('http');
const express = require('express');
const { Pool } = require('pg');
const WebSocket = require('ws');
const cors = require('cors');

// --- [BLOCK 1: CONFIGURATION & ENV] ---
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.MODEL_API_KEY; 
const MODEL_URL = process.env.MODEL_URL || "wss://api.openai.com/v1/realtime";
const MODEL_NAME = process.env.MODEL_NAME || "gpt-4o-mini-realtime-preview-2024-12-17"; 

// --- [BLOCK 2: DB CONNECTION] ---
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

// --- [Block MEDDPICC_AGENT_PROMPT] --- 

/** 
* SUB-BLOCK: PROMPT_GENERATOR 
* Creates the dynamic MEDDPICC instructions based on current deal data. 
*/
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

    // B. THE CORE INSTRUCTION SET
    return `
    ### MANDATORY OPENING: START HERE
    You MUST open the call with this exact script: "${intro} ${hook}"
    Do not say "How can I help you" or "I am here to assist."

    ### ROLE & IDENTITY 
    You are Matthew, a VP of Sales and Forecasting Auditor. You are professional, data-driven, and direct. 
•	NO SMALL TALK. NO COACHING. Your sole objective is to extract verifiable deal data to determine forecast accuracy. Filter out rep optimism; focus exclusively on objective evidence. Do not offer advice or selling tips.
•	ZERO TOLERANCE: If the rep lacks an answer or says "unsure," the score for that category is 0. Do not give 1s for "participation."
•	THE "WHY" RULE: If a rep lacks evidence, state the specific risk (e.g., "Without an EB, the deal cannot be signed") and move on.
•	STALLING / HESITATION: If the rep says "um," "uh," or pauses, do not skip. Ask: "Take your time. Do you actually have visibility into this?"
•	PRODUCT POLICE: Your "Internal Truths" are derived strictly from the Sales Rep’s own company website/documentation. If a rep claims a fake feature, correct them immediately.

### SMART CONTEXT (THE ANTI-ROBOT BRAIN)

•	CROSS-CATEGORY LISTENING: If the rep answers a future category early (e.g., mentions the $600k penalty during the Champion phase), MARK IT as answered and SKIP that question later.
•	NO REDUNDANT QUESTIONS: Do not ask a question if the answer was already provided in a previous turn.

### INTERACTION PROTOCOL (STRICT SEQUENCE)
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
•	One Question at a Time: Ask one question, then wait for response.
•	he Evidence Probe: If an answer is vague, probe ONCE. If still vague, score as 1, state the risk, and move to the next item.
•	No Labels: Do not use category names.

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

// --- [BLOCK 3: TWILIO WEBHOOK] ---
app.post("/agent", (req, res) => {
    const oppId = req.query.oppId || "4";
    console.log(`[TWILIO] Incoming Call for Opp ${oppId}`);
    res.type("text/xml").send(`
        <Response>
            <Connect>
                <Stream url="wss://${req.headers.host}/?oppId=${oppId}" />
            </Connect>
        </Response>
    `);
});

// --- [BLOCK 4: WEBSOCKET CORE] ---
wss.on('connection', (ws, req) => {
    // 1. SAFE ID EXTRACTION
    const oppId = new URL(req.url, 'http://localhost').searchParams.get('oppId') || "4";
    console.log(`\n[CONNECTION] 📞 Incoming Call for Opp: ${oppId}`);

    let streamSid = null;

    const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
        headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "realtime=v1"
        }
    });

    // --- [SUB-BLOCK 4.A: OPENAI SESSION INIT] ---
    openAiWs.on('open', async () => {
        // A. FETCH DYNAMIC DATA (No more hardcoding)
        let dealData = { account_name: "Unknown Account", amount: 0, forecast_stage: "Pipeline", last_summary: null };
        let dealsLeft = 0;

        try {
            // Query 1: The Target Deal
            const dealResult = await pool.query('SELECT * FROM opportunities WHERE id = $1', [oppId]);
            
            // Query 2: The Context (How many other active deals?)
            // We exclude closed deals so he doesn't nag about dead/won leads
            const countResult = await pool.query("SELECT COUNT(*) FROM opportunities WHERE forecast_stage NOT IN ('Closed Won', 'Closed Lost')");
            dealsLeft = parseInt(countResult.rows[0].count);

            if (dealResult.rows.length > 0) {
                dealData = dealResult.rows[0];
            } else {
                console.log(`⚠️ Opp ${oppId} not found. Using Ghost Data.`);
            }
        } catch (e) {
            console.error("❌ DB ERROR:", e.message);
        }

        // --- [DATA DEBUGGER] ---
        // This lets you see EXACTLY what the Agent sees
        console.log("------------------------------------------");
        console.log("🤖 [AGENT BRAIN DATA]");
        console.log(`• Account: ${dealData.account_name}`);
        console.log(`• Amount:  $${dealData.amount}`);
        console.log(`• Stage:   ${dealData.forecast_stage}`);
        console.log(`• Mode:    ${(dealData.last_summary && dealData.last_summary.length > 10) ? "REVIEW (Update Mode)" : "NEW DEAL (Discovery Mode)"}`);
        console.log(`• Queue:   ${dealsLeft} deals remaining`);
        console.log("------------------------------------------");

        // B. GENERATE PROMPT
        const instructions = getSystemPrompt(dealData, "Erik", dealsLeft);

        // C. CONFIGURE SESSION
        const sessionUpdate = {
            type: "session.update",
            session: {
                modalities: ["text", "audio"],
                instructions: instructions,
                voice: "verse", // Deep, professional voice
                input_audio_format: "g711_ulaw",
                output_audio_format: "g711_ulaw",
                turn_detection: { type: "server_vad" }
            }
        };
        openAiWs.send(JSON.stringify(sessionUpdate));

        // D. FORCE SPEAK (The "Hello" kicker)
        setTimeout(() => {
            openAiWs.send(JSON.stringify({ type: "response.create" }));
        }, 250);
    });

    // --- [SUB-BLOCK 4.B: AI TO TWILIO (OUTPUT)] ---
    openAiWs.on('message', (data) => {
        const response = JSON.parse(data);

        // Audio Stream
        if (response.type === 'response.audio.delta' && response.delta) {
            ws.send(JSON.stringify({
                event: 'media',
                streamSid: streamSid,
                media: { payload: response.delta }
            }));
        }

        // --- [SUB-BLOCK 4.C: DATA CAPTURE & DB WRITE] ---
        if (response.type === 'response.audio_transcript.done') {
            const transcript = response.transcript;
            
            // Log what he thinks, so we can debug his "ears"
            // console.log(`[🗣️]: ${transcript}`);

            if (transcript.includes("Deal Summary:") || transcript.includes("Final Health Score:")) {
                console.log("\n🎯 FINAL AUDIT DETECTED - PARSING...");
                try {
                    const scoreMatch = transcript.match(/Final Health Score:\s*\[?(\d+)\/27\]?/i);
                    const totalScore = scoreMatch ? parseInt(scoreMatch[1]) : null;
                    
                    let newStage = "Pipeline";
                    if (totalScore >= 20) newStage = "Commit";
                    else if (totalScore >= 12) newStage = "Best Case";

                    // The "Update" Logic
                    const updateQuery = `
                        UPDATE opportunities 
                        SET last_summary = $1, forecast_stage = $2, updated_at = NOW() 
                        WHERE id = $3
                    `;
                    pool.query(updateQuery, [transcript, newStage, oppId]);
                    console.log(`✅ DATABASE UPDATED: ${newStage} (Score: ${totalScore}/27)`);
                } catch (dbErr) {
                    console.error("❌ DB UPDATE FAILED:", dbErr.message);
                }
            }
        }
    });

    // --- [SUB-BLOCK 4.D: TWILIO TO AI (INPUT)] ---
    ws.on('message', (message) => {
        const msg = JSON.parse(message);
        
        if (msg.event === 'start') {
            streamSid = msg.start.streamSid;
            console.log(`[STREAM START] Sid: ${streamSid}`);
        } else if (msg.event === 'media' && openAiWs.readyState === WebSocket.OPEN) {
            openAiWs.send(JSON.stringify({
                type: "input_audio_buffer.append",
                audio: msg.media.payload
            }));
        }
    });

    ws.on('close', () => openAiWs.close());
});// --- [BLOCK 5: DASHBOARD API] ---
app.get("/get-deal", async (req, res) => {
    const oppId = req.query.oppId;
    try {
        const result = await pool.query('SELECT * FROM opportunities WHERE id = $1', [oppId]);
        res.json(result.rows[0] || { message: "Deal not found" });
    } catch (err) {
        res.status(500).send("Database connection error");
    }
});

server.listen(PORT, () => console.log(`🚀 Master Server live on ${PORT}`));
