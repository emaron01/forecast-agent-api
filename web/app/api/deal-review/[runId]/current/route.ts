import { NextRequest, NextResponse } from "next/server";
import { handsfreeRuns } from "../../../handsfree/runs";
import { sessions } from "../../../agent/sessions";
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

  const session = sessions.get(run.sessionId);
  if (!session) {
    endSpan(reqSpan, { status: "error", http_status: 404 });
    return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 404 });
  }

  const deal = session.deals?.[session.index] || null;
  if (!deal) {
    endSpan(reqSpan, { status: "ok", http_status: 200 });
    return NextResponse.json({
      ok: true,
      done: true,
      index: session.index,
      total: Array.isArray(session.deals) ? session.deals.length : 0,
    });
  }

  endSpan(reqSpan, { status: "ok", http_status: 200 });
  return NextResponse.json({
    ok: true,
    done: false,
    index: session.index,
    total: Array.isArray(session.deals) ? session.deals.length : 0,
    deal: {
      public_id: String((deal as any)?.public_id || ""),
      account_name: String((deal as any)?.account_name || ""),
      opportunity_name: String((deal as any)?.opportunity_name || ""),
      rep_name: String((deal as any)?.rep_name || ""),
      forecast_stage: String((deal as any)?.forecast_stage || ""),
      close_date: (deal as any)?.close_date ?? null,
      amount: (deal as any)?.amount ?? null,
      updated_at: (deal as any)?.updated_at ?? null,
    },
  });
}

