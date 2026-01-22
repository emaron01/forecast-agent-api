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

// --- [BLOCK 3: SYSTEM PROMPT] ---
function getSystemPrompt(deal, repName, dealsLeft) {
    // 1. SANITIZATION
    let category = deal.forecast_stage || "Pipeline";
    if (category === "Null" || category.trim() === "") category = "Pipeline";

    // 2. FORMATTING
    const amountStr = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(deal.amount || 0);
    const lastSummary = deal.last_summary || "";
    const hasHistory = lastSummary.length > 5;
    
    // 3. FLATTENED READ LOGIC (The "Hybrid" Fix)
    // We try to read the specific Column (pain_score) first. If null, we check the JSON (audit_details).
    const details = deal.audit_details || {};
    
    const scoreContext = `
    PRIOR SNAPSHOT:
    • Pain: ${deal.pain_score || details.pain_score || "?"}/3
    • Metrics: ${deal.metrics_score || details.metrics_score || "?"}/3
    • Champion: ${deal.champion_score || details.champion_score || "?"}/3
    • EB: ${deal.eb_score || details.eb_score || "?"}/3
    • Decision Criteria: ${deal.criteria_score || details.criteria_score || "?"}/3  <-- VERIFIED
    • Decision Process: ${deal.process_score || details.process_score || "?"}/3    <-- VERIFIED
    • Competition: ${deal.competition_score || details.competition_score || "?"}/3 <-- VERIFIED
    • Paper Process: ${deal.paper_score || details.paper_score || "?"}/3
    • Timing: ${deal.timing_score || details.timing_score || "?"}/3
    `;

    // 4. STAGE STRATEGY
    let stageInstructions = "";
    if (category.includes("Commit")) {
        stageInstructions = `MODE: CLOSING ASSISTANT (Commit). Goal: De-risk. Scan for 0-2 scores. Focus: EB & Paperwork.`;
    } else if (category.includes("Best Case")) {
        stageInstructions = `MODE: DEAL STRATEGIST (Best Case). Goal: Validate Upside. Focus: Champion & Timeline.`;
    } else {
        stageInstructions = `MODE: PIPELINE ANALYST (Pipeline). Goal: Qualify. Focus: Pain & Metrics. IGNORE LEGAL.`;
    }

    const intro = `Hi ${repName}, this is Matthew from Sales Forecaster. Today we will be reviewing ${dealsLeft + 1} deals, starting with ${deal.account_name} for ${amountStr} in ${category}.`;
    const historyHook = hasHistory ? `Last time we flagged: "${lastSummary}". How is that looking now?` : "What's the latest?";

    return `
    ### MANDATORY OPENING
    You MUST open exactly with: "${intro} ${historyHook}"

    ### ROLE
    You are Matthew, a Deal Strategy AI. Professional, direct, data-driven.
    ${stageInstructions}

    ### DATA EXTRACTION RULES
    1. **NEXT STEPS:** You MUST extract a specific, date-driven next step (e.g., "Meeting with CFO on Thursday").
    2. **SCORES:** Strict 0-3 scale. 0 = Unknown. 3 = Verified Evidence.
    
    ### PROTOCOL (Investigate in this Order)
    ${scoreContext}
    1. Pain
    2. Metrics
    3. Champion
    4. Economic Buyer
    5. Decision Criteria
    6. Decision Process
    7. Competition
    8. Paper Process (Skip if Pipeline)
    9. Timing

    ### DEAL CONTEXT
    - Account: ${deal.account_name} | Amount: ${amountStr} | Stage: ${category}
    ### INTERNAL TRUTHS
    ${deal.org_product_data || "Verify capabilities against company documentation."}

    ### COMPLETION PROTOCOL
    1. Silent Analysis. 2. Verbal Confirmation (Health Score / 27). 3. Transition. 4. Action: Trigger 'save_deal_data' IMMEDIATELY.
    `;
}

// --- [BLOCK 4: WEBHOOK] ---
app.post("/agent", async (req, res) => {
    const callerPhone = req.body.From;
    try {
        const result = await pool.query(`SELECT org_id FROM opportunities WHERE rep_phone = $1 LIMIT 1`, [callerPhone]);
        const orgId = result.rows.length > 0 ? result.rows[0].org_id : 1;
        res.type("text/xml").send(`<Response><Connect><Stream url="wss://${req.headers.host}/?org_id=${orgId}" /></Connect></Response>`);
    } catch (err) {
        res.type("text/xml").send(`<Response><Connect><Stream url="wss://${req.headers.host}/?org_id=1" /></Connect></Response>`);
    }
});

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
    
    let historyHook = "What's the latest?";
    if (hasHistory) {
        historyHook = `Last time we flagged: "${lastSummary}". How is that looking now?`;
    }

    // 4. FLATTENED READ LOGIC (The Fix)
    // We check the new DB Column first. If 0 or null, we check the old JSON.
    const details = deal.audit_details || {}; // The old JSON blob

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

    // 5. STAGE STRATEGY
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

    1. **Silent Analysis:** Formulate a helpful suggestion for each category and a specific NEXT STEP.
    2. **Verbal Confirmation:** Say exactly: "Based on today's discussion, this opportunity's Health Score is [Total] out of 27. Just one moment while I update and add feedback to your opportunity scorecard."
    3. **Transition:** Say: "Okay, let's move to the next opportunity."
    4. **Action:** Immediately trigger the `save_deal_data` tool.
       - Map your scores, tips, and next steps to the tool parameters.
       - *CRITICAL:* Do not wait for a user response. Trigger the tool immediately after speaking.
    `;
}
// --- [BLOCK 6: API ENDPOINTS] ---
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

server.listen(PORT, () => console.log(`🚀 Matthew Live on ${PORT}`));
