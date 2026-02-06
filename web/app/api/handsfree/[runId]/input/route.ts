import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { handsfreeRuns } from "../../runs";
import { runUntilPauseOrEnd } from "../../runner";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const run = handsfreeRuns.get(runId);
    if (!run) return NextResponse.json({ ok: false, error: "Invalid runId" }, { status: 404 });
    if (run.status === "DONE") return NextResponse.json({ ok: false, error: "Run already complete" }, { status: 409 });
    if (run.status === "ERROR") return NextResponse.json({ ok: false, error: run.error || "Run is in error state" }, { status: 409 });
    if (run.status === "RUNNING" || run.inFlight) return NextResponse.json({ ok: false, error: "Run is busy", run }, { status: 409 });

    const body = await req.json().catch(() => ({}));
    const text = String(body?.text || "").trim();
    if (!text) return NextResponse.json({ ok: false, error: "Missing text" }, { status: 400 });

    const updated = await runUntilPauseOrEnd({ pool, runId, userText: text });
    return NextResponse.json({ ok: true, run: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

