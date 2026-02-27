import type { Pool } from "pg";
import { buildNoDealsPrompt, buildPrompt, computeFirstGap } from "./prompt";
import { loadMasterDcoPrompt } from "./masterDcoPrompt";
import { buildTools } from "./tools";
import { handleFunctionCall } from "../../muscle.js";
import { getQuestionPack } from "../../db.js";

export type ForecastSession = {
  orgId: number;
  repName: string;
  masterPromptText?: string;
  masterPromptSha256?: string;
  masterPromptLoadedAt?: number;
  masterPromptSourcePath?: string;
  reviewed: Set<string>;
  lastCategoryKey?: string;
  lastCheckType?: "strong" | "progress";
  skipSaveCategoryKey?: string;
  deals: any[];
  index: number;
  scoreDefs: any[];
  touched: Set<string>;
  items: any[];
  wrapSaved: boolean;
  // Strict wrap enforcement: exact health-score phrase must be spoken before advancing.
  wrapExpectedHealthPercent?: number;
  wrapHealthPhraseOk?: boolean;
  /** Accumulated EB/Champion fields from save_deal_data calls during this review; persisted on wrap save. */
  accumulatedEntity?: Record<string, string>;
};

function normalizeCategoryKeyFromLabel(label: string) {
  const s = String(label || "").trim().toLowerCase();
  if (!s) return "";
  if (s.startsWith("pain")) return "pain";
  if (s.startsWith("metrics")) return "metrics";
  if (s.startsWith("champion")) return "champion";
  if (s.startsWith("internal sponsor")) return "champion";
  if (s.startsWith("internal coach")) return "champion";
  if (s.startsWith("sponsor")) return "champion";
  if (s.startsWith("criteria")) return "criteria";
  if (s.startsWith("competition")) return "competition";
  if (s.startsWith("timing")) return "timing";
  if (s.startsWith("budget")) return "budget";
  if (s.startsWith("economic buyer") || s.startsWith("eb")) return "eb";
  if (s.startsWith("decision process")) return "process";
  if (s.startsWith("paper process")) return "paper";
  return "";
}

function touchedKeyFromSaveToolField(field: string) {
  // tool args use prefixes that mostly match touchedKey (except EB).
  const k = String(field || "").trim();
  const m = k.match(/^([a-z_]+)_(score|summary|tip)$/i);
  if (!m) return "";
  const prefix = String(m[1] || "").toLowerCase();
  if (!prefix) return "";
  if (prefix === "economic_buyer") return "eb";
  return prefix; // e.g. pain, metrics, champion, eb, criteria, process, paper, timing, budget, competition
}

function extractTouchedKeysFromSaveToolArgs(toolArgs: any) {
  const out = new Set<string>();
  for (const key of Object.keys(toolArgs || {})) {
    const tk = touchedKeyFromSaveToolField(key);
    if (tk) out.add(tk);
  }
  return out;
}

function displayTouchedKey(touchedKey: string) {
  const k = String(touchedKey || "").trim().toLowerCase();
  switch (k) {
    case "pain":
      return "Pain";
    case "metrics":
      return "Metrics";
    case "champion":
      return "Internal Sponsor";
    case "criteria":
      return "Criteria";
    case "competition":
      return "Competition";
    case "timing":
      return "Timing";
    case "budget":
      return "Budget";
    case "eb":
      return "Economic Buyer";
    case "process":
      return "Decision Process";
    case "paper":
      return "Paper Process";
    default:
      return k || "Category";
  }
}

function parseLastCheckFromAssistant(text: string): { categoryKey?: string; checkType?: "strong" | "progress" } {
  const t = String(text || "");
  const m = t.match(/Last review\s+(.+?)\s+was\b/i);
  const rawCat = m?.[1] || "";
  const categoryKey = normalizeCategoryKeyFromLabel(rawCat);
  if (!categoryKey) return {};

  // Be tolerant: small punctuation/wording differences should not break state tracking.
  const hasStrongMarker = /Last review\s+.+?\s+was\s+strong\b/i.test(t);
  const hasChangeQuestion = /has anything changed\b/i.test(t) || /anything changed\b/i.test(t) || /any change\b/i.test(t);
  const isStrong = hasStrongMarker && hasChangeQuestion;

  const isProgress =
    /have we\s+made\s+progress\b/i.test(t) ||
    /made\s+progress\s+since\s+the\s+last\s+review\b/i.test(t) ||
    /any\s+progress\b/i.test(t) ||
    (/last review\b/i.test(t) && /progress\b/i.test(t));

  // If we can identify the category in a "Last review ..." pattern but the phrasing varies,
  // default to treating it as a "progress" style check so that a "no change" reply advances.
  const checkType: "strong" | "progress" = isStrong ? "strong" : isProgress ? "progress" : "progress";
  return { categoryKey, checkType };
}

function isNoChangeReply(userText: string) {
  const t = String(userText || "").trim().toLowerCase();
  if (!t) return false;
  return /^(no|nope|nah|unchanged|no change|nothing changed|nothing new|same)\b/.test(t);
}

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

function lastNonEmptyLine(text: string) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.at(-1) || "";
}

function assistantHandsTurnToRep(assistantText: string) {
  const last = lastNonEmptyLine(assistantText);
  if (!last) return false;
  // Direct question.
  if (last.length <= 650 && /\?\s*$/.test(last)) return true;
  // Imperative prompt that expects an answer even without '?'.
  if (
    last.length <= 650 &&
    /^(what|who|when|where|why|how|walk me through|talk me through|tell me|describe|share|list|confirm|give me)\b/i.test(last)
  )
    return true;
  // Question very near the end.
  const tail = String(assistantText || "").slice(-800);
  if (tail.includes("?")) return true;
  return false;
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

function healthPercentFromScore(healthScore: number) {
  const hs = Number(healthScore);
  if (!Number.isFinite(hs)) return 0;
  // Health is still computed server-side as 0-30 internally; we just speak percent.
  const pct = Math.round((hs / 30) * 100);
  return Math.max(0, Math.min(100, pct));
}

function expectedHealthPhrase(hp: number) {
  const n = Number(hp);
  const safe = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
  return `Your Deal Health Score is at ${safe} percent.`;
}

function extractHealthPercentFromAssistant(text: string) {
  const t = String(text || "");
  const m = t.match(/Your Deal Health Score is at\s+(\d{1,3})\s+percent\.?/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function runResponsesTurn(args: {
  pool: Pool;
  session: ForecastSession;
  text: string;
  maxToolLoops?: number;
  toolChoice?: "auto" | "none";
  repTurn?: boolean;
}): Promise<{ assistantText: string; done: boolean }> {
  const { pool, session } = args;
  const baseUrl = resolveBaseUrl();
  const apiKey = String(process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const model = process.env.MODEL_API_NAME;

  if (!baseUrl) throw new Error("Missing OPENAI_BASE_URL (or MODEL_API_URL or MODEL_URL)");
  if (!apiKey) throw new Error("Missing MODEL_API_KEY");
  if (!model) throw new Error("Missing MODEL_API_NAME");

  const text = String(args.text || "").trim();
  if (!text) throw new Error("Missing text");

  const toolChoice = args.toolChoice || "auto";
  const toolsEnabled = toolChoice !== "none";
  const tools = toolsEnabled ? buildTools() : undefined;

  // IMPORTANT:
  // We intentionally do NOT send a "running history" to the Responses API.
  // Instead we use `previous_response_id` *within this turn* to attach tool outputs
  // to the tool calls that were emitted in the immediately preceding response.
  //
  // This avoids invalid histories where `function_call_output` items exist without
  // a server-known tool call, which triggers:
  // "No tool call found for function call output with call_id ..."
  //
  // The deal context is always re-provided via `instructions`, and category state
  // is tracked server-side in `session.touched/reviewed`.
  let nextInput: any[] = [];
  let previousResponseId: string | null = null;
  const assistantTexts: string[] = [];
  const repTurn = args.repTurn ?? true;
  let forcedSaveNudge = false;
  const repText = repTurn ? text : "";
  const repSaidNoChange = repTurn ? isNoChangeReply(repText) : false;

  // Enforce strict category order + "never combine categories" on SAVE.
  // We derive the expected category from the current deal + reviewed set *before* this rep answer is saved.
  const dealIndexAtStart = session.index;
  const reviewedBeforeTurn = new Set<string>(session.reviewed || []);
  const expectedGapAtStart = (() => {
    const deal = session.deals?.[dealIndexAtStart];
    if (!deal) return null;
    const stage = String(deal?.forecast_stage || "Pipeline");
    try {
      return computeFirstGap(deal, stage, reviewedBeforeTurn);
    } catch {
      return null;
    }
  })();
  const expectedTouchedKeyAtStart = expectedGapAtStart?.touchedKey ? String(expectedGapAtStart.touchedKey) : "";

  // If the previous assistant turn was a locked "check pattern" and the rep says "no change",
  // we must move on without overwriting summaries/tips (per master prompt contract).
  if (repTurn && session.lastCategoryKey && session.lastCheckType && isNoChangeReply(text)) {
    session.reviewed.add(session.lastCategoryKey);
    session.skipSaveCategoryKey = session.lastCategoryKey;
  } else {
    session.skipSaveCategoryKey = undefined;
  }

  nextInput.push(userMsg(text));

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

  // Logging guards: keep noise down (once per invocation).
  let loggedQuestionDbError = false;
  const warnedNoBase = new Set<string>(); // key: `${orgId}:${category}`

  while (loop < maxLoops) {
    loop += 1;

    const deal = session.deals[session.index];
    let questionPack: { base?: string[]; primary?: string; clarifiers?: string[] } | undefined = undefined;

    if (deal) {
      try {
        const stage = String(deal?.forecast_stage || "Pipeline");
        const gap = computeFirstGap(deal, stage, session.reviewed);
        const scoreVal = Number(deal?.[gap.key] ?? 0);
        questionPack = await getQuestionPack(pool, {
          orgId: session.orgId,
          category: gap.touchedKey,
          criteriaId: Number.isFinite(scoreVal) ? scoreVal : null,
        });

        // If we're about to ask a direct "score=0" question but DB has no active base question,
        // warn once so it's detectable but doesn't spam logs.
        if (Number(scoreVal) === 0 && !String(questionPack?.primary || "").trim()) {
          const key = `${session.orgId}:${gap.touchedKey}`;
          if (!warnedNoBase.has(key)) {
            warnedNoBase.add(key);
            console.warn("[question_definitions] no active base question; falling back to hardcoded copy", {
              orgId: session.orgId,
              category: gap.touchedKey,
            });
          }
        }
      } catch (e) {
        // If DB is unavailable or question rows are missing, fall back to built-in question copy.
        questionPack = undefined;
        if (!loggedQuestionDbError) {
          loggedQuestionDbError = true;
          console.error("[question_definitions] failed to load questions; falling back to hardcoded copy", {
            orgId: session.orgId,
            error: (e as any)?.message || String(e),
          });
        }
      }
    }

    const contextBlock = deal
      ? buildPrompt(
          deal,
          firstName(session.repName),
          session.deals.length,
          session.index === 0,
          session.reviewed,
          session.scoreDefs,
          questionPack
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
        ...(tools ? { tools } : {}),
        tool_choice: toolChoice,
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        input: nextInput,
      }),
    });

    const json = await resp.json().catch(async () => ({ error: { message: await resp.text() } }));
    if (!resp.ok) {
      const msg = json?.error?.message || JSON.stringify(json);
      throw new Error(msg);
    }

    lastResponse = json;
    const respId = String(json?.id || json?.response_id || "").trim();
    if (respId) previousResponseId = respId;
    const output = Array.isArray(json?.output) ? json.output : [];

    const chunkText = extractAssistantText(output);
    if (chunkText) assistantTexts.push(chunkText);

    // Strict wrap enforcement: detect exact health-score phrase when expected.
    if (chunkText && session.wrapExpectedHealthPercent != null) {
      const expected = Math.max(0, Math.min(100, Math.round(Number(session.wrapExpectedHealthPercent) || 0)));
      const spoken = extractHealthPercentFromAssistant(chunkText);
      if (spoken != null) {
        session.wrapHealthPhraseOk = spoken === expected;
      }
      // If the assistant said the exact required phrase, mark ok even if regex missed punctuation nuances.
      const phrase = expectedHealthPhrase(expected);
      if (chunkText.includes(phrase) || chunkText.includes(phrase.replace(/\.$/, ""))) {
        session.wrapHealthPhraseOk = true;
      }
    }

    const toolCalls = output.filter((it: any) => it?.type === "function_call");
    if (!toolCalls.length) {
      // If tools are disabled (e.g. kickoff), do not run save-enforcement guardrails.
      if (!toolsEnabled) break;

      // Guardrail: if the rep answered with new info but the model failed to save,
      // we can get stuck repeating the same check question forever.
      // Do ONE corrective retry instructing a save + next question.
      if (repTurn && !forcedSaveNudge && repText && !repSaidNoChange && !session.skipSaveCategoryKey) {
        forcedSaveNudge = true;
        const expectedLabel = expectedTouchedKeyAtStart ? displayTouchedKey(expectedTouchedKeyAtStart) : "the current category";
        nextInput = [
          userMsg(
            "The rep just answered with new information. You MUST now:\n" +
              "1) Say only: \"Got it.\"\n" +
              `2) Call save_deal_data with the score, summary, and tip for ${expectedLabel} ONLY (do not save any other category).\n` +
              "3) Then ask the next required category question (ONE direct question).\n" +
              "Do not repeat the prior question."
          ),
        ];
        continue;
      }
      break;
    }

    const toolOutputs: any[] = [];
    const extraInputs: any[] = [];
    let advancedThisBatch = false;
    let sawSaveTool = false;
    let sawAdvanceTool = false;

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
        sawSaveTool = true;
        const activeDealIndex = session.index;
        const enforcingThisTurn =
          repTurn && activeDealIndex === dealIndexAtStart && !!expectedTouchedKeyAtStart && !session.skipSaveCategoryKey;
        const savedTouchedKeys = extractTouchedKeysFromSaveToolArgs(toolArgs);

        // HARD ENFORCEMENT:
        // - If the model tries to save multiple categories for a single rep answer, reject it.
        // - If the model tries to save a different category than the strict order expects, reject it.
        // (Wrap-only saves with risk_summary/next_steps are allowed and do not count as a category save.)
        if (enforcingThisTurn && savedTouchedKeys.size > 0) {
          const keys = Array.from(savedTouchedKeys);
          const expected = expectedTouchedKeyAtStart;
          const okSingle = savedTouchedKeys.size === 1 && savedTouchedKeys.has(expected);
          if (!okSingle) {
            toolOutputs.push(
              toolOutput(callId, {
                status: "error",
                error: "invalid_category_save",
                expected_category: expected,
                got_categories: keys,
              })
            );
            extraInputs.push(
              userMsg(
                "STOP. You must follow STRICT category order and NEVER combine categories.\n" +
                  `For this rep answer, you MUST save ONLY ${displayTouchedKey(expected)}.\n` +
                  `Do NOT save: ${keys.map(displayTouchedKey).join(", ") || "(none)"}.\n` +
                  "Call save_deal_data again with ONLY the correct <category>_score, <category>_summary (evidence only), and <category>_tip.\n" +
                  "Then ask the NEXT required category question."
              )
            );
            continue;
          }
        }

        // Normalize camelCase variants
        if (toolArgs.risk_summary == null && toolArgs.riskSummary != null) toolArgs.risk_summary = toolArgs.riskSummary;
        if (toolArgs.next_steps == null && toolArgs.nextSteps != null) toolArgs.next_steps = toolArgs.nextSteps;
        if (toolArgs.champion_name == null && (toolArgs as any).championName != null) toolArgs.champion_name = (toolArgs as any).championName;
        if (toolArgs.champion_title == null && (toolArgs as any).championTitle != null) toolArgs.champion_title = (toolArgs as any).championTitle;
        if (toolArgs.eb_name == null && (toolArgs as any).ebName != null) toolArgs.eb_name = (toolArgs as any).ebName;
        if (toolArgs.eb_title == null && (toolArgs as any).ebTitle != null) toolArgs.eb_title = (toolArgs as any).ebTitle;
        const wrapRisk = cleanText(toolArgs.risk_summary);
        const wrapNext = cleanText(toolArgs.next_steps);
        const wrapComplete = !!wrapRisk && !!wrapNext;

        // Accumulate entity fields from this save so we can persist them on the wrap save (Full Voice Review).
        if (!session.accumulatedEntity) session.accumulatedEntity = {};
        for (const key of ["champion_name", "champion_title", "eb_name", "eb_title"]) {
          const v = String((toolArgs as any)[key] ?? "").trim();
          if (v) (session.accumulatedEntity as Record<string, string>)[key] = v;
        }

        // Track touched + reviewed categories
        for (const key of Object.keys(toolArgs || {})) {
          const tk = touchedKeyFromSaveToolField(key);
          if (tk) {
            session.touched.add(tk);
            session.reviewed.add(tk);
          }
        }

        const activeDeal = session.deals[session.index];
        if (!activeDeal) {
          toolOutputs.push(toolOutput(callId, { status: "error", error: "No active deal" }));
          continue;
        }

        // On wrap save, include entity fields so ONE persistence writes wrap + entities (from accumulation or current DB).
        let entityForWrap: Record<string, string> = { ...session.accumulatedEntity };
        if (wrapComplete && Object.keys(entityForWrap).length === 0) {
          try {
            const { rows } = await pool.query<{ eb_name: string | null; eb_title: string | null; champion_name: string | null; champion_title: string | null }>(
              "SELECT eb_name, eb_title, champion_name, champion_title FROM opportunities WHERE org_id = $1 AND id = $2 LIMIT 1",
              [session.orgId, activeDeal.id]
            );
            const row = rows?.[0];
            if (row) {
              for (const k of ["champion_name", "champion_title", "eb_name", "eb_title"] as const) {
                const v = row[k];
                if (v != null && String(v).trim() !== "") entityForWrap[k] = String(v).trim();
              }
            }
          } catch {
            // ignore
          }
        }
        const argsForSave = wrapComplete && Object.keys(entityForWrap).length > 0
          ? { ...entityForWrap, ...toolArgs }
          : toolArgs;

        // If the rep said "no change" for a locked check pattern, do NOT overwrite DB fields.
        // We still return success so the model can proceed to the next question.
        if (session.skipSaveCategoryKey) {
          const prefix = `${session.skipSaveCategoryKey}_`;
          const touchesSkipped = Object.keys(toolArgs || {}).some((k) => k.startsWith(prefix));
          if (touchesSkipped) {
            // Clear skip so it applies to one category only.
            session.skipSaveCategoryKey = undefined;
            toolOutputs.push(toolOutput(callId, { status: "success", skipped: true }));
            continue;
          }
        }

        const result = await handleFunctionCall({
          toolName: "save_deal_data",
          args: {
            ...argsForSave,
            org_id: session.orgId,
            opportunity_id: activeDeal.id,
            score_event_source: "agent",
            rep_name: session.repName,
            call_id: `web_turn_${Date.now()}`,
          },
          pool,
        });

        // Keep local deal in sync
        for (const [k, v] of Object.entries(toolArgs || {})) {
          if (v !== undefined) (activeDeal as any)[k] = v;
        }

        toolOutputs.push(toolOutput(callId, { status: "success", result }));

        // Record wrap saved for THIS review only when BOTH fields are non-empty.
        if (wrapComplete) {
          session.wrapSaved = true;
          // Once wrap is saved, we expect the exact health-score phrase too.
          const hs = await fetchHealthScore(pool, session.orgId, activeDeal.id);
          const hp = healthPercentFromScore(hs);
          session.wrapExpectedHealthPercent = hp;
          session.wrapHealthPhraseOk = session.wrapHealthPhraseOk === true; // don't auto-pass; must be spoken.
        } else if (wrapRisk || wrapNext) {
          // If the model tried to save wrap fields but missed one, force correction.
          session.wrapSaved = false;
          const hs = await fetchHealthScore(pool, session.orgId, activeDeal.id);
          const hp = healthPercentFromScore(hs);
          session.wrapExpectedHealthPercent = hp;
          session.wrapHealthPhraseOk = false;
          extraInputs.push(
            userMsg(
              "End-of-deal wrap save is incomplete. You MUST save BOTH fields:\n" +
                "1) Speak Updated Risk Summary (if not already spoken).\n" +
                `2) Say EXACTLY: \"Your Deal Health Score is at ${hp} percent.\" (do not change this number)\n` +
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
        const allReviewed = requiredCats.every((cat) => session.reviewed.has(cat) || session.touched.has(cat));
        if (allReviewed && !session.wrapSaved) {
          const hs = await fetchHealthScore(pool, session.orgId, activeDeal.id);
          const hp = healthPercentFromScore(hs);
          session.wrapExpectedHealthPercent = hp;
          session.wrapHealthPhraseOk = false;
          extraInputs.push(
            userMsg(
              "All required categories reviewed. You MUST complete the end-of-deal wrap now:\n" +
                "1) Speak 'Updated Risk Summary: <your synthesis>'\n" +
                `2) Say EXACTLY: \"Your Deal Health Score is at ${hp} percent.\" (do not change this number)\n` +
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
        sawAdvanceTool = true;
        // Block advance until wrap save has been recorded for this review.
        const activeDeal = session.deals[session.index];
        const hs = activeDeal ? await fetchHealthScore(pool, session.orgId, activeDeal.id) : 0;
        const hp = healthPercentFromScore(hs);
        session.wrapExpectedHealthPercent = hp;

        if (!session.wrapSaved) {
          const activeDeal = session.deals[session.index];
          toolOutputs.push(toolOutput(callId, { status: "error", error: "end_wrap_not_saved" }));
          extraInputs.push(
            userMsg(
              "STOP. Before advancing, you MUST complete the end-of-deal wrap and save it:\n" +
                "1) Speak Updated Risk Summary.\n" +
                `2) Say EXACTLY: \"Your Deal Health Score is at ${hp} percent.\" (do not change this number)\n` +
                "3) Speak Suggested Next Steps.\n" +
                "4) Call save_deal_data with NON-EMPTY risk_summary AND NON-EMPTY next_steps.\n" +
                "5) Then call advance_deal.\n" +
                "Do NOT ask questions."
            )
          );
          continue;
        }

        // Block advance until the exact health-score phrase is spoken with the computed percent.
        if (!session.wrapHealthPhraseOk) {
          toolOutputs.push(toolOutput(callId, { status: "error", error: "health_phrase_missing_or_wrong", expected: hp }));
          extraInputs.push(
            userMsg(
              "STOP. Your end-of-deal wrap MUST follow the Master Prompt exactly.\n" +
                `You MUST say EXACTLY: \"Your Deal Health Score is at ${hp} percent.\" (do not change this number)\n` +
                "Then call advance_deal.\n" +
                "Do NOT ask questions."
            )
          );
          continue;
        }

        // Advance deal in session
        session.index += 1;
        session.touched = new Set<string>();
        session.reviewed = new Set<string>();
        session.lastCategoryKey = undefined;
        session.lastCheckType = undefined;
        session.skipSaveCategoryKey = undefined;
        session.wrapSaved = false;
        session.wrapExpectedHealthPercent = undefined;
        session.wrapHealthPhraseOk = undefined;
        session.accumulatedEntity = {};
        advancedThisBatch = true;

        if (session.index >= session.deals.length) {
          toolOutputs.push(toolOutput(callId, { status: "success", done: true }));
          break;
        }

        toolOutputs.push(toolOutput(callId, { status: "success" }));
        continue;
      }

      // Unknown tool: return no-op
      toolOutputs.push(toolOutput(callId, { status: "success", ignored: name }));
    }

    // Next model call should receive tool outputs (+ any corrective user nudges).
    // If we advanced deals, add a strong reset nudge so the model does not blend contexts.
    if (advancedThisBatch) {
      extraInputs.push(
        userMsg("New deal context starts now. Ignore any prior deal; follow the current deal instructions and ask the next required question.")
      );
    }

    // Latency optimization:
    // If the assistant already handed the turn back to the rep with the next question in THIS response,
    // and we didn't enqueue any corrective nudges, we can stop here without a follow-up model call.
    // (We have already executed the save tool server-side.)
    if (!extraInputs.length && sawSaveTool && !sawAdvanceTool && assistantHandsTurnToRep(chunkText)) {
      break;
    }

    nextInput = [...toolOutputs, ...extraInputs];
  }

  // We do not persist Responses API item history across turns.
  // Keep the field for backwards compatibility but ensure it stays empty.
  session.items = [];

  const assistantText = assistantTexts.join("\n\n").trim();
  const parsed = parseLastCheckFromAssistant(assistantText);
  if (parsed.categoryKey && parsed.checkType) {
    session.lastCategoryKey = parsed.categoryKey;
    session.lastCheckType = parsed.checkType;
  } else {
    session.lastCategoryKey = undefined;
    session.lastCheckType = undefined;
  }
  const done = session.index >= session.deals.length;
  return { assistantText, done };
}

/** Single-turn Responses API call (no tools). Used by comment ingestion. */
export async function callResponsesApiSingleTurn(args: { instructions: string; userMessage: string }): Promise<string> {
  const baseUrl = resolveBaseUrl();
  const apiKey = String(process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const model = process.env.MODEL_API_NAME;

  if (!baseUrl) throw new Error("Missing OPENAI_BASE_URL (or MODEL_API_URL or MODEL_URL)");
  if (!apiKey) throw new Error("Missing MODEL_API_KEY");
  if (!model) throw new Error("Missing MODEL_API_NAME");

  const resp = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: args.instructions,
      tool_choice: "none",
      input: [userMsg(args.userMessage)],
    }),
  });

  const json = await resp.json().catch(async () => ({ error: { message: await resp.text() } }));
  if (!resp.ok) {
    const msg = json?.error?.message || JSON.stringify(json);
    throw new Error(msg);
  }

  const output = Array.isArray(json?.output) ? json.output : [];
  return extractAssistantText(output);
}

