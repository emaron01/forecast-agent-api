import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { startSpan, endSpan } from "../../../lib/perf";

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

function toBase64(buf: ArrayBuffer) {
  // Node.js Buffer is available in Next nodejs runtime
  return Buffer.from(buf).toString("base64");
}

export async function POST(req: Request) {
  const callId = randomUUID();
  const reqSpan = startSpan({
    workflow: "voice_review",
    stage: "request_total",
    org_id: 0,
    call_id: callId,
  });
  try {
    const baseUrl = resolveBaseUrl();
    const apiKey = String(process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY || "").trim();
    const model = process.env.TTS_MODEL;
    const voice = String(process.env.TTS_VOICE || "").trim().toLowerCase();
    const responseFormat = process.env.TTS_FORMAT || "mp3";

    if (!baseUrl) {
      endSpan(reqSpan, { status: "error", http_status: 500 });
      return NextResponse.json(
        { ok: false, error: "Missing OPENAI_BASE_URL (or MODEL_API_URL or MODEL_URL)" },
        { status: 500 }
      );
    }
    if (!apiKey) {
      endSpan(reqSpan, { status: "error", http_status: 500 });
      return NextResponse.json({ ok: false, error: "Missing MODEL_API_KEY" }, { status: 500 });
    }
    if (!model) {
      endSpan(reqSpan, { status: "error", http_status: 500 });
      return NextResponse.json({ ok: false, error: "Missing TTS_MODEL" }, { status: 500 });
    }
    if (!voice) {
      endSpan(reqSpan, { status: "error", http_status: 500 });
      return NextResponse.json({ ok: false, error: "Missing TTS_VOICE" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const input = String(body?.text || "").trim();
    if (!input) {
      endSpan(reqSpan, { status: "error", http_status: 400 });
      return NextResponse.json({ ok: false, error: "Missing text" }, { status: 400 });
    }

    const ttsSpan = startSpan({
      workflow: "voice_review",
      stage: "tts",
      org_id: 0,
      call_id: callId,
      text_chars: input.length,
      model: model ?? null,
    });

    const resp = await fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
        input,
        response_format: responseFormat,
      }),
    });

    if (!resp.ok) {
      endSpan(ttsSpan, { status: "error", http_status: resp.status });
      endSpan(reqSpan, { status: "error", http_status: resp.status });
      const errText = await resp.text();
      return NextResponse.json({ ok: false, error: errText || "TTS failed" }, { status: resp.status });
    }

    endSpan(ttsSpan, { status: "ok", http_status: resp.status });
    const buf = await resp.arrayBuffer();
    const b64 = toBase64(buf);
    endSpan(reqSpan, { status: "ok", http_status: 200 });
    return NextResponse.json({
      ok: true,
      audio_base64: b64,
      mime: responseFormat === "wav" ? "audio/wav" : responseFormat === "aac" ? "audio/aac" : responseFormat === "opus" ? "audio/opus" : "audio/mpeg",
    });
  } catch (e: any) {
    endSpan(reqSpan, { status: "error", http_status: 500 });
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

