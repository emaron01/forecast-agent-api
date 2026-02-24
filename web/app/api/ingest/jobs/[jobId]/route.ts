import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "../../../../../lib/auth";
import { getIngestQueue } from "../../../../../lib/ingest-queue";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> }
) {
  const auth = await getAuth();
  if (!auth || auth.kind !== "user") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const queue = getIngestQueue();
  if (!queue) {
    return NextResponse.json(
      { ok: false, error: "Staged ingestion not configured (REDIS_URL required)" },
      { status: 503 }
    );
  }

  const { jobId } = await ctx.params;
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "Missing jobId" }, { status: 400 });
  }

  const job = await queue.getJob(jobId);
  if (!job) {
    return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  }

  if (job.data?.orgId !== auth.user.org_id) {
    return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  }

  const state = await job.getState();
  const progress = (job.progress as { processed?: number; ok?: number; skipped?: number; failed?: number; percent?: number }) || {};
  const returnvalue = job.returnvalue as { processed?: number; ok?: number; skipped?: number; failed?: number } | undefined;

  const counts = state === "completed" && returnvalue
    ? {
        processed: returnvalue.processed ?? 0,
        ok: returnvalue.ok ?? 0,
        skipped: returnvalue.skipped ?? 0,
        failed: returnvalue.failed ?? 0,
      }
    : {
        processed: progress.processed ?? 0,
        ok: progress.ok ?? 0,
        skipped: progress.skipped ?? 0,
        failed: progress.failed ?? 0,
      };

  return NextResponse.json({
    ok: true,
    jobId: job.id,
    state,
    progress: progress.percent ?? null,
    counts,
    total: job.data?.rows?.length ?? null,
    failedReason: job.failedReason ?? null,
  });
}
