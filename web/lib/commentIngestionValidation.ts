/** Pure parsing/validation for comment ingestion extraction. No external deps. */

export type CategoryExtraction = {
  signal: string;
  evidence: string[];
  gaps: string[];
  score?: number;
  evidence_text?: string;
  tip?: string;
};

export type CommentIngestionExtracted = {
  summary: string;
  meddpicc: Record<string, CategoryExtraction>;
  timing: CategoryExtraction;
  budget: CategoryExtraction;
  risk_flags: Array<{ type: string; severity: string; why: string }>;
  next_steps: string[];
  follow_up_questions: Array<{
    category: string;
    question: string;
    priority: string;
  }>;
  extraction_confidence: string;
  champion_name?: string | null;
  champion_title?: string | null;
  eb_name?: string | null;
  eb_title?: string | null;
};

/** Basic schema validation for extraction output. Returns null if invalid. */
export function validateCommentIngestionExtraction(parsed: any): CommentIngestionExtracted | null {
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.summary !== "string") return null;
  if (!parsed.meddpicc || typeof parsed.meddpicc !== "object") return null;
  if (!parsed.timing || typeof parsed.timing !== "object") return null;
  if (!parsed.budget || typeof parsed.budget !== "object") return null;
  if (!Array.isArray(parsed.risk_flags)) return null;
  if (!Array.isArray(parsed.next_steps)) return null;
  if (!Array.isArray(parsed.follow_up_questions)) return null;
  if (typeof parsed.extraction_confidence !== "string") return null;
  return parsed as CommentIngestionExtracted;
}

export function stripJsonFence(text: string): string {
  const t = String(text || "").trim();
  if (!t) return "";
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (m?.[1]) return String(m[1]).trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) return t.slice(first, last + 1).trim();
  return t;
}

export function tryParseExtraction(text: string): CommentIngestionExtracted | null {
  const raw = stripJsonFence(text);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    return validateCommentIngestionExtraction(parsed);
  } catch {
    return null;
  }
}

/** Result of a single per-category LLM call. */
export type SingleCategoryResult = {
  score: number;
  evidence_text: string;
  tip: string;
  signal: string;
};

/** Parse LLM response for one category. Returns null if invalid. */
export function tryParseSingleCategoryExtraction(text: string): SingleCategoryResult | null {
  const raw = stripJsonFence(text);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== "object") return null;
    const score = Number(parsed.score);
    if (!Number.isFinite(score) || score < 0 || score > 3) return null;
    return {
      score: Math.round(score),
      evidence_text: String(parsed.evidence_text ?? "").trim(),
      tip: String(parsed.tip ?? "").trim(),
      signal: String(parsed.signal ?? "missing").trim().toLowerCase() || "missing",
    };
  } catch {
    return null;
  }
}

/** Metadata from the 11th lightweight call (summary, names, confidence, risk_flags, next_steps, follow_up_questions). */
export type MetadataExtraction = {
  summary: string;
  extraction_confidence: string;
  champion_name?: string | null;
  champion_title?: string | null;
  eb_name?: string | null;
  eb_title?: string | null;
  risk_flags: Array<{ type: string; severity: string; why: string }>;
  next_steps: string[];
  follow_up_questions: Array<{ category: string; question: string; priority: string }>;
};

/** Parse LLM response for metadata-only call. Returns null if invalid. */
export function tryParseMetadataExtraction(text: string): MetadataExtraction | null {
  const raw = stripJsonFence(text);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.summary !== "string") return null;
    if (typeof parsed.extraction_confidence !== "string") return null;
    if (!Array.isArray(parsed.risk_flags)) return null;
    if (!Array.isArray(parsed.next_steps)) return null;
    if (!Array.isArray(parsed.follow_up_questions)) return null;
    return {
      summary: String(parsed.summary).trim(),
      extraction_confidence: String(parsed.extraction_confidence).trim() || "medium",
      champion_name: parsed.champion_name == null ? null : String(parsed.champion_name).trim() || null,
      champion_title: parsed.champion_title == null ? null : String(parsed.champion_title).trim() || null,
      eb_name: parsed.eb_name == null ? null : String(parsed.eb_name).trim() || null,
      eb_title: parsed.eb_title == null ? null : String(parsed.eb_title).trim() || null,
      risk_flags: Array.isArray(parsed.risk_flags)
        ? parsed.risk_flags.map((r: any) => ({
            type: String(r?.type ?? ""),
            severity: String(r?.severity ?? ""),
            why: String(r?.why ?? ""),
          }))
        : [],
      next_steps: Array.isArray(parsed.next_steps) ? parsed.next_steps.map((s: any) => String(s ?? "")) : [],
      follow_up_questions: Array.isArray(parsed.follow_up_questions)
        ? parsed.follow_up_questions.map((q: any) => ({
            category: String(q?.category ?? ""),
            question: String(q?.question ?? ""),
            priority: String(q?.priority ?? ""),
          }))
        : [],
    };
  } catch {
    return null;
  }
}
