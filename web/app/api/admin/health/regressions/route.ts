import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "../../../../../lib/auth";
import { pool } from "../../../../../lib/pool";

export const runtime = "nodejs";

/** SaaS Owner only. GET /api/admin/health/regressions?baselineDays=7&currentHours=24 */
export async function GET(req: NextRequest) {
  const auth = await getAuth();
  if (!auth || auth.kind !== "master") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const baselineDays = Math.min(30, Math.max(1, Number(url.searchParams.get("baselineDays")) || 7));
  const currentHours = Math.min(168, Math.max(1, Number(url.searchParams.get("currentHours")) || 24));

  const baselineEnd = new Date();
  baselineEnd.setUTCDate(baselineEnd.getUTCDate() - 1);
  const baselineStart = new Date(baselineEnd);
  baselineStart.setUTCDate(baselineStart.getUTCDate() - baselineDays);
  const currentSince = new Date(Date.now() - currentHours * 60 * 60 * 1000);

  try {
    const { rows: baseline } = await pool.query(
      `
      SELECT workflow, stage,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms
      FROM perf_events
      WHERE ts >= $1::timestamptz AND ts < $2::timestamptz AND is_test = false
      GROUP BY workflow, stage
      `,
      [baselineStart.toISOString(), baselineEnd.toISOString()]
    );

    const { rows: current } = await pool.query(
      `
      SELECT workflow, stage,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms
      FROM perf_events
      WHERE ts >= $1::timestamptz AND is_test = false
      GROUP BY workflow, stage
      `,
      [currentSince.toISOString()]
    );

    const baseMap = new Map<string, number>();
    for (const r of baseline || []) {
      baseMap.set(`${(r as any).workflow}:${(r as any).stage}`, (r as any).p95_ms);
    }
    const currMap = new Map<string, number>();
    for (const r of current || []) {
      currMap.set(`${(r as any).workflow}:${(r as any).stage}`, (r as any).p95_ms);
    }

    const workflows = new Set<string>();
    baseMap.forEach((_, k) => workflows.add(k.split(":")[0]));
    currMap.forEach((_, k) => workflows.add(k.split(":")[0]));

    const byWorkflow: { workflow: string; baseline_p95_ms: number; current_p95_ms: number; delta_ms: number; stages: { stage: string; baseline_p95_ms: number; current_p95_ms: number; delta_ms: number }[] }[] = [];

    for (const w of workflows) {
      const baseTotal = baseMap.get(`${w}:request_total`);
      const currTotal = currMap.get(`${w}:request_total`);
      const stages: { stage: string; baseline_p95_ms: number; current_p95_ms: number; delta_ms: number }[] = [];
      const stageKeys = new Set<string>();
      baseMap.forEach((_, k) => {
        if (k.startsWith(w + ":")) stageKeys.add(k.split(":")[1]);
      });
      currMap.forEach((_, k) => {
        if (k.startsWith(w + ":")) stageKeys.add(k.split(":")[1]);
      });
      for (const s of stageKeys) {
        const b = baseMap.get(`${w}:${s}`) ?? 0;
        const c = currMap.get(`${w}:${s}`) ?? 0;
        stages.push({ stage: s, baseline_p95_ms: b, current_p95_ms: c, delta_ms: c - b });
      }
      stages.sort((a, b) => Math.abs(b.delta_ms) - Math.abs(a.delta_ms));
      byWorkflow.push({
        workflow: w,
        baseline_p95_ms: baseTotal ?? 0,
        current_p95_ms: currTotal ?? 0,
        delta_ms: (currTotal ?? 0) - (baseTotal ?? 0),
        stages,
      });
    }

    byWorkflow.sort((a, b) => Math.abs(b.delta_ms) - Math.abs(a.delta_ms));

    return NextResponse.json({
      baselineDays,
      currentHours,
      by_workflow: byWorkflow,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
