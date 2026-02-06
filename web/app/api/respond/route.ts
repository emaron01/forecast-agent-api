import { NextResponse } from "next/server";
import { Pool } from "pg";
import { sessions } from "../agent/sessions";
import { buildPrompt } from "../../../lib/prompt";
import { buildTools } from "../../../lib/tools";
import { handleFunctionCall } from "../../../../muscle.js";

export const runtime = "nodejs";

function resolveBaseUrl() {
  const raw = (process.env.OPENAI_BASE_URL || process.env.MODEL_API_URL || "").trim();
  if (!raw) return "";
  // Allow re-using old Realtime URLs (wss://.../v1/realtime) by converting them.
  const wsNormalized = raw.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
  const strippedRealtime = wsNormalized.replace(/\/v1\/realtime(?:\/calls)?$/i, "/v1");
  const noTrail = strippedRealtime.replace(/\/+$/, "");
  // Accept either https://api.openai.com or https://api.openai.com/v1
  return noTrail.endsWith("/v1") ? noTrail : `${noTrail}/v1`;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function firstName(full: string) {
  const s = String(full || "").trim();
  return s.split(/\s+/)[0] || s || "Rep";
}

function userMsg(text: string) {
  return { role: "user", content: text };
}

function toolOutput(callId: string, output: any) {
  return { type: "function_call_output", call_id: callId, output: typeof output === "string" ? output : JSON.stringify(output) };
}

function cleanText(v: any) {
  if (v == null) return "";
  const s = String(v).trim();
  return s;
}

function extractAssistantText(output: any[]) {
  const chunks: string[] = [];
  for (const item of output || []) {
    if (item?.type === "message" && item?.role === "assistant") {
      for (const c of item?.content || []) {
        if (c?.type === "output_text" && typeof c.text === "string") chunks.push(c.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

async function fetchHealthScore(orgId: number, opportunityId: number) {
  try {
    const { rows } = await pool.query(
      `SELECT health_score FROM opportunities WHERE org_id = $1 AND id = $2 LIMIT 1`,
      [orgId, opportunityId]
    );
    const n = Number(rows?.[0]?.health_score);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export async function POST(req: Request) {
  try {
    const baseUrl = resolveBaseUrl();
    const apiKey = process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY;
    const model = process.env.MODEL_NAME;
    if (!baseUrl)
      return NextResponse.json(
        { ok: false, error: "Missing OPENAI_BASE_URL (or MODEL_API_URL)" },
        { status: 500 }
      );
    if (!apiKey) return NextResponse.json({ ok: false, error: "Missing MODEL_API_KEY" }, { status: 500 });
    if (!model) return NextResponse.json({ ok: false, error: "Missing MODEL_NAME" }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const sessionId = String(body?.sessionId || "");
    const text = String(body?.text || "").trim();
    if (!sessionId) return NextResponse.json({ ok: false, error: "Missing sessionId" }, { status: 400 });
    if (!text) return NextResponse.json({ ok: false, error: "Missing text" }, { status: 400 });

    const session = sessions.get(sessionId);
    if (!session) return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 400 });

    const tools = buildTools();

    // Build a running input list (user messages + model outputs + tool outputs).
    const input: any[] = Array.isArray(session.items) ? [...session.items] : [];
    input.push(userMsg(text));

    const maxLoops = 6; // tool-call loops guard
    let loop = 0;
    let lastResponse: any = null;

    while (loop < maxLoops) {
      loop += 1;

      const deal = session.deals[session.index];
      const instructions = deal
        ? buildPrompt(
            deal,
            firstName(session.repName),
            session.deals.length,
            session.index === 0,
            session.touched,
            session.scoreDefs
          )
        : "SYSTEM PROMPT — SALES FORECAST AGENT\nNo deals available.";

      const resp = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          instructions,
          tools,
          tool_choice: "auto",
          input,
        }),
      });

      const json = await resp.json().catch(async () => ({ error: { message: await resp.text() } }));
      if (!resp.ok) {
        const msg = json?.error?.message || JSON.stringify(json);
        return NextResponse.json({ ok: false, error: msg }, { status: resp.status });
      }

      lastResponse = json;
      const output = Array.isArray(json?.output) ? json.output : [];

      // Append model outputs to running input.
      for (const item of output) input.push(item);

      const toolCalls = output.filter((it: any) => it?.type === "function_call");
      if (!toolCalls.length) break;

      for (const call of toolCalls) {
        const name = String(call?.name || "");
        const callId = String(call?.call_id || "");
        let args: any = {};
        try {
          args = call?.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          args = {};
        }

        if (name === "save_deal_data") {
          // Normalize camelCase variants
          if (args.risk_summary == null && args.riskSummary != null) args.risk_summary = args.riskSummary;
          if (args.next_steps == null && args.nextSteps != null) args.next_steps = args.nextSteps;
          const wrapRisk = cleanText(args.risk_summary);
          const wrapNext = cleanText(args.next_steps);
          const wrapComplete = !!wrapRisk && !!wrapNext;

          // Track touched categories (same logic as existing tool route)
          for (const key of Object.keys(args || {})) {
            if (key.endsWith("_score") || key.endsWith("_summary") || key.endsWith("_tip")) {
              const category = key.replace(/_score$/, "").replace(/_summary$/, "").replace(/_tip$/, "");
              session.touched.add(category);
            }
          }

          const activeDeal = session.deals[session.index];
          if (!activeDeal) {
            input.push(toolOutput(callId, { status: "error", error: "No active deal" }));
            continue;
          }

          const result = await handleFunctionCall({
            toolName: "save_deal_data",
            args: {
              ...args,
              org_id: session.orgId,
              opportunity_id: activeDeal.id,
              rep_name: session.repName,
              call_id: `web_turn_${Date.now()}`,
            },
            pool,
          });

          // Keep local deal in sync
          for (const [k, v] of Object.entries(args || {})) {
            if (v !== undefined) (activeDeal as any)[k] = v;
          }

          input.push(toolOutput(callId, { status: "success", result }));

          // Record wrap saved for THIS review only when BOTH fields are non-empty.
          if (wrapComplete) {
            session.wrapSaved = true;
          } else if (wrapRisk || wrapNext) {
            // If the model tried to save wrap fields but missed one, force correction.
            session.wrapSaved = false;
            const hs = await fetchHealthScore(session.orgId, activeDeal.id);
            input.push(
              userMsg(
                "End-of-deal wrap save is incomplete. You MUST save BOTH fields:\n" +
                  "1) Speak Updated Risk Summary (if not already spoken).\n" +
                  `2) Say EXACTLY: \"Your Deal Health Score is ${hs} out of 30.\" (do not change this number)\n` +
                  "3) Speak Suggested Next Steps (if not already spoken).\n" +
                  "4) Call save_deal_data with NON-EMPTY risk_summary AND NON-EMPTY next_steps.\n" +
                  "5) Then call advance_deal.\n" +
                  "Do NOT ask questions."
              )
            );
          }

          // If deal is complete but wrap not done, force it with the actual health score.
          const stage = String(activeDeal?.forecast_stage || "Pipeline");
          const isPipeline = stage.includes("Pipeline");
          const requiredCats = isPipeline
            ? ["pain", "metrics", "champion", "competition", "budget"]
            : ["pain", "metrics", "champion", "criteria", "competition", "timing", "budget", "eb", "process", "paper"];
          const allTouched = requiredCats.every((cat) => session.touched.has(cat));
          if (allTouched && !session.wrapSaved) {
            const hs = await fetchHealthScore(session.orgId, activeDeal.id);
            input.push(
              userMsg(
                "All required categories reviewed. You MUST complete the end-of-deal wrap now:\n" +
                  "1) Speak 'Updated Risk Summary: <your synthesis>'\n" +
                  `2) Say EXACTLY: \"Your Deal Health Score is ${hs} out of 30.\" (do not change this number)\n` +
                  "3) Speak 'Suggested Next Steps: <your recommendations>'\n" +
                  "4) Call save_deal_data with NON-EMPTY risk_summary and next_steps\n" +
                  "5) Call advance_deal.\n" +
                  "Do NOT ask questions."
              )
            );
          }
          continue;
        }

        if (name === "advance_deal") {
          // Block advance until wrap save has been recorded for this review.
          if (!session.wrapSaved) {
            const activeDeal = session.deals[session.index];
            const hs = activeDeal ? await fetchHealthScore(session.orgId, activeDeal.id) : 0;
            input.push(toolOutput(callId, { status: "error", error: "end_wrap_not_saved" }));
            input.push(
              userMsg(
                "STOP. Before advancing, you MUST complete the end-of-deal wrap and save it:\n" +
                  "1) Speak Updated Risk Summary.\n" +
                  `2) Say EXACTLY: \"Your Deal Health Score is ${hs} out of 30.\" (do not change this number)\n` +
                  "3) Speak Suggested Next Steps.\n" +
                  "4) Call save_deal_data with NON-EMPTY risk_summary AND NON-EMPTY next_steps.\n" +
                  "5) Then call advance_deal.\n" +
                  "Do NOT ask questions."
              )
            );
            continue;
          }

          // Advance deal in session (same behavior as existing advance route)
          session.index += 1;
          session.touched = new Set<string>();
          session.items = [];
          session.wrapSaved = false;
          input.length = 0; // reset conversation items for next deal

          if (session.index >= session.deals.length) {
            input.push(toolOutput(callId, { status: "success", done: true }));
            break;
          }

          input.push(toolOutput(callId, { status: "success" }));
          // Continue loop; next Responses call will use updated instructions and fresh input.
          continue;
        }

        // Unknown tool: return no-op
        input.push(toolOutput(callId, { status: "success", ignored: name }));
      }
    }

    // Persist updated running items back to session for next turn.
    session.items = input;

    const assistantText = extractAssistantText(Array.isArray(lastResponse?.output) ? lastResponse.output : []);
    return NextResponse.json({
      ok: true,
      text: assistantText,
      done: session.index >= session.deals.length,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

