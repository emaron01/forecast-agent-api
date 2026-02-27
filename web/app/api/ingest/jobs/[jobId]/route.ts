import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAuth } from "../../../../../lib/auth";
import { getIngestQueue } from "../../../../../lib/ingest-queue";
import { startSpan, endSpan } from "../../../../../lib/perf";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> }
) {
  const auth = await getAuth();
  if (!auth || auth.kind !== "user") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const reqSpan = startSpan({
    workflow: "ingestion",
    stage: "request_total",
    org_id: auth.user.org_id,
    call_id: randomUUID(),
  });

  const queue = getIngestQueue();
  if (!queue) {
    endSpan(reqSpan, { status: "error", http_status: 503 });
    return NextResponse.json(
      { ok: false, error: "Staged ingestion not configured (REDIS_URL required)" },
      { status: 503 }
    );
  }

  const { jobId } = await ctx.params;
  if (!jobId) {
    endSpan(reqSpan, { status: "error", http_status: 400 });
    return NextResponse.json({ ok: false, error: "Missing jobId" }, { status: 400 });
  }

  const job = await queue.getJob(jobId);
  if (!job) {
    endSpan(reqSpan, { status: "error", http_status: 404 });
    return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  }

  if (job.data?.orgId !== auth.user.org_id) {
    endSpan(reqSpan, { status: "error", http_status: 404 });
    return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  }

  const state = await job.getState();
  const progress = (job.progress as {
    processed?: number;
    ok?: number;
    skipped?: number;
    skipped_out_of_scope?: number;
    skipped_baseline_exists?: number;
    failed?: number;
    percent?: number;
  }) || {};
  const returnvalue = job.returnvalue as {
    processed?: number;
    ok?: number;
    skipped?: number;
    skipped_out_of_scope?: number;
    skipped_baseline_exists?: number;
    failed?: number;
  } | undefined;

  const counts = state === "completed" && returnvalue
    ? {
        processed: returnvalue.processed ?? 0,
        ok: returnvalue.ok ?? 0,
        skipped: (returnvalue.skipped ?? 0) + (returnvalue.skipped_out_of_scope ?? 0) + (returnvalue.skipped_baseline_exists ?? 0),
        skipped_out_of_scope: returnvalue.skipped_out_of_scope ?? 0,
        skipped_baseline_exists: returnvalue.skipped_baseline_exists ?? 0,
        failed: returnvalue.failed ?? 0,
      }
    : {
        processed: progress.processed ?? 0,
        ok: progress.ok ?? 0,
        skipped: (progress.skipped ?? 0) + (progress.skipped_out_of_scope ?? 0) + (progress.skipped_baseline_exists ?? 0),
        skipped_out_of_scope: progress.skipped_out_of_scope ?? 0,
        skipped_baseline_exists: progress.skipped_baseline_exists ?? 0,
        failed: progress.failed ?? 0,
      };

  endSpan(reqSpan, { status: "ok", http_status: 200 });
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
