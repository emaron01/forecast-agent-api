/// server.js (ES module)
/// Forecast Agent Conductor: Twilio <Stream> + OpenAI Realtime + deal queue + tool routing.
/// Notes:
/// - server.js is READ-ONLY to DB (writes happen in db.js via muscle.js)
/// - No watchdogs. Stability first: rep speaks -> SAVE -> next question (server enforced).

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
const MODEL_NAME = process.env.MODEL_NAME;        // model id
const OPENAI_API_KEY = process.env.MODEL_API_KEY; // key
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

function safeSend(ws, payload) {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  } catch (e) {
    console.error("❌ WS send error:", e?.message || e);
  }
}

/// Deterministic category order
const CATEGORY_ORDER = [
  { name: "Pain", key: "pain_score" },
  { name: "Metrics", key: "metrics_score" },
  { name: "Champion", key: "champion_score" },
  { name: "Economic Buyer", key: "eb_score" },
  { name: "Decision Criteria", key: "criteria_score" },
  { name: "Decision Process", key: "process_score" },
  { name: "Competition", key: "competition_score" },
  { name: "Paper Process", key: "paper_score" },
  { name: "Timing", key: "timing_score" },
];

function scoreVal(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function findNextGap(deal) {
  // Focus ONLY on < 3
  for (const c of CATEGORY_ORDER) {
    if (scoreVal(deal?.[c.key]) < 3) return c;
  }
  return null; // no gaps
}

function applyArgsToLocalDeal(deal, args) {
  // keep in-memory queue aligned with DB for next gap selection
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
/// SECTION 5: TWILIO WEBHOOK (/agent)
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
/// SECTION 6: DEBUG / DASHBOARD SUPPORT (READ-ONLY + local CORS)
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

    let query = `
      SELECT *
      FROM opportunities
      WHERE org_id = $1
    `;
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
/// SECTION 7: HTTP SERVER + WS SERVER
/// ============================================================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
console.log("🌐 WebSocket server created");

/// ============================================================================
/// SECTION 8: OpenAI Tool Schema (save_deal_data) — hard score guardrails
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
      risk_summary: { type: "string" },
      next_steps: { type: "string" },
      rep_comments: { type: "string" },
    },
    required: [],
  },
};

/// ============================================================================
/// SECTION 9: Prompt builders (SPEAK vs TOOL-ONLY save)
/// IMPORTANT: server enforces ordering; prompt is secondary.
/// ============================================================================
function buildSpeakPrompt(deal, repFirstName, totalCount, dealIndex, gap) {
  const runCount = Number(deal.run_count) || 0;
  const isNewDeal = runCount === 0;

  const amountStr = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(deal.amount || 0));

  const stage = deal.forecast_stage || "Pipeline";
  const closeDateStr = deal.close_date ? new Date(deal.close_date).toLocaleDateString() : "TBD";

  const isSessionStart = dealIndex === 0;

  // Opening line (spoken)
  let openingLine = "";
  if (isSessionStart) {
    openingLine = `Hi ${repFirstName}. This is Matthew. We will review ${totalCount} opportunities, starting with ${deal.account_name}.`;
  } else {
    openingLine = `Next deal: ${deal.account_name}.`;
  }

  // New deal: do NOT ask "what changed"
  if (isNewDeal) {
    openingLine += ` It's ${stage} for ${amountStr}, closing ${closeDateStr}. What is the specific customer problem and the quantified impact?`;
  } else {
    openingLine += ` It's ${stage} for ${amountStr}.`;
  }

  // Question (spoken) — always category-specific
  const question = isNewDeal
    ? `For ${gap.name}, what is the best current evidence?`
    : `Has anything changed since last review regarding ${gap.name}?`;

  return `
### ROLE
You are Matthew, a MEDDPICC Auditor. You are an extractor, not a coach.

### HARD CONTEXT
DEAL_ID: ${deal.id}
ACCOUNT_NAME: ${deal.account_name}
Never change the account name unless the rep explicitly corrects it.

### SPOKEN OUTPUT RULES (STRICT)
- Speak ONE sentence ending with a question mark.
- Do NOT repeat or paraphrase the rep.
- Do NOT debate scoring.
- Do NOT give coaching.

### DATA RULES
- Capture evidence in summaries, not chatter.

### YOU MUST SPEAK EXACTLY THIS OPENING + QUESTION:
"${openingLine} ${question}"
`.trim();
}

function buildToolOnlySavePrompt(deal, gap) {
  // This is never spoken (tools only)
  // Goal: after rep answers, save updates for CURRENT gap only.
  const gapKeyPrefix = gap.key.replace("_score", ""); // e.g. pain_score -> pain
  const scoreField = `${gapKeyPrefix}_score`;
  const summaryField = `${gapKeyPrefix}_summary`;
  const tipField = `${gapKeyPrefix}_tip`;

  return `
### TOOL-ONLY MODE (NO SPEECH)
You must call save_deal_data NOW.
Do not speak. Do not output text.

CURRENT DEAL:
- DEAL_ID: ${deal.id}
- ACCOUNT_NAME: ${deal.account_name}

CURRENT CATEGORY:
- ${gap.name}

REQUIREMENTS:
- Update ONLY these fields if you have evidence: ${scoreField}, ${summaryField}, ${tipField}.
- Summaries must be raw evidence; muscle.js will add label prefix.
- If no evidence was provided, set rep_comments="No change stated" ONLY.
- Scores must be integers 0-3.
- Do not invent facts.
`.trim();
}

/// ============================================================================
/// SECTION 10: WS CORE (Twilio <-> OpenAI) — stability-first two-phase gating
/// ============================================================================
wss.on("connection", async (twilioWs) => {
  console.log("🔥 Twilio WebSocket connected");

  let streamSid = null;
  let orgId = 1;
  let repName = null;

  let dealQueue = [];
  let currentDealIndex = 0;

  // Phase control
  // asking: tools disabled, model speaks 1 question
  // saving: tools enabled, model must call tool, no speech
  let phase = "idle";
  let saveInProgress = false;
  let currentGap = null;

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

    // Session init: ulaw + voice + VAD
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
        // tools are intentionally NOT always enabled (we gate by phase)
        tools: [],
      },
    });
  });

  /// ---------------- OpenAI inbound frames ----------------
  openAiWs.on("message", async (data) => {
    const parsed = safeJsonParse(data);
    if (!parsed.ok) {
      console.error("❌ OpenAI frame not JSON:", parsed.err?.message, "| head:", parsed.head);
      return;
    }
    const response = parsed.json;

    // VAD: rep started speaking
    if (response.type === "input_audio_buffer.speech_started") {
      // nothing: we just wait for speech_stopped
    }

    // VAD: rep finished speaking -> enter SAVE phase immediately
    if (response.type === "input_audio_buffer.speech_stopped") {
      if (phase !== "asking") return;   // ignore if not expecting rep
      if (saveInProgress) return;       // guard

      const deal = dealQueue[currentDealIndex];
      if (!deal || !currentGap) return;

      saveInProgress = true;
      phase = "saving";

      // Enable tool + tool-only instructions
      safeSend(openAiWs, {
        type: "session.update",
        session: {
          tools: [saveDealDataTool],
          instructions: buildToolOnlySavePrompt(deal, currentGap),
        },
      });

      // Force model to produce tool call
      safeSend(openAiWs, { type: "response.create" });
      return;
    }

    // Tool call args complete -> save -> ask next question
    if (response.type === "response.function_call_arguments.done") {
      if (!saveInProgress || phase !== "saving") {
        console.warn("⚠️ Ignoring tool call (not in save phase).");
        return;
      }

      const callId = response.call_id;
      const argsParsed = safeJsonParse(response.arguments || "{}");
      if (!argsParsed.ok) {
        console.error("❌ Tool args not JSON:", argsParsed.err?.message, "| head:", argsParsed.head);
        saveInProgress = false;
        phase = "asking";
        return;
      }

      const deal = dealQueue[currentDealIndex];
      if (!deal) {
        console.error("❌ Tool fired but no active deal (ignoring).");
        saveInProgress = false;
        phase = "asking";
        return;
      }

      console.log(
        `🧾 SAVE ROUTE dealIndex=${currentDealIndex}/${Math.max(dealQueue.length - 1, 0)} id=${deal.id} account="${deal.account_name}" callId=${callId}`
      );
      console.log("🔎 args keys:", Object.keys(argsParsed.json));
      console.log(
        "🔎 args preview:",
        compact(argsParsed.json, [
          "pain_score","metrics_score","champion_score","eb_score",
          "criteria_score","process_score","competition_score","paper_score","timing_score",
          "risk_summary","rep_comments",
        ])
      );

      try {
        await handleFunctionCall({ ...argsParsed.json, _deal: deal }, callId);
        applyArgsToLocalDeal(deal, argsParsed.json);

        // ack tool output
        safeSend(openAiWs, {
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ status: "success" }),
          },
        });
      } catch (err) {
        console.error("❌ handleFunctionCall failed:", err?.message || err);
      }

      // Release save barrier
      saveInProgress = false;

      // Recompute next gap on current deal
      currentGap = findNextGap(dealQueue[currentDealIndex]);

      // If no gaps remain, advance deal
      if (!currentGap) {
        currentDealIndex++;
        if (currentDealIndex >= dealQueue.length) {
          console.log("🏁 All deals done.");
          phase = "idle";
          return;
        }
      }

      const nextDeal = dealQueue[currentDealIndex];
      currentGap = findNextGap(nextDeal) || CATEGORY_ORDER[0];

      const repFirst = (repName || "Rep").split(" ")[0];

      // Disable tools while speaking
      safeSend(openAiWs, {
        type: "session.update",
        session: {
          tools: [],
          instructions: buildSpeakPrompt(nextDeal, repFirst, dealQueue.length, currentDealIndex, currentGap),
        },
      });

      phase = "asking";
      safeSend(openAiWs, { type: "response.create" });
      return;
    }

    // Audio out (model -> Twilio)
    if (response.type === "response.audio.delta" && response.delta && streamSid) {
      twilioWs.send(JSON.stringify({
        event: "media",
        streamSid,
        media: { payload: response.delta },
      }));
    }
  });

  /// ---------------- Twilio inbound frames (rep audio) ----------------
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

      if (data.event === "media" && data.media?.payload) {
        // Send rep audio to OpenAI
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

  /// ---------------- Deal loading + initial question ----------------
  async function attemptLaunch() {
    if (!repName) return;
    if (openAiWs.readyState !== WebSocket.OPEN) return;

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
    currentGap = findNextGap(deal) || CATEGORY_ORDER[0];

    const repFirst = (repName || "Rep").split(" ")[0];

    safeSend(openAiWs, {
      type: "session.update",
      session: {
        tools: [], // ask mode => no tools
        instructions: buildSpeakPrompt(deal, repFirst, dealQueue.length, currentDealIndex, currentGap),
      },
    });

    phase = "asking";
    safeSend(openAiWs, { type: "response.create" });
  }
});

/// ============================================================================
/// SECTION 11: START
/// ============================================================================
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
