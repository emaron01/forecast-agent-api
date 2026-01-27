require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const { Pool } = require('pg');
const http = require('http');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 10000;

// [CONFIGURATION]
const OPENAI_API_KEY = process.env.MODEL_API_KEY; 
const MODEL_URL = "wss://api.openai.com/v1/realtime";
const MODEL_NAME = "gpt-4o-realtime-preview-2024-10-01";

if (!OPENAI_API_KEY) {
    console.error("❌ Missing MODEL_API_KEY in environment");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- [BLOCK 3: SYSTEM PROMPT] ---
function getSystemPrompt(deal, repName, dealsLeft, totalCount) {
    let category = deal.forecast_stage || "Pipeline";
    if (category === "Null" || category.trim() === "") category = "Pipeline";

    const amountStr = new Intl.NumberFormat('en-US', { 
        style: 'currency', currency: 'USD', maximumFractionDigits: 0 
    }).format(deal.amount || 0);

    const lastSummary = deal.last_summary || "";
    const hasHistory = lastSummary.length > 5;
    const historyHook = hasHistory ? `Last time we flagged: "${lastSummary}".` : "";

    let stageInstructions = "";
    if (category.includes("Commit")) {
        stageInstructions = `MODE: CLOSING AUDIT (Commit). Goal: Find the one thing that will kill this deal. Focus on scores < 3.`;
    } else {
        stageInstructions = `MODE: PIPELINE QUALIFICATION. Determine if this is early discovery or progressed. Focus on Pain, Metrics, and Timing.`;
    }

    const closeDateStr = deal.close_date ? new Date(deal.close_date).toLocaleDateString() : "TBD";
    const intro = `Hi ${repName}. My name is Matthew, I am your Sales Forecaster assistant. Today, we will review ${totalCount} deals, starting with ${deal.account_name} (${category}, for ${amountStr}) with a close date of ${closeDateStr}. ${historyHook}`;

    return `
### MANDATORY OPENING
   You MUST open exactly with: "${intro} So, lets jump right in - please share the latest update?"

### ROLE
   You are Matthew, a high-IQ Sales Strategist. You are an **Extractor**, not a Coach.
   **SKEPTICISM RULE:** Never assume a category is "strong" unless the representative provides evidence. If they are vague, assume it is a RISK and probe deeper.

${stageInstructions}

### THE MEDDPICC CHECKLIST
   Pain, Metrics, Champion, EB, Criteria, Process, Competition, Paper, Timing.

### COMPLETION PROTOCOL
   1. Say: "Got it. I'm updating the scorecard."
   2. Call the function 'save_deal_data'. 
      - capture Champion/EB names and titles.
      - write blunt coaching in 'rep_comments'.
      - write #1 risk in 'manager_comments'.
   3. After Tool Success: Say "Saved. Next is [Next Account Name]. What's the latest?"
   `;
}

// --- [BLOCK 4: SMART RECEPTIONIST] ---
app.post("/agent", async (req, res) => {
    try {
        const callerPhone = req.body.From || null;
        console.log("📞 Incoming call from:", callerPhone);
        const result = await pool.query(
            "SELECT org_id, rep_name FROM opportunities WHERE rep_phone = $1 LIMIT 1",
            [callerPhone]
        );
        let orgId = 1, repName = "Guest";
        if (result.rows.length > 0) {
            orgId = result.rows[0].org_id;
            repName = result.rows[0].rep_name || "Rep";
            console.log(`✅ Identified Rep: ${repName}`);
        }
        res.type("text/xml").send(`
            <Response>
                <Connect>
                    <Stream url="wss://${req.headers.host}/">
                        <Parameter name="org_id" value="${orgId}" />
                        <Parameter name="rep_name" value="${repName}" />
                    </Stream>
                </Connect>
            </Response>`);
    } catch (err) {
        console.error("❌ /agent error:", err.message);
        res.type("text/xml").send(`<Response><Connect><Stream url="wss://${req.headers.host}/" /></Connect></Response>`);
    }
});

// --- [BLOCK 5: WEBSOCKET CORE] ---
wss.on("connection", (ws) => {
    console.log("🔥 Twilio WebSocket connected");
    let streamSid = null, dealQueue = [], currentDealIndex = 0, repName = null, orgId = 1;
    let openAiReady = false;

    // 1. CONNECT TO OPENAI
    const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" }
    });

    // 2. OPEN EVENT (STATIC FIX)
    openAiWs.on("open", () => {
        console.log("📡 OpenAI Connected");
        // Force G.711 Audio Immediately
        openAiWs.send(JSON.stringify({
            type: "session.update",
            session: {
                input_audio_format: "g711_ulaw",
                output_audio_format: "g711_ulaw",
                voice: "verse",
                turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 1000 }
            }
        }));
        openAiReady = true;
        attemptLaunch();
    });

    // 3. HELPER: LAUNCHER
    const attemptLaunch = async () => {
        if (!repName || !openAiReady) return;
        console.log(`🚀 Launching Session for ${repName}`);
        try {
            const result = await pool.query(
                `SELECT o.*, org.product_truths FROM opportunities o JOIN organizations org ON o.org_id = org.id WHERE o.org_id = $1 AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost') ORDER BY o.id ASC`, [orgId]
            );
            dealQueue = result.rows;
            console.log(`📊 Loaded ${dealQueue.length} deals`);

            if (dealQueue.length === 0) {
                 openAiWs.send(JSON.stringify({ type: "session.update", session: { instructions: "System Message." } }));
                 openAiWs.send(JSON.stringify({ type: "response.create", response: { instructions: `Say: 'Hello ${repName}. I connected, but I found zero active deals.'` } }));
                 return;
            }

            const deal = dealQueue[0];
            const instructions = getSystemPrompt(deal, repName.split(" ")[0], dealQueue.length - 1, dealQueue.length);
            
            // A. SEND INSTRUCTIONS (With Save Fixes)
            openAiWs.send(JSON.stringify({
                type: "session.update",
                session: {
                    instructions: instructions,
                    tools: [{
                        type: "function",
                        name: "save_deal_data",
                        description: "Saves sales audit data.",
                        parameters: {
                            type: "object",
                            properties: {
                                pain_score: { type: "number" }, pain_tip