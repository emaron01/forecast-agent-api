import { NextRequest, NextResponse } from "next/server";
import { handsfreeRuns } from "../../../handsfree/runs";
import { getAuth } from "../../../../../lib/auth";
import { startSpan, endSpan, orgIdFromAuth } from "../../../../../lib/perf";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const reqSpan = startSpan({
    workflow: "voice_review",
    stage: "request_total",
    org_id: orgIdFromAuth(auth) || 1,
    run_id: runId,
    call_id: runId,
  });
  const run = handsfreeRuns.get(runId);
  if (!run) {
    endSpan(reqSpan, { status: "error", http_status: 404 });
    return NextResponse.json({ ok: false, error: "Invalid runId" }, { status: 404 });
  }
  endSpan(reqSpan, { status: "ok", http_status: 200 });
  return NextResponse.json({ ok: true, run });
}

