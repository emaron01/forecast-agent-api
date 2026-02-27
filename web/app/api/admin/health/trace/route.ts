import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "../../../../../lib/auth";
import { pool } from "../../../../../lib/pool";

export const runtime = "nodejs";

/** SaaS Owner only. GET /api/admin/health/trace?run_id=... OR call_id=... */
export async function GET(req: NextRequest) {
  const auth = await getAuth();
  if (!auth || auth.kind !== "master") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const runId = String(url.searchParams.get("run_id") || "").trim() || null;
  const callId = String(url.searchParams.get("call_id") || "").trim() || null;

  if (!runId && !callId) {
    return NextResponse.json({ error: "run_id or call_id required" }, { status: 400 });
  }

  try {
    const query = runId && callId
      ? `SELECT * FROM perf_events WHERE (run_id = $1::uuid OR call_id = $2) AND is_test = false ORDER BY ts ASC`
      : runId
        ? `SELECT * FROM perf_events WHERE run_id = $1::uuid AND is_test = false ORDER BY ts ASC`
        : `SELECT * FROM perf_events WHERE call_id = $1 AND is_test = false ORDER BY ts ASC`;
    const params = runId && callId ? [runId, callId] : runId ? [runId] : [callId];
    const { rows } = await pool.query(query, params);

    const spans = (rows || []).map((r: any) => ({
      id: r.id,
      ts: r.ts,
      workflow: r.workflow,
      stage: r.stage,
      duration_ms: r.duration_ms,
      status: r.status,
      http_status: r.http_status,
      error_code: r.error_code,
      org_id: r.org_id,
      opportunity_id: r.opportunity_id,
      run_id: r.run_id,
      call_id: r.call_id,
      audio_ms: r.audio_ms,
      text_chars: r.text_chars,
      payload_bytes: r.payload_bytes,
      tokens_in: r.tokens_in,
      tokens_out: r.tokens_out,
      model: r.model,
      provider: r.provider,
    }));

    return NextResponse.json({
      run_id: runId,
      call_id: callId,
      spans,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
