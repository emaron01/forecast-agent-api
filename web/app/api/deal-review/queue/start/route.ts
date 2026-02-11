import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { sessions } from "../../../agent/sessions";
import { handsfreeRuns } from "../../../handsfree/runs";
import { runUntilPauseOrEnd } from "../../../handsfree/runner";
import { loadMasterDcoPrompt } from "../../../../../lib/masterDcoPrompt";
import { getAuth } from "../../../../../lib/auth";
import { pool } from "../../../../../lib/pool";
import { resolvePublicId } from "../../../../../lib/publicId";

export const runtime = "nodejs";

async function assertOpportunityVisible(args: {
  auth: Awaited<ReturnType<typeof getAuth>>;
  orgId: number;
  opportunityRepName: string | null;
}) {
  const { auth, orgId, opportunityRepName } = args;

  if (!auth) return { ok: false as const, status: 401 as const, error: "Unauthorized" };
  if (auth.kind !== "user") return { ok: false as const, status: 403 as const, error: "Forbidden" };

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

    const orgId = auth.kind === "user" ? auth.user.org_id : auth.orgId || 0;
    if (!orgId) return NextResponse.json({ ok: false, error: "Missing org context" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body?.opportunityIds) ? body.opportunityIds : [];
    const opportunityPublicIds = ids.map((x: any) => String(x || "").trim()).filter(Boolean);
    if (!opportunityPublicIds.length) {
      return NextResponse.json({ ok: false, error: "Missing opportunityIds" }, { status: 400 });
    }
    if (opportunityPublicIds.length > 50) {
      return NextResponse.json({ ok: false, error: "Too many deals selected (max 50)" }, { status: 400 });
    }

    const internalIds: number[] = [];
    for (const pid of opportunityPublicIds) {
      internalIds.push(await resolvePublicId("opportunities", pid));
    }

    const { rows } = await pool.query(
      `
      SELECT *
        FROM opportunities
       WHERE org_id = $1
         AND id = ANY($2::bigint[])
      `,
      [orgId, internalIds]
    );
    const byId = new Map<number, any>();
    for (const r of rows || []) byId.set(Number(r.id), r);
    const deals = internalIds.map((id) => byId.get(id)).filter(Boolean);
    if (!deals.length) return NextResponse.json({ ok: false, error: "No opportunities found" }, { status: 404 });

    // Enforce visibility per deal.
    for (const d of deals) {
      const vis = await assertOpportunityVisible({
        auth,
        orgId,
        opportunityRepName: (d as any)?.rep_name ?? null,
      });
      if (!vis.ok) return NextResponse.json({ ok: false, error: vis.error }, { status: vis.status });
    }

    // Queue sessions are currently single-rep only, to avoid misattribution in save tool calls.
    const repNames = Array.from(new Set(deals.map((d) => String((d as any)?.rep_name || "").trim()).filter(Boolean)));
    if (repNames.length !== 1) {
      return NextResponse.json(
        {
          ok: false,
          error: "Queue review currently supports one rep at a time. Filter by rep, then re-select deals.",
        },
        { status: 400 }
      );
    }
    const repName = repNames[0] || "Rep";

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
      .catch(() => ({ rows: [] as any[] }));
    const scoreDefs = defsRes.rows || [];

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
      lastCategoryKey: undefined,
      lastCheckType: undefined,
      skipSaveCategoryKey: undefined,
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
      waitingSeq: 0,
      masterPromptSha256: mp.sha256,
      masterPromptLoadedAt: mp.loadedAt,
      messages: [],
      modelCalls: 0,
      updatedAt: Date.now(),
    });

    const run = await runUntilPauseOrEnd({ pool, runId, kickoff: true });
    return NextResponse.json({ ok: true, run, count: deals.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

