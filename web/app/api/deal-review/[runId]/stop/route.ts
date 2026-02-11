import { NextRequest, NextResponse } from "next/server";
import { handsfreeRuns } from "../../../handsfree/runs";
import { getAuth } from "../../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { runId } = await ctx.params;
  const run = handsfreeRuns.get(runId);
  if (!run) return NextResponse.json({ ok: false, error: "Invalid runId" }, { status: 404 });

  run.status = "DONE";
  run.error = undefined;
  run.waitingPrompt = undefined;
  run.updatedAt = Date.now();
  run.inFlight = false;

  return NextResponse.json({ ok: true, run });
}

