import { NextResponse } from "next/server";
import { getAuth } from "../../../lib/auth";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are Matthew, a sales coach. Give this rep specific actionable coaching based on their current deal scores. Be direct and encouraging — not critical. Focus on the two or three things they can do THIS WEEK to move their weakest deals forward. Use their actual deal names. Maximum 150 words. No bullet points. Talk to them directly as 'you'.`;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function resolveBaseUrl() {
  const raw = (process.env.OPENAI_BASE_URL || process.env.MODEL_API_URL || process.env.MODEL_URL || "").trim();
  if (!raw) return "";
  const wsNormalized = raw.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
  const strippedRealtime = wsNormalized.replace(/\/v1\/realtime(?:\/calls)?$/i, "/v1");
  const noTrail = strippedRealtime.replace(/\/+$/, "");
  return noTrail.endsWith("/v1") ? noTrail : `${noTrail}/v1`;
}

export async function POST(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return jsonError(401, "Unauthorized");
    if (auth.kind !== "user") return jsonError(403, "Forbidden");

    const body = await req.json().catch(() => ({}));
    const payload = body?.payload ?? null;

    const apiKey = String(process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY || "").trim();
    const model = String(process.env.MODEL_API_NAME || "").trim();
    const baseUrl = resolveBaseUrl();

    if (!baseUrl) return NextResponse.json({ text: "Unable to generate brief." }, { status: 500 });
    if (!apiKey) return NextResponse.json({ text: "Unable to generate brief." }, { status: 500 });
    if (!model) return NextResponse.json({ text: "Unable to generate brief." }, { status: 500 });

    const userMessage = JSON.stringify(payload);

    const resp = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: SYSTEM_PROMPT,
        tool_choice: "none",
        input: [{ role: "user", content: userMessage }],
        temperature: 0,
      }),
    });

    const json = await resp.json().catch(async () => ({ error: { message: await resp.text() } }));
    if (!resp.ok) {
      return NextResponse.json({ text: "Unable to generate brief." }, { status: 500 });
    }

    const output = Array.isArray(json?.output) ? json.output : [];
    const chunks: string[] = [];
    for (const item of output || []) {
      if (item?.type === "message" && item?.role === "assistant") {
        for (const c of item?.content || []) {
          if (c?.type === "output_text" && typeof c.text === "string") chunks.push(c.text);
        }
      }
    }
    const text = chunks.join("\n").trim();
    return NextResponse.json({ text: text || "Unable to generate brief." });
  } catch {
    return NextResponse.json({ text: "Unable to generate brief." }, { status: 500 });
  }
}
