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

function toBase64(buf: ArrayBuffer) {
  // Node.js Buffer is available in Next nodejs runtime
  return Buffer.from(buf).toString("base64");
}

export async function POST(req: Request) {
  try {
    const baseUrl = resolveBaseUrl();
    const apiKey = String(process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY || "").trim();
    const model = process.env.TTS_MODEL;
    const voice = String(process.env.TTS_VOICE || "").trim().toLowerCase();
    const responseFormat = process.env.TTS_FORMAT || "mp3";

    if (!baseUrl)
      return NextResponse.json(
        { ok: false, error: "Missing OPENAI_BASE_URL (or MODEL_API_URL or MODEL_URL)" },
        { status: 500 }
      );
    if (!apiKey) return NextResponse.json({ ok: false, error: "Missing MODEL_API_KEY" }, { status: 500 });
    if (!model) return NextResponse.json({ ok: false, error: "Missing TTS_MODEL" }, { status: 500 });
    if (!voice) return NextResponse.json({ ok: false, error: "Missing TTS_VOICE" }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const input = String(body?.text || "").trim();
    if (!input) return NextResponse.json({ ok: false, error: "Missing text" }, { status: 400 });

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
      const errText = await resp.text();
      return NextResponse.json({ ok: false, error: errText || "TTS failed" }, { status: resp.status });
    }

    const buf = await resp.arrayBuffer();
    const b64 = toBase64(buf);
    // For now, return base64 for browser playback.
    return NextResponse.json({
      ok: true,
      audio_base64: b64,
      mime: responseFormat === "wav" ? "audio/wav" : responseFormat === "aac" ? "audio/aac" : responseFormat === "opus" ? "audio/opus" : "audio/mpeg",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

