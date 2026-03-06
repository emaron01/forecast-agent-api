import { NextRequest, NextResponse } from "next/server";
import { handsfreeRuns } from "../../../handsfree/runs";
import { runUntilPauseOrEnd } from "../../../handsfree/runner";
import { pool } from "../../../../../lib/pool";
import { getAuth } from "../../../../../lib/auth";
import { startSpan, endSpan, orgIdFromAuth } from "../../../../../lib/perf";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  let reqSpan: ReturnType<typeof startSpan> | null = null;
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    reqSpan = startSpan({
      workflow: "voice_review",
      stage: "request_total",
      org_id: orgIdFromAuth(auth) || 1,
      run_id: runId,
      call_id: runId,
    });
    const run = handsfreeRuns.get(runId);
    if (!run) {
      endSpan(reqSpan!, { status: "error", http_status: 404 });
      return NextResponse.json({ ok: false, error: "Invalid runId" }, { status: 404 });
    }

    // Idempotency: late mic/STT segments (or user clicks) can arrive after completion.
    if (run.status === "DONE") {
      endSpan(reqSpan!, { status: "ok", http_status: 200 });
      return NextResponse.json({ ok: true, ignored: true, reason: "done", run });
    }
    if (run.status === "ERROR") {
      endSpan(reqSpan!, { status: "ok", http_status: 200 });
      return NextResponse.json({ ok: true, ignored: true, reason: "error", run });
    }
    if (run.inFlight) {
      endSpan(reqSpan!, { status: "error", http_status: 409 });
      return NextResponse.json({ ok: false, error: "Run is busy", run }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const text = String(body?.text || "").trim();
    if (!text) {
      endSpan(reqSpan!, { status: "error", http_status: 400 });
      return NextResponse.json({ ok: false, error: "Missing text" }, { status: 400 });
    }
    const audioTokens = body?.usage?.input_token_details?.audio_tokens;
    const charCount = text.length;
    const shortInputGuard =
      (typeof audioTokens === "number" && audioTokens < 50) || (audioTokens == null && charCount < 30);
    if (shortInputGuard) {
      console.log(
        JSON.stringify({
          event: "short_input_guard",
          session_id: run.sessionId ?? null,
          turn_index: run.modelCalls ?? null,
          audio_tokens: audioTokens ?? null,
          char_count: charCount,
        })
      );
    }
    const waitingSeq = body?.waitingSeq;
    if (waitingSeq != null) {
      const expected = Number(run.waitingSeq || 0) || 0;
      const got = Number(waitingSeq);
      if (!Number.isFinite(got)) {
        endSpan(reqSpan!, { status: "error", http_status: 400 });
        return NextResponse.json({ ok: false, error: "Invalid waitingSeq" }, { status: 400 });
      }
      if (got !== expected) {
        endSpan(reqSpan!, { status: "ok", http_status: 200 });
        return NextResponse.json({ ok: true, ignored: true, reason: "stale_turn", expected, got, run });
      }
    }

    const streamEnabled =
      process.env.LLM_STREAM_ENABLED === "true" &&
      process.env.VOICE_SENTENCE_CHUNKING === "true";

    if (streamEnabled) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const sendSSE = (payload: object) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          };

          const onSentence = (sentenceText: string) => {
            sendSSE({ type: "sentence", text: sentenceText });
          };

          try {
            await runUntilPauseOrEnd({
              pool,
              runId,
              userText: text,
              shortInputGuard,
              onSentence,
            });

            const updated = handsfreeRuns.get(runId);
            endSpan(reqSpan!, { status: "ok", http_status: 200 });
            sendSSE({ type: "done", ok: true, run: updated ?? null });
          } catch (err) {
            endSpan(reqSpan!, { status: "error", http_status: 500 });
            console.log(
              JSON.stringify({
                event: "input_stream_error",
                runId,
                error: String(err),
              })
            );
            sendSSE({ type: "error", ok: false, error: String(err) });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const updated = await runUntilPauseOrEnd({ pool, runId, userText: text, shortInputGuard });
    endSpan(reqSpan!, { status: "ok", http_status: 200 });
    return NextResponse.json({ ok: true, run: updated });
  } catch (e: any) {
    if (reqSpan) endSpan(reqSpan, { status: "error", http_status: 500 });
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

