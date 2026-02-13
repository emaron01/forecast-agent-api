import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { sessions } from "../../agent/sessions";
import { handsfreeRuns } from "../../handsfree/runs";
import { runUntilPauseOrEnd } from "../../handsfree/runner";
import { loadMasterDcoPrompt } from "../../../../lib/masterDcoPrompt";
import { getAuth } from "../../../../lib/auth";
import { pool } from "../../../../lib/pool";
import { resolvePublicId } from "../../../../lib/publicId";
import { closedOutcomeFromOpportunityRow } from "../../../../lib/opportunityOutcome";

export const runtime = "nodejs";

async function assertOpportunityVisible(args: {
  auth: Awaited<ReturnType<typeof getAuth>>;
  orgId: number;
  opportunityRepName: string | null;
}) {
  const { auth, orgId, opportunityRepName } = args;

  if (!auth) {
    return { ok: false as const, status: 401 as const, error: "Unauthorized" };
  }
  if (auth.kind !== "user") {
    // Master context can inspect data elsewhere; keep this scoped to normal signed-in users.
    return { ok: false as const, status: 403 as const, error: "Forbidden" };
  }

  const role = auth.user.role;

  if (role === "REP") {
    if (!opportunityRepName || opportunityRepName !== auth.user.account_owner_name) {
      return { ok: false as const, status: 403 as const, error: "Forbidden" };
    }
  }

  if (role === "MANAGER") {
    if (!opportunityRepName) return { ok: false as const, status: 403 as const, error: "Forbidden" };
    const { rows } = await pool.query(
      `
      SELECT 1
        FROM users
       WHERE org_id = $1
         AND role = 'REP'
         AND active IS TRUE
         AND manager_user_id = $2
         AND account_owner_name = $3
       LIMIT 1
      `,
      [orgId, auth.user.id, opportunityRepName]
    );
    if (!rows?.length) return { ok: false as const, status: 403 as const, error: "Forbidden" };
  }

  return { ok: true as const };
}

export async function POST(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const opportunityPublicId = String(body?.opportunityId || "").trim();
    if (!opportunityPublicId) {
      return NextResponse.json({ ok: false, error: "Missing opportunityId" }, { status: 400 });
    }

    const orgId = auth.kind === "user" ? auth.user.org_id : auth.orgId || 0;
    if (!orgId) return NextResponse.json({ ok: false, error: "Missing org context" }, { status: 400 });

    const opportunityId = await resolvePublicId("opportunities", opportunityPublicId);

    // Fetch the full opportunity row (includes scoring columns used by prompts + muscle tool save).
    const { rows } = await pool.query(`SELECT * FROM opportunities WHERE org_id = $1 AND id = $2 LIMIT 1`, [
      orgId,
      opportunityId,
    ]);
    const deal = rows?.[0] || null;
    if (!deal) return NextResponse.json({ ok: false, error: "Opportunity not found" }, { status: 404 });
    const closed = closedOutcomeFromOpportunityRow({ ...deal, stage: (deal as any)?.sales_stage });
    if (closed) {
      return NextResponse.json({ ok: false, error: `Deal Review is disabled for closed opportunities (${closed}).` }, { status: 409 });
    }

    const vis = await assertOpportunityVisible({
      auth,
      orgId,
      opportunityRepName: (deal as any)?.rep_name ?? null,
    });
    if (!vis.ok) return NextResponse.json({ ok: false, error: vis.error }, { status: vis.status });

    // Load score definitions for rubric text.
    const defsRes = await pool
      .query(
        `
        SELECT category, score, label, criteria
          FROM score_definitions
         WHERE org_id = $1
         ORDER BY category ASC, score ASC
        `,
        [orgId]
      )
      .catch(async (e: any) => {
        // score_definitions may be global (no org_id column) in some DBs.
        if (String(e?.code || "") === "42703") {
          const r = await pool
            .query(
              `
              SELECT category, score, label, criteria
                FROM score_definitions
               ORDER BY category ASC, score ASC
              `
            )
            .catch(() => ({ rows: [] as any[] }));
          return r as any;
        }
        return { rows: [] as any[] };
      });
    const scoreDefs = defsRes.rows || [];

    const mp = await loadMasterDcoPrompt();

    // Session is a single-deal queue.
    const sessionId = randomUUID();
    const repName = String((deal as any)?.rep_name || (auth.kind === "user" ? auth.user.account_owner_name : "Rep") || "Rep");
    sessions.set(sessionId, {
      orgId,
      repName,
      masterPromptText: mp.text,
      masterPromptSha256: mp.sha256,
      masterPromptLoadedAt: mp.loadedAt,
      masterPromptSourcePath: mp.sourcePath,
      reviewed: new Set<string>(),
      lastCategoryKey: undefined,
      lastCheckType: undefined,
      skipSaveCategoryKey: undefined,
      deals: [deal],
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
      waitingSeq: 0,
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

