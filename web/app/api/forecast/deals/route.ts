import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "../../../../lib/auth";
import { pool } from "../../../../lib/pool";
import { closedOutcomeFromOpportunityRow, normalizeClosedForecast } from "../../../../lib/opportunityOutcome";
import {
  computeCommitAdmission,
  isCommitAdmissionApplicable,
  type CommitAdmissionStatus,
} from "../../../../lib/commitAdmission";
import { getScopedRepDirectory } from "../../../../lib/repScope";
import { computeAiForecastFromHealthScore } from "../../../../lib/aiForecast";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function downgradeAiVerdictOneLevel(
  ai: "Commit" | "Best Case" | "Pipeline"
): "Best Case" | "Pipeline" {
  if (ai === "Commit") return "Best Case";
  if (ai === "Best Case") return "Pipeline";
  return "Pipeline";
}

function normalizeAiVerdictRow(row: any) {
  const closed = closedOutcomeFromOpportunityRow(row);
  if (closed) {
    const closedLabel = normalizeClosedForecast(closed) ?? closed;
    return { ...row, ai_verdict: closedLabel, ai_forecast: closedLabel };
  }

  const aiForecast = computeAiForecastFromHealthScore({
    healthScore: row?.health_score,
    forecastStage: row?.forecast_stage,
    salesStage: row?.sales_stage,
  });
  if (!aiForecast) return { ...row };

  const applicable = isCommitAdmissionApplicable(row, aiForecast);
  const admission = computeCommitAdmission(row, applicable);

  let aiVerdict: string = aiForecast;
  let verdictNote: string | undefined;

  if (admission.status === "not_admitted") {
    aiVerdict = downgradeAiVerdictOneLevel(aiForecast);
    verdictNote = "AI: Commit not supported (see admission reasons).";
  } else if (admission.status === "needs_review") {
    verdictNote = "AI: Commit evidence is low-confidence; review required.";
  }

  const out: Record<string, unknown> = {
    ...row,
    ai_verdict: aiVerdict,
    ai_forecast: aiForecast,
  };
  if (applicable) {
    out.commit_admission_status = admission.status as CommitAdmissionStatus;
    out.commit_admission_reasons = admission.reasons;
  }
  if (verdictNote) out.verdict_note = verdictNote;

  return out;
}

export async function GET(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return jsonError(401, "Unauthorized");
    if (auth.kind !== "user") return jsonError(403, "Forbidden");

    const url = new URL(req.url);
    const requestedRepName = String(url.searchParams.get("rep_name") || "").trim();
    const atRiskRaw = String(url.searchParams.get("at_risk") || "").trim().toLowerCase();
    const atRisk = atRiskRaw === "1" || atRiskRaw === "true" || atRiskRaw === "yes" || atRiskRaw === "on";
    const quotaPeriodId = z
      .string()
      .regex(/^\d+$/)
      .optional()
      .catch(undefined)
      .parse(String(url.searchParams.get("quota_period_id") || "").trim() || undefined);
    const limit = z.coerce.number().int().min(1).max(2000).catch(200).parse(url.searchParams.get("limit"));

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
        sales_stage,
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
        paper_confidence, process_confidence, timing_confidence, budget_confidence,
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

    // At-risk filter: Commit/Best Case (CRM forecast stage) with red/yellow avg health score.
    // Health colors: >= 80% (>= 24/30) is green. We want < 24 (red/yellow).
    if (atRisk) {
      where.push(`o.health_score IS NOT NULL`);
      where.push(`o.health_score > 0`);
      where.push(`o.health_score < 24`);
      where.push(
        `
        (
          (' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% commit %'
          OR (' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% best %'
        )
        `.trim()
      );
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

