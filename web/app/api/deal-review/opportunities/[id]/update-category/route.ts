import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { categoryUpdateSessions, type CategoryKey } from "../../../../opportunities/categoryUpdateSessions";
import { handleFunctionCall } from "../../../../../../../muscle.js";
import { getQuestionPack } from "../../../../../../../db.js";
import { pool } from "../../../../../../lib/pool";
import { getAuth } from "../../../../../../lib/auth";
import { resolvePublicId } from "../../../../../../lib/publicId";
import { closedOutcomeFromOpportunityRow } from "../../../../../../lib/opportunityOutcome";
import {
  extractSentences,
  extractQuestionFromPartialJson,
  extractActionFromPartialJson,
  getVoiceTuningFlags,
  passesEarlyEmitGate,
  logVoiceLatency,
} from "../../../../../../lib/voiceStreaming";

export const runtime = "nodejs";

// Latency-layer only: env flags for streaming/chunking. No changes to MEDDPICC scoring,
// gating, saves, DB writes, prompts, or model selection.
//
// VERIFICATION CHECKLIST (when LLM_STREAM_ENABLED=true, VOICE_LATENCY_LOGGING=true):
// 1. time_to_first_token_ms: populated and low (<1000ms) — stream events consumed
// 2. time_to_first_audio_ms: low (~2s) when early_audio_used=true — TTS started before full response
// 3. early_audio_used: true when question extracted early; false when fallback to post-completion
const LLM_STREAM_ENABLED = process.env.LLM_STREAM_ENABLED === "true";
const VOICE_SENTENCE_CHUNKING = process.env.VOICE_SENTENCE_CHUNKING === "true";

type ScoreDefRow = { score: number; label: string | null; criteria: string | null };

const ALL_CATEGORIES: CategoryKey[] = [
  "metrics",
  "economic_buyer",
  "criteria",
  "process",
  "paper",
  "pain",
  "champion",
  "competition",
  "timing",
  "budget",
];

function roundInt(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function computeHealthPercentFromOpportunity(healthScore: any) {
  const hs = Number(healthScore);
  if (!Number.isFinite(hs)) return null;
  return roundInt((hs / 30) * 100);
}

function resolveBaseUrl() {
  const raw = (process.env.OPENAI_BASE_URL || process.env.MODEL_API_URL || process.env.MODEL_URL || "").trim();
  if (!raw) return "";
  const wsNormalized = raw.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
  const strippedRealtime = wsNormalized.replace(/\/v1\/realtime(?:\/calls)?$/i, "/v1");
  const noTrail = strippedRealtime.replace(/\/+$/, "");
  return noTrail.endsWith("/v1") ? noTrail : `${noTrail}/v1`;
}

function displayCategory(category: CategoryKey) {
  switch (category) {
    case "economic_buyer":
      return "Economic Buyer";
    case "criteria":
      return "Decision Criteria";
    case "process":
      return "Decision Process";
    case "paper":
      return "Paper Process";
    case "pain":
      return "Identify Pain";
    case "champion":
      return "Internal Sponsor";
    default:
      return category.charAt(0).toUpperCase() + category.slice(1);
  }
}

function oppPrefixForCategory(category: CategoryKey) {
  switch (category) {
    case "economic_buyer":
      return "eb";
    default:
      return category;
  }
}

function splitLabelEvidence(summary: any) {
  const s = String(summary ?? "").trim();
  if (!s) return { label: "", evidence: "" };
  const idx = s.indexOf(":");
  if (idx > 0) {
    const label = s.slice(0, idx).trim();
    const evidence = s.slice(idx + 1).trim();
    return { label, evidence };
  }
  return { label: "", evidence: s };
}

function isNoChangeReply(userText: string) {
  const t = String(userText || "").trim().toLowerCase();
  if (!t) return false;
  return /^(no|nope|nah|unchanged|no change|nothing changed|nothing new|same)\b/.test(t);
}

function firstQuestionForCategory(category: CategoryKey, baseQuestion?: string) {
  const q = String(baseQuestion || "").trim();
  if (q) return q;
  // IMPORTANT: keep questions tightly scoped to this one category.
  // Also: do not use the word "champion" in user-facing text.
  switch (category) {
    case "pain":
      return "What specific business problem are they trying to solve, and what happens if they do nothing?";
    case "metrics":
      return "What measurable outcome matters most here (baseline → target), and who on the buyer side validated it?";
    case "champion":
      return "Who is your internal sponsor/coach, what influence do they have, and what concrete action have they taken in this cycle to drive the deal?";
    case "economic_buyer":
      return "Who is the economic buyer, what do they personally care about, and do you have direct access (or a committed intro)?";
    case "criteria":
      return "What are the top decision criteria, in the buyer’s words, and how is each weighted?";
    case "process":
      return "Walk me through the decision process step-by-step (stages, owners, dates) and what could block progress.";
    case "paper":
      return "What is the paper process (legal/procurement/security), who owns each step, and what are the target dates to signature?";
    case "competition":
      return "What is the competitive alternative, and what’s the buyer-verified reason you win?";
    case "timing":
      return "What buyer-owned event drives timing, and what are the critical path milestones between now and close?";
    case "budget":
      return "What’s the budget source, approval path, and amount—has it been confirmed by an approver?";
    default:
      return "What is the latest evidence for this category?";
  }
}

function openerQuestion(args: { category: CategoryKey; lastScore: number; lastLabel: string; baseQuestion?: string }) {
  const cat = displayCategory(args.category);
  if (args.lastScore >= 3) {
    return `Last review, ${cat} looked strong.\nHas anything changed that could introduce new risk?`;
  }
  if (args.lastScore >= 1) {
    const lbl = String(args.lastLabel || "").trim();
    return `Last review, ${cat} was ${lbl ? `"${lbl}"` : "partially met"}.\nWhat has changed since then?`;
  }
  return firstQuestionForCategory(args.category, args.baseQuestion);
}

function rubricText(defs: ScoreDefRow[]) {
  const rows = [...(defs || [])].sort((a, b) => Number(a.score) - Number(b.score));
  return rows
    .map((r) => `- ${Number(r.score)}: ${String(r.label || "").trim()} — ${String(r.criteria || "").trim()}`.trim())
    .join("\n");
}

async function fetchRubric(orgId: number, category: CategoryKey) {
  // Some environments treat score_definitions as global (no org_id column).
  // Support both org-scoped (org_id) and global schemas.
  const hasOrgId = await scoreDefinitionsHasOrgIdColumn();
  const sql = hasOrgId
    ? `
      SELECT score, label, criteria
        FROM score_definitions
       WHERE org_id = $1
         AND category = $2
       ORDER BY score ASC
      `
    : `
      SELECT score, label, criteria
        FROM score_definitions
       WHERE category = $1
       ORDER BY score ASC
      `;
  const params = hasOrgId ? [orgId, category] : [category];
  const { rows } = await pool.query(sql, params as any[]);
  return (rows || []) as ScoreDefRow[];
}

let __scoreDefinitionsHasOrgId: boolean | null = null;
async function scoreDefinitionsHasOrgIdColumn() {
  if (__scoreDefinitionsHasOrgId != null) return __scoreDefinitionsHasOrgId;
  try {
    const { rows } = await pool.query(
      `
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'score_definitions'
         AND column_name = 'org_id'
       LIMIT 1
      `
    );
    __scoreDefinitionsHasOrgId = !!rows?.length;
    return __scoreDefinitionsHasOrgId;
  } catch {
    __scoreDefinitionsHasOrgId = false;
    return __scoreDefinitionsHasOrgId;
  }
}

async function fetchOpportunity(orgId: number, opportunityId: number) {
  const { rows } = await pool.query(`SELECT * FROM opportunities WHERE org_id = $1 AND id = $2 LIMIT 1`, [
    orgId,
    opportunityId,
  ]);
  return rows?.[0] || null;
}

/** Latency-layer: non-streaming call. Preserves exact prompts and parameters. */
async function callModelJSON(args: { instructions: string; input: string }) {
  const baseUrl = resolveBaseUrl();
  const apiKey = String(process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const model = process.env.MODEL_API_NAME;
  if (!baseUrl) throw new Error("Missing OPENAI_BASE_URL (or MODEL_API_URL/MODEL_URL)");
  if (!apiKey) throw new Error("Missing MODEL_API_KEY");
  if (!model) throw new Error("Missing MODEL_API_NAME");

  if (!LLM_STREAM_ENABLED) {
    const resp = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        instructions: args.instructions,
        input: args.input,
      }),
    });
    const json = await resp.json().catch(() => ({ error: { message: "Upstream LLM request failed" } }));
    if (!resp.ok) throw new Error(json?.error?.message || "Upstream LLM request failed");
    const output = Array.isArray(json?.output) ? json.output : [];
    const chunks: string[] = [];
    for (const item of output) {
      if (item?.type === "message" && item?.role === "assistant") {
        for (const c of item?.content || []) {
          if (c?.type === "output_text" && typeof c.text === "string") chunks.push(c.text);
        }
      }
    }
    const text = chunks.join("\n").trim();
    return { raw: json, text };
  }

  // LLM_STREAM_ENABLED: consume token stream, accumulate. Same prompts/params.
  const turnStart = Date.now();
  let firstTokenAt: number | null = null;

  const resp = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: args.instructions,
      input: args.input,
      stream: true,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(errText || "LLM request failed");
  }
  if (!resp.body) throw new Error("No response body");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  const extractDelta = (ev: any): string | null => {
    if (ev?.type === "response.output_text.delta" && typeof ev.delta === "string") return ev.delta;
    if (ev?.type === "response.output_text.done" && typeof ev.text === "string") return ev.text;
    const part = ev?.part ?? ev?.delta;
    if (part && typeof part === "object" && typeof part.text === "string") return part.text;
    if (part && typeof part === "object" && typeof part.delta === "string") return part.delta;
    return null;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]" || data.trim() === "") continue;
      try {
        const ev = JSON.parse(data);
        const delta = extractDelta(ev);
        if (delta) {
          if (firstTokenAt == null) firstTokenAt = Date.now();
          fullText += delta;
        }
      } catch {
        // ignore parse errors for non-JSON lines
      }
    }
  }
  if (buffer.trim()) {
    try {
      const ev = JSON.parse(buffer.startsWith("data: ") ? buffer.slice(6) : buffer);
      const delta = extractDelta(ev);
      if (delta) {
        if (firstTokenAt == null) firstTokenAt = Date.now();
        fullText += delta;
      }
    } catch {
      /* ignore */
    }
  }

  const text = fullText.trim();
  logVoiceLatency({
    time_to_first_token_ms: firstTokenAt != null ? firstTokenAt - turnStart : undefined,
    total_turn_time_ms: Date.now() - turnStart,
  });
  return { raw: null, text };
}

type SentenceCallback = (sentence: string) => void | Promise<void>;

/**
 * Latency-layer: TRUE early-audio streaming. Emit question to TTS as soon as we have
 * a complete, properly-terminated "question" value from the stream — do NOT wait for
 * full LLM response.
 * Phase A: extract early candidate when we see "question":"...<value>" with matching
 *   closing quote (handles \"). Safe because JSON string is final once quote closes.
 * Phase B: validate on done; log early_validation_mismatch if candidate !== final.
 */
async function callModelJSONWithSentenceStream(
  args: { instructions: string; input: string },
  onSentence: SentenceCallback
): Promise<{ text: string; emittedSentences: string[]; earlyAudioUsed: boolean }> {
  const baseUrl = resolveBaseUrl();
  const apiKey = String(process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const model = process.env.MODEL_API_NAME;
  if (!baseUrl) throw new Error("Missing OPENAI_BASE_URL (or MODEL_API_URL/MODEL_URL)");
  if (!apiKey) throw new Error("Missing MODEL_API_KEY");
  if (!model) throw new Error("Missing MODEL_API_NAME");

  const turnStart = Date.now();
  let firstTokenAt: number | null = null;
  let earlyCandidate: string | null = null;
  let earlyEmittedAt: number | null = null;

  const resp = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: args.instructions,
      input: args.input,
      stream: true,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(errText || "LLM request failed");
  }
  if (!resp.body) throw new Error("No response body");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  const extractDelta = (ev: any): string | null => {
    if (ev?.type === "response.output_text.delta" && typeof ev.delta === "string") return ev.delta;
    if (ev?.type === "response.output_text.done" && typeof ev.text === "string") return ev.text;
    const part = ev?.part ?? ev?.delta;
    if (part && typeof part === "object" && typeof part.text === "string") return part.text;
    if (part && typeof part === "object" && typeof part.delta === "string") return part.delta;
    return null;
  };

  const tuning = getVoiceTuningFlags();
  let earlyActionSeen = false;
  let earlyEmitDisabled = false;

  const processBuffer = (): void => {
    if (earlyEmitDisabled || earlyEmittedAt) return;
    const action = extractActionFromPartialJson(fullText);
    if (action) earlyActionSeen = true;
    if (tuning.requireActionFollowup && action !== "followup") return;
    const candidate = extractQuestionFromPartialJson(fullText);
    if (
      candidate &&
      candidate.length >= tuning.minQuestionChars &&
      passesEarlyEmitGate(candidate, { requireEndPunct: tuning.requireEndPunct }) &&
      !earlyEmittedAt
    ) {
      earlyCandidate = candidate;
      earlyEmittedAt = Date.now();
      onSentence(candidate);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]" || data.trim() === "") continue;
      try {
        const ev = JSON.parse(data);
        const delta = extractDelta(ev);
        if (delta) {
          if (firstTokenAt == null) firstTokenAt = Date.now();
          fullText += delta;
          processBuffer();
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (buffer.trim()) {
    try {
      const ev = JSON.parse(buffer.startsWith("data: ") ? buffer.slice(6) : buffer);
      const delta = extractDelta(ev);
      if (delta) {
        if (firstTokenAt == null) firstTokenAt = Date.now();
        fullText += delta;
        processBuffer();
      }
    } catch {
      /* ignore */
    }
  }

  const text = fullText.trim();
  const emittedSentences: string[] = [];
  let earlyAudioUsed = false;

  try {
    const obj = parseStrictJson(text);
    if (String(obj?.action || "").trim() === "followup") {
      const finalQuestion = String(obj?.question || "").trim();
      if (finalQuestion) {
        if (earlyEmittedAt != null) {
          earlyAudioUsed = true;
          emittedSentences.push(finalQuestion);
          const mismatch = earlyCandidate != null && earlyCandidate !== finalQuestion;
          if (mismatch) {
            earlyEmitDisabled = true;
            console.warn(
              JSON.stringify({
                event: "early_audio_mismatch",
                message: "Early candidate did not match final question; no further early emits this turn",
              })
            );
          }
        } else {
          const sentences = extractSentences(finalQuestion);
          for (const s of sentences) {
            if (s) {
              emittedSentences.push(s);
              await onSentence(s);
            }
          }
        }
        logVoiceLatency({
          time_to_first_token_ms: firstTokenAt != null ? firstTokenAt - turnStart : undefined,
          time_to_first_audio_ms:
            earlyEmittedAt != null ? earlyEmittedAt - turnStart : undefined,
          total_turn_time_ms: Date.now() - turnStart,
          early_audio_used: earlyAudioUsed,
          early_validation_mismatch:
            earlyCandidate != null && earlyCandidate !== finalQuestion,
          early_action_seen_early: earlyActionSeen,
        });
        return { text, emittedSentences, earlyAudioUsed };
      }
    }
  } catch {
    /* parse failed — fall back to no sentence events */
  }

  logVoiceLatency({
    time_to_first_token_ms: firstTokenAt != null ? firstTokenAt - turnStart : undefined,
    total_turn_time_ms: Date.now() - turnStart,
    early_audio_used: false,
    early_action_seen_early: earlyActionSeen,
  });
  return { text, emittedSentences, earlyAudioUsed: false };
}

function parseStrictJson(text: string) {
  const s = String(text || "").trim();
  const unfenced = s.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(unfenced);
}

function parseLooseObject(raw: string) {
  // Accept a non-JSON "object-like" payload such as:
  // {category:paper,text:hello world}
  const s = String(raw || "").trim();
  if (!s.startsWith("{") || !s.endsWith("}")) return null;
  const inner = s.slice(1, -1).trim();
  if (!inner) return {};

  const parts = inner.split(/,(?=[a-zA-Z_][a-zA-Z0-9_]*:)/g);
  const out: any = {};
  for (const p of parts) {
    const idx = p.indexOf(":");
    if (idx <= 0) continue;
    const k = p.slice(0, idx).trim();
    const vRaw = p.slice(idx + 1).trim();
    if (!k) continue;
    const n = Number(vRaw);
    out[k] = Number.isFinite(n) && String(n) === vRaw ? n : vRaw;
  }
  return out;
}

function computeAssessedOnlyPercentFromOpportunity(opp: any) {
  if (!opp) return { percent: null as number | null, assessed: 0, unassessed: ALL_CATEGORIES.length };
  let assessed = 0;
  let totalScore = 0;
  for (const c of ALL_CATEGORIES) {
    const prefix = oppPrefixForCategory(c);
    const score = Number(opp?.[`${prefix}_score`] ?? 0) || 0;
    const summary = String(opp?.[`${prefix}_summary`] ?? "").trim();
    const tip = String(opp?.[`${prefix}_tip`] ?? "").trim();
    const isAssessed = !!summary || !!tip || score > 0;
    if (!isAssessed) continue;
    assessed += 1;
    totalScore += Math.max(0, Math.min(3, score));
  }
  const unassessed = ALL_CATEGORIES.length - assessed;
  if (!assessed) return { percent: null as number | null, assessed, unassessed };
  const percent = roundInt((totalScore / (assessed * 3)) * 100);
  return { percent, assessed, unassessed };
}

async function saveToOpportunities(args: {
  orgId: number;
  opportunityId: number;
  category: CategoryKey;
  score: number;
  evidence: string;
  tip: string;
  riskSummary: string;
  nextSteps: string;
}) {
  const prefix = oppPrefixForCategory(args.category);
  const toolArgs: any = {
    org_id: args.orgId,
    opportunity_id: args.opportunityId,
    score_event_source: "agent",
    [`${prefix}_score`]: Math.max(0, Math.min(3, Number(args.score) || 0)),
    // IMPORTANT: pass evidence only; muscle will prefix the rubric label.
    [`${prefix}_summary`]: String(args.evidence || "").trim(),
    [`${prefix}_tip`]: String(args.tip || "").trim(),
    risk_summary: String(args.riskSummary || "").trim(),
    next_steps: String(args.nextSteps || "").trim(),
  };

  await handleFunctionCall({ toolName: "save_deal_data", args: toolArgs, pool });
}

async function assertOpportunityVisible(args: {
  auth: Awaited<ReturnType<typeof getAuth>>;
  orgId: number;
  opportunityRepName: string | null;
}) {
  const { auth, orgId, opportunityRepName } = args;
  if (!auth) return { ok: false as const, status: 401 as const, error: "Unauthorized" };
  if (auth.kind !== "user") return { ok: false as const, status: 403 as const, error: "Forbidden" };

  const role = auth.user.role;
  if (role === "REP") {
    if (!opportunityRepName || opportunityRepName !== auth.user.account_owner_name) {
      return { ok: false as const, status: 403 as const, error: "Forbidden" };
    }
  }

  if (role === "MANAGER") {
    if (!opportunityRepName) return { ok: false as const, status: 403 as const, error: "Forbidden" };
    const { rows } = await pool.query(
      `
      SELECT 1
        FROM users
       WHERE org_id = $1
         AND role = 'REP'
         AND active IS TRUE
         AND manager_user_id = $2
         AND account_owner_name = $3
       LIMIT 1
      `,
      [orgId, auth.user.id, opportunityRepName]
    );
    if (!rows?.length) return { ok: false as const, status: 403 as const, error: "Forbidden" };
  }

  return { ok: true as const };
}

export async function POST(req: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const resolvedParams = await Promise.resolve(params as any);
    const opportunityPublicId = String(resolvedParams?.id ?? "").trim();
    if (!opportunityPublicId) return NextResponse.json({ ok: false, error: "Invalid opportunity id" }, { status: 400 });

    const orgId = auth.kind === "user" ? auth.user.org_id : auth.orgId || 0;
    if (!orgId) return NextResponse.json({ ok: false, error: "Missing org context" }, { status: 400 });

    const opportunityId = await resolvePublicId("opportunities", opportunityPublicId);

    const raw = await req.text().catch(() => "");
    let body: any = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
        if (typeof body === "string" && body.trim().startsWith("{")) body = JSON.parse(body);
      } catch {
        body = parseLooseObject(raw) || {};
      }
    } else {
      body = await req.json().catch(() => ({}));
    }

    let sessionId = String(body?.sessionId || "").trim();
    const category = String(body?.category || "").trim() as CategoryKey;
    const text = String(body?.text || "").trim();

    if (!ALL_CATEGORIES.includes(category)) {
      return NextResponse.json({ ok: false, error: "Invalid category" }, { status: 400 });
    }

    const opp = await fetchOpportunity(orgId, opportunityId);
    if (!opp) return NextResponse.json({ ok: false, error: "Opportunity not found" }, { status: 404 });

    const closed = closedOutcomeFromOpportunityRow({ ...opp, stage: (opp as any)?.sales_stage });
    if (closed) {
      return NextResponse.json({ ok: false, error: `Closed opportunity (${closed}). Deal Review is disabled.` }, { status: 409 });
    }

    const vis = await assertOpportunityVisible({
      auth,
      orgId,
      opportunityRepName: (opp as any)?.rep_name ?? null,
    });
    if (!vis.ok) return NextResponse.json({ ok: false, error: vis.error }, { status: vis.status });

    const prefix = oppPrefixForCategory(category);
    const lastScore = Number(opp?.[`${prefix}_score`] ?? 0) || 0;
    const lastTip = String(opp?.[`${prefix}_tip`] ?? "").trim();
    const lastSummary = String(opp?.[`${prefix}_summary`] ?? "").trim();
    const split = splitLabelEvidence(lastSummary);
    const lastLabel = split.label;
    const lastEvidence = split.evidence;

    // Session start
    if (!sessionId) {
      sessionId = randomUUID();
      categoryUpdateSessions.set(sessionId, {
        sessionId,
        orgId,
        opportunityId,
        category,
        turns: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    const session = categoryUpdateSessions.get(sessionId);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unknown sessionId" }, { status: 400 });
    }
    if (session.orgId !== orgId || session.opportunityId !== opportunityId || session.category !== category) {
      return NextResponse.json({ ok: false, error: "sessionId does not match org/opportunity/category" }, { status: 400 });
    }

    // If this is the first call, ask opener unless we got text for one-shot.
    if (!session.turns.length && !text) {
      let baseQuestion = "";
      try {
        const pack = await getQuestionPack(pool, { orgId, category, criteriaId: lastScore });
        baseQuestion = String(pack?.primary || "").trim();
      } catch {
        baseQuestion = "";
      }
      const q = openerQuestion({ category, lastScore, lastLabel, baseQuestion });
      session.turns.push({ role: "assistant", text: q, at: Date.now() });
      session.updatedAt = Date.now();
      return NextResponse.json({ ok: true, sessionId, category, assistantText: q });
    }

    if (text) {
      session.turns.push({ role: "user", text, at: Date.now() });
      session.updatedAt = Date.now();

      // One-shot drift guard: if they simply confirm "no change" and we already have a stored assessment,
      // don't churn the DB or wrap text.
      const hasStoredAssessment = lastScore > 0 || !!lastEvidence || !!lastTip;
      const hasAnyAssistant = session.turns.some((t) => t?.role === "assistant");
      if (!hasAnyAssistant && hasStoredAssessment && isNoChangeReply(text)) {
        return NextResponse.json({
          ok: true,
          sessionId,
          category,
          material_change: false,
          assistantText: "Got it — no material change. Leaving the saved assessment and wrap as-is.",
          healthPercent: computeHealthPercentFromOpportunity(opp?.health_score),
        });
      }

      // Drift guard: if rep indicates "no change" to a check-in opener, don't churn stored values.
      const lastAssistant = [...session.turns].reverse().find((t) => t?.role === "assistant")?.text || "";
      const isCheckInOpener =
        typeof lastAssistant === "string" &&
        (lastAssistant.startsWith("Last review,") || /Has anything changed/i.test(lastAssistant));
      if (isCheckInOpener && isNoChangeReply(text)) {
        return NextResponse.json({
          ok: true,
          sessionId,
          category,
          material_change: false,
          assistantText: "Got it — no material change. Leaving the saved assessment and wrap as-is.",
          healthPercent: computeHealthPercentFromOpportunity(opp?.health_score),
        });
      }
    }

    const defs = await fetchRubric(orgId, category);
    const instructions = [
      "You are an Expert Sales Leader running a targeted update for ONE category only.",
      "CRITICAL:",
      "- Do NOT evaluate or change any other categories.",
      "- If the rep indicates there is no material change, set material_change=false and do not propose updates.",
      "- If you need more information to score, ask ONE focused follow-up question.",
      "- Otherwise, produce a final update for this category: score (0-3), evidence, and coaching tip.",
      "- Also update wrap outputs (risk_summary and next_steps) using ONLY the known evidence. If coverage is incomplete, be accurate and not harsh.",
      "- Do NOT use the word 'champion' in any user-facing text; use 'Internal Sponsor'.",
      '- Do NOT use "out of 30" phrasing; if you mention overall health, use a percent.',
      "",
      "Output MUST be strict JSON with one of these shapes:",
      `- {"action":"followup","question":"..."} `,
      `- {"action":"finalize","material_change":true,"score":0-3,"evidence":"...","tip":"...","risk_summary":"...","next_steps":"..."} `,
      `- {"action":"finalize","material_change":false} `,
    ].join("\n");

    const input = [
      `Opportunity: ${opportunityPublicId} (org ${orgId})`,
      `Category: ${displayCategory(category)}`,
      "",
      "Category rubric (0-3):",
      rubricText(defs) || "(no rubric rows found)",
      "",
      "Current stored state (from opportunities):",
      `- last_score: ${lastScore}`,
      `- last_label: ${lastLabel || "(none)"}`,
      `- last_evidence: ${lastEvidence || "(none)"}`,
      `- last_tip: ${lastTip || "(none)"}`,
      `- current_risk_summary: ${String(opp?.risk_summary || "").trim() || "(none)"}`,
      `- current_next_steps: ${String(opp?.next_steps || "").trim() || "(none)"}`,
      "",
      "Conversation so far:",
      ...session.turns.map((t) => `${t.role.toUpperCase()}: ${String(t.text || "").trim()}`),
      "",
      "Return JSON only.",
    ].join("\n");

    // Latency-layer: when streaming+chunking, return SSE. Otherwise JSON.
    // Diagnostic: fires for every request that reaches the LLM (search logs for "update_category_llm")
    console.log(
      JSON.stringify({
        event: "update_category_llm",
        LLM_STREAM_ENABLED,
        VOICE_SENTENCE_CHUNKING,
        VOICE_LATENCY_LOGGING: process.env.VOICE_LATENCY_LOGGING ?? "(unset)",
      })
    );
    if (LLM_STREAM_ENABLED && VOICE_SENTENCE_CHUNKING) {
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(': keepalive\n\n'));
          const sendSSE = (
            payload: object,
            _opts?: { event?: string; id?: string }
          ) => {
            let out = "";
            if (_opts?.event) out += `event: ${String(_opts.event).replace(/\n/g, "")}\n`;
            if (_opts?.id != null) out += `id: ${String(_opts.id).replace(/\n/g, "")}\n`;
            out += `data: ${JSON.stringify(payload)}\n\n`;
            controller.enqueue(encoder.encode(out));
          };
          try {
            const { text: modelText, emittedSentences } = await callModelJSONWithSentenceStream(
              { instructions, input },
              async (sentence) => {
                sendSSE({ type: "sentence", text: sentence });
              }
            );
            const obj = parseStrictJson(modelText);
            const action = String(obj?.action || "").trim();

            if (action === "followup") {
              const q = String(obj?.question || "").trim();
              let remainingText = "";
              if (q && emittedSentences.length > 0) {
                let pos = 0;
                for (const s of emittedSentences) {
                  const i = q.indexOf(s, pos);
                  if (i >= 0) pos = i + s.length;
                }
                remainingText = q.slice(pos).trim();
              }
              if (!q) {
                sendSSE({ type: "error", error: "Model followup missing question" });
                controller.close();
                return;
              }
              session.turns.push({ role: "assistant", text: q, at: Date.now() });
              session.updatedAt = Date.now();
              sendSSE({
                type: "done",
                ok: true,
                sessionId,
                category,
                assistantText: q,
                remainingText: remainingText || undefined,
              });
              controller.close();
              return;
            }

            if (action !== "finalize") {
              sendSSE({ type: "error", error: "Model returned invalid action" });
              controller.close();
              return;
            }

            const material = Boolean(obj?.material_change);
            if (!material) {
              sendSSE({
                type: "done",
                ok: true,
                sessionId,
                category,
                material_change: false,
                assistantText: "No material change — leaving the saved assessment and wrap as-is.",
                healthPercent: computeHealthPercentFromOpportunity(opp?.health_score),
              });
              controller.close();
              return;
            }

            const score = Number(obj?.score);
            const evidence = String(obj?.evidence || "").trim();
            const tip = String(obj?.tip || "").trim();
            const riskSummary = String(obj?.risk_summary || "").trim();
            const nextSteps = String(obj?.next_steps || "").trim();

            if (!Number.isFinite(score) || score < 0 || score > 3) {
              sendSSE({ type: "error", error: "Model returned invalid score" });
              controller.close();
              return;
            }
            if (!evidence || !tip) {
              sendSSE({ type: "error", error: "Model returned empty evidence or tip" });
              controller.close();
              return;
            }

            await saveToOpportunities({
              orgId,
              opportunityId,
              category,
              score,
              evidence,
              tip,
              riskSummary,
              nextSteps,
            });

            const oppAfter = await fetchOpportunity(orgId, opportunityId);
            const healthPercent = computeHealthPercentFromOpportunity(oppAfter?.health_score);
            const assessedOnly = computeAssessedOnlyPercentFromOpportunity(oppAfter);
            const disclaimer =
              assessedOnly.unassessed > 0
                ? "Overall score reflects only updated categories; remaining categories not assessed yet."
                : "";
            categoryUpdateSessions.delete(sessionId);
            const assistantText = [
              `Updated ${displayCategory(category)}.`,
              assessedOnly.percent != null
                ? `Overall: ${assessedOnly.percent}%`
                : healthPercent != null
                  ? `Overall: ${healthPercent}%`
                  : "",
              disclaimer ? disclaimer : "",
            ]
              .filter(Boolean)
              .join("\n");

            sendSSE({
              type: "done",
              ok: true,
              sessionId,
              category,
              material_change: true,
              result: {
                score: Math.max(0, Math.min(3, Number(score) || 0)),
                evidence,
                tip,
              },
              healthPercent,
              assessedOnlyPercent: assessedOnly.percent,
              assistantText,
            });
            controller.close();
          } catch (e: any) {
            sendSSE({ type: "error", error: e?.message || String(e) });
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const { text: modelText } = await callModelJSON({ instructions, input });
    console.log(
      JSON.stringify({
        event: "parse_strict_json_input",
        modelText_length: modelText.length,
        modelText_head: modelText.slice(0, 300),
        modelText_tail: modelText.length > 300 ? modelText.slice(-300) : "",
      })
    );
    let obj: any;
    try {
      obj = parseStrictJson(modelText);
    } catch {
      throw new Error("LLM returned unexpected response format");
    }
    const action = String(obj?.action || "").trim();

    if (action === "followup") {
      const q = String(obj?.question || "").trim();
      if (!q) return NextResponse.json({ ok: false, error: "Model followup missing question" }, { status: 500 });
      session.turns.push({ role: "assistant", text: q, at: Date.now() });
      session.updatedAt = Date.now();
      return NextResponse.json({ ok: true, sessionId, category, assistantText: q });
    }

    if (action !== "finalize") {
      return NextResponse.json({ ok: false, error: "Model returned invalid action" }, { status: 500 });
    }

    const material = Boolean(obj?.material_change);
    if (!material) {
      return NextResponse.json({
        ok: true,
        sessionId,
        category,
        material_change: false,
        assistantText: "No material change — leaving the saved assessment and wrap as-is.",
        healthPercent: computeHealthPercentFromOpportunity(opp?.health_score),
      });
    }

    const score = Number(obj?.score);
    const evidence = String(obj?.evidence || "").trim();
    const tip = String(obj?.tip || "").trim();
    const riskSummary = String(obj?.risk_summary || "").trim();
    const nextSteps = String(obj?.next_steps || "").trim();

    if (!Number.isFinite(score) || score < 0 || score > 3) {
      return NextResponse.json({ ok: false, error: "Model returned invalid score" }, { status: 500 });
    }
    if (!evidence) return NextResponse.json({ ok: false, error: "Model returned empty evidence" }, { status: 500 });
    if (!tip) return NextResponse.json({ ok: false, error: "Model returned empty tip" }, { status: 500 });

    await saveToOpportunities({
      orgId,
      opportunityId,
      category,
      score,
      evidence,
      tip,
      riskSummary,
      nextSteps,
    });

    const oppAfter = await fetchOpportunity(orgId, opportunityId);
    const healthPercent = computeHealthPercentFromOpportunity(oppAfter?.health_score);
    const assessedOnly = computeAssessedOnlyPercentFromOpportunity(oppAfter);
    const disclaimer =
      assessedOnly.unassessed > 0 ? "Overall score reflects only updated categories; remaining categories not assessed yet." : "";

    categoryUpdateSessions.delete(sessionId);

    const assistantText = [
      `Updated ${displayCategory(category)}.`,
      assessedOnly.percent != null ? `Overall: ${assessedOnly.percent}%` : healthPercent != null ? `Overall: ${healthPercent}%` : "",
      disclaimer ? disclaimer : "",
    ]
      .filter(Boolean)
      .join("\n");

    return NextResponse.json({
      ok: true,
      sessionId,
      category,
      material_change: true,
      result: {
        score: Math.max(0, Math.min(3, Number(score) || 0)),
        evidence,
        tip,
      },
      healthPercent,
      assessedOnlyPercent: assessedOnly.percent,
      assistantText,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

