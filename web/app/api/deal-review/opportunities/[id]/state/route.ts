import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { pool } from "../../../../../../lib/pool";
import { getAuth } from "../../../../../../lib/auth";
import { resolvePublicId } from "../../../../../../lib/publicId";
import { closedOutcomeFromOpportunityRow } from "../../../../../../lib/opportunityOutcome";
import { startSpan, endSpan, orgIdFromAuth } from "../../../../../../lib/perf";
import { channelUserCanViewOpportunity } from "../../../../../../lib/dealReviewOpportunityScope";
import { HIERARCHY, isChannelRole, isManager, isSalesRep } from "../../../../../../lib/roleHelpers";
import { computeConfidence, type ScoreSource } from "../../../../../../lib/confidence";

export const runtime = "nodejs";

const ALL_CATEGORIES = [
  "metrics",
  "economic_buyer",
  "criteria",
  "process",
  "paper",
  "pain",
  "champion",
  "competition",
  "timing",
  "budget",
] as const;

function roundInt(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function computeHealthPercentFromOpportunity(healthScore: any) {
  const hs = Number(healthScore);
  if (!Number.isFinite(hs)) return null;
  // Internal score is 0-30; UI speaks percent.
  return roundInt((hs / 30) * 100);
}

function splitLabelEvidence(summary: any) {
  const s = String(summary ?? "").trim();
  if (!s) return { label: "", evidence: "" };
  const idx = s.indexOf(":");
  if (idx > 0) {
    const label = s.slice(0, idx).trim();
    const evidence = s.slice(idx + 1).trim();
    return { label, evidence };
  }
  return { label: "", evidence: s };
}

function normalizeScoreSource(value: unknown): ScoreSource {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "rep_review" || s === "ai_notes" || s === "manager_override" || s === "system") {
    return s;
  }
  return "system";
}

/** Sales rep (3) only: own deals by rep_name match. Channel roles use channelUserCanViewOpportunity. */
function ensureOpportunityVisible(args: {
  auth: Awaited<ReturnType<typeof getAuth>>;
  orgId: number;
  opportunityRepName: string | null;
}) {
  const { auth, opportunityRepName } = args;
  if (!auth) return { ok: false as const, status: 401 as const, error: "Unauthorized" };
  if (auth.kind !== "user") return { ok: false as const, status: 403 as const, error: "Forbidden" };
  if (isSalesRep(auth.user)) {
    if (!opportunityRepName || opportunityRepName !== auth.user.account_owner_name) {
      return { ok: false as const, status: 403 as const, error: "Forbidden" };
    }
  }
  return { ok: true as const };
}

async function ensureManagerCanSeeRep(args: { orgId: number; managerUserId: number; repName: string }) {
  const { rows } = await pool.query(
    `
    SELECT 1
      FROM users
    WHERE org_id = $1
      AND COALESCE(hierarchy_level, 99) IN ($4::int, $5::int)
       AND active IS TRUE
       AND manager_user_id = $2
       AND account_owner_name = $3
     LIMIT 1
    `,
    [args.orgId, args.managerUserId, args.repName, HIERARCHY.REP, HIERARCHY.CHANNEL_REP]
  );
  return !!rows?.length;
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  const callId = randomUUID();
  let reqSpan: ReturnType<typeof startSpan> | null = null;
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const orgId = auth.kind === "user" ? auth.user.org_id : auth.orgId || 0;
    if (!orgId) return NextResponse.json({ ok: false, error: "Missing org context" }, { status: 400 });

    reqSpan = startSpan({
      workflow: "voice_review",
      stage: "request_total",
      org_id: orgId,
      call_id: callId,
    });

    const opportunityId = await resolvePublicId("opportunities", ctx.params.id);

    const oppRes = await pool.query(
      `
      SELECT *
        FROM opportunities
       WHERE org_id = $1 AND id = $2
       LIMIT 1
      `,
      [orgId, opportunityId]
    );
    const opportunity = oppRes.rows?.[0] || null;
    if (!opportunity) {
      endSpan(reqSpan!, { status: "error", http_status: 404 });
      return NextResponse.json({ ok: false, error: "Opportunity not found" }, { status: 404 });
    }

    const closed = closedOutcomeFromOpportunityRow({ ...opportunity, stage: (opportunity as any)?.sales_stage });
    if (closed) {
      endSpan(reqSpan!, { status: "error", http_status: 409 });
      return NextResponse.json({ ok: false, error: `Closed opportunity (${closed}). Deal Review is disabled.` }, { status: 409 });
    }

    const repName = (opportunity as any)?.rep_name ?? null;

    if (auth.kind === "user" && isChannelRole(auth.user)) {
      const allowed = await channelUserCanViewOpportunity({
        orgId,
        user: auth.user,
        opportunity: opportunity as { rep_id?: unknown; partner_name?: unknown },
      });
      if (!allowed) {
        endSpan(reqSpan!, { status: "error", http_status: 403 });
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
    } else {
      const vis = ensureOpportunityVisible({ auth, orgId, opportunityRepName: repName });
      if (!vis.ok) {
        endSpan(reqSpan!, { status: "error", http_status: vis.status });
        return NextResponse.json({ ok: false, error: vis.error }, { status: vis.status });
      }
    }

    if (auth.kind === "user" && isManager(auth.user)) {
      if (!repName) {
        endSpan(reqSpan!, { status: "error", http_status: 403 });
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
      const ok = await ensureManagerCanSeeRep({ orgId, managerUserId: auth.user.id, repName });
      if (!ok) {
        endSpan(reqSpan!, { status: "error", http_status: 403 });
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
    }

    const categories = ALL_CATEGORIES.map((c) => {
      const opp: any = opportunity || {};
      const map: Record<string, { score: string; summary: string; tip: string }> = {
        metrics: { score: "metrics_score", summary: "metrics_summary", tip: "metrics_tip" },
        economic_buyer: { score: "eb_score", summary: "eb_summary", tip: "eb_tip" },
        criteria: { score: "criteria_score", summary: "criteria_summary", tip: "criteria_tip" },
        process: { score: "process_score", summary: "process_summary", tip: "process_tip" },
        paper: { score: "paper_score", summary: "paper_summary", tip: "paper_tip" },
        pain: { score: "pain_score", summary: "pain_summary", tip: "pain_tip" },
        champion: { score: "champion_score", summary: "champion_summary", tip: "champion_tip" },
        competition: { score: "competition_score", summary: "competition_summary", tip: "competition_tip" },
        timing: { score: "timing_score", summary: "timing_summary", tip: "timing_tip" },
        budget: { score: "budget_score", summary: "budget_summary", tip: "budget_tip" },
      };
      const fallback = map[c];
      const fallbackScore = fallback ? Number(opp?.[fallback.score] ?? 0) : 0;
      const fallbackTip = fallback ? String(opp?.[fallback.tip] ?? "") : "";
      const summary = fallback ? opp?.[fallback.summary] : "";
      const split = splitLabelEvidence(summary);
      return {
        category: c,
        score: Number(fallbackScore ?? 0),
        label: String(split.label ?? ""),
        tip: String(fallbackTip ?? ""),
        evidence: String(split.evidence ?? ""),
        updated_at: opportunity?.updated_at ?? null,
      };
    });

    const healthPercent = computeHealthPercentFromOpportunity((opportunity as any)?.health_score);
    const persistedScoring = (opportunity as any)?.audit_details?.scoring ?? null;
    const scoring = computeConfidence({
      opportunity: opportunity as Record<string, unknown>,
      source: normalizeScoreSource(persistedScoring?.score_source),
      commentIngestionId: Number.isFinite(Number(persistedScoring?.evidence?.comment_ingestion_id))
        ? Number(persistedScoring.evidence.comment_ingestion_id)
        : null,
      now: new Date(),
    });

    const rollup = {
      // Canonical stored wrap on opportunities.
      summary: "",
      next_steps: String((opportunity as any)?.next_steps || "").trim(),
      risks: String((opportunity as any)?.risk_summary || "").trim(),
      updated_at: (opportunity as any)?.updated_at ?? null,
    };

    // Do not expose internal numeric ids by default; the client operates on public ids.
    const { id: _id, org_id: _orgId, rep_id: _repId, ...opportunityPublic } = opportunity as any;

    endSpan(reqSpan!, { status: "ok", http_status: 200 });
    return NextResponse.json({
      ok: true,
      opportunity: opportunityPublic,
      rollup,
      healthPercent,
      categories,
      scoring,
    });
  } catch (e: any) {
    if (reqSpan) endSpan(reqSpan, { status: "error", http_status: 500 });
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

