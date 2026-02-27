import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "../../../../../lib/auth";
import { pool } from "../../../../../lib/pool";

export const runtime = "nodejs";

/** SaaS Owner only. GET /api/admin/health/worst?workflow=&windowHours=24&limit=50 */
export async function GET(req: NextRequest) {
  const auth = await getAuth();
  if (!auth || auth.kind !== "master") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const workflow = String(url.searchParams.get("workflow") || "").trim() || null;
  const windowHours = Math.min(168, Math.max(1, Number(url.searchParams.get("windowHours")) || 24));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  try {
    const { rows: worstRuns } = await pool.query(
      workflow
        ? `
      SELECT run_id, call_id, workflow, org_id, opportunity_id, ts, duration_ms, status, http_status, error_code
      FROM perf_events
      WHERE ts >= $1::timestamptz AND stage = 'request_total' AND is_test = false AND workflow = $2
        AND (run_id IS NOT NULL OR call_id IS NOT NULL)
      ORDER BY duration_ms DESC NULLS LAST
      LIMIT $3
      `
        : `
      SELECT run_id, call_id, workflow, org_id, opportunity_id, ts, duration_ms, status, http_status, error_code
      FROM perf_events
      WHERE ts >= $1::timestamptz AND stage = 'request_total' AND is_test = false
        AND (run_id IS NOT NULL OR call_id IS NOT NULL)
      ORDER BY duration_ms DESC NULLS LAST
      LIMIT $3
      `,
      workflow ? [since, workflow, limit] : [since, limit]
    );

    const runIds: string[] = [];
    const callIds: string[] = [];
    for (const r of worstRuns || []) {
      const rid = (r as any).run_id;
      const cid = (r as any).call_id;
      if (rid) runIds.push(rid);
      if (cid) callIds.push(cid);
    }
    let stageBreakdown: any[] = [];
    if (runIds.length > 0 || callIds.length > 0) {
      const { rows: stages } = await pool.query(
        runIds.length > 0 && callIds.length > 0
          ? `
        SELECT run_id, call_id, stage, duration_ms, status
        FROM perf_events
        WHERE ts >= $1::timestamptz AND is_test = false
          AND (run_id = ANY($2::uuid[]) OR call_id = ANY($3::text[]))
        ORDER BY ts
        `
          : runIds.length > 0
            ? `
        SELECT run_id, call_id, stage, duration_ms, status
        FROM perf_events
        WHERE ts >= $1::timestamptz AND is_test = false AND run_id = ANY($2::uuid[])
        ORDER BY ts
        `
            : `
        SELECT run_id, call_id, stage, duration_ms, status
        FROM perf_events
        WHERE ts >= $1::timestamptz AND is_test = false AND call_id = ANY($2::text[])
        ORDER BY ts
        `,
        runIds.length > 0 && callIds.length > 0 ? [since, runIds, callIds] : runIds.length > 0 ? [since, runIds] : [since, callIds]
      );
      stageBreakdown = stages || [];
    }

    const byRun = new Map<string, { run_id: string | null; call_id: string | null; workflow: string; org_id: number; ts: string; duration_ms: number; status: string; stages: { stage: string; duration_ms: number; status: string }[] }>();
    for (const r of worstRuns || []) {
      const key = String((r as any).run_id || (r as any).call_id || "");
      byRun.set(key, {
        run_id: (r as any).run_id ?? null,
        call_id: (r as any).call_id ?? null,
        workflow: (r as any).workflow,
        org_id: (r as any).org_id,
        ts: (r as any).ts,
        duration_ms: (r as any).duration_ms,
        status: (r as any).status,
        stages: [],
      });
    }
    for (const s of stageBreakdown) {
      const key = String((s as any).run_id || (s as any).call_id || "");
      const rec = byRun.get(key);
      if (rec) {
        rec.stages.push({
          stage: (s as any).stage,
          duration_ms: (s as any).duration_ms,
          status: (s as any).status,
        });
      }
    }

    const list = Array.from(byRun.values());

    return NextResponse.json({
      workflow: workflow || "all",
      windowHours,
      limit,
      worst_runs: list,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
