/**
 * voiceStreaming.ts
 * Latency-layer only: LLM streaming, sentence detection, and TTS chunking for voice pipeline.
 * Does NOT modify: MEDDPICC scoring, gating, saves, DB writes, prompts, or model selection.
 */

const MIN_SENTENCE_LENGTH = 40;
const MAX_SENTENCES_BEFORE_STOP = 2;
const FALLBACK_TOKEN_LIMIT = 120;

const DEFAULT_MIN_QUESTION_CHARS = 25;
const DEFAULT_REQUIRE_END_PUNCT = false;
const DEFAULT_REQUIRE_ACTION_FOLLOWUP = true;

const INTERROGATIVE_START =
  /^(what|who|when|where|why|how|which|do|does|did|is|are|can|could|would|should|will|have|has|may)\b/i;

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(s: string): number {
  return Math.ceil((s || "").length / 4);
}

/**
 * Extract a JSON string value for a given key from partial buffer.
 * Robust: handles \\, \", \n, \r, \t, \uXXXX. Returns decoded string only when
 * we have a complete, properly-terminated value. Uses JSON.parse for safe decoding.
 */
function extractJsonStringValue(buffer: string, key: string): string | null {
  const pattern = new RegExp('"' + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"\\s*:\\s*', "i");
  const m = pattern.exec(buffer);
  if (!m) return null;
  let i = (m.index || 0) + (m[0]?.length ?? 0);
  if (i >= buffer.length || buffer[i] !== '"') return null;
  i++;
  const start = i;
  const raw: string[] = [];
  while (i < buffer.length) {
    const c = buffer[i];
    if (c === "\\") {
      if (i + 1 >= buffer.length) return null;
      const next = buffer[i + 1];
      if (next === "u" && i + 5 < buffer.length) {
        raw.push(buffer.slice(i, i + 6));
        i += 6;
        continue;
      }
      raw.push(buffer.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (c === '"') {
      const rawStr = raw.join("");
      try {
        const wrapped = '{"_":"' + rawStr.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"}';
        return JSON.parse(wrapped)._ as string;
      } catch {
        return null;
      }
    }
    raw.push(c);
    i++;
  }
  return null;
}

export function extractQuestionFromPartialJson(buffer: string): string | null {
  return extractJsonStringValue(buffer, "question");
}

export function extractActionFromPartialJson(buffer: string): string | null {
  const a = extractJsonStringValue(buffer, "action");
  if (typeof a !== "string") return null;
  const s = a.trim().toLowerCase();
  return s || null;
}

export function getVoiceTuningFlags() {
  const minChars = Number(process.env.VOICE_MIN_QUESTION_CHARS);
  return {
    minQuestionChars: Number.isFinite(minChars) && minChars > 0 ? minChars : DEFAULT_MIN_QUESTION_CHARS,
    requireEndPunct: process.env.VOICE_REQUIRE_END_PUNCT === "true",
    requireActionFollowup: process.env.VOICE_REQUIRE_ACTION_FOLLOWUP !== "false",
  };
}

/**
 * Check if question passes early-emit gating (avoids micro/garbage emits).
 * Requires EITHER: contains "?" OR starts with common interrogative.
 */
export function passesEarlyEmitGate(
  question: string,
  opts: { requireEndPunct?: boolean } = {}
): boolean {
  const q = String(question || "").trim();
  if (!q) return false;
  if (opts.requireEndPunct && !/[.?!]\s*$/.test(q)) return false;
  if (q.includes("?")) return true;
  if (INTERROGATIVE_START.test(q)) return true;
  return false;
}

/**
 * Detect sentence boundaries: . ? !
 * Min length 40 chars, stop after 2 sentences, fallback flush at 120 tokens.
 */
export function extractSentences(
  text: string,
  opts: { maxSentences?: number; minLength?: number; fallbackTokens?: number } = {}
): string[] {
  const maxSentences = opts.maxSentences ?? MAX_SENTENCES_BEFORE_STOP;
  const minLength = opts.minLength ?? MIN_SENTENCE_LENGTH;
  const fallbackTokens = opts.fallbackTokens ?? FALLBACK_TOKEN_LIMIT;

  const sentences: string[] = [];
  let buffer = "";
  let tokenCount = 0;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    buffer += c;
    tokenCount = estimateTokens(buffer);

    const endsWithBoundary = /[.?!]\s*$/.test(buffer);
    const longEnough = buffer.trim().length >= minLength;

    if (endsWithBoundary && longEnough) {
      const trimmed = buffer.trim();
      if (trimmed) sentences.push(trimmed);
      buffer = "";
      if (sentences.length >= maxSentences) break;
    } else if (tokenCount >= fallbackTokens && buffer.trim().length > 0) {
      const trimmed = buffer.trim();
      if (trimmed) sentences.push(trimmed);
      buffer = "";
      break;
    }
  }

  if (buffer.trim()) sentences.push(buffer.trim());
  return sentences;
}

/**
 * Log latency metrics when VOICE_LATENCY_LOGGING=true.
 * Does NOT log PII or transcript contents.
 */
export function logVoiceLatency(metrics: {
  time_to_first_token_ms?: number;
  time_to_first_audio_ms?: number;
  total_turn_time_ms?: number;
  early_audio_used?: boolean;
  early_validation_mismatch?: boolean;
  early_action_seen_early?: boolean;
}) {
  if (process.env.VOICE_LATENCY_LOGGING !== "true") return;
  console.log(
    JSON.stringify({
      event: "voice_latency",
      ...metrics,
    })
  );
}
