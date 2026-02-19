import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "../../../../lib/auth";
import { loadAiStrategicTakeawayPrompt } from "../../../../lib/aiStrategicTakeawayPrompt";

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

const BodySchema = z.object({
  surface: z.enum(["hero", "radar"]),
  payload: z.any(),
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

    const prompt = await loadAiStrategicTakeawayPrompt();
    const userText =
      `Surface: ${body.surface}\n` +
      `Org: ${auth.user.org_id}\n\n` +
      `Input data (JSON):\n${JSON.stringify(body.payload, null, 2)}\n\n` +
      "Write a CRO-grade ✨ AI Strategic Takeaway.\n" +
      "- Use explicit GAP math (call out if 1 deal closes the GAP; else minimum # deals).\n" +
      "- Analyze MEDDPICC+TB gaps and rep/team trends.\n" +
      "- Provide the highest-leverage coaching actions.\n" +
      "- Keep it concise: 5-10 bullets max.\n";

    const resp = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: prompt.text,
        tool_choice: "none",
        input: [{ role: "user", content: userText }],
      }),
    });

    const json = await resp.json().catch(async () => ({ error: { message: await resp.text() } }));
    if (!resp.ok) {
      const msg = json?.error?.message || JSON.stringify(json);
      return jsonError(500, msg);
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
    return NextResponse.json({
      ok: true,
      text,
      prompt_sha256: prompt.sha256,
      prompt_source_path: prompt.sourcePath,
      prompt_loaded_at: prompt.loadedAt,
    });
  } catch (e: any) {
    const msg = e?.issues ? "Invalid request body" : e?.message || String(e);
    return jsonError(400, msg);
  }
}

