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

    // [NEW PART 1] LOGIC & PERSONA SWITCH
    // 1. EXTRACT SCORES (Safe fallback to 0)
    const details = deal.audit_details || {};
    const scores = {
        pain: details.pain?.score || 0,
        metrics: details.metrics?.score || 0,
        champion: details.champion?.score || 0,
        eb: details.eb?.score || 0,
        process: details.process?.score || 0,
        paper: details.paper?.score || 0,
        timing: details.timing?.score || 0
    };
    
    // 2. CREATE CONTEXT STRING (Feeds into Branch B)
    const scoreContext = `
    EXISTING DATA (Do not ask again if Score is 3):
    - Pain: ${scores.pain}/3
    - Metrics: ${scores.metrics}/3
    - Champion: ${scores.champion}/3
    - EB: ${scores.eb}/3
    - Process: ${scores.process}/3
    - Paper: ${scores.paper}/3
    - Timing: ${scores.timing}/3
    `;

    // 3. STAGE LOGIC (The "Persona" Toggle)
    let stageInstructions = "";
    if (category.includes("Commit")) {
        stageInstructions = `
        MODE: CLOSING PARTNER (Commit). 
        • Tone: Professional, precise, urgent but supportive. 
        • Goal: "Let's secure the win." 
        • Focus: Identify the final blockers (Legal/Signatures).
        `;
    } else if (category.includes("Best Case")) {
        stageInstructions = `
        MODE: DEAL ARCHITECT (Best Case). 
        • Tone: Strategic and curious.
        • Goal: "Let's strengthen our case."
        • Focus: Verify the Champion is strong enough to sell for us.
        `;
    } else {
        stageInstructions = `
        MODE: PIPELINE SCANNER (Pipeline). 
        • Tone: Casual, low-pressure, collaborative. 
        • Goal: "Let's map out what we know so far." 
        • Strategy: Ask "What can you tell me about this opportunity?" and simply map their answer to the categories.
        • Rule: 1 Question per topic. Do not dig. Identify the gap and move on.
        `;
    }

    const intro = `Hi ${repName}, this is Matthew. Reviewing ${dealsLeft} deals, starting with ${deal.account_name} for ${amountStr} in ${category}.`;
    const hook = hasHistory ? `Last update: "${deal.last_summary}". What's the latest?` : "What can you tell me about this opportunity?";

    return `
    ### MANDATORY OPENING
    You MUST open the call with this exact script: "${intro} ${hook}"
    Do not say "How can I help you" or "I am here to assist."

    ### ROLE & IDENTITY 
    You are Matthew, a VP of Sales. You are professional, data-driven, and direct. 
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
    • MEMORY: Check "EXISTING DATA" below. If a score is 3, DO NOT ASK about it unless the user indicates a change.

    ### INTERACTION PROTOCOL (LOGIC BRANCH)
    
    [BRANCH A: THE CLOSING SHORTCUT]
    *Trigger ONLY if user mentions: "PO", "Contract", "SOW", "Paperwork", "Procurement"*
    
    1. SCENARIO: "SIGNED / DONE" 
       - VERIFY: "Do we have the clean PDF in hand?"
       - IF YES: Score 27/27. Say: "That is huge. Great work. I'm moving this to Closed Won."
       - GENERATE SUMMARY.

    2. SCENARIO: "WORKING ON IT" 
       - SKIP Pain, Metrics, Champion (Assume done).
       - EXECUTE "LEGAL CHECK": "Are all legal documents fully executed? Or is there still redlining?"
       - EXECUTE "DATE CHECK": "When do you think the PO hits? Let's get a precise date."
       - GENERATE SUMMARY.

    [BRANCH B: STANDARD MEDDPICC]
    *If NO closing keywords, audit MISSING items based on stage:*
    
    ${scoreContext}

    Investigate in this EXACT ORDER. Do not name categories or provide mid-call scores.
    1. IMPLICATE PAIN: Only real if there is a cost to doing nothing. Probe: "What happens if they do nothing?"
       - CRITICAL: Summarize the "Cost of Inaction" immediately after the rep answers.
       - Constraint: Do not summarize this again at the end.
    2. METRICS
    3. CHAMPION: Verify status.
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
    • The Evidence Probe: If an answer is vague, probe ONCE. If still vague, score as 1, state risk, move on.
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

    DATABASE_DATA: Pain: [score]| [Short summary of pain], Metrics: [score]| [Short summary of metrics], Champion: [score]| [Name/Title], EB: [score]| [Name/Title], Criteria: [score]| [Detail], Process: [score]| [Detail], Competition: [score]| [Name], Paper: [score]| [Detail], Timing: [score]| [Detail] 
    `;
}

// --- [BLOCK 4: TWILIO WEBHOOK] ---
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

// --- [BLOCK 5: WEBSOCKET CORE] ---
wss.on('connection', (ws, req) => {
    // 1. SAFE ID EXTRACTION
    const oppId = new URL(req.url, 'http://localhost').searchParams.get('oppId') || "4";
    console.log(`\n[CONNECTION] 📞 New Stream for Opp: ${oppId}`);

    let streamSid = null;

    const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
        headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "realtime=v1"
        }
    });

    // --- [SUB-BLOCK 5.A: OPENAI SESSION INIT] ---
    openAiWs.on('open', async () => {
        // A. FETCH DYNAMIC DATA
        let dealData = { account_name: "Unknown Account", amount: 0, forecast_stage: "Pipeline", last_summary: null };
        let dealsLeft = 0;

        try {
            const dealResult = await pool.query('SELECT * FROM opportunities WHERE id = $1', [oppId]);
            const countResult = await pool.query("SELECT COUNT(*) FROM opportunities WHERE forecast_stage NOT IN ('Closed Won', 'Closed Lost')");
            dealsLeft = parseInt(countResult.rows[0].count);

            if (dealResult.rows.length > 0) {
                dealData = dealResult.rows[0];
            }
        } catch (e) {
            console.error("❌ DB ERROR:", e.message);
        }

        console.log("------------------------------------------");
        console.log(`🤖 [MATTHEW BRAIN]: ${dealData.account_name} | $${dealData.amount}`);
        console.log(`📝 [CONTEXT]: ${(dealData.last_summary) ? "Update Mode" : "Discovery Mode"}`);
        console.log("------------------------------------------");

        // B. GENERATE PROMPT
        const instructions = getSystemPrompt(dealData, "Erik", dealsLeft);

        // C. CONFIGURE SESSION
        const sessionUpdate = {
            type: "session.update",
            session: {
                modalities: ["text", "audio"],
                instructions: instructions,
                voice: "verse",
                input_audio_format: "g711_ulaw",
                output_audio_format: "g711_ulaw",
                turn_detection: { 
                    type: "server_vad",
                    threshold: 0.6,
                    prefix_padding_ms: 300, 
                    silence_duration_ms: 1000 
                }
            }
        };
        openAiWs.send(JSON.stringify(sessionUpdate));

        // D. FORCE SPEAK
        setTimeout(() => {
            openAiWs.send(JSON.stringify({ type: "response.create" }));
        }, 250);
    });

    // --- [SUB-BLOCK 5.B: AI TO TWILIO (OUTPUT)] ---
    openAiWs.on('message', (data) => {
        const response = JSON.parse(data);

        if (response.type === 'response.audio.delta' && response.delta) {
            ws.send(JSON.stringify({
                event: 'media',
                streamSid: streamSid,
                media: { payload: response.delta }
            }));
        }

        // --- [SUB-BLOCK 5.C: RICH ANALYTICS PARSER] ---
        if (response.type === 'response.audio_transcript.done') {
            const transcript = response.transcript;
            
            if (transcript.includes("DATABASE_DATA:")) {
                console.log("\n🎯 RICH ANALYTICS DETECTED");
                try {
                    const extract = (label) => {
                        const regex = new RegExp(`${label}: (\\d)\\|\\s*([^,]+)`);
                        const match = transcript.match(regex);
                        return match ? { score: parseInt(match[1]), text: match[2].trim() } : { score: 0, text: "No data provided" };
                    };

                    const auditDetails = {
                        pain: extract("Pain"),
                        metrics: extract("Metrics"),
                        champion: extract("Champion"),
                        eb: extract("EB"),
                        criteria: extract("Criteria"),
                        process: extract("Process"),
                        competition: extract("Competition"),
                        paper: extract("Paper"),
                        timing: extract("Timing")
                    };

                    const totalScore = Object.values(auditDetails).reduce((acc, curr) => acc + curr.score, 0);
                    let newStage = totalScore >= 20 ? "Commit" : (totalScore >= 12 ? "Best Case" : "Pipeline");

                    // SQL: Added run_count increment here
                    const updateQuery = `
                        UPDATE opportunities 
                        SET 
                            last_summary = $1, 
                            audit_details = $2, 
                            forecast_stage = $3, 
                            updated_at = NOW(),
                            run_count = COALESCE(run_count, 0) + 1
                        WHERE id = $4
                    `;
                    pool.query(updateQuery, [transcript, JSON.stringify(auditDetails), newStage, oppId]);
                    console.log(`✅ RICH DATA SAVED | Score: ${totalScore}/27`);
                } catch (err) {
                    console.error("❌ PARSING ERROR:", err.message);
                }
            }
        }
    });

    // --- [SUB-BLOCK 5.D: TWILIO TO AI (INPUT)] ---
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

// --- [BLOCK 6: DASHBOARD API] ---
app.get("/get-deal", async (req, res) => {
    const oppId = req.query.oppId;
    const staticFallback = {
        id: oppId,
        account_name: "Loading...",
        amount: 0,
        forecast_stage: "Pipeline",
        last_summary: "Connecting..."
    };

    try {
        const result = await pool.query('SELECT * FROM opportunities WHERE id = $1', [oppId]);
        res.json(result.rows[0] || staticFallback);
    } catch (err) {
        res.json(staticFallback);
    }
});

server.listen(PORT, () => console.log(`🚀 Server live on ${PORT}`));
