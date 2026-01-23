require("dotenv").config();
const http = require("http");
const express = require("express");
const { Pool } = require("pg");
const WebSocket = require("ws");
const cors = require("cors");

// --- [BLOCK 1: CONFIGURATION] ---
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.MODEL_API_KEY;
const MODEL_URL = process.env.MODEL_URL || "wss://api.openai.com/v1/realtime";
const MODEL_NAME =
    process.env.MODEL_NAME || "gpt-4o-mini-realtime-preview-2024-12-17";

if (!OPENAI_API_KEY) {
    console.error("❌ Missing MODEL_API_KEY in environment");
    process.exit(1);
}

// --- [BLOCK 2: DB CONNECTION] ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool
    .connect()
    .then(() => console.log("✅ DB connected"))
    .catch(err => {
        console.error("❌ DB connection failed:", err.message);
        process.exit(1);
    });

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- [BLOCK 3: SYSTEM PROMPT CP (MASTER STRATEGIST, POWER VERSION)] ---
function getSystemPrompt(deal, repName, dealsLeft) {
    let category = deal.forecast_stage || "Pipeline";
    if (category === "Null" || category.trim() === "") category = "Pipeline";

    const amountStr = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0
    }).format(deal.amount || 0);

    const lastSummary = deal.last_summary || "";
    const historyHook =
        lastSummary.length > 5
            ? `Last time we flagged: "${lastSummary}". How is that looking now?`
            : "What's the latest update on this account?";

    const details = deal.audit_details || {};

    const scoreContext = `
PRIOR SNAPSHOT:
• Pain: ${deal.pain_score || details.pain_score || "?"}/3
• Metrics: ${deal.metrics_score || details.metrics_score || "?"}/3
• Champion: ${deal.champion_score || details.champion_score || "?"}/3
• Economic Buyer: ${deal.eb_score || details.eb_score || "?"}/3
• Decision Criteria: ${deal.criteria_score || details.criteria_score || "?"}/3
• Decision Process: ${deal.process_score || details.process_score || "?"}/3
• Competition: ${deal.competition_score || details.competition_score || "?"}/3
• Paper Process: ${deal.paper_score || details.paper_score || "?"}/3
• Timing: ${deal.timing_score || details.timing_score || "?"}/3
`;

    const stageMap = {
        Commit: `MODE: CLOSING ASSISTANT (Commit). Goal: De-risk. Focus on EB signature and Paper Process.`,
        "Best Case": `MODE: DEAL STRATEGIST (Best Case). Goal: Validate Upside. Focus on Champion power level.`,
        Pipeline: `MODE: PIPELINE ANALYST (Pipeline). Goal: Qualify. Validate Pain/Metrics.`
    };

    const stageInstructions =
        stageMap[category] ||
        stageMap[
            Object.keys(stageMap).find(k => category.includes(k)) || "Pipeline"
        ];

    const intro = `Hi ${repName}, this is Matthew from Sales Forecaster. Today we will be reviewing ${
        dealsLeft + 1
    } deals, starting with ${deal.account_name} for ${amountStr} in ${category}.`;

    return `
### MANDATORY OPENING
You MUST open exactly with: "${intro} ${historyHook}"

### ROLE & IDENTITY
You are Matthew, a Deal Strategy AI. You are professional, high-IQ, and direct.
The customer is "${deal.account_name}".
${stageInstructions}

### INTERACTION PROTOCOL (MEDDPICC)
1. PAIN (0-3): What is the specific cost of doing nothing?
2. METRICS (0-3): Has their finance team validated the ROI?
3. CHAMPION (0-3): 1 = Coach, 2 = Mobilizer, 3 = Champion.
4. ECONOMIC BUYER (0-3): Signature authority access?
5. DECISION CRITERIA/PROCESS: Approval hurdles?
6. PAPER PROCESS (0-3): Contract status?
7. TIMING (0-3): Compelling event?

### INTERNAL TRUTHS
${deal.org_product_data || "Verify capabilities against company documentation."}

### COMPLETION PROTOCOL
1. "Health Score is [Total] out of 27. Updating your scorecard now."
2. "Moving to the next opportunity."
3. Trigger save_deal_data.
`;
}
// --- [BLOCK 4: THE SMART RECEPTIONIST] ---
app.post("/agent", async (req, res) => {
  try {
    const callerPhone = req.body.From || null;
    console.log("📞 Incoming call from:", callerPhone);

    // Lookup rep by phone
    const result = await pool.query(
      "SELECT org_id, rep_name FROM opportunities WHERE rep_phone = $1 LIMIT 1",
      [callerPhone]
    );

    const orgId = result.rows.length > 0 ? result.rows[0].org_id : 1;
    const repName = result.rows.length > 0 ? result.rows[0].rep_name : "Team";

    // Build the WebSocket URL
    const streamUrl = `wss://${req.headers.host}/?org_id=${orgId}&rep_name=${encodeURIComponent(repName)}`;

    // Escape XML-sensitive characters
    const escapedUrl = streamUrl.replace(/&/g, "&amp;");

    // Return valid TwiML
    res.type("text/xml").send(
`<Response>
  <Connect>
    <Stream url="${escapedUrl}" />
  </Connect>
</Response>`
    );
  } catch (err) {
    console.error("❌ /agent error:", err.message);

    // Safe fallback TwiML
    const fallbackUrl = `wss://${req.headers.host}/?org_id=1&rep_name=Team`.replace(/&/g, "&amp;");

    res.type("text/xml").send(
`<Response>
  <Connect>
    <Stream url="${fallbackUrl}" />
  </Connect>
</Response>`
    );
  }
});

// --- [BLOCK 5: SURGICAL MESSAGE LISTENER UPDATE] ---
    openAiWs.on('message', (data) => {
        const event = JSON.parse(data);

        // A. Handle Audio Stream to Twilio
        if (event.type === 'response.audio.delta' && event.delta) {
            ws.send(JSON.stringify({ event: 'media', streamSid: streamSid, media: { payload: event.delta } }));
        }

        // B. Handle the Save & Advance Logic
        if (event.type === 'response.done' && event.response.output) {
            event.response.output.forEach(output => {
                if (output.type === 'function_call' && output.name === 'save_deal_data') {
                    const args = JSON.parse(output.arguments);
                    const dealToSave = dealQueue[currentDealIndex];

                    console.log(`💾 Detected Tool Call: Saving ${dealToSave.account_name}...`);

                    // 1. Calculate Score & Stage Ranking
                    const scores = [
                        args.pain_score, args.metrics_score, args.champion_score, 
                        args.eb_score, args.criteria_score, args.process_score, 
                        args.competition_score, args.paper_score, args.timing_score
                    ];
                    const totalScore = scores.reduce((a, b) => a + (Number(b) || 0), 0);
                    let newStage = totalScore >= 25 ? "Closed Won" : (totalScore >= 20 ? "Commit" : (totalScore >= 12 ? "Best Case" : "Pipeline"));

                    // 2. Execute Postgres Update
                    pool.query(`
                        UPDATE opportunities 
                        SET previous_total_score = (COALESCE(pain_score,0) + COALESCE(metrics_score,0) + COALESCE(champion_score,0) + COALESCE(eb_score,0) + COALESCE(criteria_score,0) + COALESCE(process_score,0) + COALESCE(competition_score,0) + COALESCE(paper_score,0) + COALESCE(timing_score,0)),
                            previous_updated_at = updated_at,
                            last_summary = $1, audit_details = $2, forecast_stage = $3, updated_at = NOW(), run_count = COALESCE(run_count, 0) + 1,
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
                    ])
                    .then(() => {
                        console.log(`✅ ${dealToSave.account_name} synced to DB. Score: ${totalScore}`);
                        // Advance to the next deal ONLY after the DB write succeeds
                        advanceToNextDeal();
                    })
                    .catch(err => console.error("❌ DB SAVE FAILED:", err.message));
                }
            });
        }
    });
    // 4. LOGIC: ADVANCE TO NEXT DEAL
    const advanceToNextDeal = () => {
        currentDealIndex++;
        if (currentDealIndex < dealQueue.length) {
            const nextDeal = dealQueue[currentDealIndex];
            // Pass the verified repName into the prompt generator
            const nextInstructions = getSystemPrompt(nextDeal, repName.split(' ')[0], dealQueue.length - currentDealIndex);
            
            openAiWs.send(JSON.stringify({ 
                type: "session.update", 
                session: { instructions: nextInstructions } 
            }));
            
            openAiWs.send(JSON.stringify({ 
                type: "response.create", 
                response: { 
                    modalities: ["text", "audio"], 
                    instructions: `Say exactly: "Pulling up ${nextDeal.account_name}."` 
                }
            }));
        } else {
            openAiWs.send(JSON.stringify({ 
                type: "response.create", 
                response: { 
                    instructions: `Say: "Review complete. Great work today, ${repName.split(' ')[0]}. Goodbye." then hang up.` 
                }
            }));
        }
    };

    // 5. ON CONNECTION OPEN: FETCH DEALS
    openAiWs.on('open', async () => {
        console.log(`📡 OpenAI Stream Active for ${repName}`);
        
        const result = await pool.query(`
            SELECT o.*, org.product_truths AS org_product_data 
            FROM opportunities o
            JOIN organizations org ON o.org_id = org.id
            WHERE o.org_id = $1 AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost') 
            ORDER BY o.id ASC
        `, [orgId]);
        
        dealQueue = result.rows;

        if (dealQueue.length > 0) {
            // This is the first greeting of the call
            const instructions = getSystemPrompt(dealQueue[0], repName.split(' ')[0], dealQueue.length - 1);
            
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

    // 6. CONSOLIDATED MESSAGE HANDLING (MATTHEW TALKS / DATA SAVES)
    openAiWs.on('message', (data) => {
        const response = JSON.parse(data);

        // A. Pass Matthew's Audio to Twilio
        if (response.type === 'response.audio.delta' && response.delta) {
            ws.send(JSON.stringify({ event: 'media', streamSid: streamSid, media: { payload: response.delta } }));
        }

        // B. Handle the Tool Call (The Save & Advance Logic)
        if (response.type === 'response.done' && response.response.output) {
            response.response.output.forEach(output => {
                if (output.type === 'function_call' && output.name === 'save_deal_data') {
                    const args = JSON.parse(output.arguments);
                    const dealToSave = dealQueue[currentDealIndex];

                    console.log(`💾 Tool Call Received: Saving ${dealToSave.account_name}...`);

                    // Calculate Score & Stage Ranking
                    const scores = [args.pain_score, args.metrics_score, args.champion_score, args.eb_score, args.criteria_score, args.process_score, args.competition_score, args.paper_score, args.timing_score];
                    const totalScore = scores.reduce((a, b) => a + (Number(b) || 0), 0);
                    let newStage = totalScore >= 25 ? "Closed Won" : (totalScore >= 20 ? "Commit" : (totalScore >= 12 ? "Best Case" : "Pipeline"));

                    // Postgres Update
                    pool.query(`
                        UPDATE opportunities 
                        SET previous_total_score = (COALESCE(pain_score,0) + COALESCE(metrics_score,0) + COALESCE(champion_score,0) + COALESCE(eb_score,0) + COALESCE(criteria_score,0) + COALESCE(process_score,0) + COALESCE(competition_score,0) + COALESCE(paper_score,0) + COALESCE(timing_score,0)),
                            previous_updated_at = updated_at,
                            last_summary = $1, audit_details = $2, forecast_stage = $3, updated_at = NOW(), run_count = COALESCE(run_count, 0) + 1,
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
                    ])
                    .then(() => {
                        console.log(`✅ ${dealToSave.account_name} synced. Score: ${totalScore}`);
                        
                        // Acknowledge the tool to OpenAI
                        openAiWs.send(JSON.stringify({ 
                            type: "conversation.item.create", 
                            item: { type: "function_call_output", call_id: output.call_id, output: JSON.stringify({ success: true }) } 
                        }));

                        // MOVE TO NEXT DEAL ONLY AFTER SUCCESSFUL DB SYNC
                        advanceToNextDeal();
                    })
                    .catch(err => console.error("❌ DB UPDATE FAILED:", err.message));
                }
            });
        }
    });

    // 7. THE MISSING PIPE: TWILIO TO OPENAI (REP TALKS / MATTHEW LISTENS)
    ws.on('message', (message) => {
        const msg = JSON.parse(message);
        if (msg.event === 'start') {
            streamSid = msg.start.streamSid;
            console.log(`🚀 Stream Started. SID: ${streamSid}`);
        } else if (msg.event === 'media' && openAiWs.readyState === WebSocket.OPEN) {
            // This sends your voice payload to the AI
            openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));
        }
    });

    ws.on('close', () => {
        console.log("🔌 Call Closed.");
        openAiWs.close();
    });

// --- [BLOCK 7: SERVER INITIALIZATION] ---
server.listen(PORT, () =>
    console.log(`🚀 Matthew God-Mode Live on ${PORT}`)
);
