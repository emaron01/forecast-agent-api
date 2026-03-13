import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "../../../lib/auth";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

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

    const apiKey = String(
      process.env.ANTHROPIC_API_KEY ||
        process.env.MODEL_API_KEY ||
        process.env.OPENAI_API_KEY ||
        ""
    ).trim();
    const model = String(process.env.MODEL_API_NAME || "").trim();
    if (!apiKey) return jsonError(500, "Missing ANTHROPIC_API_KEY (or MODEL_API_KEY)");
    if (!model) return jsonError(500, "Missing MODEL_API_NAME");

    const payload = {
      model,
      max_tokens: body.max_tokens ?? 600,
      system: body.system,
      messages: body.messages,
    };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errMsg =
        data?.error?.message || data?.message || `Anthropic API error: ${response.status}`;
      return jsonError(response.status >= 400 && response.status < 600 ? response.status : 500, errMsg);
    }

    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return jsonError(400, "Invalid request body");
    }
    const message = e instanceof Error ? e.message : String(e);
    return jsonError(500, message);
  }
}
