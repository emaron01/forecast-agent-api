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

    // 2. OPEN EVENT (FIX: STATIC REMOVAL)
    openAiWs.on("open", () => {
        console.log("📡 OpenAI Connected");
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
            
            // SEND INSTRUCTIONS (FIX: EVENT ID LOCK & TOOL CHOICE)
            openAiWs.send(JSON.stringify({
                type: "session.update",
                client_event_id: "instructions_loaded", // <--- THE DEAD AIR FIX
                session: {
                    instructions: instructions,
                    tools: [{
                        type: "function",
                        name: "save_deal_data",
                        description: "Saves sales audit data.",
                        parameters: {
                            type: "object",
                            properties: {
                                pain_score: { type: "number" }, pain_tip: { type: "string" }, pain_summary: { type: "string" },
                                metrics_score: { type: "number" }, metrics_tip: { type: "string" }, metrics_summary: { type: "string" },
                                champion_score: { type: "number" }, champion_tip: { type: "string" }, champion_summary: { type: "string" },
                                eb_score: { type: "number" }, eb_tip: { type: "string" }, eb_summary: { type: "string" },
                                criteria_score: { type: "number" }, criteria_tip: { type: "string" }, criteria_summary: { type: "string" },
                                process_score: { type: "number" }, process_tip: { type: "string" }, process_summary: { type: "string" },
                                competition_score: { type: "number" }, competition_tip: { type: "string" }, competition_summary: { type: "string" },
                                paper_score: { type: "number" }, paper_tip: { type: "string" }, paper_summary: { type: "string" },
                                timing_score: { type: "number" }, timing_tip: { type: "string" }, timing_summary: { type: "string" },
                                risk_summary: { type: "string" }, next_steps: { type: "string" },
                                champion_name: { type: "string" }, champion_title: { type: "string" },
                                eb_name: { type: "string" }, eb_title: { type: "string" },
                                rep_comments: { type: "string" }, manager_comments: { type: "string" }
                            },
                            required: [] // <--- THE CRASH FIX
                        }
                    }],
                    tool_choice: "auto" // <--- THE SAVE FIX
                }
            }));
            
        } catch (err) { console.error("❌ Launch Error:", err); }
    };

    // 4. HELPER: FUNCTION HANDLER (The Muscle)
    async function handleFunctionCall(args) {
        const deal = dealQueue[currentDealIndex];
        if (!deal) return;
        try {
            console.log(`💾 Saving data for ${deal.account_name}...`);
            const query = `UPDATE opportunities SET 
                pain_score=$1, pain_tip=$2, pain_summary=$3, metrics_score=$4, metrics_tip=$5, metrics_summary=$6,
                champion_score=$7, champion_tip=$8, champion_summary=$9, eb_score=$10, eb_tip=$11, eb_summary=$12,
                criteria_score=$13, criteria_tip=$14, criteria_summary=$15, process_score=$16, process_tip=$17, process_summary=$18,
                competition_score=$19, competition_tip=$20, competition_summary=$21, paper_score=$22, paper_tip=$23, paper_summary=$24,
                timing_score=$25, timing_tip=$26, timing_summary=$27, risk_summary=$28, next_steps=$29,
                champion_name=$30, champion_title=$31, eb_name=$32, eb_title=$33, rep_comments=$34, manager_comments=$35,
                updated_at=NOW(), run_count=COALESCE(run_count, 0)+1 WHERE id=$36`;
            
            // [FIX: DEFAULTS PREVENT UNDEFINED CRASHES]
            const values = [
                args.pain_score || 0, args.pain_tip || "", args.pain_summary || "",
                args.metrics_score || 0, args.metrics_tip || "", args.metrics_summary || "",
                args.champion_score || 0, args.champion_tip || "", args.champion_summary || "",
                args.eb_score || 0, args.eb_tip || "", args.eb_summary || "",
                args.criteria_score || 0, args.criteria_tip || "", args.criteria_summary || "",
                args.process_score || 0, args.process_tip || "", args.process_summary || "",
                args.competition_score || 0, args.competition_tip || "", args.competition_summary || "",
                args.paper_score || 0, args.paper_tip || "", args.paper_summary || "",
                args.timing_score || 0, args.timing_tip || "", args.timing_summary || "",
                args.risk_summary || "", args.next_steps || "",
                args.champion_name || "", args.champion_title || "", 
                args.eb_name || "", args.eb_title || "", 
                args.rep_comments || "", args.manager_comments || "", 
                deal.id
            ];
            
            await pool.query(query, values);
            
            currentDealIndex++;
            if (currentDealIndex < dealQueue.length && openAiWs.readyState === WebSocket.OPEN) {
                const nextDeal = dealQueue[currentDealIndex];
                const nextInstructions = `*** SYSTEM ALERT: PREVIOUS DEAL CLOSED. ***\n\nFORGET ALL context about the previous account. FOCUS ONLY on this new deal:\n\n` + getSystemPrompt(nextDeal, repName, 0, dealQueue.length);
                openAiWs.send(JSON.stringify({ type: "session.update", session: { instructions: nextInstructions } }));
                openAiWs.send(JSON.stringify({ type: "response.create", response: { instructions: `Say: 'Saved. Next is ${nextDeal.account_name}. What's the latest?'` } }));
            } else {
                 openAiWs.send(JSON.stringify({ type: "response.create", response: { instructions: `Say: 'Saved. That was the last deal. Talk soon.'` } }));
            }
        } catch (err) { console.error("❌ Save Error:", err); }
    }

    // 5. OPENAI EVENT LISTENER (The Ear)
    openAiWs.on("message", (data) => {
        const response = JSON.parse(data);
        
        // [FIX: ID CHECK] Only speak when "instructions_loaded" event confirms readiness
        if (response.type === "session.updated" && response.client_event_id === "instructions_loaded") {
            console.log("✅ Instructions Confirmed - TRIGGERING GREETING");
            openAiWs.send(JSON.stringify({ type: "response.create" }));
        }

        if (response.type === "response.audio.delta" && response.delta) {
             ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: response.delta } }));
        }
        
        if (response.type === "response.function_call_arguments.done") {
            const args = JSON.parse(response.arguments);
            handleFunctionCall(args);
            if (openAiWs.readyState === WebSocket.OPEN) {
                 openAiWs.send(JSON.stringify({ 
                     type: "conversation.item.create", 
                     item: { type: "function_call_output", call_id: response.call_id, output: "success" } 
                 }));
            }
        }
    });

    // 6. TWILIO EVENT LISTENER
    ws.on("message", (message) => {
        const msg = JSON.parse(message);
        if (msg.event === "start") {
            streamSid = msg.start.streamSid;
            const params = msg.start.customParameters || {};
            orgId = params.org_id || 1;
            repName = params.rep_name || "Guest";
            console.log(`🔎 Twilio Connected: ${repName}`);
            attemptLaunch();
        }
        if (msg.event === "media" && openAiWs.readyState === WebSocket.OPEN) openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));
    });

    ws.on("close", () => {
        console.log("🔌 Call Closed.");
        if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
    });
});

// --- [BLOCK 6: API ENDPOINTS] ---
app.get("/debug/opportunities", async (req, res) => {
    try {
        const result = await pool.query("SELECT id, account_name, forecast_stage, updated_at FROM opportunities WHERE org_id = $1 ORDER BY updated_at DESC", [req.query.org_id || 1]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

server.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
