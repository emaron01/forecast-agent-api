// server.js (ES module)
// Forecast Agent API — Twilio Media Streams <-> OpenAI Realtime WS
// Goals: stable turn-taking, save-as-you-go, deal-by-deal context, stage-aware prompt.

import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import pkg from "pg";
import twilio from "twilio";
import url from "url";

import { handleFunctionCall } from "./muscle.js";

const { Pool } = pkg;

const app = express();
app.use(express.json());

/* =========================
   ENV
========================= */
const PORT = process.env.PORT || 10000;

const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Example:
// MODEL_URL = "wss://api.openai.com/v1/realtime"
// MODEL_NAME = "gpt-4o-mini-realtime-preview-2024-12-17"
const MODEL_URL = process.env.MODEL_URL || "wss://api.openai.com/v1/realtime";
const MODEL_NAME = process.env.MODEL_NAME || "gpt-4o-mini-realtime-preview-2024-12-17";

/* =========================
   DB
========================= */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function getRepByPhone(phoneE164) {
  const q = `
    SELECT r.*, o.name AS org_name
    FROM reps r
    JOIN organizations o ON o.id = r.org_id
    WHERE r.phone_e164 = $1
      AND COALESCE(r.active, true) = true
    LIMIT 1;
  `;
  const res = await pool.query(q, [phoneE164]);
  return res.rows[0] || null;
}

async function loadDealsToReview(orgId, repId) {
  // Only review_now = true deals
  const q = `
    SELECT *
    FROM opportunities
    WHERE org_id = $1
      AND rep_id = $2
      AND COALESCE(review_now, false) = true
    ORDER BY
      (close_date IS NULL) ASC,
      close_date ASC,
      amount DESC,
      id ASC;
  `;
  const res = await pool.query(q, [orgId, repId]);
  return res.rows || [];
}

// Debug endpoint (matches your logs)
app.get("/debug/opportunities", async (req, res) => {
  try {
    const orgId = Number(req.query.org_id || 1);
    const q = `
      SELECT *
      FROM opportunities
      WHERE org_id = $1
      ORDER BY id ASC;
    `;
    const out = await pool.query(q, [orgId]);
    res.json(out.rows);
  } catch (e) {
    console.error("❌ /debug/opportunities error:", e?.message || e);
    res.status(500).json({ error: "debug query failed" });
  }
});

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => res.send("✅ Forecast Agent API is alive!"));

/* =========================
   TWILIO VOICE WEBHOOK
   Twilio -> POST /agent
   Returns TwiML to start Media Stream to /twilio
========================= */
app.post("/agent", async (req, res) => {
  try {
    const from = req.body?.From || req.body?.from || req.query?.From; // Twilio sends From
    console.log("📞 Incoming call from:", from);

    if (!from) {
      return res.status(400).send("Missing From");
    }

    const rep = await getRepByPhone(from);
    if (!rep) {
      console.log("❌ Rep not found for:", from);
      return res.status(404).send("Rep not found");
    }

    console.log(`✅ Identified Rep: ${rep.rep_name} (org_id=${rep.org_id})`);

    const wsUrl = new URL(`${req.protocol}://${req.get("host")}/twilio`);
    wsUrl.searchParams.set("org_id", String(rep.org_id));
    wsUrl.searchParams.set("rep_id", String(rep.id));
    wsUrl.searchParams.set("rep_name", rep.rep_name);

    const twiml = new twilio.twiml.VoiceResponse();
    const connect = twiml.connect();
    connect.stream({ url: wsUrl.toString() });

    res.type("text/xml").send(twiml.toString());
  } catch (e) {
    console.error("❌ /agent error:", e?.message || e);
    res.status(500).send("Server error");
  }
});

/* =========================
   OPENAI TOOL SCHEMA
   MEDDPICC + TB (Timing + Budget)
========================= */
const scoreInt = { type: "integer", minimum: 0, maximum: 3 };

const saveDealDataTool = {
  type: "function",
  name: "save_deal_data",
  description:
    "Save MEDDPICC+TB updates for the CURRENT deal only. Scores MUST be integers 0-3. Do not invent facts. Do not overwrite evidence with blanks.",
  parameters: {
    type: "object",
    properties: {
      pain_score: scoreInt,
      pain_summary: { type: "string" },
      pain_tip: { type: "string" },

      metrics_score: scoreInt,
      metrics_summary: { type: "string" },
      metrics_tip: { type: "string" },

      champion_score: scoreInt,
      champion_summary: { type: "string" },
      champion_tip: { type: "string" },
      champion_name: { type: "string" },
      champion_title: { type: "string" },

      eb_score: scoreInt,
      eb_summary: { type: "string" },
      eb_tip: { type: "string" },
      eb_name: { type: "string" },
      eb_title: { type: "string" },

      criteria_score: scoreInt,
      criteria_summary: { type: "string" },
      criteria_tip: { type: "string" },

      process_score: scoreInt,
      process_summary: { type: "string" },
      process_tip: { type: "string" },

      competition_score: scoreInt,
      competition_summary: { type: "string" },
      competition_tip: { type: "string" },

      paper_score: scoreInt,
      paper_summary: { type: "string" },
      paper_tip: { type: "string" },

      timing_score: scoreInt,
      timing_summary: { type: "string" },
      timing_tip: { type: "string" },

      budget_score: scoreInt,
      budget_summary: { type: "string" },
      budget_tip: { type: "string" },

      // optional; muscle.js may compute/overwrite deterministically
      risk_summary: { type: "string" },

      next_steps: { type: "string" },
      rep_comments: { type: "string" },
    },
    required: [],
  },
};

/* =========================
   SYSTEM PROMPT BUILDER
========================= */
function fmtMoney(amount) {
  const n = Number(amount || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function fmtCloseDate(d) {
  if (!d) return "TBD";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "TBD";
  return dt.toLocaleDateString();
}

function stageMode(stageRaw) {
  const s = String(stageRaw || "Pipeline");
  if (s.includes("Commit")) return "Commit";
  if (s.includes("Best")) return "Best Case";
  return "Pipeline";
}

function getStageStrategy(stage) {
  if (stage === "Commit") {
    return `
MODE: CLOSING ASSISTANT (Commit).
Goal: Protect the forecast (de-risk).
Logic: Scan for ANY category scored 0-2. Ask: "Why is this in Commit if <Category> is still a gap?"
Focus: EB + Paper + Process + Budget must be solid. If they aren't, Commit is not justified.
`.trim();
  }

  if (stage === "Best Case") {
    return `
MODE: DEAL STRATEGIST (Best Case).
Goal: Validate the upside.
Logic: Test the gaps blocking a move to Commit.
Focus: Champion strength, EB access, Paper/Process readiness, Budget confidence, Competitive edge.
`.trim();
  }

  return `
MODE: PIPELINE ANALYST (Pipeline).
Goal: Qualify or disqualify quickly.
Logic: FOUNDATION FIRST. Validate Pain, Metrics, Champion, Budget.
Constraint: IGNORE Paper/Legal/Contracts. Do not ask about contracts or redlines in Pipeline.
If Pain/Metrics/Budget are weak, the deal is not real enough—move on.
`.trim();
}

function pickLowestGapCategory(deal) {
  // MEDDPICC+TB order (foundation-first bias)
  const order = [
    "pain",
    "metrics",
    "champion",
    "budget",
    "eb",
    "criteria",
    "process",
    "competition",
    "paper",
    "timing",
  ];

  for (const cat of order) {
    const v = Number(deal?.[`${cat}_score`]);
    const score = Number.isFinite(v) ? v : 0;
    if (score < 3) return cat;
  }
  return "pain";
}

function buildDealSnapshotLine(deal) {
  const account = deal.account_name || "Unknown Account";
  const opp = deal.opportunity_name || "Opportunity";
  const stage = deal.forecast_stage || "Pipeline";
  const amountStr = fmtMoney(deal.amount);
  const closeDateStr = fmtCloseDate(deal.close_date);

  // Your required snapshot format
  return `Let’s look at ${account} — ${opp} — ${stage}, ${amountStr}, closing ${closeDateStr}.`;
}

function buildSessionGreeting(repName, totalCount, deal) {
  // Your required pickup greeting format
  const first = repName?.split(" ")?.[0] || repName || "there";
  const account = deal?.account_name || "Unknown Account";
  return `Hi ${first}. Matthew here. We're reviewing ${totalCount} deals. First up: ${account}.`;
}

function getSystemPrompt(deal, repName, totalCount, dealIndex) {
  const stage = stageMode(deal.forecast_stage);
  const stageInstructions = getStageStrategy(stage);

  const snapshotLine = buildDealSnapshotLine(deal);

  const lowestGap = pickLowestGapCategory(deal);

  // Keep it human, but not chatty. Spoken output is mainly questions + minimal framing.
  // IMPORTANT: We allow a 2-sentence opening for deal 1 only (greeting + snapshot).
  // After that, one-sentence snapshot at the start of each deal.
  const opening =
    dealIndex === 0
      ? `${buildSessionGreeting(repName, totalCount, deal)} ${snapshotLine}`
      : snapshotLine;

  // “Recap” instruction — model must NOT invent; use only stored summaries if present.
  const recapRule = `
If there are existing summaries/tips in the deal record, you MAY give a one-sentence recap using ONLY those fields.
Do not invent any facts. If summaries are empty, skip recap.
`.trim();

  return `
### ROLE
You are Matthew, a sales-leader-grade MEDDPICC+TB Auditor. You are an evaluator, not a motivational coach.

### HARD CONTEXT
You are auditing exactly:
- DEAL_ID: ${deal.id}
- ACCOUNT_NAME: ${deal.account_name}
- OPPORTUNITY_NAME: ${deal.opportunity_name || "Opportunity"}
Never use any other company/opportunity name unless the rep explicitly corrects it.

### OPENING (MANDATORY)
At the start of this deal, you MUST say exactly:
"${opening}"

${recapRule}

### STAGE STRATEGY
${stageInstructions}

### TURN RHYTHM (STABILITY)
- Ask ONE question at a time.
- Wait for the rep to answer.
- After the rep’s answer, call save_deal_data (silently) to update the scorecard.
- Then ask the next single question.

### QUESTION TARGETING
- Prioritize the lowest category with score < 3 (foundation-first order: pain, metrics, champion, budget, eb, criteria, process, competition, paper, timing).
- Your first question for this deal MUST target: ${lowestGap.toUpperCase()}.

### COMMUNICATION RULES (SALES-LEADER FEEL, NOT CHATTY)
- Sound like a supportive operator, not a boss.
- Do NOT lecture.
- Do NOT say “keep me posted” / “let me know”.
- Do NOT repeat back long paraphrases.
- Do NOT debate scores; decide silently.
- Spoken output should be: brief framing + one question.

### SCORING (0-3 ONLY)
PAIN: 0=None, 1=Vague, 2=Clear, 3=Quantified ($$$).
METRICS: 0=Unknown, 1=Soft, 2=Rep-defined, 3=Customer-validated.
CHAMPION: 0=None, 1=Coach, 2=Mobilizer, 3=Champion (Power).
EB: 0=Unknown, 1=Identified, 2=Indirect, 3=Direct relationship.
CRITERIA: 0=Unknown, 1=Vague, 2=Defined, 3=Locked in favor.
PROCESS: 0=Unknown, 1=Assumed, 2=Understood, 3=Documented.
COMPETITION: 0=Unknown, 1=Assumed, 2=Identified, 3=Known edge.
PAPER: 0=Unknown, 1=Not started, 2=Known started, 3=Waiting for signature / final sign-off.
TIMING: 0=Unknown, 1=Assumed, 2=Flexible, 3=Real consequence/event.
BUDGET: 0=Unknown, 1=Assumed, 2=Identified source/range, 3=Confirmed budget & fits.

### SAVE FORMAT RULES (IN TOOL CALL)
- Summaries: concise evidence (do NOT include “Score X”).
- If you learned nothing new for a category, do not overwrite existing summary with blanks.
- Extract name/title for Champion and EB when you have it.

### DEAL EXIT
Only when leaving the deal, say:
"Health Score: [Sum]/30. Risk: [Top Risk]. NEXT_DEAL_TRIGGER."
(30 max because MEDDPICC + Timing + Budget)
You MUST say NEXT_DEAL_TRIGGER to advance.
`.trim();
}

/* =========================
   SERVER + WS
========================= */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/twilio" });

function safeJsonParse(data) {
  try {
    const s = typeof data === "string" ? data : data.toString("utf8");
    return { ok: true, json: JSON.parse(s) };
  } catch (err) {
    const head =
      typeof data === "string"
        ? data.slice(0, 200)
        : data?.toString?.("utf8")?.slice(0, 200);
    return { ok: false, err, head };
  }
}

function safeSend(ws, payload) {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  } catch (e) {
    console.error("❌ WS send error:", e?.message || e);
  }
}

wss.on("connection", async (twilioWs, req) => {
  console.log("🔥 Twilio WebSocket connected");

  const parsedUrl = url.parse(req.url, true);
  const orgId = Number(parsedUrl.query.org_id || 1);
  const repId = Number(parsedUrl.query.rep_id || 0);
  const repName = String(parsedUrl.query.rep_name || "Rep");

  let streamSid = null;

  // Deal state
  let dealQueue = [];
  let currentDealIndex = 0;

  // Model state
  let openAiReady = false;
  let awaitingModel = false;
  let lastKickAt = 0;

  const openAiWs = new WebSocket(`${MODEL_URL}?model=${encodeURIComponent(MODEL_NAME)}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  openAiWs.on("error", (err) => {
    console.error("❌ OpenAI WebSocket error:", err?.message || err);
  });

  openAiWs.on("unexpected-response", (req0, res0) => {
    console.error("❌ OpenAI WS unexpected response:", res0?.statusCode, res0?.statusMessage);
    console.error("Headers:", res0?.headers);
  });

  function kickModel(reason = "kick") {
    const now = Date.now();
    if (!openAiReady) return;
    if (awaitingModel) return;

    // small debounce to avoid response storms
    if (now - lastKickAt < 250) return;
    lastKickAt = now;

    awaitingModel = true;
    console.log(`⚡ response.create (${reason})`);
    safeSend(openAiWs, { type: "response.create" });
  }

  async function loadAndStart() {
    dealQueue = await loadDealsToReview(orgId, repId);

    console.log(`📊 Loaded ${dealQueue.length} deals for ${repName} (review_now=true)`);
    if (!dealQueue.length) {
      // Nothing to review — say something short and end
      safeSend(openAiWs, {
        type: "session.update",
        session: {
          instructions:
            `You are Matthew. Say: "Hi ${repName.split(" ")[0] || repName}. No deals are marked for review right now."`,
        },
      });
      awaitingModel = false;
      kickModel("no_deals");
      return;
    }

    currentDealIndex = 0;
    const deal = dealQueue[currentDealIndex];
    console.log(`👉 Starting deal -> id=${deal.id} account="${deal.account_name}"`);

    const instructions = getSystemPrompt(deal, repName, dealQueue.length, currentDealIndex);

    safeSend(openAiWs, {
      type: "session.update",
      session: { instructions },
    });

    awaitingModel = false;
    kickModel("first_question");
  }

  openAiWs.on("open", () => {
    console.log("📡 OpenAI Connected");

    // Session init: ulaw + voice + VAD + tools
    safeSend(openAiWs, {
      type: "session.update",
      session: {
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "verse",
        // IMPORTANT: slightly longer silence to reduce cutoffs/interruptions
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          silence_duration_ms: 900,
        },
        tools: [saveDealDataTool],
      },
    });

    openAiReady = true;
    loadAndStart().catch((e) => console.error("❌ loadAndStart error:", e));
  });

  /* =========================
     OpenAI inbound frames
  ========================= */
  openAiWs.on("message", async (data) => {
    const parsed = safeJsonParse(data);
    if (!parsed.ok) {
      console.error("❌ OpenAI frame not JSON:", parsed.err?.message, "| head:", parsed.head);
      return;
    }

    const msg = parsed.json;

    try {
      // Model VAD events (server_vad)
      if (msg.type === "input_audio_buffer.speech_started") {
        // Rep started speaking — we should not kick model
        // (No-op; just breadcrumbs)
        return;
      }

      if (msg.type === "input_audio_buffer.speech_stopped") {
        // Rep stopped speaking — ask model to respond
        awaitingModel = false;
        kickModel("speech_stopped");
        return;
      }

      // Tool call args complete
      if (msg.type === "response.function_call_arguments.done") {
        const callId = msg.call_id;

        const argsParsed = safeJsonParse(msg.arguments || "{}");
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

        await handleFunctionCall({ ...argsParsed.json, _deal: deal }, callId);

        // Ack tool output so the model can proceed
        safeSend(openAiWs, {
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ status: "success" }),
          },
        });

        // Nudge the model forward (prevents “save then silence”)
        awaitingModel = false;
        kickModel("post_tool_continue");
        return;
      }

      // Response done: detect NEXT_DEAL_TRIGGER and swap context
      if (msg.type === "response.done") {
        awaitingModel = false;

        const transcript =
          msg.response?.output
            ?.flatMap((o) => o.content || [])
            .map((c) => c.transcript || c.text || "")
            .join(" ") || "";

        if (transcript.includes("NEXT_DEAL_TRIGGER")) {
          console.log("🚀 NEXT_DEAL_TRIGGER detected. Advancing deal...");

          currentDealIndex += 1;

          if (currentDealIndex < dealQueue.length) {
            const nextDeal = dealQueue[currentDealIndex];
            console.log(`👉 Context switch -> id=${nextDeal.id} account="${nextDeal.account_name}"`);

            const instructions = getSystemPrompt(
              nextDeal,
              repName,
              dealQueue.length,
              currentDealIndex
            );

            safeSend(openAiWs, {
              type: "session.update",
              session: { instructions },
            });

            awaitingModel = false;
            kickModel("next_deal_first_question");
          } else {
            console.log("🏁 All deals done.");
          }
        }

        return;
      }

      // Audio out (model -> Twilio)
      if (msg.type === "response.audio.delta" && msg.delta && streamSid) {
        twilioWs.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: msg.delta },
          })
        );
        return;
      }
    } catch (err) {
      console.error("❌ OpenAI inbound handler error:", err?.message || err);
      awaitingModel = false;
    }
  });

  /* =========================
     Twilio inbound frames
  ========================= */
  twilioWs.on("message", (data) => {
    const parsed = safeJsonParse(data);
    if (!parsed.ok) return;

    const msg = parsed.json;

    if (msg.event === "start") {
      streamSid = msg.start?.streamSid;
      console.log("🎬 Stream started:", streamSid, "| Rep:", repName, "| orgId:", orgId);
      return;
    }

    if (msg.event === "media") {
      // Forward audio payload to OpenAI input buffer
      if (!openAiReady) return;

      safeSend(openAiWs, {
        type: "input_audio_buffer.append",
        audio: msg.media.payload,
      });
      return;
    }

    if (msg.event === "stop") {
      console.log("🛑 Stream stopped:", streamSid);
      try {
        if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      } catch {}
      return;
    }
  });

  twilioWs.on("close", () => {
    console.log("🔌 Twilio WebSocket closed");
    try {
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
    } catch {}
  });

  twilioWs.on("error", (e) => {
    console.error("❌ Twilio WS error:", e?.message || e);
    try {
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
    } catch {}
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server listening on ${PORT}`);
});
