import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "../../../../lib/auth";
import { loadAiStrategicTakeawayPrompt } from "../../../../lib/aiStrategicTakeawayPrompt";
import { createHash } from "node:crypto";

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
  surface: z.enum(["hero", "radar", "partners_executive", "pipeline_momentum"]),
  payload: z.any(),
  force: z.boolean().optional().catch(undefined),
  previous_payload_sha256: z.string().optional().catch(undefined),
  previous_summary: z.string().optional().catch(undefined),
  previous_extended: z.string().optional().catch(undefined),
});

function sha256Text(s: string) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function safeParseJson(text: string): any | null {
  const t = String(text || "").trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function summarizeFallback(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return { summary: "", extended: "" };
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const summaryLines = lines.slice(0, 4);
  const summary = summaryLines.join("\n");
  return { summary, extended: raw };
}

function capSummary(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const lines = s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // If it's bullets/lines, cap at 4.
  if (lines.length > 1) return lines.slice(0, 4).join("\n");
  // If it's a paragraph, keep it short.
  const maxChars = 520;
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars).trimEnd()}…`;
}

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
    const payloadJson = JSON.stringify(body.payload ?? null);
    const payloadSha = sha256Text(payloadJson);
    const force = body.force === true;

    // Hard guarantee: do not update analysis if payload is identical.
    // This prevents the model from "churning" copy with the same data (even if the user hits Reanalyze).
    if (body.previous_payload_sha256 && body.previous_payload_sha256 === payloadSha) {
      return NextResponse.json({
        ok: true,
        no_change: true,
        summary: String(body.previous_summary || "").trim(),
        extended: String(body.previous_extended || "").trim(),
        payload_sha256: payloadSha,
        prompt_sha256: prompt.sha256,
        prompt_source_path: prompt.sourcePath,
        prompt_loaded_at: prompt.loadedAt,
      });
    }

    const surfaceGuidance =
      body.surface === "pipeline_momentum"
        ? [
            "Focus on: pipeline creation, coverage/velocity, forecast mix, cycle-length mix, product pipeline generation, and partner signals that can shorten cycles.",
            "If GAP math is not applicable, skip it (do not fabricate quota gaps).",
            "Make quarter-over-quarter comparisons explicit (what changed vs last quarter and why it matters).",
            "Conclude with 2-3 concrete CRO actions for the next 7-14 days.",
          ].join("\n- ")
        : body.surface === "partners_executive"
          ? [
              "Focus on: Direct vs Partner comparisons (close rate, # opps, avg days, AOV, mix %).",
              "Identify which partners show promise to shorten cycles and where channel is dragging velocity.",
              "Conclude with coverage + enablement recommendations (MDF/SE support) and a shortlist of partners to invest in.",
            ].join("\n- ")
          : [
              "Use explicit GAP math (call out if 1 deal closes the GAP; else minimum # deals).",
              "Analyze MEDDPICC+TB gaps and rep/team trends.",
              "Provide the highest-leverage coaching actions.",
            ].join("\n- ");

    const prior =
      String(body.previous_extended || "").trim() || String(body.previous_summary || "").trim()
        ? `\n\nPrevious analysis (if still valid, reuse verbatim; only update bullets impacted by changed numbers):\n${String(body.previous_extended || body.previous_summary || "").trim()}\n`
        : "";

    const userText =
      `Surface: ${body.surface}\n` +
      `Org: ${auth.user.org_id}\n\n` +
      `Payload sha256: ${payloadSha}\n` +
      (body.previous_payload_sha256 ? `Previous payload sha256: ${body.previous_payload_sha256}\n` : "") +
      `Input data (JSON):\n${JSON.stringify(body.payload, null, 2)}\n\n` +
      prior +
      "Write a CRO-grade ✨ AI Strategic Takeaway.\n" +
      `- ${surfaceGuidance}\n` +
      "- Keep it concise: 5-10 bullets max.\n\n" +
      "OUTPUT FORMAT (STRICT): Return ONLY valid JSON with these fields:\n" +
      `{\n  "no_change": boolean,\n  "summary": string,   // <=4 bullets OR a short paragraph\n  "extended": string   // full analysis; may include bullets\n}\n` +
      "RULES:\n" +
      "- If the new input data does not materially change the conclusions, set no_change=true and return the previous summary/extended verbatim.\n" +
      "- Do NOT add new bullets unless new data changes the story.\n";

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
    const parsed = safeParseJson(text);

    const fallback = summarizeFallback(text);
    const out = parsed && typeof parsed === "object" ? parsed : null;
    const summary = capSummary(String(out?.summary ?? fallback.summary ?? "").trim());
    const extended = String(out?.extended ?? fallback.extended ?? "").trim();
    const no_change = !!out?.no_change;
    return NextResponse.json({
      ok: true,
      no_change,
      summary,
      extended,
      payload_sha256: payloadSha,
      prompt_sha256: prompt.sha256,
      prompt_source_path: prompt.sourcePath,
      prompt_loaded_at: prompt.loadedAt,
    });
  } catch (e: any) {
    const msg = e?.issues ? "Invalid request body" : e?.message || String(e);
    return jsonError(400, msg);
  }
}

