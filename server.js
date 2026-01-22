require('dotenv').config();
const http = require('http');
const express = require('express');
const { Pool } = require('pg');
const WebSocket = require('ws');
const cors = require('cors');

// --- [BLOCK 1: CONFIGURATION] ---
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
    // 1. DATA SANITIZATION
    let category = deal.forecast_stage || "Pipeline";
    if (category === "Null" || category.trim() === "") category = "Pipeline";

    // 2. DATA FORMATTING
    const amountStr = new Intl.NumberFormat('en-US', { 
        style: 'currency', currency: 'USD', maximumFractionDigits: 0 
    }).format(deal.amount || 0);

    // 3. HISTORY EXTRACTION
    const lastSummary = deal.last_summary || "";
    const hasHistory = lastSummary.length > 5;
    const historyHook = hasHistory ? `Last time we flagged: "${lastSummary}". How is that looking now?` : "What's the latest?";

    // 4. HYBRID DATA READ (Columns First, Fallback to JSON)
    const details = deal.audit_details || {};
    const scoreContext = `
    PRIOR SNAPSHOT:
    • Pain: ${deal.pain_score || details.pain_score || "?"}/3
    • Metrics: ${deal.metrics_score || details.metrics_score || "?"}/3
    • Champion: ${deal.champion_score || details.champion_score || "?"}/3
    • EB: ${deal.eb_score || details.eb_score || "?"}/3
    • Decision Criteria: ${deal.criteria_score || details.criteria_score || "?"}/3
    • Decision Process: ${deal.process_score || details.process_score || "?"}/3
    • Competition: ${deal.competition_score || details.competition_score || "?"}/3
    • Paper Process: ${deal.paper_score || details.paper_score || "?"}/3
    • Timing: ${deal.timing_score || details.timing_score || "?"}/3
    `;

    // 5. STAGE STRATEGY (The Gap Hunter)
    let stageInstructions = "";
    if (category.includes("Commit")) {
        stageInstructions = "MODE: CLOSING ASSISTANT (Commit). Goal: De-risk. Scan for 0-2 scores. Focus: EB & Paperwork.";
    } else if (category.includes("Best Case")) {
        stageInstructions = "MODE: DEAL STRATEGIST (Best Case). Goal: Validate Upside. Focus: Champion & Timeline.";
    } else {
        stageInstructions = "MODE: PIPELINE ANALYST (Pipeline). Goal: Qualify. Focus: Pain & Metrics. IGNORE LEGAL.";
    }

    const intro = `Hi ${repName}, this is Matthew. We are reviewing ${dealsLeft + 1} deals, starting with ${deal.account_name} for ${amountStr} in ${category}.`;

    // 6. THE MASTER PROMPT
    return `
    ### MANDATORY OPENING
    You MUST open exactly with: "${intro} ${historyHook}"

    ### ROLE
    You are Matthew, a Deal Strategy AI. Professional, direct, data-driven.
    ${stageInstructions}

    [CORE RULES]
    • ZERO TOLERANCE: If the rep lacks an answer, score is 0. 
    • PRODUCT POLICE: Correct fake features using Internal Truths.
    • MEMORY: If a category is already scored 3 in "${scoreContext}", do not ask about it unless the user indicates a change.

    [BRANCH A: THE CLOSING SHORTCUT]
    Trigger if user mentions: "PO", "Signed", "Done". Verify clean PDF. If yes, score 27/27 and finish.

    [BRANCH B: STANDARD MEDDPICC]
    Investigate in order: Pain, Metrics, Champion, EB, Criteria, Process, Competition, Paper, Timing.
    
    ### DEAL CONTEXT
    - Account: ${deal.account_name} | Amount: ${amountStr} | Stage: ${category}
    
    ### INTERNAL TRUTHS (PRODUCT POLICE)
    ${deal.org_product_data || "Verify capabilities against company documentation."}

    ### COMPLETION PROTOCOL
    1. Silent Analysis: Formulate a coaching tip for each category and a date-driven NEXT STEP.
    2. Verbal Confirmation: "Based on today's discussion, this opportunity's Health Score is [Total] out of 27."
    3. Action: Trigger 'save_deal_data' IMMEDIATELY after speaking.
    `;
}

// --- [BLOCK 4: WEBHOOK] ---
app.post("/agent", async (req, res) => {
    const callerPhone = req.body.From;
    try {
        const result = await pool.query("SELECT org_id FROM opportunities WHERE rep_phone = $1 LIMIT 1", [callerPhone]);
        const orgId = result.rows.length > 0 ? result.rows[0].org_id : 1;
        res.type("text/xml").send(`<Response><Connect><Stream url="wss://${req.headers.host}/?org_id=${orgId}" /></Connect></Response>`);
    } catch (err) {
        res.type("text/xml").send(`<Response><Connect><Stream url="wss://${req.headers.host}/?org_id=1" /></Connect></Response>`);
    }
});

// --- [BLOCK 5: WEBSOCKET CORE] ---
wss.on('connection', (ws, req) => {
    let orgId = 1; 
    try {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const extractedId = urlObj.searchParams.get('org_id');
        if (extractedId) orgId = parseInt(extractedId, 10);
    } catch (err) {}

    let streamSid = null;
    let dealQueue = [];
    let currentDealIndex = 0;

    const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
        headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" }
    });

    const advanceToNextDeal = () => {
        currentDealIndex++;
        if (currentDealIndex < dealQueue.length) {
            const nextDeal = dealQueue[currentDealIndex];
            const nextInstructions = getSystemPrompt(nextDeal, (nextDeal.rep_name||"Team").split(' ')[0], dealQueue.length - currentDealIndex);
            openAiWs.send(JSON.stringify({ type: "session.update", session: { instructions: nextInstructions } }));
            openAiWs.send(JSON.stringify({ type: "response.create", response: { modalities: ["text", "audio"], instructions: `Say: "Pulling up ${nextDeal.account_name}."` } }));
        } else {
            openAiWs.send(JSON.stringify({ type: "response.create", response: { instructions: "Say: 'Review complete. Goodbye.' then hang up." } }));
        }
    };

    openAiWs.on('open', async () => {
        const result = await pool.query("SELECT o.*, org.product_truths AS org_product_data FROM opportunities o JOIN organizations org ON o.org_id = org.id WHERE o.org_id = $1 AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost') ORDER BY o.id ASC", [orgId]);
        dealQueue = result.rows;
        if (dealQueue.length > 0) {
            const instructions = getSystemPrompt(dealQueue[0], (dealQueue[0].rep_name||"Team").split(' ')[0], dealQueue.length - 1);
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
                        description: "Saves scores, tips, and next steps.",
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
                                risk_summary: { type: "string" },
                                next_steps: { type: "string" }
                            },
                            required: ["pain_score", "pain_tip", "metrics_score", "metrics_tip", "champion_score", "champion_tip", "eb_score", "eb_tip", "criteria_score", "criteria_tip", "process_score", "process_tip", "competition_score", "competition_tip", "paper_score", "paper_tip", "timing_score", "timing_tip", "risk_summary", "next_steps"]
                        }
                    }],
                    tool_choice: "auto"
                }
            };
            openAiWs.send(JSON.stringify(sessionUpdate));
            setTimeout(() => { openAiWs.send(JSON.stringify({ type: "response.create" })); }, 250);
        }
    });

    openAiWs.on('message', (data) => {
        const response = JSON.parse(data);
        if (response.type === 'response.audio.delta' && response.delta) {
            ws.send(JSON.stringify({ event: 'media', streamSid: streamSid, media: { payload: response.delta } }));
        }
        if (response.type === 'response.function_call_arguments.done' && response.name === 'save_deal_data') {
            const args = JSON.parse(response.arguments);
            const dealToSave = dealQueue[currentDealIndex];
            openAiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: response.call_id, output: JSON.stringify({ success: true }) } }));
            advanceToNextDeal();

            const scores = [args.pain_score, args.metrics_score, args.champion_score, args.eb_score, args.criteria_score, args.process_score, args.competition_score, args.paper_score, args.timing_score];
            const totalScore = scores.reduce((a, b) => a + b, 0);
            let newStage = totalScore >= 25 ? "Closed Won" : (totalScore >= 20 ? "Commit" : (totalScore >= 12 ? "Best Case" : "Pipeline"));

            pool.query(`
                UPDATE opportunities 
                SET last_summary = $1, audit_details = $2, forecast_stage = $3, updated_at = NOW(), run_count = COALESCE(run_count, 0) + 1,
                    pain_score = $5, metrics_score = $6, champion_score = $7, eb_score = $8,
                    criteria_score = $9, process_score = $10, competition_score = $11, paper_score = $12, timing_score = $13,
                    pain_tip = $14, metrics_tip = $15, champion_tip = $16, eb_tip = $17, 
                    criteria_tip = $18, process_tip = $19, competition_tip = $20, paper_tip = $21, timing_tip = $22,
                    next_steps = $23
                WHERE id = $4
            `, [
                args.risk_summary, JSON.stringify(args), newStage, dealToSave.id,
                args.pain_score, args.metrics_score, args.champion_score, args.eb_score,
                args.criteria_score, args.process_score, args.competition_score, args.paper_score, args.timing_score,
                args.pain_tip, args.metrics_tip, args.champion_tip, args.eb_tip, 
                args.criteria_tip, args.process_tip, args.competition_tip, args.paper_tip, args.timing_tip,
                args.next_steps
            ]).catch(err => console.error("❌ DB ERROR:", err.message));
        }
    });

    ws.on('message', (message) => {
        const msg = JSON.parse(message);
        if (msg.event === 'start') streamSid = msg.start.streamSid;
        else if (msg.event === 'media' && openAiWs.readyState === WebSocket.OPEN) {
            openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));
        }
    });

    ws.on('close', () => openAiWs.close());
});

app.get("/get-deal", async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM opportunities WHERE id = $1', [req.query.oppId]);
        res.json(result.rows[0] || {});
    } catch (err) { res.json({}); }
});

app.get("/deals", async (req, res) => {
    try {
        const result = await pool.query('SELECT id, account_name, forecast_stage, run_count FROM opportunities WHERE org_id = $1 ORDER BY id ASC', [req.query.org_id || 1]);
        res.json(result.rows);
    } catch (err) { res.status(500).json([]); }
});

server.listen(PORT, () => console.log(`🚀 Live on ${PORT}`));