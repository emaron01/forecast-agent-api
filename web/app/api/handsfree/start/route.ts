import { NextResponse } from "next/server";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import { sessions } from "../../agent/sessions";
import { handsfreeRuns } from "../runs";
import { runUntilPauseOrEnd } from "../runner";
import { loadMasterDcoPrompt } from "../../../../lib/masterDcoPrompt";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const orgId = Number(body?.orgId || 1);
    const repName = String(body?.repName || "Rep");

    let deals: any[] = [];
    let scoreDefs: any[] = [];

    try {
      const result = await pool.query(
        `
        SELECT o.*
        FROM opportunities o
        WHERE o.org_id = $1
          AND o.rep_name = $2
          AND o.review_now = TRUE
          AND o.forecast_stage NOT IN ('Closed Won', 'Closed Lost')
        ORDER BY o.id ASC
        `,
        [orgId, repName]
      );
      const defsRes = await pool.query(
        `
        SELECT category, score, label, criteria
        FROM score_definitions
        WHERE org_id = $1
        ORDER BY category ASC, score ASC
        `,
        [orgId]
      );
      deals = result.rows || [];
      scoreDefs = defsRes.rows || [];
    } catch {
      // Fallback: allow conversation to start even if DB is unavailable.
      deals = [];
      scoreDefs = [];
    }

    const mp = await loadMasterDcoPrompt();
    const sessionId = randomUUID();
    sessions.set(sessionId, {
      orgId,
      repName,
      masterPromptText: mp.text,
      masterPromptSha256: mp.sha256,
      masterPromptLoadedAt: mp.loadedAt,
      masterPromptSourcePath: mp.sourcePath,
      deals,
      index: 0,
      scoreDefs,
      touched: new Set<string>(),
      items: [],
      wrapSaved: false,
    });

    const runId = randomUUID();
    handsfreeRuns.set(runId, {
      runId,
      sessionId,
      status: "RUNNING",
      masterPromptSha256: mp.sha256,
      masterPromptLoadedAt: mp.loadedAt,
      messages: [],
      modelCalls: 0,
      updatedAt: Date.now(),
    });

    const run = await runUntilPauseOrEnd({ pool, runId, kickoff: true });
    return NextResponse.json({ ok: true, run });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

