import { NextRequest, NextResponse } from "next/server";
import { handsfreeRuns } from "../../../handsfree/runs";
import { runUntilPauseOrEnd } from "../../../handsfree/runner";
import { pool } from "../../../../../lib/pool";
import { getAuth } from "../../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const { runId } = await ctx.params;
    const run = handsfreeRuns.get(runId);
    if (!run) return NextResponse.json({ ok: false, error: "Invalid runId" }, { status: 404 });

    // Idempotency: late mic/STT segments (or user clicks) can arrive after completion.
    if (run.status === "DONE") return NextResponse.json({ ok: true, ignored: true, reason: "done", run });
    if (run.status === "ERROR") return NextResponse.json({ ok: true, ignored: true, reason: "error", run });
    if (run.inFlight) return NextResponse.json({ ok: false, error: "Run is busy", run }, { status: 409 });

    const body = await req.json().catch(() => ({}));
    const text = String(body?.text || "").trim();
    if (!text) return NextResponse.json({ ok: false, error: "Missing text" }, { status: 400 });
    const waitingSeq = body?.waitingSeq;
    if (waitingSeq != null) {
      const expected = Number(run.waitingSeq || 0) || 0;
      const got = Number(waitingSeq);
      if (!Number.isFinite(got)) {
        return NextResponse.json({ ok: false, error: "Invalid waitingSeq" }, { status: 400 });
      }
      if (got !== expected) {
        return NextResponse.json({ ok: true, ignored: true, reason: "stale_turn", expected, got, run });
      }
    }

    const updated = await runUntilPauseOrEnd({ pool, runId, userText: text });
    return NextResponse.json({ ok: true, run: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

