import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "../../../lib/auth";

export const runtime = "nodejs";

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

const EXECUTIVE_BRIEFING_SYSTEM_PROMPT =
  "You are Matthew, a skeptical CRO-level revenue intelligence advisor. Brief the executive on their quarter in plain paragraphs, no bullets, no closing summary. Four sections with bold headings: Quarter Outlook, Commit Integrity, Pipeline Risk, Channel Performance. Lead every section with the problem, not the positive. Be clinical and direct — not dramatic. Format all dollar amounts as currency with $ and commas. Maximum 300 words.";

const BodySchema = z.object({
  max_tokens: z.number().int().min(1).max(8192).optional(),
  system: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.union([z.string(), z.array(z.any())]),
    })
  ),
});

export async function POST(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return jsonError(401, "Unauthorized");
    if (auth.kind !== "user") return jsonError(403, "Forbidden");

    const body = BodySchema.parse(await req.json().catch(() => ({})));

    const baseUrl = resolveBaseUrl();
    const apiKey = String(process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY || "").trim();
    const model = String(process.env.MODEL_API_NAME || "").trim();
    if (!baseUrl) return jsonError(500, "Missing OPENAI_BASE_URL (or MODEL_API_URL or MODEL_URL)");
    if (!apiKey) return jsonError(500, "Missing MODEL_API_KEY");
    if (!model) return jsonError(500, "Missing MODEL_API_NAME");

    const userContent = body.messages?.length
      ? (typeof body.messages[0].content === "string"
          ? body.messages[0].content
          : JSON.stringify(body.messages[0].content))
      : "";

    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: EXECUTIVE_BRIEFING_SYSTEM_PROMPT,
        tool_choice: "none",
        input: [{ role: "user", content: userContent }],
        temperature: 0,
        max_output_tokens: body.max_tokens ?? 600,
      }),
    });

    const data = await response.json().catch(async () => ({ error: { message: await response.text() } }));
    if (!response.ok) {
      const errMsg = data?.error?.message || data?.message || `API error: ${response.status}`;
      return jsonError(response.status >= 400 && response.status < 600 ? response.status : 500, errMsg);
    }

    const output = Array.isArray(data?.output) ? data.output : [];
    const chunks: string[] = [];
    for (const item of output) {
      if (item?.type === "message" && item?.role === "assistant") {
        for (const c of item?.content || []) {
          if (c?.type === "output_text" && typeof c.text === "string") chunks.push(c.text);
        }
      }
    }
    const text = chunks.join("\n").trim();

    return NextResponse.json({ content: [{ type: "text", text: text || "Unable to generate briefing." }] });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return jsonError(400, "Invalid request body");
    }
    const message = e instanceof Error ? e.message : String(e);
    return jsonError(500, message);
  }
}
