import { NextRequest, NextResponse } from "next/server";
import { handsfreeRuns } from "../../runs";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const run = handsfreeRuns.get(runId);
  if (!run) return NextResponse.json({ ok: false, error: "Invalid runId" }, { status: 404 });
  return NextResponse.json({ ok: true, run });
}

