import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

export async function POST(req: Request) {
  try {
    const baseUrl = resolveBaseUrl();
    const apiKey = String(process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY || "").trim();
    const model = process.env.TRANSCRIBE_MODEL;

    if (!baseUrl)
      return NextResponse.json(
        { ok: false, error: "Missing OPENAI_BASE_URL (or MODEL_API_URL or MODEL_URL)" },
        { status: 500 }
      );
    if (!apiKey) return NextResponse.json({ ok: false, error: "Missing MODEL_API_KEY" }, { status: 500 });
    if (!model) return NextResponse.json({ ok: false, error: "Missing TRANSCRIBE_MODEL" }, { status: 500 });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing audio file (field: file)" }, { status: 400 });
    }

    const outForm = new FormData();
    outForm.set("model", model);
    // Preserve filename/type for OpenAI ingestion
    outForm.set("file", file, file.name || "audio.webm");
    const language = form.get("language");
    if (typeof language === "string" && language.trim()) outForm.set("language", language.trim());

    // Use plain text when supported to avoid JSON parse errors (trailing content, unescaped quotes).
    // whisper-1 supports "text"; gpt-4o-transcribe* only support "json". Set STT_RESPONSE_FORMAT=text to force.
    const useFormatText =
      process.env.STT_RESPONSE_FORMAT === "text" || (model && /^whisper-1$/i.test(model));
    if (useFormatText) outForm.set("response_format", "text");

    const resp = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: outForm,
    });

    const rawText = await resp.text();
    // TEMP DEBUG: log upstream STT body for analysis (server logs only).
    const contentType = resp.headers.get("content-type") || "";
    const contentLength = resp.headers.get("content-length") || "";
    console.log(
      JSON.stringify({
        event: "stt_upstream_response",
        ok: resp.ok,
        status: resp.status,
        content_type: contentType,
        content_length: contentLength,
        head: rawText.slice(0, 500),
        tail: rawText.length > 500 ? rawText.slice(-500) : "",
        total_length: rawText.length,
      })
    );
    if (!resp.ok) {
      const trimmed = rawText.trim();
      const isProviderJsonParseError = /Unexpected non-whitespace character after JSON/i.test(trimmed);
      const friendlyError = isProviderJsonParseError ? "Transcription backend returned invalid JSON" : trimmed || "Transcription failed";
      return NextResponse.json({ ok: false, error: friendlyError }, { status: resp.status });
    }

    if (useFormatText) {
      return NextResponse.json({ ok: true, text: rawText.trim() });
    }

    const text = rawText.trim();
    let json: any = null;

    try {
      json = JSON.parse(text);
    } catch {
      // Some providers return JSON with trailing content (e.g. "Unexpected non-whitespace after JSON").
      // Try parsing up to each "}" from first to last until we get valid JSON.
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "}") {
          try {
            const candidate = JSON.parse(text.slice(0, i + 1));
            if (candidate && typeof candidate.text === "string") {
              json = candidate;
              break;
            }
          } catch {
            /* try next } */
          }
        }
      }
      if (!json) {
        return NextResponse.json(
          { ok: false, error: "Transcription returned non-JSON", raw: text.slice(0, 500) },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({ ok: true, text: String(json?.text || "") });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

