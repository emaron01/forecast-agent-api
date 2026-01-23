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

// --- [BLOCK 3: SYSTEM PROMPT (MASTER STRATEGIST, POWER VERSION)] ---
function getSystemPrompt(deal, repName, dealsLeft) {
    const categoryRaw = (deal.forecast_stage || "Pipeline").trim();
    const category = categoryRaw === "" || categoryRaw === "Null"
        ? "Pipeline"
        : categoryRaw;

    const amountStr = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0
    }).format(deal.amount || 0);

    const lastSummary = deal.last_summary || "";
    const historyHook =
        lastSummary.length > 5
            ? `Last time we flagged: "${lastSummary}". What's changed?`
            : "What's the latest update?";

    const details = deal.audit_details || {};

    const scores = {
        Pain: deal.pain_score || details.pain_score || 0,
        Metrics: deal.metrics_score || details.metrics_score || 0,
        Champion: deal.champion_score || details.champion_score || 0,
        EB: deal.eb_score || details.eb_score || 0,
        Criteria: deal.criteria_score || details.criteria_score || 0,
        Process: deal.process_score || details.process_score || 0,
        Competition: deal.competition_score || details.competition_score || 0,
        Paper: deal.paper_score || details.paper_score || 0,
        Timing: deal.timing_score || details.timing_score || 0
    };

    const gaps = Object.entries(scores)
        .filter(([_, v]) => Number(v) < 3)
        .map(([k]) => k)
        .join(", ");

    let mode;
    if (category.includes("Commit")) {
        mode = `MODE: Commit. De-risk. Challenge any gaps: ${gaps || "None"}.`;
    } else if (category.includes("Best Case")) {
        mode = `MODE: Best Case. Validate Upside. Gaps: ${gaps || "None"}.`;
    } else {
        mode = `MODE: Pipeline. Qualify. Gaps: ${gaps || "None"}.`;
    }

    const safeRepName = (repName || "Team").trim().split(/\s+/)[0];
    const intro = `Hi ${safeRepName}, this is Matthew. Starting with ${deal.account_name} for ${amountStr} in ${category}.`;

    return `
OPEN WITH: "${intro} ${historyHook}"

ROLE: Matthew, Deal Strategy AI. Direct. No fluff.
Customer: "${deal.account_name}"
${mode}

MEDDPICC (ask one at a time, wait for answers):
- Pain
- Metrics
- Champion
- Economic Buyer
- Decision Criteria / Process
- Paper Process
- Timing

INTERNAL TRUTHS:
${deal.org_product_data || "Verify capabilities against company documentation."}

CLOSE:
- "Health Score is [Total]/27. Updating your scorecard now."
- "Moving to the next opportunity."
- Call the tool: save_deal_data with all scores, tips, risk_summary, and next_steps.
`;
}
// --- [BLOCK 4: THE SMART RECEPTIONIST] --- app.post("/agent", async (req, res) => { try { const callerPhone = req.body.From || null; console.log("📞 Incoming call from:", callerPhone); // Lookup rep by phone const result = await pool.query( "SELECT org_id, rep_name FROM opportunities WHERE rep_phone = $1 LIMIT 1", [callerPhone] ); const orgId = result.rows.length > 0 ? result.rows[0].org_id : 1; const repName = result.rows.length > 0 ? result.rows[0].rep_name : "Team"; // Build the WebSocket URL const streamUrl = `wss://${req.headers.host}/?org_id=${orgId}&rep_name=${encodeURIComponent(repName)}`; // Escape XML-sensitive characters const escapedUrl = streamUrl.replace(/&/g, "&amp;"); // Return valid TwiML res.type("text/xml").send( `<Response> <Connect> <Stream url="${escapedUrl}" /> </Connect> </Response>` ); } catch (err) { console.error("❌ /agent lookup failed:", err.message); // Safe fallback TwiML const fallbackUrl = `wss://${req.headers.host}/?org_id=1&rep_name=Team`.replace(/&/g, "&amp;"); res.type("text/xml").send( `<Response> <Connect> <Stream url="${fallbackUrl}" /> </Connect> </Response>` ); } });


// --- [BLOCK 5: WEBSOCKET CORE & SAVE ENGINE] ---
wss.on("connection", (ws, req) => {
    let orgId = 1;
    let repName = "Team";

    try {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        orgId = parseInt(urlObj.searchParams.get("org_id"), 10) || 1;
        repName = urlObj.searchParams.get("rep_name") || "Team";
    } catch (err) {
        console.error("❌ URL parse failed:", err.message);
    }

    const safeRepName = (repName || "Team").trim().split(/\s+/)[0];

    let streamSid = null;
    let dealQueue = [];
    let currentDealIndex = 0;

    const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "realtime=v1"
        }
    });

    const advanceToNextDeal = () => {
        currentDealIndex++;
        if (!dealQueue.length || currentDealIndex >= dealQueue.length) {
            openAiWs.send(
                JSON.stringify({
                    type: "response.create",
                    response: {
                        instructions:
                            "Say: 'Review complete. Great work today. Goodbye.' then hang up."
                    }
                })
            );
            return;
        }

        const nextDeal = dealQueue[currentDealIndex];
        const nextInstructions = getSystemPrompt(
            nextDeal,
            safeRepName,
            dealQueue.length - currentDealIndex
        );

        openAiWs.send(
            JSON.stringify({
                type: "session.update",
                session: { instructions: nextInstructions }
            })
        );
        openAiWs.send(
            JSON.stringify({
                type: "response.create",
                response: {
                    modalities: ["text", "audio"],
                    instructions: `Say: "Pulling up ${nextDeal.account_name}."`
                }
            })
        );
    };

    openAiWs.on("open", async () => {
        try {
            const result = await pool.query(
                `SELECT o.*, org.product_truths AS org_product_data
                 FROM opportunities o
                 JOIN organizations org ON o.org_id = org.id
                 WHERE o.org_id = $1
                   AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost')
                 ORDER BY o.id ASC`,
                [orgId]
            );

            dealQueue = result.rows;

            if (!dealQueue.length) {
                openAiWs.send(
                    JSON.stringify({
                        type: "response.create",
                        response: {
                            instructions:
                                "Say: 'No active opportunities found for your org. Goodbye.' then hang up."
                        }
                    })
                );
                return;
            }

            const firstDeal = dealQueue[0];
            const instructions = getSystemPrompt(
                firstDeal,
                safeRepName,
                dealQueue.length - 1
            );

            openAiWs.send(
                JSON.stringify({
                    type: "session.update",
                    session: {
                        modalities: ["text", "audio"],
                        instructions,
                        voice: "verse",
                        input_audio_format: "g711_ulaw",
                        output_audio_format: "g711_ulaw",
                        turn_detection: {
                            type: "server_vad",
                            threshold: 0.5,
                            silence_duration_ms: 1000
                        },
                        tools: [
                            {
                                type: "function",
                                name: "save_deal_data",
                                description: "Saves scores and tips.",
                                parameters: {
                                    type: "object",
                                    properties: {
                                        pain_score: { type: "number" },
                                        pain_tip: { type: "string" },
                                        metrics_score: { type: "number" },
                                        metrics_tip: { type: "string" },
                                        champion_score: { type: "number" },
                                        champion_tip: { type: "string" },
                                        eb_score: { type: "number" },
                                        eb_tip: { type: "string" },
                                        criteria_score: { type: "number" },
                                        criteria_tip: { type: "string" },
                                        process_score: { type: "number" },
                                        process_tip: { type: "string" },
                                        competition_score: { type: "number" },
                                        competition_tip: { type: "string" },
                                        paper_score: { type: "number" },
                                        paper_tip: { type: "string" },
                                        timing_score: { type: "number" },
                                        timing_tip: { type: "string" },
                                        risk_summary: { type: "string" },
                                        next_steps: { type: "string" }
                                    },
                                    required: [
                                        "pain_score",
                                        "pain_tip",
                                        "metrics_score",
                                        "metrics_tip",
                                        "champion_score",
                                        "champion_tip",
                                        "eb_score",
                                        "eb_tip",
                                        "criteria_score",
                                        "criteria_tip",
                                        "process_score",
                                        "process_tip",
                                        "competition_score",
                                        "competition_tip",
                                        "paper_score",
                                        "paper_tip",
                                        "timing_score",
                                        "timing_tip",
                                        "risk_summary",
                                        "next_steps"
                                    ]
                                }
                            }
                        ],
                        tool_choice: "auto"
                    }
                })
            );

            setTimeout(() => {
                openAiWs.send(JSON.stringify({ type: "response.create" }));
            }, 250);
        } catch (err) {
            console.error("❌ Deal load failed:", err.message);
            openAiWs.send(
                JSON.stringify({
                    type: "response.create",
                    response: {
                        instructions:
                            "Say: 'I had trouble loading your deals. Please try again later.' then hang up."
                    }
                })
            );
        }
    });

    openAiWs.on("message", data => {
        let response;
        try {
            response = JSON.parse(data);
        } catch {
            return;
        }

        if (response.type === "response.audio.delta" && response.delta) {
            ws.send(
                JSON.stringify({
                    event: "media",
                    streamSid,
                    media: { payload: response.delta }
                })
            );
        }

        if (
            response.type === "response.function_call_arguments.done" &&
            response.name === "save_deal_data"
        ) {
            let args;
            try {
                args = JSON.parse(response.arguments);
            } catch {
                console.error("❌ Failed to parse function args");
                return;
            }

            if (!args || typeof args !== "object") return;
            const dealToSave = dealQueue[currentDealIndex];
            if (!dealToSave) {
                console.error("❌ No deal to save at index", currentDealIndex);
                return;
            }

            openAiWs.send(
                JSON.stringify({
                    type: "conversation.item.create",
                    item: {
                        type: "function_call_output",
                        call_id: response.call_id,
                        output: JSON.stringify({ success: true })
                    }
                })
            );

            const scores = [
                args.pain_score,
                args.metrics_score,
                args.champion_score,
                args.eb_score,
                args.criteria_score,
                args.process_score,
                args.competition_score,
                args.paper_score,
                args.timing_score
            ].map(v => Number(v) || 0);

            const totalScore = scores.reduce((a, b) => a + b, 0);
            const newStage =
                totalScore >= 25
                    ? "Closed Won"
                    : totalScore >= 20
                    ? "Commit"
                    : totalScore >= 12
                    ? "Best Case"
                    : "Pipeline";

            pool
                .query(
                    `
                UPDATE opportunities 
                SET previous_total_score = (
                        COALESCE(pain_score,0) + COALESCE(metrics_score,0) +
                        COALESCE(champion_score,0) + COALESCE(eb_score,0) +
                        COALESCE(criteria_score,0) + COALESCE(process_score,0) +
                        COALESCE(competition_score,0) + COALESCE(paper_score,0) +
                        COALESCE(timing_score,0)
                    ),
                    previous_updated_at = updated_at,
                    last_summary = $1,
                    audit_details = $2,
                    forecast_stage = $3,
                    updated_at = NOW(),
                    run_count = COALESCE(run_count, 0) + 1,
                    pain_score = $5,
                    metrics_score = $6,
                    champion_score = $7,
                    eb_score = $8,
                    criteria_score = $9,
                    process_score = $10,
                    competition_score = $11,
                    paper_score = $12,
                    timing_score = $13,
                    pain_tip = $14,
                    metrics_tip = $15,
                    champion_tip = $16,
                    eb_tip = $17,
                    criteria_tip = $18,
                    process_tip = $19,
                    competition_tip = $20,
                    paper_tip = $21,
                    timing_tip = $22,
                    next_steps = $23
                WHERE id = $4
            `,
                    [
                        args.risk_summary,
                        JSON.stringify(args),
                        newStage,
                        dealToSave.id,
                        args.pain_score,
                        args.metrics_score,
                        args.champion_score,
                        args.eb_score,
                        args.criteria_score,
                        args.process_score,
                        args.competition_score,
                        args.paper_score,
                        args.timing_score,
                        args.pain_tip,
                        args.metrics_tip,
                        args.champion_tip,
                        args.eb_tip,
                        args.criteria_tip,
                        args.process_tip,
                        args.competition_tip,
                        args.paper_tip,
                        args.timing_tip,
                        args.next_steps
                    ]
                )
                .catch(err =>
                    console.error("❌ DB UPDATE FAILED:", err.message)
                );

            advanceToNextDeal();
        }
    });

    openAiWs.on("close", () => {
        console.log("🔌 OpenAI WS closed");
        try {
            ws.close();
        } catch {}
    });

    openAiWs.on("error", err => {
        console.error("❌ OpenAI WS error:", err.message);
    });

    ws.on("message", message => {
        let msg;
        try {
            msg = JSON.parse(message);
        } catch {
            return;
        }

        if (msg.event === "start") {
            streamSid = msg.start?.streamSid;
        } else if (
            msg.event === "media" &&
            msg.media?.payload &&
            openAiWs.readyState === WebSocket.OPEN
        ) {
            openAiWs.send(
                JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: msg.media.payload
                })
            );
        }
    });

    ws.on("close", () => {
        try {
            openAiWs.close();
        } catch {}
    });
});

// --- [BLOCK 6: API ENDPOINTS] ---
app.get("/get-deal", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM opportunities WHERE id = $1",
            [req.query.oppId]
        );
        res.json(result.rows[0] || {});
    } catch (err) {
        console.error("❌ /get-deal failed:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get("/deals", async (req, res) => {
    try {
        const orgId = req.query.org_id || 1;
        const result = await pool.query(
            "SELECT * FROM opportunities WHERE org_id = $1 ORDER BY id ASC",
            [orgId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error("❌ /deals failed:", err.message);
        res.status(500).json([]);
    }
});

// Simple health check
app.get("/health", (req, res) => res.send("OK"));

// --- [BLOCK 7: SERVER INITIALIZATION] ---
server.listen(PORT, () =>
    console.log(`🚀 Matthew God-Mode Live on ${PORT}`)
);
