import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "../../../../lib/auth";
import { pool } from "../../../../lib/pool";
import { closedOutcomeFromOpportunityRow } from "../../../../lib/opportunityOutcome";
import { getScopedRepDirectory } from "../../../../lib/repScope";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function computeAiFromHealthScore(healthScore: any) {
  const n = Number(healthScore);
  if (!Number.isFinite(n)) return null;
  if (n >= 24) return "Commit";
  if (n >= 18) return "Best Case";
  return "Pipeline";
}

function normalizeAiVerdictRow(row: any) {
  const closed = closedOutcomeFromOpportunityRow(row);
  if (closed) {
    return { ...row, ai_verdict: closed };
  }
  const ai = computeAiFromHealthScore(row?.health_score);
  if (!ai) return row;
  // Force AI display to align with computed health score (non-negotiable).
  // Keep the raw DB fields too, but always provide a correct `ai_verdict`.
  return { ...row, ai_verdict: ai };
}

export async function GET(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return jsonError(401, "Unauthorized");
    if (auth.kind !== "user") return jsonError(403, "Forbidden");

    const url = new URL(req.url);
    const requestedRepName = String(url.searchParams.get("rep_name") || "").trim();
    const quotaPeriodId = z
      .string()
      .regex(/^\d+$/)
      .optional()
      .catch(undefined)
      .parse(String(url.searchParams.get("quota_period_id") || "").trim() || undefined);
    const limit = z.coerce.number().int().min(1).max(500).catch(200).parse(url.searchParams.get("limit"));

    const roleRaw = String(auth.user.role || "").trim();
    const scopedRole =
      roleRaw === "ADMIN" || roleRaw === "EXEC_MANAGER" || roleRaw === "MANAGER" || roleRaw === "REP"
        ? (roleRaw as "ADMIN" | "EXEC_MANAGER" | "MANAGER" | "REP")
        : ("REP" as const);

    const scope = await getScopedRepDirectory({
      orgId: auth.user.org_id,
      userId: auth.user.id,
      role: scopedRole,
    });
    const allowedRepIds = scope.allowedRepIds; // null => admin (no filter)

    // If we can't resolve a scope for a non-admin, return no deals (fail closed).
    if (allowedRepIds !== null && (!allowedRepIds.length || !Number.isFinite(allowedRepIds[0] as any))) {
      return NextResponse.json({ ok: true, deals: [] });
    }

    const requestedLike = String(requestedRepName || "").trim();

    const baseSelect = `
      SELECT
        public_id::text AS id,
        rep_id::text AS rep_id,
        rep_name,
        account_name,
        opportunity_name,
        crm_opp_id,
        product,
        amount,
        create_date_raw,
        create_date,
        close_date,
        forecast_stage AS stage,
        forecast_stage,
        ai_verdict,
        ai_forecast,
        partner_name,
        deal_registration,
        health_score,
        risk_summary,
        next_steps,
        rep_comments,
        pain_score, pain_summary, pain_tip,
        metrics_score, metrics_summary, metrics_tip,
        champion_score, champion_summary, champion_tip,
        eb_score, eb_summary, eb_tip,
        criteria_score, criteria_summary, criteria_tip,
        process_score, process_summary, process_tip,
        competition_score, competition_summary, competition_tip,
        paper_score, paper_summary, paper_tip,
        timing_score, timing_summary, timing_tip,
        budget_score, budget_summary, budget_tip,
        updated_at
      FROM opportunities o
    `;

    // Build WHERE/params in a stable, index-safe way.
    const params: any[] = [auth.user.org_id];
    let p = 1;
    const where: string[] = [`o.org_id = $1`];

    // Visibility scoping (ADMIN sees all; everyone else is scoped by allowed rep IDs).
    if (allowedRepIds !== null) {
      params.push(allowedRepIds);
      where.push(`o.rep_id IS NOT NULL`);
      where.push(`o.rep_id = ANY($${++p}::bigint[])`);
    }

    // Rep filter: allow partial typing; never 403.
    if (requestedLike) {
      params.push(`%${requestedLike}%`);
      where.push(`btrim(COALESCE(o.rep_name, '')) ILIKE $${++p}`);
    }

    // Quota period filter.
    let qpCte = "";
    let qpJoin = "";
    if (quotaPeriodId) {
      params.push(quotaPeriodId);
      const qpIdx = ++p;
      qpCte = `
      , qp AS (
        SELECT period_start, period_end
          FROM quota_periods
         WHERE org_id = $1::bigint
           AND id = $${qpIdx}::bigint
         LIMIT 1
      )
      `;
      qpJoin = "JOIN qp ON TRUE";
      where.push(`o.close_date IS NOT NULL`);
      where.push(`o.close_date >= qp.period_start`);
      where.push(`o.close_date <= qp.period_end`);
    }

    params.push(limit);
    const limitIdx = ++p;

    const baseSelectWithJoin = qpJoin ? `${baseSelect}\n      ${qpJoin}` : baseSelect;
    const whereSql = where.length ? `\n      WHERE ${where.join("\n        AND ")}\n` : "\n";

    const { rows } = await pool.query(
      `
      WITH base AS (SELECT 1) ${qpCte}
      ${baseSelectWithJoin}
      ${whereSql}
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT $${limitIdx}
      `,
      params
    );

    return NextResponse.json({ ok: true, deals: (rows || []).map(normalizeAiVerdictRow) });
  } catch (e: any) {
    return jsonError(500, e?.message || String(e));
  }
}

