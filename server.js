// server.js (ESM) — Stable Realtime (Twilio <-> OpenAI) with single in-flight response guard
import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import pkg from "pg";
import { handleFunctionCall } from "./muscle.js";

const { Pool } = pkg;

const PORT = process.env.PORT || 10000;
const MODEL_URL = process.env.MODEL_API_URL;      // e.g. wss://api.openai.com/v1/realtime
const MODEL_NAME = process.env.MODEL_NAME;        // e.g. gpt-4o-mini-realtime-preview-2024-12-17
const OPENAI_API_KEY = process.env.MODEL_API_KEY; // your key
const DATABASE_URL = process.env.DATABASE_URL;

if (!MODEL_URL || !MODEL_NAME || !OPENAI_API_KEY) {
  throw new Error("MODEL_API_URL, MODEL_NAME, MODEL_API_KEY must be set.");
}
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio sends urlencoded

app.get("/", (req, res) => res.send("✅ Forecast Agent API is alive!"));

// Twilio webhook -> TwiML to start <Stream>
app.post("/agent", async (req, res) => {
  try {
    const callerPhone = req.body.From || null;
    console.log("📞 Incoming call from:", callerPhone);

    // Identify rep + org
    const r = await pool.query(
      "SELECT org_id, rep_name FROM opportunities WHERE rep_phone = $1 LIMIT 1",
      [callerPhone]
    );

    let orgId = 1;
    let repName = "Rep";
    if (r.rows.length) {
      orgId = r.rows[0].org_id || 1;
      repName = r.rows[0].rep_name || "Rep";
      console.log(`✅ Identified Rep: ${repName} (org_id=${orgId})`);
    }

    const wsUrl = `wss://${req.headers.host}/`;
    res.type("text/xml").send(
      `<Response>
         <Connect>
           <Stream url="${wsUrl}">
             <Parameter name="org_id" value="${orgId}" />
             <Parameter name="rep_name" value="${repName}" />
             <Parameter name="caller" value="${callerPhone || ""}" />
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

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/**
 * Tool schema (Realtime)
 * - name MUST match what the model calls
 */
const saveDealDataTool = {
  type: "function",
  name: "save_deal_data",
  description:
    "Persist scorecard updates for the CURRENT deal only. Provide only changed fields; do not blank out existing data.",
  parameters: {
    type: "object",
    additionalProperties: true,
    properties: {
      // scores + summaries + tips (your db supports more fields; model may send a subset)
      pain_score: { type: "integer" },
      pain_summary: { type: "string" },
      pain_tip: { type: "string" },

      metrics_score: { type: "integer" },
      metrics_summary: { type: "string" },
      metrics_tip: { type: "string" },

      champion_score: { type: "integer" },
      champion_summary: { type: "string" },
      champion_tip: { type: "string" },
      champion_name: { type: "string" },
      champion_title: { type: "string" },

      eb_score: { type: "integer" },
      eb_summary: { type: "string" },
      eb_tip: { type: "string" },
      eb_name: { type: "string" },
      eb_title: { type: "string" },

      criteria_score: { type: "integer" },
      criteria_summary: { type: "string" },
      criteria_tip: { type: "string" },

      process_score: { type: "integer" },
      process_summary: { type: "string" },
      process_tip: { type: "string" },

      competition_score: { type: "integer" },
      competition_summary: { type: "string" },
      competition_tip: { type: "string" },

      paper_score: { type: "integer" },
      paper_summary: { type: "string" },
      paper_tip: { type: "string" },

      timing_score: { type: "integer" },
      timing_summary: { type: "string" },
      timing_tip: { type: "string" },

      budget_score: { type: "integer" },
      budget_summary: { type: "string" },
      budget_tip: { type: "string" },

      risk_summary: { type: "string" },
      next_steps: { type: "string" },
      rep_comments: { type: "string" },
      ai_forecast: { type: "string" },
    },
  },
};

function safeJsonParse(input) {
  try {
    return { ok: true, json: JSON.parse(input) };
  } catch (e) {
    const head = String(input || "").slice(0, 220);
    return { ok: false, err: e, head };
  }
}

function formatUSD(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount || "");
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatCloseDate(d) {
  if (!d) return "Unknown date";
  // d may be Date, ISO, or YYYY-MM-DD
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const yyyy = dt.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * SYSTEM PROMPT (per deal)
 * - You asked to keep pipeline/best case/commit “sales leader logic”
 * - Deal opening is mandatory and must be spoken exactly
 * - Coaching stays in the scorecard (tool saves); voice is for questions only
 */
function getSystemPrompt({
  deal,
  repFirstName,
  totalCount,
  remainingCount,
  isFirstDeal,
}) {
  const acct = deal.account_name || "Unknown Account";
  const opp = deal.opportunity_name || "Unknown Opportunity";
  const stage = deal.forecast_stage || deal.ai_forecast || "Pipeline";
  const amt = formatUSD(deal.amount);
  const close = formatCloseDate(deal.close_date);

  const greeting = isFirstDeal
    ? `Hi ${repFirstName}. Matthew here. We're reviewing ${totalCount} deals. First up: ${acct}.`
    : "";

  // Stage strategy (keep your intent; don’t ask “paper/legal” on early pipeline)
  let stageInstructions = "";
  if (String(stage).toLowerCase().includes("commit")) {
    stageInstructions = `
MODE: CLOSING ASSISTANT (Commit)
- Goal: Protect the forecast (de-risk).
- Logic: Scan for any 0–2. Ask: “Why is this in Commit if <Category> is still a gap?”
- Focus: EB + Paper + Process must be solid.`;
  } else if (String(stage).toLowerCase().includes("best")) {
    stageInstructions = `
MODE: DEAL STRATEGIST (Best Case)
- Goal: Validate the upside.
- Logic: Test the gaps preventing a move to Commit.
- Focus: Champion strength + EB access + Paper/Process readiness.`;
  } else {
    stageInstructions = `
MODE: PIPELINE ANALYST (Pipeline)
- Goal: Qualify or disqualify quickly.
- FOUNDATION FIRST: Pain, Metrics, Champion, Budget, Timing.
- Constraint: IGNORE PAPERWORK & LEGAL unless rep says it has progressed meaningfully.`;
  }

  return `
You are Matthew, a sales leader running a fast, supportive forecast review.

VOICE RULES
- Be conversational, not chatty. No “boss” language (“keep me updated”, etc.).
- Talking is for questioning and clarifying. Do NOT read coaching tips aloud.
- If unsure which category a rep’s update belongs to, ask a single clarifier.

SAVE RULE (CRITICAL)
- After EACH rep answer, you MUST call the tool save_deal_data with the relevant updates.
- Then continue with the next question.
- You ONLY advance deals when you say NEXT_DEAL_TRIGGER.

DEAL OPENING (MANDATORY)
At the start of THIS deal, say exactly:
“Let’s look at ${acct} — ${opp} — ${stage}, ${amt}, closing ${close}.”

${greeting}

CONTEXT (existing scorecard)
- Use the current deal fields as ground truth; don’t invent.
- Ask about gaps and changes since last review ONLY when appropriate to stage strategy.
- If category is already a 3, only ask “anything changed?” at the end.

FLOW
1) Say the mandatory deal opening line.
2) Ask ONE targeted question (based on stage strategy + weakest relevant category).
3) Wait for answer. Save via tool. Continue.
4) When ready to leave the deal, say:
"Health Score: [Sum]/[Max]. Risk: [Top Risk]. NEXT_DEAL_TRIGGER."
You MUST say NEXT_DEAL_TRIGGER to advance.

${stageInstructions}
`.trim();
}

wss.on("connection", async (twilioWs) => {
  console.log("🔥 Twilio WebSocket connected");

  let streamSid = null;
  let orgId = 1;
  let repName = "Rep";
  let repFirstName = "Rep";

  let dealQueue = [];
  let currentDealIndex = 0;

  // --- Realtime response gating (THIS fixes your errors)
  let responseActive = false;
  let queuedKick = false;
  let openAiReady = false;

  function safeSend(ws, payload) {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    } catch (e) {
      console.error("❌ WS send error:", e?.message || e);
    }
  }

  function requestResponse(reason = "kick") {
    if (!openAiReady) return;

    if (responseActive) {
      queuedKick = true;
      // Optional log, helps debugging storms
      console.log(`🧷 response.create queued (${reason})`);
      return;
    }

    responseActive = true;
    queuedKick = false;
    console.log(`⚡ response.create (${reason})`);
    safeSend(openAiWs, { type: "response.create" });
  }

  function maybeCancel(reason = "cancel") {
    // Only cancel if we *know* we have an active response
    if (!responseActive) return;
    console.log(`🛑 response.cancel (${reason})`);
    safeSend(openAiWs, { type: "response.cancel" });
    responseActive = false;
  }

  // Connect OpenAI Realtime
  const openAiWs = new WebSocket(`${MODEL_URL}?model=${MODEL_NAME}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  openAiWs.on("open", async () => {
    console.log("📡 OpenAI Connected");

    // session init
    safeSend(openAiWs, {
      type: "session.update",
      session: {
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "verse",
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          silence_duration_ms: 800, // slightly longer to reduce “cutting off”
        },
        tools: [saveDealDataTool],
      },
    });

    openAiReady = true;
    // If we already have rep+deals loaded, launch.
    if (dealQueue.length) {
      const d = dealQueue[currentDealIndex];
      const instructions = getSystemPrompt({
        deal: d,
        repFirstName,
        totalCount: dealQueue.length,
        remainingCount: dealQueue.length - 1 - currentDealIndex,
        isFirstDeal: currentDealIndex === 0,
      });
      safeSend(openAiWs, { type: "session.update", session: { instructions } });
      requestResponse("first_question");
    }
  });

  openAiWs.on("error", (err) => {
    console.error("❌ OpenAI WebSocket error:", err?.message || err);
  });

  openAiWs.on("message", async (data) => {
    const parsed = safeJsonParse(data);
    if (!parsed.ok) {
      console.error("❌ OpenAI frame not JSON:", parsed.err?.message, "| head:", parsed.head);
      return;
    }
    const msg = parsed.json;

    // Helpful error logging
    if (msg.type === "error") {
      console.error("❌ OpenAI error frame:", msg);
      // If we errored because we tried to create while active, just mark active and rely on done.
      return;
    }

    // VAD events (server-side)
    if (msg.type === "input_audio_buffer.speech_started") {
      // If user starts talking while model is talking, cancel model.
      maybeCancel("rep_interrupt");
      return;
    }

    if (msg.type === "input_audio_buffer.speech_stopped") {
      // Rep finished speaking -> trigger model turn
      requestResponse("speech_stopped");
      return;
    }

    // Model audio out -> Twilio
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

    // Tool call
    if (msg.type === "response.function_call_arguments.done") {
      const callId = msg.call_id;
      const argsParsed = safeJsonParse(msg.arguments || "{}");
      if (!argsParsed.ok) {
        console.error("❌ Tool args not JSON:", argsParsed.err?.message, "| head:", argsParsed.head);
        return;
      }

      const deal = dealQueue[currentDealIndex];
      if (!deal) {
        console.error("❌ Tool fired but no active deal.");
        return;
      }

      // Execute your tool handler (muscle -> db)
      await handleFunctionCall({ ...argsParsed.json, _deal: deal }, callId);

      // Ack tool output so model continues
      safeSend(openAiWs, {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ status: "success" }),
        },
      });

      // IMPORTANT: do NOT call response.create here.
      // Let the model naturally continue OR wait for next VAD stop.
      // If you want to force continuation, do it via the queue:
      queuedKick = true;
      return;
    }

    // Response finished -> free gate + advance deal if trigger present
    if (msg.type === "response.done") {
      responseActive = false;

      const transcript =
        msg.response?.output
          ?.flatMap((o) => o.content || [])
          .map((c) => c.transcript || c.text || "")
          .join(" ") || "";

      if (transcript.includes("NEXT_DEAL_TRIGGER")) {
        console.log("🚀 NEXT_DEAL_TRIGGER detected. Advancing deal...");
        currentDealIndex++;

        if (currentDealIndex < dealQueue.length) {
          const nextDeal = dealQueue[currentDealIndex];
          const instructions = getSystemPrompt({
            deal: nextDeal,
            repFirstName,
            totalCount: dealQueue.length,
            remainingCount: dealQueue.length - 1 - currentDealIndex,
            isFirstDeal: false,
          });

          safeSend(openAiWs, { type: "session.update", session: { instructions } });
          requestResponse("next_deal_first_question");
        } else {
          console.log("🏁 All deals done.");
        }
      }

      // If anything queued while active, run it now.
      if (queuedKick) requestResponse("queued_continue");
    }
  });

  // Twilio inbound
  twilioWs.on("message", async (raw) => {
    const parsed = safeJsonParse(raw);
    if (!parsed.ok) {
      console.error("❌ Twilio frame not JSON:", parsed.err?.message, "| head:", parsed.head);
      return;
    }
    const evt = parsed.json;

    if (evt.event === "start") {
      streamSid = evt.start?.streamSid || evt.streamSid || null;

      const params = evt.start?.customParameters || {};
      orgId = Number(params.org_id) || 1;
      repName = params.rep_name || repName || "Rep";
      repFirstName = String(repName).split(" ")[0] || "Rep";

      console.log("🎬 Stream started:", streamSid);
      console.log(`🔎 Rep: ${repName} | orgId=${orgId}`);

      // Load ONLY review_now deals
      try {
        const q = await pool.query(
          `
          SELECT *
          FROM opportunities
          WHERE org_id = $1
            AND rep_name = $2
            AND review_now = true
          ORDER BY
            CASE
              WHEN forecast_stage ILIKE '%commit%' THEN 1
              WHEN forecast_stage ILIKE '%best%' THEN 2
              ELSE 3
            END,
            close_date NULLS LAST,
            amount::numeric DESC
          `,
          [orgId, repName]
        );

        dealQueue = q.rows || [];
        currentDealIndex = 0;

        console.log(`📊 Loaded ${dealQueue.length} review_now deals for ${repName}`);

        if (!dealQueue.length) {
          // If no deals, still let model speak once
          const instructions = `You are Matthew. Tell the caller: "Hi ${repFirstName}. No deals are marked review_now, so there is nothing to review today."`;
          safeSend(openAiWs, { type: "session.update", session: { instructions } });
          requestResponse("no_deals");
          return;
        }

        console.log(
          `👉 Starting deal -> id=${dealQueue[0].id} account="${dealQueue[0].account_name}"`
        );

        // If OpenAI already connected, set instructions + kick
        if (openAiReady) {
          const d = dealQueue[0];
          const instructions = getSystemPrompt({
            deal: d,
            repFirstName,
            totalCount: dealQueue.length,
            remainingCount: dealQueue.length - 1,
            isFirstDeal: true,
          });
          safeSend(openAiWs, { type: "session.update", session: { instructions } });
          requestResponse("first_question");
        }
      } catch (e) {
        console.error("❌ deal load error:", e?.message || e);
      }

      return;
    }

    if (evt.event === "media" && evt.media?.payload) {
      // Forward audio -> OpenAI (append)
      if (!openAiReady) return;

      safeSend(openAiWs, {
        type: "input_audio_buffer.append",
        audio: evt.media.payload, // already base64
      });
      return;
    }

    if (evt.event === "stop") {
      console.log("🛑 Stream stopped:", streamSid);
      streamSid = null;
      return;
    }
  });

  twilioWs.on("close", () => {
    console.log("🔌 Twilio WebSocket closed");
    streamSid = null;
    try {
      openAiWs.close();
    } catch {}
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
