import { NextResponse } from "next/server";
import { getAuth } from "../../../../../lib/auth";
import { pool } from "../../../../../lib/pool";

export const runtime = "nodejs";

/**
 * Idempotent daily rollup: computes perf_rollups_daily for yesterday and upserts.
 * SaaS Owner / Master Admin only.
 */
export async function POST() {
  const auth = await getAuth();
  if (!auth || auth.kind !== "master") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const dayStr = yesterday.toISOString().slice(0, 10);

    await pool.query(
      `
      INSERT INTO perf_rollups_daily (day, org_id, workflow, stage, count, error_count, p50_ms, p90_ms, p95_ms, p99_ms, avg_ms, max_ms)
      SELECT
        $1::date AS day,
        org_id,
        workflow,
        stage,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE status = 'error')::int AS error_count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS p50_ms,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY duration_ms)::int AS p90_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms)::int AS p99_ms,
        AVG(duration_ms)::int AS avg_ms,
        MAX(duration_ms)::int AS max_ms
      FROM perf_events
      WHERE ts >= $1::date AND ts < $1::date + interval '1 day'
        AND is_test = false
      GROUP BY org_id, workflow, stage
      ON CONFLICT (day, org_id, workflow, stage) DO UPDATE SET
        count = EXCLUDED.count,
        error_count = EXCLUDED.error_count,
        p50_ms = EXCLUDED.p50_ms,
        p90_ms = EXCLUDED.p90_ms,
        p95_ms = EXCLUDED.p95_ms,
        p99_ms = EXCLUDED.p99_ms,
        avg_ms = EXCLUDED.avg_ms,
        max_ms = EXCLUDED.max_ms
      `,
      [dayStr]
    );

    return NextResponse.json({ ok: true, day: dayStr });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
