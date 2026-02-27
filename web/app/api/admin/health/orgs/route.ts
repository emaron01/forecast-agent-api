import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "../../../../../lib/auth";
import { pool } from "../../../../../lib/pool";

export const runtime = "nodejs";

/** SaaS Owner only. GET /api/admin/health/orgs?workflow=&windowHours=24 */
export async function GET(req: NextRequest) {
  const auth = await getAuth();
  if (!auth || auth.kind !== "master") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const workflow = String(url.searchParams.get("workflow") || "").trim() || null;
  const windowHours = Math.min(168, Math.max(1, Number(url.searchParams.get("windowHours")) || 24));
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  try {
    const query = workflow
      ? `
      SELECT org_id,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE status = 'error')::int AS error_count,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms
      FROM perf_events
      WHERE ts >= $1::timestamptz AND stage = 'request_total' AND is_test = false AND workflow = $2 AND org_id > 0
      GROUP BY org_id
      ORDER BY p95_ms DESC NULLS LAST
      LIMIT 10
      `
      : `
      SELECT org_id,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE status = 'error')::int AS error_count,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms
      FROM perf_events
      WHERE ts >= $1::timestamptz AND stage = 'request_total' AND is_test = false AND org_id > 0
      GROUP BY org_id
      ORDER BY p95_ms DESC NULLS LAST
      LIMIT 10
      `;
    const params = workflow ? [since, workflow] : [since];
    const { rows } = await pool.query(query, params);

    const topOrgs = (rows || []).map((r: any) => ({
      org_id: Number(r.org_id),
      count: r.count,
      error_count: r.error_count,
      error_rate: r.count > 0 ? (r.error_count || 0) / r.count : 0,
      p95_ms: r.p95_ms,
    }));

    return NextResponse.json({
      workflow: workflow || "all",
      windowHours,
      top_orgs: topOrgs,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
