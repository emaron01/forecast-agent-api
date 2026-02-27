import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "../../../../../lib/auth";
import { pool } from "../../../../../lib/pool";

export const runtime = "nodejs";

/** SaaS Owner only. GET /api/admin/health/summary?windowHours=24 */
export async function GET(req: NextRequest) {
  const auth = await getAuth();
  if (!auth || auth.kind !== "master") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const windowHours = Math.min(168, Math.max(1, Number(url.searchParams.get("windowHours")) || 24));
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  try {
    const { rows: requestTotal } = await pool.query(
      `
      SELECT
        workflow,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE status = 'error')::int AS error_count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS p50_ms,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY duration_ms)::int AS p90_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms)::int AS p99_ms
      FROM perf_events
      WHERE ts >= $1::timestamptz AND stage = 'request_total' AND is_test = false
      GROUP BY workflow
      `,
      [since]
    );

    const { rows: stageBreakdown } = await pool.query(
      `
      SELECT workflow, stage,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms
      FROM perf_events
      WHERE ts >= $1::timestamptz AND is_test = false
      GROUP BY workflow, stage
      `,
      [since]
    );

    const { rows: voiceRtf } = await pool.query(
      `
      SELECT
        workflow,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CASE WHEN audio_ms IS NOT NULL AND audio_ms > 0 THEN duration_ms::float / audio_ms ELSE NULL END)::float AS p50_rtf,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY CASE WHEN audio_ms IS NOT NULL AND audio_ms > 0 THEN duration_ms::float / audio_ms ELSE NULL END)::float AS p95_rtf
      FROM perf_events
      WHERE ts >= $1::timestamptz AND stage = 'request_total' AND is_test = false
        AND audio_ms IS NOT NULL AND audio_ms > 0
      GROUP BY workflow
      `,
      [since]
    );

    const perWorkflow = (requestTotal || []).map((r: any) => ({
      workflow: r.workflow,
      count: r.count,
      error_rate: r.count > 0 ? (r.error_count || 0) / r.count : 0,
      p50_ms: r.p50_ms,
      p90_ms: r.p90_ms,
      p95_ms: r.p95_ms,
      p99_ms: r.p99_ms,
    }));

    const stageP95: Record<string, Record<string, number>> = {};
    for (const row of stageBreakdown || []) {
      const w = (row as any).workflow;
      const s = (row as any).stage;
      const p95 = (row as any).p95_ms;
      if (!stageP95[w]) stageP95[w] = {};
      stageP95[w][s] = p95;
    }

    const voice_rtf = (voiceRtf || []).map((r: any) => ({
      workflow: r.workflow,
      p50_rtf: r.p50_rtf != null ? Math.round(r.p50_rtf * 1000) / 1000 : null,
      p95_rtf: r.p95_rtf != null ? Math.round(r.p95_rtf * 1000) / 1000 : null,
    }));

    return NextResponse.json({
      windowHours,
      since,
      per_workflow: perWorkflow,
      stage_breakdown_p95: stageP95,
      voice_rtf,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
