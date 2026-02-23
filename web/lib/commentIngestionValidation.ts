/** Pure parsing/validation for comment ingestion extraction. No external deps. */

export type CommentIngestionExtracted = {
  summary: string;
  meddpicc: Record<
    string,
    { signal: string; evidence: string[]; gaps: string[] }
  >;
  timing: { signal: string; evidence: string[]; gaps: string[] };
  budget: { signal: string; evidence: string[]; gaps: string[] };
  risk_flags: Array<{ type: string; severity: string; why: string }>;
  next_steps: string[];
  follow_up_questions: Array<{
    category: string;
    question: string;
    priority: string;
  }>;
  extraction_confidence: string;
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
