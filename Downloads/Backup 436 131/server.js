import express from "express";
import dotenv from "dotenv";
import twilio from "twilio";
import WebSocket, { WebSocketServer } from "ws";
import { Pool } from "pg";

import { handleFunctionCall } from "./muscle.js";

dotenv.config();

const app = express();
app.use(express.json());

/**
 * ENV
 */
const {
  PORT = 10000,
  DATABASE_URL,
  OPENAI_API_KEY,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
} = process.env;

if (!DATABASE_URL) console.warn("⚠️ Missing DATABASE_URL");
if (!OPENAI_API_KEY) console.warn("⚠️ Missing OPENAI_API_KEY");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const twilioClient = (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
  ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  : null;

/**
 * Basic health check
 */
app.get("/", (req, res) => res.send("✅ Forecast Agent API is alive!"));

/**
 * Debug: list opportunities by org_id
 */
app.get("/debug/opportunities", async (req, res) => {
  try {
    const org_id = Number(req.query.org_id);
    if (!org_id) return res.status(400).json({ error: "org_id required" });

    const { rows } = await pool.query(
      `
      SELECT id, org_id, rep_name, account_name, stage, amount, close_date, review_now,
             ai_forecast, total_score, last_summary, risk_summary
      FROM opportunities
      WHERE org_id = $1
      ORDER BY id ASC
      `,
      [org_id]
    );

    res.json(rows);
  } catch (e) {
    console.error("❌ /debug/opportunities error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * Twilio webhook endpoint for voice stream initiation
 */
app.post("/agent", async (req, res) => {
  // You already have Twilio calling this endpoint
  // Respond with TwiML that starts a stream to our WS server.
  const twiml = new twilio.twiml.VoiceResponse();
  const connect = twiml.connect();
  connect.stream({
    url: `wss://${req.headers.host}/twilio`,
  });

  res.type("text/xml").send(twiml.toString());
});

/**
 * WebSocket server for Twilio Media Streams
 */
const wss = new WebSocketServer({ noServer: true });
console.log("🌐 WebSocket server created");

const server = app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

server.on("upgrade", (req, socket, head) => {
  // only accept ws upgrades on /twilio
  const { url } = req;
  if (url !== "/twilio") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

/**
 * Helpers
 */
function safeSend(ws, obj) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  } catch (e) {
    console.error("❌ safeSend error:", e?.message || e);
  }
}

/**
 * Load score labels (category->score->label)
 */
async function loadScoreLabelsByType(orgId) {
  // score_definitions schema: (org_id, category, score, label, criteria)
  // Return: Map<category, Map<score:int, label:string>>
  const out = new Map();
  const q = `
    SELECT category, score, label
    FROM score_definitions
    WHERE org_id = $1
  `;
  const { rows } = await pool.query(q, [orgId]);
  for (const r of rows) {
    const cat = String(r.category || "").trim();
    const score = Number(r.score);
    const label = (r.label ?? "").toString();
    if (!cat || Number.isNaN(score)) continue;
    if (!out.has(cat)) out.set(cat, new Map());
    out.get(cat).set(score, label);
  }
  return out;
}

/**
 * Build system prompt
 * NOTE: We are NOT touching save logic. Prompt controls the spoken behavior.
 */
function getSystemPrompt({ repFirstName, deal, scoreLabelsByType }) {
  const account = deal.account_name ?? "Unknown Account";
  const stage = deal.stage ?? "Unknown Stage";
  const amount = deal.amount ?? null;
  const close = deal.close_date ?? null;

  // Minimal verbal behavior. Coaching stays in summaries/tips (saved), not spoken.
  return `
You are a VP-level sales inspection agent running a MEDDPICC+TB deal review.
You MUST be rigorous, skeptical, and prioritize accuracy over speed — but DO NOT coach verbally.

CONVERSATION RULES (spoken):
- Keep spoken output minimal.
- No long recap. No coaching. No “next steps” verbally.
- For each category:
  - If score < 3:
    Say exactly:
      "Last review <Category> was <Label>. Have we made progress since the last review?"
    If unclear/vague, challenge with ONE follow-up question.
    If clear improvement, capture and proceed.
    If no change, confirm and proceed.
  - If score == 3:
    Ask exactly:
      "Any new risk introduced for <Category> since last review?"
    If yes: capture and rescore. If no: move on.

DO NOT read full criteria aloud.
DO NOT summarize everything aloud.
Saving happens silently via tools.

Deal opener (spoken) when starting a deal:
- "Hi ${repFirstName}. Reviewing ${account}. Stage ${stage}${amount ? `, amount ${amount}` : ""}${close ? `, close ${close}` : ""}."
- Then read ONLY: Risk Summary + Pain Summary (if present in deal fields).
- Then proceed to the next category question.

AVAILABLE LABELS:
Use these labels when you reference <Label>:
${Array.from(scoreLabelsByType.entries()).map(([cat, m]) => {
  const pairs = Array.from(m.entries()).sort((a,b)=>a[0]-b[0]).map(([s,l])=>`${s}="${l}"`).join(", ");
  return `- ${cat}: ${pairs}`;
}).join("\n")}

TOOLS:
- You must use save_deal_data tool after each category interaction to store:
  <category>_score, <category>_summary, <category>_tip and any extra fields provided by the tool schema.
- You may use advance_deal when instructed by system logic, but do NOT verbally announce "next deal trigger".
`.trim();
}

/**
 * Tools (OpenAI Realtime function calling)
 */
const saveDealDataTool = {
  type: "function",
  name: "save_deal_data",
  description:
    "Save category score/summary/tip (and optional details) for current opportunity. Must be called after each category interaction. Silent.",
  parameters: {
    type: "object",
    additionalProperties: true,
    properties: {
      opportunity_id: { type: "integer" },
      org_id: { type: "integer" },
      rep_name: { type: "string" },
      call_id: { type: "string" },
      // dynamic category fields: pain_score, pain_summary, pain_tip, etc.
    },
    required: ["opportunity_id", "org_id"],
  },
};

const advanceDealTool = {
  type: "function",
  name: "advance_deal",
  description: "Advance to the next deal in the queue. Silent.",
  parameters: {
    type: "object",
    properties: {
      reason: { type: "string" },
    },
    required: [],
  },
};

/**
 * WebSocket connection handler
 */
wss.on("connection", (twilioWs) => {
  console.log("🔥 Twilio WebSocket connected");

  let streamSid = null;
  let callSid = null;
  let repName = null;
  let repFirstName = null;
  let orgId = null;

  let deals = [];
  let dealIndex = 0;
  let currentDeal = null;

  // score labels cache per call
  let scoreLabelsByType = new Map();

  // OpenAI WS
  let openAiWs = null;

  // Realtime state guards (DO NOT change save behavior)
  let responseActive = false;
  let responseCreateInFlight = false;
  let responseCreateQueued = false;
  let lastResponseCreateAt = 0;

  function kickModel(reason) {
    // IMPORTANT: do not call response.create here.
    // We only commit audio to tell the model input is complete.
    const now = Date.now();
    if (now - lastResponseCreateAt < 250) return; // micro-throttle
    lastResponseCreateAt = now;
    safeSend(openAiWs, { type: "input_audio_buffer.commit" });
  }

  function trySendResponseCreate(reason) {
    // Only send response.create when no response is active/in flight.
    if (responseActive || responseCreateInFlight) {
      responseCreateQueued = true;
      console.log(`⏭️ response.create queued (${reason})`);
      return;
    }
    responseCreateInFlight = true;
    console.log(`⚡ response.create (${reason})`);
    safeSend(openAiWs, { type: "response.create" });
  }

  async function loadDealsForRep() {
    const q = `
      SELECT id, org_id, rep_name, account_name, stage, amount, close_date, review_now,
             ai_forecast, total_score, last_summary, risk_summary,
             pain_score, pain_summary
      FROM opportunities
      WHERE org_id = $1
        AND rep_name = $2
        AND review_now = TRUE
      ORDER BY id ASC
    `;
    const { rows } = await pool.query(q, [orgId, repName]);
    return rows;
  }

  function setCurrentDeal(idx) {
    dealIndex = idx;
    currentDeal = deals[dealIndex] || null;
    if (currentDeal) {
      console.log(`👉 Starting deal -> id=${currentDeal.id} account="${currentDeal.account_name}"`);
    }
  }

  async function attemptLaunch() {
    try {
      // score labels for prompt
      try {
        scoreLabelsByType = await loadScoreLabelsByType(orgId);
        console.log(`🧾 Loaded score labels for orgId=${orgId}`);
      } catch (e) {
        console.warn("⚠️ Could not load score_definitions labels:", e?.message || e);
      }

      deals = await loadDealsForRep();
      console.log(`📊 Loaded ${deals.length} review_now deals for ${repName}`);

      if (!deals.length) {
        // still connect openai so we can speak
        setCurrentDeal(0);
      } else {
        setCurrentDeal(0);
      }

      const systemPrompt = getSystemPrompt({
        repFirstName: repFirstName || "there",
        deal: currentDeal || {},
        scoreLabelsByType,
      });

      safeSend(openAiWs, {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
      });

      // initial question
      trySendResponseCreate("first_question");
    } catch (e) {
      console.error("❌ attemptLaunch error:", e);
    }
  }

  /**
   * Create OpenAI WS once Twilio stream starts (we need org/rep first)
   */
  function connectOpenAI() {
    openAiWs = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview", {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
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
            threshold: 0.6,
            silence_duration_ms: 1100,
          },
          tools: [saveDealDataTool, advanceDealTool],
        },
      });

      attemptLaunch();
    });

    openAiWs.on("error", (err) => {
      console.error("❌ OpenAI WebSocket error:", err?.message || err);
    });

    openAiWs.on("unexpected-response", (req, res) => {
      console.error("❌ OpenAI WS unexpected response:", res?.statusCode, res?.statusMessage);
      console.error("Headers:", res?.headers);
    });

    openAiWs.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (e) {
        console.error("❌ OpenAI frame parse error:", e);
        return;
      }

      // Debug log key frames
      if (msg?.type === "error") {
        console.error("❌ OpenAI error frame:", msg);
      }

      if (msg.type === "response.created") {
        responseCreateInFlight = false;
        responseActive = true;
        // console.log("🟦 OpenAI response.created");
      }

      if (msg.type === "response.done") {
        // console.log("🟩 OpenAI response.done");
        responseActive = false;
        responseCreateInFlight = false;

        if (responseCreateQueued) {
          responseCreateQueued = false;
          // small delay to avoid bursts
          setTimeout(() => trySendResponseCreate("queued_continue"), 250);
        }
      }

      // Audio out -> Twilio
      if (msg.type === "response.output_audio.delta") {
        const payload = msg.delta;
        if (payload && streamSid) {
          safeSend(twilioWs, {
            event: "media",
            streamSid,
            media: { payload },
          });
        }
      }

      // Tool call handling
      if (msg.type === "response.function_call_arguments.done") {
        const toolName = msg.name;
        const argsText = msg.arguments || "{}";
        let args;
        try {
          args = JSON.parse(argsText);
        } catch {
          args = {};
        }

        if (toolName === "save_deal_data") {
          // Always force ids
          args.opportunity_id = currentDeal?.id ?? args.opportunity_id;
          args.org_id = orgId ?? args.org_id;
          args.rep_name = repName ?? args.rep_name;
          args.call_id = callSid ?? args.call_id;

          console.log(
            `🧾 SAVE ROUTE dealIndex=${dealIndex}/${Math.max(deals.length - 1, 0)} id=${args.opportunity_id} account="${currentDeal?.account_name}" callId=${args.call_id}`
          );
          console.log("🔎 args keys:", Object.keys(args));
          if (Object.keys(args).length <= 8) console.log("🔎 args preview:", args);

          try {
            console.log("🛠️ Tool Triggered: save_deal_data");
            const result = await handleFunctionCall({
              toolName,
              args,
              pool,
            });

            // Return tool result
            safeSend(openAiWs, {
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: msg.call_id,
                output: JSON.stringify(result ?? { ok: true }),
              },
            });

            // IMPORTANT: we do NOT speak coaching here; model will proceed.
            // Let model decide next step, but we can commit audio buffer to unblock if needed.
            kickModel("post_tool_continue");
          } catch (e) {
            console.error("❌ save_deal_data error:", e);
          }
        }

        if (toolName === "advance_deal") {
          console.log("➡️ advance_deal tool received. Advancing deal...");
          const nextIdx = dealIndex + 1;
          if (nextIdx >= deals.length) {
            console.log("🏁 All deals done.");
            return;
          }
          setCurrentDeal(nextIdx);

          // Refresh system context for new deal (short opener rules already in prompt)
          const systemPrompt = getSystemPrompt({
            repFirstName: repFirstName || "there",
            deal: currentDeal || {},
            scoreLabelsByType,
          });

          safeSend(openAiWs, {
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "system",
              content: [{ type: "input_text", text: systemPrompt }],
            },
          });

          trySendResponseCreate("next_deal_first_question");
        }
      }
    });
  }

  /**
   * Twilio inbound frames
   */
  twilioWs.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    // Twilio Media Streams events: start/media/stop
    if (msg.event === "start") {
      streamSid = msg.start.streamSid;
      callSid = msg.start.callSid;
      console.log(`🎬 Stream started: ${streamSid}`);

      // Identify rep from phone number (you already have this working in your DB)
      const from = msg.start.customParameters?.From || msg.start.customParameters?.from;

      // If you already parse caller elsewhere, keep it. Here is a safe fallback.
      const caller = from || msg.start.customParameters?.caller || null;

      // Lookup rep by phone in DB
      try {
        const { rows } = await pool.query(
          `SELECT org_id, rep_name FROM reps WHERE phone = $1 LIMIT 1`,
          [caller]
        );

        if (rows.length) {
          orgId = rows[0].org_id;
          repName = rows[0].rep_name;
          repFirstName = (repName || "").split(" ")[0] || repName;

          console.log(`📞 Incoming call from: ${caller}`);
          console.log(`✅ Identified Rep: ${repName} (org_id=${orgId})`);
          console.log(`🔎 Rep: ${repName} | orgId=${orgId}`);
        } else {
          // fallback if not found
          orgId = 1;
          repName = "Rep";
          repFirstName = "there";
          console.warn("⚠️ Rep not found by phone, using fallback");
        }
      } catch (e) {
        console.error("❌ Rep lookup error:", e);
        orgId = 1;
        repName = "Rep";
        repFirstName = "there";
      }

      // Now connect OpenAI
      connectOpenAI();
      return;
    }

    if (msg.event === "media") {
      const payload = msg.media?.payload;
      if (!payload || !openAiWs) return;

      // forward audio to OpenAI
      safeSend(openAiWs, {
        type: "input_audio_buffer.append",
        audio: payload,
      });
      return;
    }

    if (msg.event === "mark") {
      // ignore
      return;
    }

    if (msg.event === "stop") {
      console.log(`🛑 Stream stopped: ${streamSid}`);
      try {
        openAiWs?.close();
      } catch {}
      try {
        twilioWs?.close();
      } catch {}
      return;
    }
  });

  twilioWs.on("close", () => {
    console.log("🔌 Twilio WebSocket closed");
    try {
      openAiWs?.close();
    } catch {}
  });

  twilioWs.on("error", (err) => {
    console.error("❌ Twilio WS error:", err?.message || err);
  });
});
