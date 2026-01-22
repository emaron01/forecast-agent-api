
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
function getSystemPrompt(deal, repName, dealsLeft) {
    const category = deal.forecast_stage || "Pipeline";
    const hasHistory = (deal.last_summary && deal.last_summary.length > 10);
    const amountStr = new Intl.NumberFormat('en-US', { 
        style: 'currency', currency: 'USD', maximumFractionDigits: 0 
    }).format(deal.amount || 0);

    // 1. EXTRACT SCORES
    const details = deal.audit_details || {};
    const scores = {
        pain: details.pain?.score || 0, metrics: details.metrics?.score || 0,
        champion: details.champion?.score || 0, eb: details.eb?.score || 0,
        process: details.process?.score || 0, paper: details.paper?.score || 0,
        timing: details.timing?.score || 0
    };
    
    // 2. DEFINE CONTEXT VARIABLES
    const scoreContext = `EXISTING DATA: [Pain:${scores.pain}, Metrics:${scores.metrics}, Champ:${scores.champion}, EB:${scores.eb}, Process:${scores.process}, Paper:${scores.paper}, Timing:${scores.timing}]`;

    let stageInstructions = "";
    if (category.includes("Commit")) {
        stageInstructions = `MODE: CLOSING PARTNER (Commit). • Tone: Professional, precise, urgent but supportive. • Goal: "Let's secure the win." • Focus: Identify final blockers (Legal/Signatures).`;
    } else if (category.includes("Best Case")) {
        stageInstructions = `MODE: DEAL ARCHITECT (Best Case). • Tone: Strategic and curious. • Goal: "Let's strengthen our case." • Focus: Verify the Champion is strong enough to sell for us.`;
    } else {
        stageInstructions = `MODE: PIPELINE SCANNER (Pipeline). • Tone: Casual, low-pressure, collaborative. • Goal: "Let's map out what we know so far." • Strategy: Ask "What can you tell me about this opportunity?" and map answers to categories. • Rule: 1 Question per topic. Do not dig.`;
    }

    const intro = `Hi ${repName}, this is Matthew. Reviewing ${dealsLeft + 1} deals, starting with ${deal.account_name} for ${amountStr} in ${category}.`;
    const hook = hasHistory ? `Last update: "${deal.last_summary}". What's the latest?` : "What can you tell me about this opportunity?";

    // 3. THE FULL UNABRIDGED RETURN
    return `
    ### MANDATORY OPENING
    You MUST open the call with this exact script: "${intro} ${hook}"
    Do not say "How can I help you" or "I am here to assist."

    ### ROLE & IDENTITY 
    You are Matthew, a VP of Sales. You are professional, data-driven, and direct. 
    NO HALLUCINATION: The customer is "${deal.account_name}". Never say "Acme".
    ${stageInstructions}

    [CORE RULES]
    • NO SMALL TALK. Your sole objective is to extract verifiable deal data.
    • ZERO TOLERANCE: If the rep lacks an answer or says "unsure," the score is 0. Do not give 1s for "participation."
    • THE "WHY" RULE: If a rep lacks evidence, state the specific risk (e.g., "Without an EB, the deal cannot be signed") and move on.
    • STALLING / HESITATION: If the rep says "um," "uh," or pauses, do not skip. Ask: "Take your time. Do you actually have visibility into this?"
    • PRODUCT POLICE: Your "Internal Truths" are derived strictly from company docs. If a rep claims a fake feature, correct them immediately.

    [FORECAST RULES]
    • MOMENTUM CHECK: Your primary goal is to determine: Is this deal STALLED or PROGRESSING? 
    • IF STALLED: Do not ask for a date. Ask "What is the specific blocker?" and log it. 
    • IF PROGRESSING: Validate the velocity (e.g., "What is the immediate next step?"). 
    • GAP LOGIC: If they don't have a date/answer, do not argue. Log it as a "Gap" and move on.

    ### SMART CONTEXT (THE ANTI-ROBOT BRAIN)
    • CROSS-CATEGORY LISTENING: If the rep answers a future category early, MARK IT as answered and SKIP later.
    • MEMORY: Check "${scoreContext}". If a score is 3, DO NOT ASK about it unless the user indicates a change.

    ### INTERACTION PROTOCOL (LOGIC BRANCH)
    
    [BRANCH A: THE CLOSING SHORTCUT]
    *Trigger ONLY if user mentions: "PO", "Contract", "SOW", "Paperwork", "Procurement", "Signed", "Done"*
    1. SCENARIO: "SIGNED / DONE": VERIFY: "Do we have the clean PDF in hand?" IF YES: Score 27/27. Say: "That is huge. Great work. I'm moving this to Closed Won."
    2. SCENARIO: "WORKING ON IT": SKIP Pain, Metrics, Champion. EXECUTE "LEGAL CHECK" (Redlining?) and "DATE CHECK" (Precise PO date).

    [BRANCH B: STANDARD MEDDPICC]
    *Investigate in this EXACT ORDER. Do not name categories or provide mid-call scores.*
    ${scoreContext}
    1. IMPLICATE PAIN: Only real if there is a cost to doing nothing. Probe: "What happens if they do nothing?"
       - CRITICAL: Summarize the "Cost of Inaction" immediately after the rep answers. Do not summarize again at the end.
    2. METRICS
    3. CHAMPION: Verify status: 1 (Coach): Friendly, no power. 2 (Mobilizer): Has influence, but hasn't acted yet. 3 (Champion): Actively sells for us/spends political capital.
    4. ECONOMIC BUYER
    5. DECISION CRITERIA
    6. DECISION PROCESS
    7. COMPETITION
    8. PAPER PROCESS
    9. TIMING: Assess if there is enough or too much time remaining.

    ### OPERATING RULES
    • One Question at a Time: Ask one question, then wait for response.
    • The Evidence Probe: If an answer is vague, probe ONCE. If still vague, score as 1, state risk, move on.
    • No Labels: Do not use category names.

    ### DEAL CONTEXT
    - Account: ${deal.account_name} | Amount: ${amountStr} | Stage: ${category}
    - History: ${hasHistory ? "Reviewed Before. Focus ONLY on what has changed since: " + deal.last_summary : "NEW DEAL. Validate from scratch."}
    
    ### INTERNAL TRUTHS (PRODUCT POLICE)
    ${deal.org_product_data || "Verify capabilities against company documentation."}

    ### FINAL OUTPUT: THE AUDIT REPORT & DATABASE SNIPE
    Deal Summary:
    • Forecast Confidence: [Low/Med/High]
    • Final Health Score: [Total numerical score/27]
    • Factual Risks: A bulleted list of evidence gaps/risks following the audit sequence. Use clinical language.
    • Immediate Next Steps: List only specific data points missing.

    DATABASE_DATA: Pain: [score]| [note], Metrics: [score]| [note], Champion: [score]| [note], EB: [score]| [note], Criteria: [score]| [note], Process: [score]| [note], Competition: [score]| [note], Paper: [score]| [note], Timing: [score]| [note]
    `;
}

// --- [BLOCK 4: SMART GATEKEEPER WEBHOOK] ---
app.post("/agent", async (req, res) => {
    const callerPhone = req.body.From; // e.g., '+12153533849'
    console.log(`\n📞 Incoming call from: ${callerPhone}`);

    try {
        // Look up the Org ID based on the phone number
        const result = await pool.query(
            "SELECT org_id FROM opportunities WHERE rep_phone = $1 LIMIT 1", 
            [callerPhone]
        );

        // If recognized, use their ID. If unknown, default to Org 1 for testing.
        const orgId = result.rows.length > 0 ? result.rows[0].org_id : 1;
        
        console.log(`🎯 Identified Caller! Routing to Org ID: ${orgId}`);

        res.type("text/xml").send(`
            <Response>
                <Connect>
                    <Stream url="wss://${req.headers.host}/?org_id=${orgId}" />
                </Connect>
            </Response>
        `);
    } catch (err) {
        console.error("❌ Gatekeeper Lookup Error:", err.message);
        // Fallback to Org 1 so the call doesn't just die
        res.type("text/xml").send(`
            <Response><Connect><Stream url="wss://${req.headers.host}/?org_id=1" /></Connect></Response>
        `);
    }
});

//--- [BLOCK 5: WEBSOCKET CORE (SECURE MULTI-TENANT)] ---
wss.on('connection', (ws, req) => {
    // 1. EXTRACT ORG_ID FROM STREAM URL
    // Twilio will send this via: wss://your-app.com/?org_id=1
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const orgId = urlParams.get('org_id') || 1; 
    
    console.log(`\n[CONNECTION] 📞 Call Started for Organization ID: ${orgId}`);
    let streamSid = null;
    
    // --- STATE MANAGEMENT ---
    let dealQueue = [];
    let currentDealIndex = 0;
    let isSaving = false; 

    const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
        headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "realtime=v1"
        }
    });

    // --- HELPER: ADVANCE PLAYLIST ---
    const advanceToNextDeal = () => {
        currentDealIndex++; 
        
        if (currentDealIndex < dealQueue.length) {
            const nextDeal = dealQueue[currentDealIndex];
            const dealsRemaining = dealQueue.length - currentDealIndex;
            const nextFirstName = (nextDeal.rep_name || "Team").split(' ')[0];

            console.log(`⏩ ADVANCING: ${nextDeal.account_name} for ${nextFirstName}`);
            
            const nextInstructions = getSystemPrompt(nextDeal, nextFirstName, dealsRemaining);
            
            openAiWs.send(JSON.stringify({
                type: "session.update",
                session: { instructions: nextInstructions }
            }));

            openAiWs.send(JSON.stringify({
                type: "response.create",
                response: {
                    modalities: ["text", "audio"],
                    instructions: `Say exactly: "Okay, moving on to ${nextDeal.account_name}." Then immediately ask the opening question.`
                }
            }));
            
            isSaving = false; 
        } else {
            console.log("🏁 PLAYLIST COMPLETE");
            openAiWs.send(JSON.stringify({
                type: "response.create",
                response: { instructions: "Say: 'That concludes the review. Database updated. Goodbye.' then hang up." }
            }));
        }
    };

    // --- [SUB-BLOCK 5.A: SECURE SESSION INIT] ---
    openAiWs.on('open', async () => {
        try {
            // SECURE QUERY: Filters by orgId to prevent data leakage between companies
            const result = await pool.query(`
                SELECT o.*, org.product_truths AS org_product_data, org.name AS org_name
                FROM opportunities o
                JOIN organizations org ON o.org_id = org.id
                WHERE o.org_id = $1 
                AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost') 
                ORDER BY o.id ASC
            `, [orgId]);

            dealQueue = result.rows;
            console.log(`📋 PLAYLIST LOADED: ${dealQueue.length} Deals for Org ${orgId}`);
        } catch (e) {
            console.error("❌ DB ERROR:", e.message);
        }

        if (dealQueue.length > 0) {
            const currentDeal = dealQueue[currentDealIndex];
            const dealsRemaining = dealQueue.length - 1 - currentDealIndex;
            const firstName = (currentDeal.rep_name || "Team").split(' ')[0]; 

            console.log("------------------------------------------");
            console.log(`🤖 [MATTHEW STARTING]: ${currentDeal.account_name} for ${firstName}`);
            console.log("------------------------------------------");

            const instructions = getSystemPrompt(currentDeal, firstName, dealsRemaining);

            const sessionUpdate = {
                type: "session.update",
                session: {
                    modalities: ["text", "audio"],
                    instructions: instructions,
                    voice: "verse",
                    input_audio_format: "g711_ulaw",
                    output_audio_format: "g711_ulaw",
                    turn_detection: { type: "server_vad", threshold: 0.6, silence_duration_ms: 1000 }
                }
            };
            openAiWs.send(JSON.stringify(sessionUpdate));
            setTimeout(() => { openAiWs.send(JSON.stringify({ type: "response.create" })); }, 250);
        } else {
            console.log("⚠️ NO DEALS FOUND FOR THIS ORG.");
            openAiWs.send(JSON.stringify({
                type: "session.update",
                session: { instructions: "You are a system announcer. Say 'No active deals found for your organization.' and hang up." }
            }));
            setTimeout(() => { openAiWs.send(JSON.stringify({ type: "response.create" })); }, 250);
        }
    });

    // --- [SUB-BLOCK 5.B: AI TO TWILIO] ---
    openAiWs.on('message', (data) => {
        const response = JSON.parse(data);

        if (response.type === 'response.audio.delta' && response.delta) {
            ws.send(JSON.stringify({
                event: 'media', streamSid: streamSid, media: { payload: response.delta }
            }));
        }

        // --- [SUB-BLOCK 5.C: SNIPER] ---
        if (response.type === 'response.audio_transcript.done') {
            const transcript = response.transcript;
            
            if (transcript.includes("DATABASE_DATA:") && !isSaving) {
                isSaving = true; 
                console.log("\n🎯 SNIPER: Parsing Audit Result...");

                try {
                    const extract = (label) => {
                        const regex = new RegExp(`${label}:\\s*(\\d)\\|\\s*([^,]+?)(?=(?:,|$|\\n))`, 'i');
                        const match = transcript.match(regex);
                        if (match) return { score: parseInt(match[1]), text: match[2].trim() };
                        return { score: 0, text: "---" };
                    };

                    const auditDetails = {
                        pain: extract("Pain"), metrics: extract("Metrics"), champion: extract("Champion"),
                        eb: extract("EB"), criteria: extract("Criteria"), process: extract("Process"),
                        competition: extract("Competition"), paper: extract("Paper"), timing: extract("Timing")
                    };

                    const totalScore = Object.values(auditDetails).reduce((acc, curr) => acc + curr.score, 0);
                    let newStage = "Pipeline";
                    if (totalScore >= 24) newStage = "Closed Won";
                    else if (totalScore >= 20) newStage = "Commit";
                    else if (totalScore >= 12) newStage = "Best Case";

                    const currentDeal = dealQueue[currentDealIndex];
                    const updateQuery = `
                        UPDATE opportunities 
                        SET last_summary = $1, audit_details = $2, forecast_stage = $3, 
                            updated_at = NOW(), run_count = COALESCE(run_count, 0) + 1
                        WHERE id = $4
                    `;

                    pool.query(updateQuery, [transcript, JSON.stringify(auditDetails), newStage, currentDeal.id])
                        .then(() => {
                            console.log(`✅ SAVED: ${currentDeal.account_name} (Org: ${orgId})`);
                            advanceToNextDeal();
                        })
                        .catch(err => {
                            console.error("❌ DB SAVE FAIL:", err.message);
                            advanceToNextDeal();
                        });
                } catch (err) {
                    console.error("❌ PARSE FAIL:", err.message);
                    advanceToNextDeal();
                }
            }
        }
    });

    // --- [SUB-BLOCK 5.D: TWILIO TO AI] ---
    ws.on('message', (message) => {
        const msg = JSON.parse(message);
        if (msg.event === 'start') {
            streamSid = msg.start.streamSid;
        } else if (msg.event === 'media' && openAiWs.readyState === WebSocket.OPEN) {
            openAiWs.send(JSON.stringify({
                type: "input_audio_buffer.append",
                audio: msg.media.payload
            }));
        }
    });

    ws.on('close', () => openAiWs.close());
});

// --- [BLOCK 6 & 7: API ENDPOINTS] ---
app.get("/get-deal", async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM opportunities WHERE id = $1', [req.query.oppId]);
        res.json(result.rows[0] || {});
    } catch (err) { res.json({}); }
});

app.get("/deals", async (req, res) => {
    const orgId = req.query.org_id || 1; 
    try {
        const result = await pool.query("SELECT id, account_name, forecast_stage, run_count FROM opportunities WHERE org_id = $1 ORDER BY id ASC", [orgId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json([]); }
});

server.listen(PORT, () => console.log(`🚀 Matthew Live on ${PORT}`));

