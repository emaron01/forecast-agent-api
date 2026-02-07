import { NextResponse } from "next/server";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import { sessions } from "../../agent/sessions";
import { handsfreeRuns } from "../../handsfree/runs";
import { runUntilPauseOrEnd } from "../../handsfree/runner";
import { loadMasterDcoPrompt } from "../../../../lib/masterDcoPrompt";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const opportunityId = Number(ctx?.params?.id);
    if (!opportunityId) return NextResponse.json({ ok: false, error: "Invalid opportunity id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const orgId = Number(body?.orgId || 0);
    if (!orgId) return NextResponse.json({ ok: false, error: "Missing orgId" }, { status: 400 });

    // Load a single opportunity (no Twilio, no realtime).
    const oppRes = await pool.query(
      `
      SELECT o.*
        FROM opportunities o
       WHERE o.org_id = $1
         AND o.id = $2
       LIMIT 1
      `,
      [orgId, opportunityId]
    );
    const deal = oppRes.rows?.[0];
    if (!deal) return NextResponse.json({ ok: false, error: "Opportunity not found" }, { status: 404 });

    const repName = String(deal.rep_name || body?.repName || "Rep");

    const defsRes = await pool.query(
      `
      SELECT category, score, label, criteria
        FROM score_definitions
       WHERE org_id = $1
       ORDER BY category ASC, score ASC
      `,
      [orgId]
    );

    const mp = await loadMasterDcoPrompt();
    const sessionId = randomUUID();
    sessions.set(sessionId, {
      orgId,
      repName,
      masterPromptText: mp.text,
      masterPromptSha256: mp.sha256,
      masterPromptLoadedAt: mp.loadedAt,
      masterPromptSourcePath: mp.sourcePath,
      reviewed: new Set<string>(),
      deals: [deal],
      index: 0,
      scoreDefs: defsRes.rows || [],
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

