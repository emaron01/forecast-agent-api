// server.js (ES module)
/// Forecast Agent Conductor: Twilio <Stream> + OpenAI Realtime + deterministic deal/category flow.
/// KEY DESIGN:
/// - Server chooses category each turn (no model drift).
/// - After rep speaks: force a silent tool-only pass to save.
/// - After save: force a speak-only pass to ask next question.
/// - No watchdog loops.

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

function safeSend(ws, payload) {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  } catch (e) {
    console.error("❌ WS send error:", e?.message || e);
  }
}

function compact(obj, keys) {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out;
}

function applyArgsToLocalDeal(deal, args) {
  // Keep local copy aligned so gap selection stays deterministic.
  for (const [k, v] of Object.entries(args || {})) {
    if (v !== undefined) deal[k] = v;
  }
}

const CATEGORY_ORDER = [
  { key: "pain", name: "Pain" },
  { key: "metrics", name: "Metrics" },
  { key: "champion", name: "Champion" },
  { key: "eb", name: "Economic Buyer" },
  { key: "criteria", name: "Decision Criteria" },
  { key: "process", name: "Decision Process" },
  { key: "competition", name: "Competition" },
  { key: "paper", name: "Paper Process" },
  { key: "timing", name: "Timing" },
];

function scoreKey(catKey) {
  return `${catKey}_score`;
}

function findNextGap(deal) {
  // First category with score < 3, deterministic order.
  for (const c of CATEGORY_ORDER) {
    const v = Number(deal?.[scoreKey(c.key)] ?? 0);
    if (v < 3) return c;
  }
  return null;
}

function dealHeader(deal, repFirstName, totalCount, idx) {
  const amountStr = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(deal.amount || 0);

  const closeDateStr = deal.close_date ? new Date(deal.close_date).toLocaleDateString() : "TBD";
  const stage = deal.forecast_stage || "Pipeline";
  const n = idx + 1;

  return `Hi ${repFirstName}. Deal ${n} of ${totalCount}: ${deal.account_name}. ${stage} for ${amountStr}, closing ${closeDateStr}.`;
}

/// ============================================================================
/// SECTION 4: EXPRESS
/// ============================================================================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // REQUIRED for Twilio

app.get("/", (req, res) => res.send("✅ Forecast Agent API is alive!"));

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
/// SECTION 5: DEBUG endpoint (optional)
/// ============================================================================
app.use("/debug/opportunities", (req, res, next) => {
  const origin = req.headers.origin || "";
  const isLocal = origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");
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
/// SECTION 6: HTTP + WS
/// ============================================================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
console.log("🌐 WebSocket server created");

/// ============================================================================
/// SECTION 7: TOOL SCHEMA (hard score guardrails)
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
/// SECTION 8: PROMPT BUILDERS (two-phase)
/// ============================================================================
function baseDiscipline(deal) {
  return `
### ROLE
You are Matthew, a MEDDPICC Auditor. You are an extractor, not a coach.

### HARD CONTEXT
DEAL_ID: ${deal.id}
ACCOUNT_NAME: ${deal.account_name}

### SPEECH RULES (ANTI-CHATTY)
- Never repeat/paraphrase the rep.
- Never ask the rep what score they would give.
- Never debate scores.
- Spoken output must be ONE sentence ending with a question mark.
- No tips verbally. Tips go into saved fields only.

### SUMMARY FORMAT
Summaries must be "Label: evidence" (no score numbers).

### SCORING (0-3)
PAIN 0=None 1=Vague 2=Clear 3=Quantified ($$$)
METRICS 0=Unknown 1=Soft 2=Rep-defined 3=Customer-validated
CHAMPION 0=None 1=Coach 2=Mobilizer 3=Champion (Power)
EB 0=Unknown 1=Identified 2=Indirect 3=Direct relationship
CRITERIA 0=Unknown 1=Vague 2=Defined 3=Locked in favor
PROCESS 0=Unknown 1=Assumed 2=Understood 3=Documented
COMPETITION 0=Unknown 1=Assumed 2=Identified 3=Known edge
PAPER 0=Unknown 1=Not started 2=Known Started 3=Waiting for Signature
TIMING 0=Unknown 1=Assumed 2=Flexible 3=Real Consequence/Event
`.trim();
}

function questionForGap(deal, repFirstName, totalCount, idx, gap) {
  const header = dealHeader(deal, repFirstName, totalCount, idx);
  const q = `Has anything changed since last review regarding ${gap.name}?`;
  return `
${baseDiscipline(deal)}

### OPENING
You MUST say exactly:
"${header} ${q}"
`.trim();
}

function questionForNewDeal(deal, repFirstName, totalCount, idx) {
  const header = dealHeader(deal, repFirstName, totalCount, idx);
  const q = "New deal: what product are we selling and what specific customer problem are we solving?";
  return `
${baseDiscipline(deal)}

### OPENING
You MUST say exactly:
"${header} ${q}"
`.trim();
}

function toolOnlyInstruction(deal, gap) {
  return `
${baseDiscipline(deal)}

### TOOL-ONLY MODE (MANDATORY)
You MUST call save_deal_data now.
- Do NOT speak.
- Update ONLY the relevant category (${gap ? gap.name : "current"}) based on the rep’s last answer.
- If rep said "no change", save rep_comments="No change stated" and do NOT overwrite other fields with blanks.
`.trim();
}

/// ============================================================================
/// SECTION 9: WS CORE
/// ============================================================================
wss.on("connection", async (twilioWs) => {
  console.log("🔥 Twilio WebSocket connected");

  let streamSid = null;
  let orgId = 1;
  let repName = null;

  let dealQueue = [];
  let currentDealIndex = 0;

  let openAiReady = false;

  // Turn state
  let currentGap = null;
  let phase = "idle"; // "idle" | "waiting_tool" | "waiting_question"

  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  openAiWs.on("error", (err) => {
    console.error("❌ OpenAI WebSocket error:", err?.message || err);
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

    // When rep finishes speaking, run tool-only pass (Phase A).
    if (response.type === "input_audio_buffer.speech_stopped") {
      if (phase !== "waiting_question") {
        // only commit to tool pass when we were actually expecting rep speech
        return;
      }

      phase = "waiting_tool";

      const deal = dealQueue[currentDealIndex];
      if (!deal) return;

      // Force a silent tool-only turn.
      safeSend(openAiWs, {
        type: "session.update",
        session: {
          instructions: toolOnlyInstruction(deal, currentGap),
        },
      });

      safeSend(openAiWs, { type: "response.create" });
      return;
    }

    try {
      // Tool call args complete => save => ask next question (Phase B)
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

        // Save
        await handleFunctionCall({ ...argsParsed.json, _deal: deal }, callId);

        // Sync local memory for deterministic next gap selection
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

        // Next: choose next gap and ask exactly one question
        currentGap = findNextGap(deal);

        // If no gaps left, advance deal.
        if (!currentGap) {
          currentDealIndex++;
          if (currentDealIndex >= dealQueue.length) {
            console.log("🏁 All deals done.");
            return;
          }
        }

        const nextDeal = dealQueue[currentDealIndex];
        const repFirst = (repName || "Rep").split(" ")[0];

        const runCount = Number(nextDeal.run_count) || 0;
        const isNewDeal = runCount === 0;

        currentGap = findNextGap(nextDeal);

        const nextInstructions = isNewDeal
          ? questionForNewDeal(nextDeal, repFirst, dealQueue.length, currentDealIndex)
          : questionForGap(nextDeal, repFirst, dealQueue.length, currentDealIndex, currentGap || CATEGORY_ORDER[0]);

        safeSend(openAiWs, {
          type: "session.update",
          session: { instructions: nextInstructions },
        });

        phase = "waiting_question";
        safeSend(openAiWs, { type: "response.create" });
      }

      // Audio out (model -> Twilio)
      if (response.type === "response.audio.delta" && response.delta && streamSid) {
        twilioWs.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: response.delta },
          })
        );
      }

      // If model "finishes" but didn't tool-call while we were waiting_tool, just stop.
      // This prevents watchdog storms. The rep can answer again, or you can hang up.
      if (response.type === "response.done") {
        // If we were waiting_tool and it didn't call tool, don't loop.
        // (You will see it immediately in logs; simplest stable behavior.)
      }
    } catch (err) {
      console.error("❌ OpenAI Message Handler Error:", err);
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

  /// ---------------- Deal loading + first question ----------------
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
    const repFirst = (repName || "Rep").split(" ")[0];

    const runCount = Number(deal.run_count) || 0;
    const isNewDeal = runCount === 0;

    currentGap = findNextGap(deal);

    const instructions = isNewDeal
      ? questionForNewDeal(deal, repFirst, dealQueue.length, currentDealIndex)
      : questionForGap(deal, repFirst, dealQueue.length, currentDealIndex, currentGap || CATEGORY_ORDER[0]);

    safeSend(openAiWs, {
      type: "session.update",
      session: { instructions },
    });

    phase = "waiting_question";
    console.log("⚡ response.create (first_question)");
    safeSend(openAiWs, { type: "response.create" });
  }
});

/// ============================================================================
/// SECTION 10: START
/// ============================================================================
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
