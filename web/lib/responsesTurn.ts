import type { Pool } from "pg";
import { buildNoDealsPrompt, buildPrompt } from "./prompt";
import { loadMasterDcoPrompt } from "./masterDcoPrompt";
import { buildTools } from "./tools";
import { handleFunctionCall } from "../../muscle.js";

export type ForecastSession = {
  orgId: number;
  repName: string;
  masterPromptText?: string;
  masterPromptSha256?: string;
  masterPromptLoadedAt?: number;
  masterPromptSourcePath?: string;
  deals: any[];
  index: number;
  scoreDefs: any[];
  touched: Set<string>;
  items: any[];
  wrapSaved: boolean;
};

function resolveBaseUrl() {
  const raw = (process.env.OPENAI_BASE_URL || process.env.MODEL_API_URL || process.env.MODEL_URL || "").trim();
  if (!raw) return "";
  // Allow re-using old Realtime URLs (wss://.../v1/realtime) by converting them.
  const wsNormalized = raw.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
  const strippedRealtime = wsNormalized.replace(/\/v1\/realtime(?:\/calls)?$/i, "/v1");
  const noTrail = strippedRealtime.replace(/\/+$/, "");
  // Accept either https://api.openai.com or https://api.openai.com/v1
  return noTrail.endsWith("/v1") ? noTrail : `${noTrail}/v1`;
}

function firstName(full: string) {
  const s = String(full || "").trim();
  return s.split(/\s+/)[0] || s || "Rep";
}

function userMsg(text: string) {
  return { role: "user", content: text };
}

function toolOutput(callId: string, output: any) {
  return {
    type: "function_call_output",
    call_id: callId,
    output: typeof output === "string" ? output : JSON.stringify(output),
  };
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

async function fetchHealthScore(pool: Pool, orgId: number, opportunityId: number) {
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

export async function runResponsesTurn(args: {
  pool: Pool;
  session: ForecastSession;
  text: string;
  maxToolLoops?: number;
}): Promise<{ assistantText: string; done: boolean }> {
  const { pool, session } = args;
  const baseUrl = resolveBaseUrl();
  const apiKey = String(process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const model = process.env.MODEL_NAME || process.env.MODEL_API_NAME;

  if (!baseUrl) throw new Error("Missing OPENAI_BASE_URL (or MODEL_API_URL or MODEL_URL)");
  if (!apiKey) throw new Error("Missing MODEL_API_KEY");
  if (!model) throw new Error("Missing MODEL_NAME");

  const text = String(args.text || "").trim();
  if (!text) throw new Error("Missing text");

  const tools = buildTools();

  // Build a running input list (user messages + model outputs + tool outputs).
  const input: any[] = Array.isArray(session.items) ? [...session.items] : [];
  input.push(userMsg(text));

  // Load master prompt once per session (cached globally too).
  if (!session.masterPromptText) {
    const mp = await loadMasterDcoPrompt();
    session.masterPromptText = mp.text;
    session.masterPromptSha256 = mp.sha256;
    session.masterPromptLoadedAt = mp.loadedAt;
    session.masterPromptSourcePath = mp.sourcePath;
  }

  const maxLoops = Math.max(1, Math.min(20, Number(args.maxToolLoops ?? 6)));
  let loop = 0;
  let lastResponse: any = null;

  while (loop < maxLoops) {
    loop += 1;

    const deal = session.deals[session.index];
    const contextBlock = deal
      ? buildPrompt(
          deal,
          firstName(session.repName),
          session.deals.length,
          session.index === 0,
          session.touched,
          session.scoreDefs
        )
      : buildNoDealsPrompt(firstName(session.repName), "No deals available in the system for this rep.");
    const instructions = `${session.masterPromptText}\n\n${contextBlock}`;

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
      throw new Error(msg);
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
      let toolArgs: any = {};
      try {
        toolArgs = call?.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        toolArgs = {};
      }

      if (name === "save_deal_data") {
        // Normalize camelCase variants
        if (toolArgs.risk_summary == null && toolArgs.riskSummary != null) toolArgs.risk_summary = toolArgs.riskSummary;
        if (toolArgs.next_steps == null && toolArgs.nextSteps != null) toolArgs.next_steps = toolArgs.nextSteps;
        const wrapRisk = cleanText(toolArgs.risk_summary);
        const wrapNext = cleanText(toolArgs.next_steps);
        const wrapComplete = !!wrapRisk && !!wrapNext;

        // Track touched categories
        for (const key of Object.keys(toolArgs || {})) {
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
            ...toolArgs,
            org_id: session.orgId,
            opportunity_id: activeDeal.id,
            rep_name: session.repName,
            call_id: `web_turn_${Date.now()}`,
          },
          pool,
        });

        // Keep local deal in sync
        for (const [k, v] of Object.entries(toolArgs || {})) {
          if (v !== undefined) (activeDeal as any)[k] = v;
        }

        input.push(toolOutput(callId, { status: "success", result }));

        // Record wrap saved for THIS review only when BOTH fields are non-empty.
        if (wrapComplete) {
          session.wrapSaved = true;
        } else if (wrapRisk || wrapNext) {
          // If the model tried to save wrap fields but missed one, force correction.
          session.wrapSaved = false;
          const hs = await fetchHealthScore(pool, session.orgId, activeDeal.id);
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
          const hs = await fetchHealthScore(pool, session.orgId, activeDeal.id);
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
          const hs = activeDeal ? await fetchHealthScore(pool, session.orgId, activeDeal.id) : 0;
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

        // Advance deal in session
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
        continue;
      }

      // Unknown tool: return no-op
      input.push(toolOutput(callId, { status: "success", ignored: name }));
    }
  }

  // Persist updated running items back to session for next turn.
  session.items = input;

  const assistantText = extractAssistantText(Array.isArray(lastResponse?.output) ? lastResponse.output : []);
  const done = session.index >= session.deals.length;
  return { assistantText, done };
}

