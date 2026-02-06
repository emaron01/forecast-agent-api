import { NextResponse } from "next/server";

export const runtime = "nodejs";

function resolveBaseUrl() {
  const raw = (process.env.OPENAI_BASE_URL || process.env.MODEL_API_URL || "").trim();
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
    const apiKey = process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY;
    const model = process.env.TRANSCRIBE_MODEL;

    if (!baseUrl)
      return NextResponse.json(
        { ok: false, error: "Missing OPENAI_BASE_URL (or MODEL_API_URL)" },
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

    const resp = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: outForm,
    });

    const text = await resp.text();
    if (!resp.ok) {
      return NextResponse.json({ ok: false, error: text || "Transcription failed" }, { status: resp.status });
    }

    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, error: "Transcription returned non-JSON", raw: text }, { status: 502 });
    }

    return NextResponse.json({ ok: true, text: String(json?.text || "") });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

