import { createHash } from "node:crypto";

export type DashboardInsight = {
  widgetId: string;
  widgetName: string;
  dashboardType: string;
  createdAt: string | number;
  text: string;
};

export type CleanedDashboardInsight = {
  widgetId: string;
  widgetName: string;
  dashboardType: string;
  createdAt: string; // ISO
  text: string; // cleaned, capped
  fingerprint: string;
  _createdAtMs: number;
  _tokens: string[];
};

export type ExecutiveSnapshot = {
  headline: string;
  strengths: string[];
  risks: string[];
  opportunities: string[];
  actions_30_days: string[];
  supporting_notes?: string[];
};

function resolveBaseUrl() {
  const raw = (process.env.OPENAI_BASE_URL || process.env.MODEL_API_URL || process.env.MODEL_URL || "").trim();
  if (!raw) return "";
  const wsNormalized = raw.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
  const strippedRealtime = wsNormalized.replace(/\/v1\/realtime(?:\/calls)?$/i, "/v1");
  const noTrail = strippedRealtime.replace(/\/+$/, "");
  return noTrail.endsWith("/v1") ? noTrail : `${noTrail}/v1`;
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

function safeParseJsonObject(text: string): any | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const stripFence = (s: string) => {
    const t = String(s || "").trim();
    if (!t) return "";
    const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (m && m[1]) return String(m[1]).trim();
    return t;
  };

  const fenced = stripFence(raw);
  const candidates: string[] = [fenced, raw].filter(Boolean);
  const first = fenced.indexOf("{");
  const last = fenced.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(fenced.slice(first, last + 1).trim());

  for (const c of candidates) {
    try {
      return JSON.parse(String(c));
    } catch {
      // continue
    }
  }
  return null;
}

export async function generateSnapshot(cleanedInsights: CleanedDashboardInsight[], opts?: { maxOutputTokens?: number }) {
  const baseUrl = resolveBaseUrl();
  const apiKey = String(process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const model = "gpt-5.2-mini";
  if (!baseUrl) throw new Error("Missing OPENAI_BASE_URL (or MODEL_API_URL or MODEL_URL)");
  if (!apiKey) throw new Error("Missing MODEL_API_KEY");

  const system =
    "You are generating an Executive Snapshot for a board/shareholder audience.\n" +
    "These inputs are dashboard-level AI insights (NOT raw metrics, NOT deal-level forecasts).\n" +
    "SYNTHESIZE the provided insights into a single board-shareable snapshot.\n" +
    "Do NOT invent numbers, facts, or specifics not present in the input.\n" +
    "Do NOT repeat the input verbatim.\n" +
    "If signal is weak or contradictory, say so explicitly.\n" +
    "Output MUST be STRICT JSON (no markdown, no prose) matching the required schema.";

  const user =
    "Cleaned dashboard insights (grouped). Use only this content:\n\n" +
    buildExecutiveSnapshotPrompt(cleanedInsights) +
    "\n\n" +
    "REQUIRED JSON OUTPUT SHAPE:\n" +
    "{\n" +
    '  "headline": string,\n' +
    '  "strengths": string[],\n' +
    '  "risks": string[],\n' +
    '  "opportunities": string[],\n' +
    '  "actions_30_days": string[],\n' +
    '  "supporting_notes": string[] | undefined\n' +
    "}\n" +
    "RULES:\n" +
    "- Crisp executive / board language.\n" +
    "- 3–6 bullets per array.\n" +
    "- No fluff. No rep coaching tone.\n";

  const resp = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: system,
      temperature: 0.2,
      max_output_tokens: Math.max(300, Math.min(450, opts?.maxOutputTokens ?? 420)),
      tool_choice: "none",
      input: [{ role: "user", content: user }],
    }),
  });

  const json = await resp.json().catch(async () => ({ error: { message: await resp.text() } }));
  if (!resp.ok) throw new Error(json?.error?.message || JSON.stringify(json));

  const text = extractAssistantText(Array.isArray(json?.output) ? json.output : []);
  const parsed = safeParseJsonObject(text);
  return { rawText: text, parsed };
}

export function preprocessInsights(
  insights: DashboardInsight[],
  opts?: { maxInsights?: number; maxInsightChars?: number; maxTotalChars?: number }
): { cleanedInsights: CleanedDashboardInsight[]; inputHash: string; inputCountUsed: number } {
  const maxInsights = Math.max(1, Math.min(50, opts?.maxInsights ?? 20));
  const maxInsightChars = Math.max(200, Math.min(8000, opts?.maxInsightChars ?? 1800));
  const maxTotalChars = Math.max(2000, Math.min(120000, opts?.maxTotalChars ?? 24000));

  const parsed = (Array.isArray(insights) ? insights : [])
    .map((x) => {
      const widgetId = String((x as any)?.widgetId ?? "").trim();
      const widgetName = String((x as any)?.widgetName ?? "").trim();
      const dashboardType = String((x as any)?.dashboardType ?? "").trim();
      const createdAtRaw = (x as any)?.createdAt;
      const textRaw = String((x as any)?.text ?? "");

      const createdAtMs = parseTimestampMs(createdAtRaw);
      const createdAtIso = createdAtMs ? new Date(createdAtMs).toISOString() : new Date(0).toISOString();

      const cleaned = cleanInsightText(textRaw);
      const capped = capChars(cleaned, maxInsightChars);
      const tokens = tokensForSimilarity(capped);
      const fingerprint = sha256(tokens.join(" "));

      return {
        widgetId,
        widgetName,
        dashboardType,
        createdAt: createdAtIso,
        text: capped,
        fingerprint,
        _createdAtMs: createdAtMs,
        _tokens: tokens,
      } satisfies CleanedDashboardInsight;
    })
    .filter((x) => x.widgetId && x.widgetName && x.dashboardType && x.text.trim());

  parsed.sort((a, b) => (b._createdAtMs - a._createdAtMs) || b.createdAt.localeCompare(a.createdAt));

  const kept: CleanedDashboardInsight[] = [];
  for (const cur of parsed) {
    if (kept.length >= maxInsights) break;
    if (kept.some((k) => k.fingerprint === cur.fingerprint)) continue;
    const tooSimilar = kept.some((k) => jaccard(k._tokens, cur._tokens) > 0.85);
    if (tooSimilar) continue;
    kept.push(cur);
  }

  // Enforce overall cap: if still too large, trim each insight uniformly (no re-ranking).
  const totalChars = () => kept.reduce((acc, x) => acc + x.text.length, 0);
  if (totalChars() > maxTotalChars) {
    const per = Math.max(160, Math.floor(maxTotalChars / Math.max(1, kept.length)));
    for (const k of kept) k.text = capChars(k.text, per);
  }

  const inputHash = sha256(
    JSON.stringify(
      kept.map((k) => ({
        widgetId: k.widgetId,
        widgetName: k.widgetName,
        dashboardType: k.dashboardType,
        createdAt: k.createdAt,
        fingerprint: k.fingerprint,
      }))
    )
  );

  return { cleanedInsights: kept, inputHash, inputCountUsed: kept.length };
}

export function buildExecutiveSnapshotPrompt(cleanedInsights: CleanedDashboardInsight[]) {
  const groups = new Map<string, CleanedDashboardInsight[]>();
  for (const x of cleanedInsights) {
    const k = String(x.dashboardType || "unknown").trim().toLowerCase() || "unknown";
    const arr = groups.get(k) || [];
    arr.push(x);
    groups.set(k, arr);
  }

  const typeOrder = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
  const lines: string[] = [];
  for (const t of typeOrder) {
    const list = (groups.get(t) || []).slice().sort((a, b) => (b._createdAtMs - a._createdAtMs) || b.createdAt.localeCompare(a.createdAt));
    lines.push(`${t.toUpperCase()}:`);
    for (const x of list) {
      const header = `- ${x.widgetName} (widgetId=${x.widgetId}, createdAt=${x.createdAt})`;
      const body = x.text
        .split("\n")
        .map((l) => l.trimEnd())
        .filter(Boolean)
        .slice(0, 80)
        .join("\n");
      lines.push(header);
      lines.push(indent(body, "  "));
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function snapshotCacheKey(args: { orgId: number; quotaPeriodId: string; inputHash: string }) {
  return sha256(`${String(args.orgId)}|${String(args.quotaPeriodId)}|${String(args.inputHash)}`);
}

function parseTimestampMs(v: any) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.round(v));
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const n = Number(s);
  if (Number.isFinite(n) && s.length >= 10) return Math.max(0, Math.round(n));
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : 0;
}

function cleanInsightText(text: string) {
  const raw = normalizeNewlines(String(text || ""));
  if (!raw.trim()) return "";

  // Normalize common "envelope" headings without losing content.
  const headingRx = /^\s*(summary|extended analysis|executive summary|executive narrative|analysis|takeaway|takeaways)\s*:?\s*$/i;
  const inlineHeadingRx = /^\s*(summary|extended analysis|executive summary|executive narrative)\s*:\s*(.+)$/i;

  const cleanedLines: string[] = [];
  for (const line of raw.split("\n")) {
    const t = String(line || "").trimEnd();
    if (!t.trim()) {
      cleanedLines.push("");
      continue;
    }
    if (headingRx.test(t.trim())) continue;
    const m = t.match(inlineHeadingRx);
    if (m && m[2]) {
      cleanedLines.push(String(m[2]).trim());
      continue;
    }
    cleanedLines.push(t);
  }

  const normalized = collapseBlankLines(cleanedLines.join("\n")).trim();

  // Deduplicate paragraphs within a block (presentation duplicates).
  const seen = new Set<string>();
  const outParas: string[] = [];
  for (const p of splitParagraphs(normalized)) {
    const key = normalizeParagraphForDedupe(p);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    outParas.push(p.trim());
  }

  return collapseBlankLines(outParas.join("\n\n")).trim();
}

function splitParagraphs(text: string) {
  return String(text || "")
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);
}

function normalizeParagraphForDedupe(p: string) {
  const s = String(p || "").trim();
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[\t ]+/g, " ")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNewlines(s: string) {
  return String(s || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function collapseBlankLines(s: string) {
  return String(s || "")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function capChars(text: string, maxChars: number) {
  const s = String(text || "").trim();
  if (!s) return "";
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars).trimEnd()}…`;
}

function tokensForSimilarity(text: string) {
  const stop = STOPWORDS;
  const t = String(text || "")
    .toLowerCase()
    .replace(/\d+(?:[.,]\d+)?/g, " <num> ")
    .replace(/[%$€£¥]/g, " ")
    .replace(/[^\p{L}\p{N}\s<>]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return [];
  const raw = t.split(" ");
  const out: string[] = [];
  for (const tok of raw) {
    const w = tok.trim();
    if (!w) continue;
    if (w !== "<num>" && w.length < 2) continue;
    if (stop.has(w)) continue;
    out.push(w);
  }
  return out;
}

function jaccard(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

function sha256(s: string) {
  return createHash("sha256").update(String(s || ""), "utf8").digest("hex");
}

function indent(text: string, prefix: string) {
  return String(text || "")
    .split("\n")
    .map((l) => `${prefix}${l}`)
    .join("\n");
}

const STOPWORDS = new Set(
  [
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "if",
    "then",
    "else",
    "to",
    "of",
    "in",
    "on",
    "for",
    "with",
    "at",
    "by",
    "from",
    "as",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "we",
    "our",
    "you",
    "your",
  ].filter(Boolean)
);

