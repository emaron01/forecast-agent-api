import dotenv from "dotenv";
import http from "http";
import express from "express";
import { Pool } from "pg";
import WebSocket, { WebSocketServer } from "ws";
import cors from "cors";

dotenv.config();

// 🔒 LOCKED BEHAVIOR (OWNER-APPROVED ONLY)
// Prompts, save logic, move-on logic, and handshakes are locked.
// Do NOT change these unless explicitly approved by the owner.

// --- [BLOCK 1: CONFIGURATION] ---
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.MODEL_API_KEY; // Using your specific Env Var
const MODEL_URL = process.env.MODEL_URL || "wss://api.openai.com/v1/realtime";
const MODEL_NAME = process.env.MODEL_NAME || "gpt-4o-realtime-preview-2024-10-01";

if (!OPENAI_API_KEY) {
  console.error("❌ Missing MODEL_API_KEY in environment");
  process.exit(1);
}

// --- [BLOCK 2: SERVER CONFIGURATION] ---
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static("public"));

// --- [BLOCK DB: POSTGRES POOL] ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --- [BLOCK X: SERVER + WEBSOCKET INIT] ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --- [BLOCK 3: SYSTEM PROMPT] ---
function formatScoreDefinitions(defs) {
  if (!Array.isArray(defs) || defs.length === 0) return "No criteria available.";
  const byCat = new Map();
  for (const row of defs) {
    const cat = row.category || "unknown";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(row);
  }
  const lines = [];
  for (const [cat, rows] of byCat.entries()) {
    rows.sort((a, b) => Number(a.score) - Number(b.score));
    lines.push(`${cat.toUpperCase()}:`);
    for (const r of rows) {
      const score = r.score;
      const label = r.label || "";
      const criteria = r.criteria || "";
      lines.push(`- ${score}: ${label} — ${criteria}`);
    }
  }
  return lines.join("\n");
}

function getSystemPrompt(deal, repName, totalCount, isSessionStart, scoreDefs) {
  const stage = deal.forecast_stage || "Pipeline";
  const amountStr = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(deal.amount || 0));
  const closeDateStr = deal.close_date
    ? new Date(deal.close_date).toLocaleDateString()
    : "TBD";
  const oppName = (deal.opportunity_name || "").trim();
  const oppNamePart = oppName ? ` — ${oppName}` : "";

  const callPickup =
    `Hi ${repName}, this is Matthew from Sales Forecaster. ` +
    `Today we are reviewing ${totalCount} deals. ` +
    `Let's jump in starting with ${deal.account_name}${oppNamePart} ` +
    `for ${amountStr} in CRM Forecast Stage ${stage} closing ${closeDateStr}.`;

  const dealOpening =
    `Let’s look at ${deal.account_name}${oppNamePart}, ` +
    `${stage}, ${amountStr}, closing ${closeDateStr}.`;

  const riskRecall = deal.risk_summary
    ? `Existing Risk Summary: ${deal.risk_summary}`
    : "No prior risk summary recorded.";

  const order = stage.includes("Commit") || stage.includes("Best Case")
    ? [
        { name: "Pain", val: deal.pain_score },
        { name: "Metrics", val: deal.metrics_score },
        { name: "Internal Sponsor", val: deal.champion_score },
        { name: "Criteria", val: deal.criteria_score },
        { name: "Competition", val: deal.competition_score },
        { name: "Timing", val: deal.timing_score },
        { name: "Budget", val: deal.budget_score },
        { name: "Economic Buyer", val: deal.eb_score },
        { name: "Decision Process", val: deal.process_score },
        { name: "Paper Process", val: deal.paper_score },
      ]
    : [
        { name: "Pain", val: deal.pain_score },
        { name: "Metrics", val: deal.metrics_score },
        { name: "Internal Sponsor", val: deal.champion_score },
        { name: "Competition", val: deal.competition_score },
        { name: "Budget", val: deal.budget_score },
      ];
  const firstGap = order.find((s) => (Number(s.val) || 0) < 3) || order[0];

  const gapQuestion = (() => {
    if (stage.includes("Pipeline")) {
      if (firstGap.name === "Pain")
        return "What specific business problem is the customer trying to solve, and what happens if they do nothing?";
      if (firstGap.name === "Metrics")
        return "What measurable outcome has the customer agreed matters, and who validated it?";
      if (firstGap.name === "Internal Sponsor")
        return "Who is driving this internally, what is their role, and how have they shown advocacy?";
      if (firstGap.name === "Budget")
        return "Has budget been discussed or confirmed, and at what level?";
      return `What changed since last time on ${firstGap.name}?`;
    }
    if (stage.includes("Commit")) {
      return `This is Commit — what evidence do we have that ${firstGap.name} is fully locked?`;
    }
    if (stage.includes("Best Case")) {
      return `What would need to happen to strengthen ${firstGap.name} to a clear 3?`;
    }
    return `What is the latest on ${firstGap.name}?`;
  })();

  const firstLine = isSessionStart ? callPickup : dealOpening;
  const criteriaBlock = formatScoreDefinitions(scoreDefs);

  return `
SYSTEM PROMPT — SALES FORECAST AGENT
You are a Sales Forecast Agent applying MEDDPICC + Timing + Budget to sales opportunities.
Your job is to run fast, rigorous deal reviews that the rep can be honest in.

NON-NEGOTIABLES
- Do NOT invent facts. Never assume answers that were not stated by the rep.
- Do NOT reveal category scores, scoring logic, scoring matrix, or how a category is computed.
- Do NOT speak coaching tips, category summaries, or "what I heard." Coaching and summaries are allowed ONLY in the written fields that will be saved (e.g., *_summary, *_tip, risk_summary, next_steps).
- Use concise spoken language. Keep momentum. No dead air after saves—always ask the next question.
- Never use the word "champion." Use "internal sponsor" or "coach" instead.

HARD CONTEXT (NON-NEGOTIABLE)
You are reviewing exactly:
- DEAL_ID: ${deal.id}
- ACCOUNT_NAME: ${deal.account_name}
- OPPORTUNITY_NAME: ${oppName || "(none)"}
- STAGE: ${stage}
Never change deal identity unless the rep explicitly corrects it.

DEAL INTRO (spoken)
At the start of this deal, you may speak ONLY:
1) "${firstLine}"
2) "${riskRecall}"
Then immediately ask the first category question: "${gapQuestion}"

CATEGORY ORDER (strict)
Pipeline deals (strict order):
1) Pain
2) Metrics
3) Internal Sponsor (do NOT say champion)
4) Competition
5) Budget

Best Case / Commit deals (strict order):
1) Pain
2) Metrics
3) Internal Sponsor
4) Criteria
5) Competition
6) Timing
7) Budget
8) Economic Buyer
9) Decision Process
10) Paper Process

Rules:
- Never skip ahead.
- Never reorder.
- Never revisit a category unless the rep introduces NEW information for that category.

QUESTIONING RULES (spoken)
- Exactly ONE primary question per category.
- At most ONE clarification question if the answer is vague or incomplete.
- No spoken summaries. No spoken coaching. No repeating the rep's answer back.
- After capturing enough info, proceed: silently update fields and save, then immediately ask the next category question.

SCORING / WRITTEN OUTPUT RULES (silent)
For each category you touch:
- Update the category score (integer) consistent with your scoring definitions.
- Update label/summary/tip ONLY in the dedicated fields for that category (e.g., pain_summary, pain_tip, etc.).
- If no meaningful coaching tip is needed, leave the tip blank (do not invent filler).
- Be skeptical by default. You are an auditor, not a cheerleader.
- Only give a 3 when the rep provides concrete, current-cycle evidence that fully meets the definition.
- If evidence is vague, aspirational, or second-hand, score lower and explain the gap in the summary/tip.
- Favor truth over momentum: it is better to downgrade than to accept weak proof.
- MEDDPICC rigor is mandatory: a named person ≠ a Champion, and a stated metric ≠ validated Metrics.
- Champion (Internal Sponsor) requires: power/influence, active advocacy, and a concrete action they drove in this cycle.
- Metrics require: measurable outcome, baseline + target, and buyer validation (not just rep belief).

SCORING CRITERIA (AUTHORITATIVE)
Use these exact definitions as the litmus test for labels and scores:
${criteriaBlock}

IMPORTANT:
The criteria are ONLY for scoring. Do NOT ask extra questions beyond the ONE allowed clarification.

Unknowns:
- If the rep explicitly says it's unknown or not applicable, score accordingly (typically 0/Unknown) and write a short summary reflecting that.

CATEGORY CHECK PATTERNS (spoken)
- For categories with prior score >= 3:
  Say: "Last review <Category> was strong. Has anything changed that could introduce new risk?"
  If rep says NO: move on to next category WITHOUT saving. Do NOT call save_deal_data.
  If rep provides ANY other answer: ask ONE follow-up if needed, then SAVE with updated score/summary/tip.

- For categories with prior score 1 or 2:
  Say: "Last review <Category> was <Label>. Have we made progress since the last review?"
  If clear improvement: capture evidence, silently update and save.
  If no change: confirm, then move on (save only if the system already does heartbeat saves).
  If vague: ask ONE clarifying question.

- For categories with prior score 0 (or empty):
  Treat as "not previously established."
  Do NOT say "last review was…" or reference any prior state.
  Ask the primary question directly.
  ALWAYS SAVE after the rep answers.

DEGRADATION (silent)
Any category may drop (including 3 → 0) if evidence supports it. No score protection. Truth > momentum.
If degradation happens: capture the new risk, rescore downward, silently update summary/tip, save.

CROSS-CATEGORY ANSWERS
If the rep provides info that answers a future category while answering the current one:
- Silently extract it and store it for that future category.
- When you reach that category later, do NOT re-ask; say only:
  "I already captured that earlier based on your previous answer."
Then proceed to the next category.

MANDATORY WORKFLOW (NON-NEGOTIABLE)
After each rep answer:
1) If a save is required, call save_deal_data silently with score/summary/tip.
2) Then immediately ask the next category question.
No spoken acknowledgments, summaries, or coaching.

CRITICAL RULES:
- Tool calls are 100% silent - never mention saving or updating
- Follow the category check patterns exactly for when to save vs move on
- If the rep says "I don't know" or provides weak evidence, still save with a low score (0-1)

HEALTH SCORE (spoken only at end)
- Health Score is ALWAYS out of 30.
- Never change the denominator.
- Never reveal individual category scores.
- If asked how it was calculated: "Your score is based on the completeness and strength of your MEDDPICC answers."

END-OF-DEAL WRAP (spoken)
After all required categories for the deal type are reviewed:
Speak in this exact order:
1) Updated Risk Summary
2) "Your Deal Health Score is X out of 30."
3) Suggested Next Steps (plain language)
Do NOT ask for rep confirmation. Do NOT invite edits. Then call the advance_deal tool silently.
`.trim();
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

    let orgId = 1;
    let repName = "Guest";

    if (result.rows.length > 0) {
      orgId = result.rows[0].org_id;
      repName = result.rows[0].rep_name || "Rep";
      console.log(`✅ Identified Rep: ${repName}`);
    }

    const wsUrl = `wss://${req.headers.host}/`;
    res.type("text/xml").send(
      `<Response>
         <Connect>
           <Stream url="${wsUrl}">
             <Parameter name="org_id" value="${orgId}" />
             <Parameter name="rep_name" value="${repName}" />
           </Stream>
         </Connect>
       </Response>`
    );
  } catch (err) {
    console.error("❌ /agent error:", err.message);
    res.type("text/xml").send(`<Response><Connect><Stream url="wss://${req.headers.host}/" /></Connect></Response>`);
  }
});

// --- [BLOCK 5: WEBSOCKET CORE (ATOMIC SAVE)] ---
wss.on("connection", async (ws) => {
  console.log("🔥 Twilio WebSocket connected");

  // Local State
  let streamSid = null;
  let dealQueue = [];
  let currentDealIndex = 0;
  let repName = null; 
  let orgId = 1;
  let openAiReady = false;
  let scoreDefinitions = [];

  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" },
  });

  // 1. THE MUSCLE: Atomic Save + Memory Merge
  const handleFunctionCall = async (args, callId) => {
    console.log("🛠️ Tool Triggered: save_deal_data");
    try {
      const deal = dealQueue[currentDealIndex];
      if (!deal) return;

      // A. Calculate Scores
      const scores = [
        args.pain_score, args.metrics_score, args.champion_score, 
        args.eb_score, args.criteria_score, args.process_score, 
        args.competition_score, args.paper_score, args.timing_score
      ];
      const totalScore = scores.reduce((a, b) => a + (Number(b) || 0), 0);
      const aiOpinion = totalScore >= 21 ? "Commit" : totalScore >= 15 ? "Best Case" : "Pipeline";

      // B. PREPARE DATA (Atomic Logic)
      const sqlQuery = `UPDATE opportunities SET 
          pain_score=$1, pain_tip=$2, pain_summary=$3, metrics_score=$4, metrics_tip=$5, metrics_summary=$6,
          champion_score=$7, champion_tip=$8, champion_summary=$9, eb_score=$10, eb_tip=$11, eb_summary=$12,
          criteria_score=$13, criteria_tip=$14, criteria_summary=$15, process_score=$16, process_tip=$17, process_summary=$18,
          competition_score=$19, competition_tip=$20, competition_summary=$21, paper_score=$22, paper_tip=$23, paper_summary=$24,
          timing_score=$25, timing_tip=$26, timing_summary=$27, risk_summary=$28, next_steps=$29, 
          champion_name=$30, champion_title=$31, eb_name=$32, eb_title=$33, rep_comments=$34, manager_comments=$35,
          ai_forecast=$36, run_count = COALESCE(run_count, 0) + 1, updated_at = NOW() WHERE id = $37`;

      // USE ?? to ensure 0s are saved, fallback to existing deal data if null
      const sqlParams = [
        args.pain_score ?? deal.pain_score, args.pain_tip || deal.pain_tip, args.pain_summary || deal.pain_summary,
        args.metrics_score ?? deal.metrics_score, args.metrics_tip || deal.metrics_tip, args.metrics_summary || deal.metrics_summary,
        args.champion_score ?? deal.champion_score, args.champion_tip || deal.champion_tip, args.champion_summary || deal.champion_summary,
        args.eb_score ?? deal.eb_score, args.eb_tip || deal.eb_tip, args.eb_summary || deal.eb_summary,
        args.criteria_score ?? deal.criteria_score, args.criteria_tip || deal.criteria_tip, args.criteria_summary || deal.criteria_summary,
        args.process_score ?? deal.process_score, args.process_tip || deal.process_tip, args.process_summary || deal.process_summary,
        args.competition_score ?? deal.competition_score, args.competition_tip || deal.competition_tip, args.competition_summary || deal.competition_summary,
        args.paper_score ?? deal.paper_score, args.paper_tip || deal.paper_tip, args.paper_summary || deal.paper_summary,
        args.timing_score ?? deal.timing_score, args.timing_tip || deal.timing_tip, args.timing_summary || deal.timing_summary,
        args.risk_summary || deal.risk_summary, args.next_steps || deal.next_steps,
        args.champion_name || deal.champion_name, args.champion_title || deal.champion_title,
        args.eb_name || deal.eb_name, args.eb_title || deal.eb_title, 
        args.rep_comments || deal.rep_comments, args.manager_comments || deal.manager_comments, 
        aiOpinion, deal.id
      ];

      await pool.query(sqlQuery, sqlParams);
      console.log(`✅ Atomic Save: ${deal.account_name}`);
      Object.assign(deal, args); // MEMORY MERGE
      
      openAiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify({ status: "success" }) } }));
    } catch (err) { console.error("❌ Atomic Save Error:", err); }
  };

// 2. THE EAR
  openAiWs.on("message", (data) => {
    try {
      const response = JSON.parse(data);
      if (response.type === "response.function_call_arguments.done") {
        const fnName = response.name || response.function_name || response?.function?.name || null;
        const args = JSON.parse(response.arguments || "{}");
        if (fnName === "save_deal_data") {
          handleFunctionCall(args, response.call_id);
        } else if (fnName === "advance_deal") {
          const nextIndex = currentDealIndex + 1;
          if (nextIndex < dealQueue.length) {
            currentDealIndex = nextIndex;
            const nextDeal = dealQueue[currentDealIndex];
            const instructions = getSystemPrompt(
              nextDeal,
              repName?.split(" ")[0] || repName,
              dealQueue.length,
              false,
              scoreDefinitions
            );
            openAiWs.send(
              JSON.stringify({
                type: "session.update",
                session: { instructions },
              })
            );
            setTimeout(() => openAiWs.send(JSON.stringify({ type: "response.create" })), 200);
          }
          openAiWs.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: { type: "function_call_output", call_id: response.call_id, output: JSON.stringify({ status: "success" }) },
            })
          );
        }
      }
      
// 3. INDEX ADVANCER (DIGITAL TRIGGER + CRASH FIX)
      if (response.type === "response.done") {
        // Fix 1: Add ?. to prevent crash on silent tool calls
        const transcript = response.response?.output?.[0]?.content?.[0]?.transcript || "";
        
        // Fix 2: Listen for the ACTUAL code defined in your Prompt
        if (transcript.includes("NEXT_DEAL_TRIGGER")) {
          console.log("🚀 Digital Trigger Detected. Advancing Index.");
          currentDealIndex++;
        }
      }
      
      if (response.type === "response.audio.delta" && response.delta && streamSid) {
          ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: response.delta } }));
      }
    } catch (err) { console.error("❌ OpenAI Message Error:", err); }
  });

  // 3. LAUNCHER
  const attemptLaunch = async () => {
    if (!repName || !openAiReady) return; 
    
    try {
      const result = await pool.query(`SELECT o.*, org.product_truths AS org_product_data FROM opportunities o JOIN organizations org ON o.org_id = org.id WHERE o.org_id = $1 AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost') ORDER BY o.id ASC`, [orgId]);
      dealQueue = result.rows;
      try {
        const defsRes = await pool.query(
          `
          SELECT category, score, label, criteria
          FROM score_definitions
          WHERE org_id = $1
          ORDER BY category ASC, score ASC
          `,
          [orgId]
        );
        scoreDefinitions = defsRes.rows || [];
      } catch (err) {
        console.error("❌ Failed to load score_definitions:", err?.message || err);
        scoreDefinitions = [];
      }
      console.log(`📊 Loaded ${dealQueue.length} deals for ${repName}`);
    } catch (err) { console.error("❌ DB Error:", err.message); }

    if (dealQueue.length > 0) {
      const firstDeal = dealQueue[0];
      const instructions = getSystemPrompt(
        firstDeal,
        repName.split(" ")[0],
        dealQueue.length,
        true,
        scoreDefinitions
      );
      openAiWs.send(JSON.stringify({
        type: "session.update",
        session: { 
            instructions, 
            tools: [{ 
              type: "function", name: "save_deal_data", 
              description: "DYNAMIC SAVE: Call this immediately after every category update. Don't wait.", 
              parameters: { 
                type: "object", 
                properties: { 
                    pain_score: { type: "number" }, pain_summary: { type: "string" }, pain_tip: { type: "string" },
                    metrics_score: { type: "number" }, metrics_summary: { type: "string" }, metrics_tip: { type: "string" },
                    champion_score: { type: "number" }, champion_summary: { type: "string" }, champion_tip: { type: "string" }, champion_name: { type: "string" }, champion_title: { type: "string" },
                    eb_score: { type: "number" }, eb_summary: { type: "string" }, eb_tip: { type: "string" }, eb_name: { type: "string" }, eb_title: { type: "string" },
                    criteria_score: { type: "number" }, criteria_summary: { type: "string" }, criteria_tip: { type: "string" },
                    process_score: { type: "number" }, process_summary: { type: "string" }, process_tip: { type: "string" },
                    competition_score: { type: "number" }, competition_summary: { type: "string" }, competition_tip: { type: "string" },
                    paper_score: { type: "number" }, paper_summary: { type: "string" }, paper_tip: { type: "string" },
                    timing_score: { type: "number" }, timing_summary: { type: "string" }, timing_tip: { type: "string" },
                    risk_summary: { type: "string" }, next_steps: { type: "string" }, rep_comments: { type: "string" }
                }, 
                required: [] 
              } 
            },
            {
              type: "function", name: "advance_deal",
              description: "Advance to the next deal after end-of-deal wrap.",
              parameters: { type: "object", properties: {} }
            }] 
        }
      }));
      setTimeout(() => openAiWs.send(JSON.stringify({ type: "response.create" })), 500);
    }
  };

  openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");
    openAiWs.send(JSON.stringify({ type: "session.update", session: { input_audio_format: "g711_ulaw", output_audio_format: "g711_ulaw", voice: "verse", turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 1000 } } }));
    openAiReady = true;
    attemptLaunch(); 
  });

  // 4. TWILIO LISTENER (Kept inside for safety)
  ws.on("message", (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.event === "start") {
        streamSid = msg.start.streamSid;
        const params = msg.start.customParameters;
        if (params) {
          orgId = parseInt(params.org_id) || 1;
          repName = params.rep_name || "Guest";
          console.log(`🔎 Identified ${repName}`);
          attemptLaunch(); 
        }
      }
      if (msg.event === "media" && openAiWs.readyState === WebSocket.OPEN) {
        openAiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));
      }
    } catch (err) { console.error("❌ Twilio Error:", err); }
  });

  ws.on("close", () => {
    console.log("🔌 Call Closed.");
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
  });
});
// --- [BLOCK 6: API ENDPOINTS] ---
app.get("/debug/opportunities", async (req, res) => {
  try {
    const orgId = parseInt(req.query.org_id) || 1;
    const result = await pool.query(
      `SELECT * FROM opportunities WHERE org_id = $1 ORDER BY updated_at DESC`,
      [orgId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
server.listen(PORT, () => console.log(`🚀 Matthew God-Mode Live on port ${PORT}`));
 