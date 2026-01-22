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

// --- [BLOCK 3: SYSTEM PROMPT (THE MASTER STRATEGIST)] ---
function getSystemPrompt(deal, repName, dealsLeft) {
    // 1. DATA SANITIZATION (The "Null" Fix)
    // If stage is null, undefined, or empty, default to "Pipeline" logic.
    let category = deal.forecast_stage || "Pipeline";
    if (category === "Null" || category.trim() === "") category = "Pipeline";

    // 2. DATA FORMATTING
    const amountStr = new Intl.NumberFormat('en-US', { 
        style: 'currency', currency: 'USD', maximumFractionDigits: 0 
    }).format(deal.amount || 0);

    // 3. HISTORY EXTRACTION
    const lastDetails = deal.audit_details || {};
    const lastSummary = deal.last_summary || "";
    const hasHistory = lastSummary.length > 5;
    
    let historyHook = "What's the latest?";
    if (hasHistory) {
        historyHook = `Last time we flagged: "${lastSummary}". How is that looking now?`;
    }

    // 4. SCORECARD CONTEXT (Full MEDDPICC View)
    // We give Matthew the cheat sheet so he knows the current state.
    const scoreContext = `
    PRIOR SNAPSHOT:
    • Pain: ${lastDetails.pain_score || "?"}/3
    • Metrics: ${lastDetails.metrics_score || "?"}/3
    • Champion: ${lastDetails.champion_score || "?"}/3
    • EB: ${lastDetails.eb_score || "?"}/3
    • Decision Criteria: ${lastDetails.criteria_score || "?"}/3
    • Decision Process: ${lastDetails.process_score || "?"}/3
    • Competition: ${lastDetails.competition_score || "?"}/3
    • Paper Process: ${lastDetails.paper_score || "?"}/3
    • Timing: ${lastDetails.timing_score || "?"}/3
    `;

    // 5. STAGE STRATEGY (The Gap Hunter)
    let stageInstructions = "";
    
    if (category.includes("Commit")) {
        stageInstructions = `MODE: CLOSING ASSISTANT (Commit). 
        • Goal: Protect the Forecast (De-risk).
        • Logic: Scan for ANY category scored 0-2. Ask: "Why is this in Commit if [Category] is still a gap?"
        • Focus: Verify Signature Authority (EB) and Paper Process are a solid 3.`;
    
    } else if (category.includes("Best Case")) {
        stageInstructions = `MODE: DEAL STRATEGIST (Best Case). 
        • Goal: Validate the Upside.
        • Logic: "Test the Gaps." Look for 0-2 scores preventing a move to Commit.
        • Focus: Is the Champion strong enough to accelerate the Paperwork? If not, leave it in Best Case.`;
    
    } else {
        // PIPELINE (Covers: Pipeline, Null, Prospecting, Qualification)
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
    You are Matthew, a Deal Strategy AI. You are professional, data-driven, and direct.
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
    1. SCENARIO "SIGNED / DONE": VERIFY: "Do we have the clean PDF in hand?" IF YES: Score 27/27. Say: "That is huge. Great work." -> Finish.
    2. SCENARIO "WORKING ON IT": SKIP Pain, Metrics, Champion. EXECUTE "LEGAL CHECK" (Redlining?) and "DATE CHECK" (Precise PO date).

    [BRANCH B: STANDARD MEDDPICC]
    *Investigate in this EXACT ORDER. Adapt based on whether data exists.*
    ${scoreContext}
    
    1. IMPLICATE PAIN: (Score 0-3). 
       - If Score 0-2: "What is the specific cost of doing nothing?"
       - If Score 3: "You've noted strong pain. Just to be safe—did the CFO confirm they believe this calculation?" (Validate).

    2. METRICS: (Score 0-3).
    
    3. CHAMPION: Verify status: 
       - 1 (Coach): Friendly, no power. 
       - 2 (Mobilizer): Has influence, but hasn't acted yet. 
       - 3 (Champion): Actively sells for us/spends political capital.
       - *Logic:* If rep claims a 3, ask: "Give me an example of them spending political capital for us."
    
    4. ECONOMIC BUYER: (Score 0-3).
    
    5. DECISION CRITERIA: (Score 0-3). "Do their technical requirements match our solution?"
    
    6. DECISION PROCESS: (Score 0-3). "How do they buy?"
    
    7. COMPETITION: (Score 0-3). "Who are we up against?"
    
    8. PAPER PROCESS: 
       - *CRITICAL:* IF Stage is "Pipeline" (or Null), SKIP THIS ENTIRELY.
       - IF Stage is "Commit" or "Best Case", verify the document status.
    
    9. TIMING: (Score 0-3).

    ### DEAL CONTEXT
    - Account: ${deal.account_name} | Amount: ${amountStr} | Stage: ${category}
    - History: ${hasHistory ? "Reviewed Before. Focus ONLY on what has changed." : "NEW DEAL. Validate from scratch."}
    
    ### INTERNAL TRUTHS (PRODUCT POLICE)
    ${deal.org_product_data || "Verify capabilities against company documentation."}

    ### COMPLETION PROTOCOL
    When you have gathered the data, perform this EXACT sequence:

    1. **Silent Analysis:** Formulate a helpful suggestion for each category.
    2. **Verbal Confirmation:** Say exactly: "Based on today's discussion, this opportunity's Health Score is [Total] out of 27. Just one moment while I update and add feedback to your opportunity scorecard."
    3. **Transition:** Say: "Okay, let's move to the next opportunity."
    4. **Action:** Immediately trigger the `save_deal_data` tool.
       - Map your scores and coaching advice to the tool parameters.
       - *CRITICAL:* Do not wait for a user response. Trigger the tool immediately after speaking.
    `;
}

// --- [BLOCK 4: SMART GATEKEEPER WEBHOOK] ---
app.post("/agent", async (req, res) => {
    const callerPhone = req.body.From;
    console.log(`\n📞 Incoming call from: ${callerPhone}`);

    try {
        const result = await pool.query(
            `SELECT org_id FROM opportunities WHERE rep_phone = $1 LIMIT 1`, 
            [callerPhone]
        );

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
        res.type("text/xml").send(`
            <Response><Connect><Stream url="wss://${req.headers.host}/?org_id=1" /></Connect></Response>
        `);
    }
});

// --- [BLOCK 5: WEBSOCKET CORE (SILENT COACH EDITION)] ---
wss.on('connection', (ws, req) => {
    // 1. ROBUST ID EXTRACTION
    console.log(`\n[DEBUG] 🔌 New Connection. URL: ${req.url}`);
    let orgId = 1; 
    try {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const extractedId = urlObj.searchParams.get('org_id');
        if (extractedId) orgId = parseInt(extractedId, 10);
    } catch (err) { console.error(`❌ URL Parse Fail. Defaulting to 1.`); }

    console.log(`[CONNECTION] 🔒 Org ID: ${orgId}`);
    let streamSid = null;
    let dealQueue = [];
    let currentDealIndex = 0;

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

            console.log(`⏩ ADVANCING: ${nextDeal.account_name}`);
            const nextInstructions = getSystemPrompt(nextDeal, nextFirstName, dealsRemaining);

            // 1. Update Brain
            openAiWs.send(JSON.stringify({
                type: "session.update",
                session: { instructions: nextInstructions }
            }));

            // 2. Force Verbal Entry (Smooth Hand-off)
            openAiWs.send(JSON.stringify({
                type: "response.create",
                response: {
                    modalities: ["text", "audio"],
                    instructions: `Say exactly: "Pulling up ${nextDeal.account_name}." Then immediately ask the opening question.` 
                }
            }));
        } else {
            console.log("🏁 PLAYLIST COMPLETE");
            openAiWs.send(JSON.stringify({
                type: "response.create",
                response: { instructions: "Say: 'That concludes the review. Goodbye.' then hang up." }
            }));
        }
    };

    // --- [SUB-BLOCK 5.A: SESSION INIT] ---
    openAiWs.on('open', async () => {
        const result = await pool.query(`
            SELECT o.*, org.product_truths AS org_product_data 
            FROM opportunities o
            JOIN organizations org ON o.org_id = org.id
            WHERE o.org_id = $1 AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost') 
            ORDER BY o.id ASC
        `, [orgId]);
        dealQueue = result.rows;

        if (dealQueue.length > 0) {
            const currentDeal = dealQueue[currentDealIndex];
            const firstName = (currentDeal.rep_name || "Team").split(' ')[0]; 
            const instructions = getSystemPrompt(currentDeal, firstName, dealQueue.length - 1);

            const sessionUpdate = {
                type: "session.update",
                session: {
                    modalities: ["text", "audio"],
                    instructions: instructions,
                    voice: "verse",
                    input_audio_format: "g711_ulaw",
                    output_audio_format: "g711_ulaw",
                    turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 1000 },
                    tools: [{
                        type: "function",
                        name: "save_deal_data",
                        description: "Call ONLY at the end of the deal review. Saves scores and coaching tips.",
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
                                risk_summary: { type: "string" }
                            },
                            required: ["pain_score", "pain_tip", "metrics_score", "metrics_tip", "champion_score", "champion_tip", "eb_score", "eb_tip", "criteria_score", "criteria_tip", "process_score", "process_tip", "competition_score", "competition_tip", "paper_score", "paper_tip", "timing_score", "timing_tip", "risk_summary"]
                        }
                    }],
                    tool_choice: "auto"
                }
            };
            openAiWs.send(JSON.stringify(sessionUpdate));
            setTimeout(() => { openAiWs.send(JSON.stringify({ type: "response.create" })); }, 250);
        }
    });

    // --- [SUB-BLOCK 5.B: FIRE & FORGET HANDLER] ---
    openAiWs.on('message', (data) => {
        const response = JSON.parse(data);

        if (response.type === 'response.audio.delta' && response.delta) {
            ws.send(JSON.stringify({ event: 'media', streamSid: streamSid, media: { payload: response.delta } }));
        }

        if (response.type === 'response.function_call_arguments.done') {
            const functionName = response.name;
            const args = JSON.parse(response.arguments);

            if (functionName === 'save_deal_data') {
                const dealToSave = dealQueue[currentDealIndex];
                console.log(`\n⚡ FAST SAVE TRIGGERED: ${dealToSave.account_name}`);
                
                // 1. INSTANT SUCCESS RESPONSE (Zero Latency)
                openAiWs.send(JSON.stringify({
                    type: "conversation.item.create",
                    item: {
                        type: "function_call_output",
                        call_id: response.call_id, 
                        output: JSON.stringify({ success: true })
                    }
                }));

                // 2. ADVANCE IMMEDIATELY
                advanceToNextDeal();

                // 3. BACKGROUND DB SAVE
                const scores = [
                    args.pain_score, args.metrics_score, args.champion_score, 
                    args.eb_score, args.criteria_score,
                    args.process_score, args.competition_score, args.paper_score, args.timing_score
                ];
                const totalScore = scores.reduce((a, b) => a + b, 0);
                
                let newStage = "Pipeline";
                if (totalScore >= 25) newStage = "Closed Won";
                else if (totalScore >= 20) newStage = "Commit";
                else if (totalScore >= 12) newStage = "Best Case";

                // UPDATED QUERY: Writes all tips and specifically maps Criteria/Competition scores
                pool.query(`
                    UPDATE opportunities 
                    SET 
                        last_summary = $1, 
                        audit_details = $2, 
                        forecast_stage = $3,
                        updated_at = NOW(), 
                        run_count = COALESCE(run_count, 0) + 1,
                        
                        -- SCORES (Specific ones we discussed)
                        criteria_score = $5,
                        competition_score = $6,

                        -- TIPS (All Categories)
                        pain_tip = $7,
                        metrics_tip = $8,
                        champion_tip = $9,
                        eb_tip = $10,
                        criteria_tip = $11,
                        process_tip = $12,
                        competition_tip = $13,
                        paper_tip = $14,
                        timing_tip = $15

                    WHERE id = $4
                `, [
                    args.risk_summary,      // $1
                    JSON.stringify(args),   // $2
                    newStage,               // $3
                    dealToSave.id,          // $4
                    
                    args.criteria_score,    // $5
                    args.competition_score, // $6

                    args.pain_tip,          // $7
                    args.metrics_tip,       // $8
                    args.champion_tip,      // $9
                    args.eb_tip,            // $10
                    args.criteria_tip,      // $11
                    args.process_tip,       // $12
                    args.competition_tip,   // $13
                    args.paper_tip,         // $14
                    args.timing_tip         // $15
                ])
                .then(() => console.log(`✅ BACKGROUND WRITE COMPLETE`))
                .catch(err => console.error("❌ BACKGROUND WRITE FAILED:", err.message));
            }
        }
    });

    // --- [SUB-BLOCK 5.D: TWILIO TO AI] ---
    ws.on('message', (message) => {
        const msg = JSON.parse(message);
        if (msg.event === 'start') streamSid = msg.start.streamSid;
        else if (msg.event === 'media' && openAiWs.readyState === WebSocket.OPEN) {
            openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));
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
        const result = await pool.query(`
            SELECT id, account_name, forecast_stage, run_count 
            FROM opportunities 
            WHERE org_id = $1 
            ORDER BY id ASC
        `, [orgId]);
        res.json(result.rows);
    } catch (err) { res.status(500).json([]); }
});

server.listen(PORT, () => console.log(`🚀 Matthew Live on ${PORT}`));
