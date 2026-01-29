// server.js (ES module)
/// Forecast Agent Conductor: Twilio <Stream> + OpenAI Realtime + deal queue + tool routing.
/// READ-ONLY to DB (writes happen in db.js via muscle.js)

import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { Pool } from "pg";

import { handleFunctionCall } from "./muscle.js";

/// ============================================================================
/// SECTION 1: CONFIG
/// ============================================================================
const PORT = process.env.PORT || 10000;

const MODEL_URL = process.env.MODEL_API_URL;      // wss://api.openai.com/v1/realtime
const MODEL_NAME = process.env.MODEL_NAME;
const OPENAI_API_KEY = process.env.MODEL_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!MODEL_URL || !MODEL_NAME || !OPENAI_API_KEY) {
  throw new Error("⚠️ MODEL_API_URL, MODEL_NAME, and MODEL_API_KEY must be set!");
}
if (!DATABASE_URL) {
  throw new Error("⚠️ DATABASE_URL must be set!");
}

/// ============================================================================
/// SECTION 2: DB (read-only in server.js)
/// ============================================================================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/// ============================================================================
/// SECTION 3: HELPERS
/// ============================================================================
function safeJsonParse(data) {
  const s = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  try {
    return { ok: true, json: JSON.parse(s) };
  } catch (e) {
    return { ok: false, err: e, head: s.slice(0, 200) };
  }
}

function compact(obj, keys) {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out;
}

function computeFirstGap(deal) {
  // first category with score < 3 (deterministic order)
  const scores = [
    { name: "Pain", key: "pain_score", val: deal.pain_score },
    { name: "Metrics", key: "metrics_score", val: deal.metrics_score },
    { name: "Champion", key: "champion_score", val: deal.champion_score },
    { name: "Economic Buyer", key: "eb_score", val: deal.eb_score },
    { name: "Decision Criteria", key: "criteria_score", val: deal.criteria_score },
    { name: "Decision Process", key: "process_score", val: deal.process_score },
    { name: "Competition", key: "competition_score", val: deal.competition_score },
    { name: "Paper Process", key: "paper_score", val: deal.paper_score },
    { name: "Timing", key: "timing_score", val: deal.timing_score },
  ];

  return scores.find((s) => (Number(s.val) || 0) < 3) || scores[0];
}

function applyArgsToLocalDeal(deal, args) {
  // Keep local memory aligned with DB so gap logic stays stable.
  for (const [k, v] of Object.entries(args || {})) {
    if (v !== undefined) deal[k] = v;
  }
}

/// ============================================================================
/// SECTION 4: EXPRESS APP
/// ============================================================================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // REQUIRED for Twilio

app.get("/", (req, res) => res.send("✅ Forecast Agent API is alive!"));

/// ============================================================================
/// SECTION 5: TWILIO WEBHOOK (/agent) -> identify rep by phone -> return TwiML
/// ============================================================================
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
      console.log(`✅ Identified Rep: ${repName} (org_id=${orgId})`);
    } else {
      console.log("⚠️ No rep matched this phone; defaulting to Guest/org 1");
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
    console.error("❌ /agent error:", err?.message || err);
    res.type("text/xml").send(
      `<Response><Connect><Stream url="wss://${req.headers.host}/" /></Connect></Response>`
    );
  }
});

/// ============================================================================
/// SECTION 6: DEBUG (optional) /debug/opportunities (read-only + local CORS)
/// ============================================================================
app.use("/debug/opportunities", (req, res, next) => {
  const origin = req.headers.origin || "";
  const isLocal =
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:");

  if (isLocal) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/debug/opportunities", async (req, res) => {
  try {
    const orgId = parseInt(req.query.org_id, 10) || 1;
    const repName = req.query.rep_name || null;

    let query = `SELECT * FROM opportunities WHERE org_id = $1`;
    const params = [orgId];

    if (repName) {
      query += " AND rep_name = $2";
      params.push(repName);
    }

    query += " ORDER BY updated_at DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ /debug/opportunities error:", err?.message || err);
    res.status(500).json({ error: err.message });
  }
});

/// ============================================================================
/// SECTION 7: OpenAI Tool Schema (save_deal_data) — HARD SCORE GUARDRAILS
/// ============================================================================
const scoreInt = { type: "integer", minimum: 0, maximum: 3 };

const saveDealDataTool = {
  type: "function",
  name: "save_deal_data",
  description:
    "Save MEDDPICC updates for the CURRENT deal only. Scores MUST be integers 0-3. Do not invent facts. Do not overwrite evidence with blanks.",
  parameters: {
    type: "object",
    properties: {
      pain_score: scoreInt, pain_summary: { type: "string" }, pain_tip: { type: "string" },
      metrics_score: scoreInt, metrics_summary: { type: "string" }, metrics_tip: { type: "string" },
      champion_score: scoreInt, champion_summary: { type: "string" }, champion_tip: { type: "string" },
      champion_name: { type: "string" }, champion_title: { type: "string" },
      eb_score: scoreInt, eb_summary: { type: "string" }, eb_tip: { type: "string" },
      eb_name: { type: "string" }, eb_title: { type: "string" },
      criteria_score: scoreInt, criteria_summary: { type: "string" }, criteria_tip: { type: "string" },
      process_score: scoreInt, process_summary: { type: "string" }, process_tip: { type: "string" },
      competition_score: scoreInt, competition_summary: { type: "string" }, competition_tip: { type: "string" },
      paper_score: scoreInt, paper_summary: { type: "string" }, paper_tip: { type: "string" },
      timing_score: scoreInt, timing_summary: { type: "string" }, timing_tip: { type: "string" },

      // optional; muscle.js can compute deterministically if present/needed
      risk_summary: { type: "string" },

      next_steps: { type: "string" },
      rep_comments: { type: "string" },
    },
    required: [],
  },
};

/// ============================================================================
/// SECTION 8: System Prompt Builder (getSystemPrompt)
/// ============================================================================
function getSystemPrompt(deal, repFirstName, dealsLeft, totalCount) {
  const runCount = Number(deal.run_count) || 0;
  const isNewDeal = runCount === 0;

  const amountStr = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(deal.amount || 0);

  const closeDateStr = deal.close_date ? new Date(deal.close_date).toLocaleDateString() : "TBD";
  const stage = deal.forecast_stage || "Pipeline";
  const isSessionStart = dealsLeft === totalCount - 1 || dealsLeft === totalCount;

  const firstGap = computeFirstGap(deal);
  const gapQuestion = `Has anything changed since last review regarding ${firstGap.name}?`;

  let openingLine = "";
  if (isSessionStart) {
    openingLine = `Hi ${repFirstName}. This is Matthew. We are reviewing ${totalCount} opportunities, starting with ${deal.account_name}.`;
  } else {
    openingLine = `Okay. Next deal: ${deal.account_name}.`;
  }

  if (isNewDeal) {
    // NEW DEAL: do NOT ask “since last review”
    openingLine += ` It's in ${stage} for ${amountStr}, closing ${closeDateStr}. What product are we selling and what specific customer problem are we solving?`;
  } else {
    openingLine += ` It's in ${stage} for ${amountStr}.`;
  }

  return `
### ROLE
You are Matthew, a high-IQ MEDDPICC Auditor. You are an extractor, not a coach.

### HARD CONTEXT
- DEAL_ID: ${deal.id}
- ACCOUNT_NAME: ${deal.account_name}
Never use any other company name unless the rep explicitly corrects the deal identity.

### MANDATORY OPENING
You MUST open exactly with: "${openingLine}"

### OUTPUT STYLE (ANTI-CHATTY)
- Do NOT repeat or paraphrase the rep.
- Do NOT ask what the rep would score.
- Do NOT debate scores.
- Spoken output must be ONLY a single question (one sentence ending with "?").
- If unclear: ask ONE clarifier question, then move on.

### SAVE-AS-YOU-GO (CRITICAL)
After EVERY rep answer, you MUST call save_deal_data SILENTLY.
- If nothing changed, still call save_deal_data with rep_comments="No change stated".
- NEVER invent facts. Never overwrite evidence with blanks.

### FLOW
- If NEW DEAL: ask baseline MEDDPICC starter question(s) (but still save after each answer).
- If NOT NEW: focus ONLY on categories with score < 3.
- Ask about the first/lowest gap. Next question MUST be exactly:
"${gapQuestion}"

### SCORING RUBRIC (0-3 ONLY)
PAIN: 0=None, 1=Vague, 2=Clear, 3=Quantified ($$$).
METRICS: 0=Unknown, 1=Soft, 2=Rep-defined, 3=Customer-validated.
CHAMPION: 0=None, 1=Coach, 2=Mobilizer, 3=Champion (Power).
EB: 0=Unknown, 1=Identified, 2=Indirect, 3=Direct relationship.
CRITERIA: 0=Unknown, 1=Vague, 2=Defined, 3=Locked in favor.
PROCESS: 0=Unknown, 1=Assumed, 2=Understood, 3=Documented.
COMPETITION: 0=Unknown, 1=Assumed, 2=Identified, 3=Known edge.
PAPER: 0=Unknown, 1=Not started, 2=Known Started, 3=Waiting for Signature.
TIMING: 0=Unknown, 1=Assumed, 2=Flexible, 3=Real Consequence/Event.

### SUMMARY FORMAT
Summaries MUST be: "Label: evidence" (NO score numbers).
Example: "Customer-validated: Outages cost ~$2M per quarter."

### COMPLETION
Only when ready to leave the deal:
Say: "Health Score: [Sum]/27. Risk: [Top Risk]. NEXT_DEAL_TRIGGER."
You MUST say NEXT_DEAL_TRIGGER to advance.
`.trim();
}

/// ============================================================================
/// SECTION 9: HTTP server + WS server
/// ============================================================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
console.log("🌐 WebSocket server created");

/// ============================================================================
/// SECTION 10: WebSocket Server (Twilio WS <-> OpenAI WS)
/// ============================================================================
wss.on("connection", async (twilioWs) => {
  console.log("🔥 Twilio WebSocket connected");

  let streamSid = null;
  let orgId = 1;
  let repName = null;

  let dealQueue = [];
  let currentDealIndex = 0;

  let openAiReady = false;

  // minimal debouncing (no watchdog loops)
  let lastSpeechStoppedAt = 0;
  let awaitingModel = false;
  let sawToolCallSinceLastUserTurn = false;

  function safeSend(ws, payload) {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    } catch (e) {
      console.error("❌ WS send error:", e?.message || e);
    }
  }

  function kickModel(reason) {
    if (awaitingModel) return;
    awaitingModel = true;
    console.log(`⚡ response.create (${reason})`);
    safeSend(openAiWs, { type: "response.create" });
  }

  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  openAiWs.on("error", (err) => {
    console.error("❌ OpenAI WebSocket error:", err?.message || err);
  });

  openAiWs.on("unexpected-response", (req, res) => {
    console.error("❌ OpenAI WS unexpected response:", res?.statusCode, res?.statusMessage);
    console.error("Headers:", res?.headers);
  });

  openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");

    safeSend(openAiWs, {
      type: "session.update",
      session: {
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "verse",
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          silence_duration_ms: 600,
        },
        tools: [saveDealDataTool],
      },
    });

    openAiReady = true;
    attemptLaunch().catch((e) => console.error("❌ attemptLaunch error:", e));
  });

  /// ---------------- OpenAI inbound frames ----------------
  openAiWs.on("message", async (data) => {
    const parsed = safeJsonParse(data);
    if (!parsed.ok) {
      console.error("❌ OpenAI frame not JSON:", parsed.err?.message, "| head:", parsed.head);
      return;
    }
    const response = parsed.json;

    // VAD
    if (response.type === "input_audio_buffer.speech_started") {
      console.log("🗣️ VAD: speech_started");
      sawToolCallSinceLastUserTurn = false;
    }

    if (response.type === "input_audio_buffer.speech_stopped") {
      console.log("🗣️ VAD: speech_stopped");

      const now = Date.now();
      if (now - lastSpeechStoppedAt < 700) return;
      lastSpeechStoppedAt = now;

      awaitingModel = false;
      kickModel("speech_stopped");
    }

    try {
      // Tool args done
      if (response.type === "response.function_call_arguments.done") {
        const callId = response.call_id;

        const argsParsed = safeJsonParse(response.arguments || "{}");
        if (!argsParsed.ok) {
          console.error("❌ Tool args not JSON:", argsParsed.err?.message, "| head:", argsParsed.head);
          return;
        }

        const deal = dealQueue[currentDealIndex];
        if (!deal) {
          console.error("❌ Tool fired but no active deal (ignoring).");
          return;
        }

        sawToolCallSinceLastUserTurn = true;

        console.log(
          `🧾 SAVE ROUTE dealIndex=${currentDealIndex}/${Math.max(dealQueue.length - 1, 0)} id=${deal.id} account="${deal.account_name}" callId=${callId}`
        );
        console.log("🔎 args keys:", Object.keys(argsParsed.json));
        console.log("🔎 args preview:", compact(argsParsed.json, [
          "pain_score","metrics_score","champion_score","eb_score",
          "criteria_score","process_score","competition_score","paper_score","timing_score",
          "risk_summary","rep_comments",
        ]));

        await handleFunctionCall({ ...argsParsed.json, _deal: deal }, callId);
        applyArgsToLocalDeal(deal, argsParsed.json);

        // Ack tool output
        safeSend(openAiWs, {
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ status: "success" }),
          },
        });

        // IMPORTANT: keep the convo moving (prevents “saved then went dark”)
        awaitingModel = false;
        kickModel("post_tool_continue");
      }

      // response.done: allow next kick + handle NEXT_DEAL_TRIGGER
      if (response.type === "response.done") {
        awaitingModel = false;

        const transcript = (
          response.response?.output
            ?.flatMap((o) => o.content || [])
            .map((c) => c.transcript || c.text || "")
            .join(" ") || ""
        );

        if (transcript.includes("NEXT_DEAL_TRIGGER")) {
          console.log("🚀 NEXT_DEAL_TRIGGER detected. Advancing deal...");
          currentDealIndex++;

          if (currentDealIndex < dealQueue.length) {
            const nextDeal = dealQueue[currentDealIndex];
            console.log(`👉 Context switch -> id=${nextDeal.id} account="${nextDeal.account_name}"`);

            const instructions = getSystemPrompt(
              nextDeal,
              (repName || "Rep").split(" ")[0],
              dealQueue.length - 1 - currentDealIndex,
              dealQueue.length
            );

            safeSend(openAiWs, { type: "session.update", session: { instructions } });

            setTimeout(() => {
              awaitingModel = false;
              kickModel("next_deal_first_question");
            }, 500);
          } else {
            console.log("🏁 All deals done.");
          }
        }
      }

      // Audio out
      if (response.type === "response.audio.delta" && response.delta && streamSid) {
        twilioWs.send(JSON.stringify({
          event: "media",
          streamSid,
          media: { payload: response.delta },
        }));
      }
    } catch (err) {
      console.error("❌ OpenAI Message Handler Error:", err);
      awaitingModel = false;
    }
  });

  /// ---------------- Twilio inbound frames ----------------
  twilioWs.on("message", async (msg) => {
    const parsed = safeJsonParse(msg);
    if (!parsed.ok) {
      console.error("❌ Twilio frame not JSON:", parsed.err?.message, "| head:", parsed.head);
      return;
    }
    const data = parsed.json;

    try {
      if (data.event === "start") {
        streamSid = data.start?.streamSid || null;
        const params = data.start?.customParameters || {};

        orgId = parseInt(params.org_id, 10) || 1;
        repName = params.rep_name || "Guest";

        console.log("🎬 Stream started:", streamSid);
        console.log(`🔎 Rep: ${repName} | orgId=${orgId}`);

        await attemptLaunch();
      }

      if (data.event === "media" && data.media?.payload && openAiReady) {
        safeSend(openAiWs, {
          type: "input_audio_buffer.append",
          audio: data.media.payload,
        });
      }

      if (data.event === "stop") {
        console.log("🛑 Stream stopped:", streamSid);
        streamSid = null;
      }
    } catch (err) {
      console.error("❌ Twilio WS message handler error:", err);
    }
  });

  twilioWs.on("close", () => {
    console.log("🔌 Twilio WebSocket closed");
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
  });

  /// ---------------- Deal loading + initial prompt ----------------
  async function attemptLaunch() {
    if (!openAiReady || !repName) return;

    if (dealQueue.length === 0) {
      const result = await pool.query(
        `
        SELECT o.*, org.product_truths AS org_product_data
        FROM opportunities o
        JOIN organizations org ON o.org_id = org.id
        WHERE o.org_id = $1
          AND o.rep_name = $2
          AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost')
        ORDER BY o.id ASC
        `,
        [orgId, repName]
      );

      dealQueue = result.rows;
      currentDealIndex = 0;

      console.log(`📊 Loaded ${dealQueue.length} deals for ${repName}`);
      if (dealQueue[0]) {
        console.log(`👉 Starting deal -> id=${dealQueue[0].id} account="${dealQueue[0].account_name}"`);
      }
    }

    if (dealQueue.length === 0) {
      console.log("⚠️ No active deals found for this rep.");
      return;
    }

    const deal = dealQueue[currentDealIndex];
    const instructions = getSystemPrompt(
      deal,
      (repName || "Rep").split(" ")[0],
      dealQueue.length - 1,
      dealQueue.length
    );

    safeSend(openAiWs, { type: "session.update", session: { instructions } });

    setTimeout(() => {
      awaitingModel = false;
      kickModel("first_question");
    }, 500);
  }
});

/// ============================================================================
/// SECTION 11: START
/// ============================================================================
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
