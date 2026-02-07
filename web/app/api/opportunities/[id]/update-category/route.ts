import { NextResponse } from "next/server";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import { categoryUpdateSessions, type CategoryKey } from "../../categoryUpdateSessions";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

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

function firstQuestionForCategory(category: CategoryKey) {
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

function rubricText(defs: ScoreDefRow[]) {
  const rows = [...(defs || [])].sort((a, b) => Number(a.score) - Number(b.score));
  return rows
    .map((r) => `- ${Number(r.score)}: ${String(r.label || "").trim()} — ${String(r.criteria || "").trim()}`.trim())
    .join("\n");
}

async function fetchRubric(orgId: number, category: CategoryKey) {
  const { rows } = await pool.query(
    `
    SELECT score, label, criteria
      FROM score_definitions
     WHERE org_id = $1
       AND category = $2
     ORDER BY score ASC
    `,
    [orgId, category]
  );
  return (rows || []) as ScoreDefRow[];
}

async function fetchLabelForScore(orgId: number, category: CategoryKey, score: number) {
  try {
    const { rows } = await pool.query(
      `
      SELECT label
        FROM score_definitions
       WHERE org_id = $1
         AND category = $2
         AND score = $3
       LIMIT 1
      `,
      [orgId, category, score]
    );
    return String(rows?.[0]?.label || "").trim();
  } catch {
    return "";
  }
}

async function callModelJSON(args: { instructions: string; input: string }) {
  const baseUrl = resolveBaseUrl();
  const apiKey = String(process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const model = process.env.MODEL_NAME || process.env.MODEL_API_NAME;
  if (!baseUrl) throw new Error("Missing OPENAI_BASE_URL (or MODEL_API_URL/MODEL_URL)");
  if (!apiKey) throw new Error("Missing MODEL_API_KEY");
  if (!model) throw new Error("Missing MODEL_NAME");

  const resp = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: args.instructions,
      input: args.input,
    }),
  });
  const json = await resp.json().catch(async () => ({ error: { message: await resp.text() } }));
  if (!resp.ok) throw new Error(json?.error?.message || JSON.stringify(json));

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

function parseStrictJson(text: string) {
  const s = String(text || "").trim();
  // tolerate fenced blocks
  const unfenced = s.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(unfenced);
}

function parseLooseObject(raw: string) {
  // Accept a non-JSON "object-like" payload such as:
  // {category:paper,orgId:1,text:hello world}
  // This can happen when shells strip quotes from JSON arguments.
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

async function upsertAssessment(args: {
  orgId: number;
  opportunityId: number;
  category: CategoryKey;
  score: number;
  label: string;
  tip: string;
  evidence: string;
  turns: any[];
}) {
  try {
    const q = `
      INSERT INTO opportunity_category_assessments
        (org_id, opportunity_id, category, score, label, tip, evidence, turns, updated_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())
      ON CONFLICT (org_id, opportunity_id, category)
      DO UPDATE SET
        score = EXCLUDED.score,
        label = EXCLUDED.label,
        tip = EXCLUDED.tip,
        evidence = EXCLUDED.evidence,
        turns = EXCLUDED.turns,
        updated_at = NOW()
      RETURNING org_id, opportunity_id, category, score, label, tip, evidence, updated_at
    `;
    const { rows } = await pool.query(q, [
      args.orgId,
      args.opportunityId,
      args.category,
      args.score,
      String(args.label || "").trim(),
      String(args.tip || "").trim(),
      String(args.evidence || "").trim(),
      JSON.stringify(args.turns || []),
    ]);
    return rows?.[0] || null;
  } catch (e: any) {
    const code = String(e?.code || "");
    if (code === "42P01") {
      throw new Error("DB migration missing: opportunity_category_assessments");
    }
    if (code === "42703") {
      throw new Error("DB migration missing: opportunity_category_assessments label/tip columns");
    }
    throw e;
  }
}

async function fetchWeights(orgId: number): Promise<Record<string, number>> {
  try {
    const { rows } = await pool.query(
      `
      SELECT category, points_max
        FROM opportunity_category_weights
       WHERE org_id = $1
      `,
      [orgId]
    );
    const out: Record<string, number> = {};
    for (const r of rows || []) out[String(r.category)] = Number(r.points_max) || 0;
    return out;
  } catch (e: any) {
    if (String(e?.code || "") === "42P01") return {};
    throw e;
  }
}

async function fetchAssessments(orgId: number, opportunityId: number) {
  try {
    const { rows } = await pool.query(
      `
      SELECT category, score, label, tip, evidence, updated_at
        FROM opportunity_category_assessments
       WHERE org_id = $1 AND opportunity_id = $2
       ORDER BY category ASC
      `,
      [orgId, opportunityId]
    );
    return rows || [];
  } catch (e: any) {
    const code = String(e?.code || "");
    if (code === "42P01") {
      throw new Error("DB migration missing: opportunity_category_assessments");
    }
    if (code === "42703") {
      throw new Error("DB migration missing: opportunity_category_assessments label/tip columns");
    }
    throw e;
  }
}

function computeOverallScore(args: {
  assessments: Array<{ category: string; score: number }>;
  weights: Record<string, number>;
  includedCategories?: string[];
}) {
  const cats = args.assessments || [];
  const weights = args.weights || {};
  const included =
    Array.isArray(args.includedCategories) && args.includedCategories.length
      ? args.includedCategories.map(String)
      : ALL_CATEGORIES;
  let total = 0;
  let max = 0;
  const byCat = new Map<string, number>();
  for (const a of cats) byCat.set(String(a.category), Number(a.score) || 0);

  for (const catKey of included) {
    const score = byCat.get(catKey) ?? 0;
    const pointsMax =
      Number.isFinite(Number(weights[catKey])) && Number(weights[catKey]) > 0 ? Number(weights[catKey]) : 3;
    const points = (Math.max(0, Math.min(3, score)) / 3) * pointsMax;
    total += points;
    max += pointsMax;
  }
  // Round for stable display/storage.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return { overall_score: round2(total), overall_max: round2(max || 0) };
}

async function upsertRollup(args: {
  orgId: number;
  opportunityId: number;
  overallScore: number;
  overallMax: number;
  summary: string;
  nextSteps: string;
  risks: string;
}) {
  try {
    const q = `
      INSERT INTO opportunity_rollups
        (org_id, opportunity_id, overall_score, overall_max, summary, next_steps, risks, updated_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (org_id, opportunity_id)
      DO UPDATE SET
        overall_score = EXCLUDED.overall_score,
        overall_max = EXCLUDED.overall_max,
        summary = EXCLUDED.summary,
        next_steps = EXCLUDED.next_steps,
        risks = EXCLUDED.risks,
        updated_at = NOW()
      RETURNING org_id, opportunity_id, overall_score, overall_max, summary, next_steps, risks, updated_at
    `;
    const { rows } = await pool.query(q, [
      args.orgId,
      args.opportunityId,
      args.overallScore,
      args.overallMax,
      String(args.summary || "").trim(),
      String(args.nextSteps || "").trim(),
      String(args.risks || "").trim(),
    ]);
    return rows?.[0] || null;
  } catch (e: any) {
    if (String(e?.code || "") === "42P01") {
      throw new Error("DB migration missing: opportunity_rollups");
    }
    throw e;
  }
}

async function regenerateRollupText(args: {
  orgId: number;
  opportunityId: number;
  assessments: Array<{ category: string; score: number; label?: string; tip?: string; evidence: string }>;
  overallScore: number;
  overallMax: number;
  assessedCategories: string[];
  unassessedCategories: string[];
}) {
  const partialDisclaimer =
    "Overall score reflects only updated categories; remaining categories not assessed yet.";

  const instructions = [
    "You are generating derived rollup outputs for a sales opportunity.",
    "CRITICAL:",
    "- Do NOT rescore any category. Scores provided are authoritative.",
    "- Use ONLY the provided per-category evidence/tips; do not invent facts.",
    "- Output MUST be strict JSON with keys: summary, next_steps, risks.",
    "- Do NOT present the score as a failing grade when coverage is incomplete.",
    `- If not all categories are assessed, the summary MUST start with this exact sentence: "${partialDisclaimer}"`,
    '- Do NOT use "out of 30" language. Prefer percent language.',
  ].join("\n");

  const byCat = new Map<string, { score: number; label: string; tip: string; evidence: string }>();
  for (const a of args.assessments || []) {
    byCat.set(String(a.category), {
      score: Number(a.score) || 0,
      label: String((a as any).label || "").trim(),
      tip: String((a as any).tip || "").trim(),
      evidence: String(a.evidence || "").trim(),
    });
  }

  const lines = ALL_CATEGORIES.map((catKey) => {
    const v = byCat.get(catKey);
    const cat = displayCategory(catKey);
    const score = v ? v.score : 0;
    const label = v ? v.label : "";
    const tip = v ? v.tip : "";
    const ev = v ? v.evidence : "";
    return `CATEGORY: ${cat}\nSCORE: ${score}\nLABEL: ${label || "(none)"}\nTIP: ${tip || "(none)"}\nEVIDENCE:\n${ev || "(none)"}\n`;
  }).join("\n");

  const input = [
    `Opportunity: ${args.opportunityId} (org ${args.orgId})`,
    `Assessed categories: ${args.assessedCategories.join(", ") || "(none)"}`,
    `Unassessed categories: ${args.unassessedCategories.join(", ") || "(none)"}`,
    `Overall score (assessed-only points): ${args.overallScore} / ${args.overallMax}`,
    `Overall percent (assessed-only): ${
      args.overallMax > 0 ? Math.round((Number(args.overallScore) / Number(args.overallMax)) * 100) : 0
    }%`,
    "",
    "Per-category assessments:",
    lines,
    "",
    "Return JSON only.",
  ].join("\n");

  const { text } = await callModelJSON({ instructions, input });
  const obj = parseStrictJson(text);
  const rawSummary = String(obj?.summary || "").trim();
  const summary = rawSummary && rawSummary.startsWith(partialDisclaimer)
    ? rawSummary
    : args.unassessedCategories.length
      ? `${partialDisclaimer}\n\n${rawSummary || ""}`.trim()
      : rawSummary;
  return {
    summary,
    next_steps: String(obj?.next_steps || "").trim(),
    risks: String(obj?.risks || "").trim(),
  };
}

export async function POST(req: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const resolvedParams = await Promise.resolve(params as any);
    const opportunityId = Number.parseInt(String(resolvedParams?.id ?? ""), 10);
    if (!opportunityId) return NextResponse.json({ ok: false, error: "Invalid opportunity id" }, { status: 400 });

    // Parse body from raw text first (most reliable across runtimes/clients).
    // NOTE: Request bodies are streams; avoid multiple reads that can yield empty bodies.
    const raw = await req.text().catch(() => "");
    let body: any = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
        // If the JSON itself is a quoted JSON string, parse again.
        if (typeof body === "string" && body.trim().startsWith("{")) body = JSON.parse(body);
      } catch {
        body = parseLooseObject(raw) || {};
      }
    } else {
      // Fallback: some Next internals may not provide raw text; try json().
      body = await req.json().catch(() => ({}));
    }

    // Keep orgId parsing behavior, but allow query fallback for debugging clients.
    const url = new URL(req.url);
    const orgId = Number(body?.orgId || url.searchParams.get("orgId") || 0);
    let sessionId = String(body?.sessionId || "").trim();
    const category = String(body?.category || "").trim() as CategoryKey;
    const text = String(body?.text || "").trim();

    if (!orgId) {
      const debug = process.env.NODE_ENV !== "production";
      return NextResponse.json(
        {
          ok: false,
          error: "Missing orgId",
          ...(debug
            ? {
                debug: {
                  contentType: req.headers.get("content-type"),
                  rawLen: raw.length,
                  rawHead: raw.slice(0, 200),
                  parsedType: typeof body,
                  parsedKeys: body && typeof body === "object" ? Object.keys(body).slice(0, 20) : [],
                },
              }
            : {}),
        },
        { status: 400 }
      );
    }
    if (!category) return NextResponse.json({ ok: false, error: "Missing category" }, { status: 400 });

    const catLabel = displayCategory(category);

    // Start: return the first targeted question (no model call required).
    if (!sessionId) {
      const newId = randomUUID();
      const q = firstQuestionForCategory(category);
      const session = {
        sessionId: newId,
        orgId,
        opportunityId,
        category,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        turns: [{ role: "assistant" as const, text: q, at: Date.now() }],
      };
      categoryUpdateSessions.set(newId, session);
      // If caller didn't provide text, just start and ask the question.
      // If caller DID provide text, treat it as the rep's answer and continue in the same request.
      if (!text) {
        return NextResponse.json({
          ok: true,
          sessionId: newId,
          assistantText: q,
          category: { key: category, label: catLabel },
        });
      }
      sessionId = newId;
    }

    const session = categoryUpdateSessions.get(sessionId);
    if (!session) return NextResponse.json({ ok: false, error: "Invalid sessionId" }, { status: 400 });
    if (session.orgId !== orgId || session.opportunityId !== opportunityId || session.category !== category) {
      return NextResponse.json({ ok: false, error: "Session mismatch" }, { status: 400 });
    }

    // If no user text, just repeat last assistant prompt.
    if (!text) {
      const lastAssistant = [...(session.turns || [])].reverse().find((t) => t.role === "assistant")?.text || "";
      return NextResponse.json({ ok: true, sessionId, assistantText: lastAssistant });
    }

    session.turns.push({ role: "user", text, at: Date.now() });
    session.updatedAt = Date.now();

    const defs = await fetchRubric(orgId, category);
    const rubric = rubricText(defs);

    const instructions = [
      "You are updating EXACTLY ONE category assessment for a sales opportunity.",
      `CATEGORY: ${catLabel}`,
      "",
      "Rules:",
      "- Ask at most ONE follow-up question if information is insufficient.",
      "- Otherwise finalize with a score 0-3, a coaching tip, and a short evidence statement (rationale).",
      "- Use ONLY the rubric definitions provided. Do not invent facts.",
      "- Output MUST be strict JSON only. No markdown, no extra text.",
      "",
      "JSON schema:",
      `{"action":"followup","question":"..."} OR {"action":"finalize","score":0,"tip":"...","evidence":"..."}`,
    ].join("\n");

    const transcript = session.turns
      .map((t) => `${t.role.toUpperCase()}: ${t.text}`)
      .join("\n");

    const input = [
      `Rubric definitions (authoritative for this category):`,
      rubric || "(no rubric found)",
      "",
      "Conversation so far:",
      transcript,
    ].join("\n");

    const { text: modelText } = await callModelJSON({ instructions, input });
    const obj = parseStrictJson(modelText);
    const action = String(obj?.action || "").trim();

    if (action === "followup") {
      const q = String(obj?.question || "").trim() || `Can you share one concrete example that supports ${catLabel}?`;
      session.turns.push({ role: "assistant", text: q, at: Date.now() });
      session.updatedAt = Date.now();
      return NextResponse.json({ ok: true, sessionId, assistantText: q });
    }

    if (action !== "finalize") {
      return NextResponse.json(
        { ok: false, error: "Model returned invalid action", detail: modelText.slice(0, 500) },
        { status: 502 }
      );
    }

    const score = Math.max(0, Math.min(3, Number(obj?.score)));
    const evidence = String(obj?.evidence || "").trim();
    const tip = String(obj?.tip || "").trim();
    if (!Number.isFinite(score)) {
      return NextResponse.json({ ok: false, error: "Invalid score from model" }, { status: 502 });
    }
    const label = await fetchLabelForScore(orgId, category, score);

    const saved = await upsertAssessment({
      orgId,
      opportunityId,
      category,
      score,
      label,
      tip,
      evidence,
      turns: session.turns,
    });

    // Deterministic rollup from stored scores + DB weights.
    const assessments = (await fetchAssessments(orgId, opportunityId)) as Array<{
      category: string;
      score: number;
      label: string;
      tip: string;
      evidence: string;
    }>;
    const assessedCategories = assessments.map((a) => String(a.category));
    const unassessedCategories = ALL_CATEGORIES.filter((c) => !assessedCategories.includes(c));
    const weights = await fetchWeights(orgId);
    // Partial rollup mode: percent should reflect assessed coverage only.
    const overall = computeOverallScore({
      assessments: assessments.map((a) => ({ category: a.category, score: Number(a.score) || 0 })),
      weights,
      includedCategories: assessedCategories.length ? assessedCategories : [],
    });
    const rollupText = await regenerateRollupText({
      orgId,
      opportunityId,
      assessments,
      overallScore: overall.overall_score,
      overallMax: overall.overall_max,
      assessedCategories,
      unassessedCategories,
    });
    const rollupSaved = await upsertRollup({
      orgId,
      opportunityId,
      overallScore: overall.overall_score,
      overallMax: overall.overall_max,
      summary: rollupText.summary,
      nextSteps: rollupText.next_steps,
      risks: rollupText.risks,
    });

    const assistantText = [
      `${catLabel} updated.`,
      `Score: ${score} / 3`,
      `Label: ${label || "(none)"}`,
      tip ? `Tip: ${tip}` : "",
      overall.overall_max ? `Overall: ${overall.overall_score} / ${overall.overall_max}` : `Overall: ${overall.overall_score}`,
    ].filter(Boolean).join("\n");

    session.turns.push({ role: "assistant", text: assistantText, at: Date.now() });
    session.updatedAt = Date.now();

    return NextResponse.json({
      ok: true,
      sessionId,
      assistantText,
      categoryResult: saved,
      rollup: rollupSaved,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

