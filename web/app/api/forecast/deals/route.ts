import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "../../../../lib/auth";
import { pool } from "../../../../lib/pool";
import { getVisibleUsers } from "../../../../lib/db";
import { closedOutcomeFromOpportunityRow } from "../../../../lib/opportunityOutcome";

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

    const role = auth.user.role;
    const isManagerish = role === "MANAGER" || role === "EXEC_MANAGER";
    const isAdmin = role === "ADMIN";

    const normalize = (s: string) => String(s || "").trim();

    // REP users see only their own rep_name.
    if (role === "REP") {
      const my = normalize(auth.user.account_owner_name || "");
      if (!my) return NextResponse.json({ ok: true, deals: [] });

      const qpCte = quotaPeriodId
        ? `
        , qp AS (
          SELECT period_start, period_end
            FROM quota_periods
           WHERE org_id = $1::bigint
             AND id = $4::bigint
           LIMIT 1
        )
      `
        : "";

      const qpJoin = quotaPeriodId ? "JOIN qp ON TRUE" : "";
      const qpWhere = quotaPeriodId
        ? `
          AND close_date IS NOT NULL
          AND close_date >= qp.period_start
          AND close_date <= qp.period_end
        `
        : "";

      const params = quotaPeriodId ? [auth.user.org_id, my, limit, quotaPeriodId] : [auth.user.org_id, my, limit];

      const { rows } = await pool.query(
        `
        WITH base AS (SELECT 1) ${qpCte}
        SELECT
          public_id::text AS id,
          rep_name,
          account_name,
          opportunity_name,
          crm_opp_id,
          product,
          amount,
          create_date_raw,
          create_date,
          close_date,
          sales_stage AS stage,
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
        FROM opportunities
        ${qpJoin}
        WHERE org_id = $1
          AND btrim(COALESCE(rep_name, '')) = btrim($2)
          ${qpWhere}
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT $3
        `,
        params
      );

      const deals = (rows || []).map(normalizeAiVerdictRow);
      return NextResponse.json({ ok: true, deals });
    }

    // Managers/execs: attempt to scope to visible REP user accounts.
    const visibleUsers = await getVisibleUsers({
      currentUserId: auth.user.id,
      orgId: auth.user.org_id,
      role,
      hierarchy_level: auth.user.hierarchy_level,
      see_all_visibility: auth.user.see_all_visibility,
    }).catch(() => []);

    const visibleRepNames = (visibleUsers || [])
      .filter((u) => u.role === "REP" && u.active)
      .map((u) => normalize(u.account_owner_name || ""))
      .filter(Boolean);

    // IMPORTANT:
    // - `rep_name` query param is treated as a *filter* (supports partial typing) and should never 403.
    // - Visibility is enforced separately for manager-ish roles via visible REP user names (when available).
    const requestedLike = normalize(requestedRepName);

    const baseSelect = `
      SELECT
        public_id::text AS id,
        rep_name,
        account_name,
        opportunity_name,
        crm_opp_id,
        product,
        amount,
        create_date_raw,
        create_date,
        close_date,
        sales_stage AS stage,
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
      FROM opportunities
      WHERE org_id = $1
    `;

    // Build WHERE/params in a stable, index-safe way.
    const params: any[] = [auth.user.org_id];
    let p = 1;
    const where: string[] = [];

    // Visibility scoping (MANAGER / EXEC_MANAGER only). Admins see all org deals.
    // NOTE: If we can't compute visible rep names, we do not block access (existing behavior).
    if (isManagerish && visibleRepNames.length) {
      params.push(visibleRepNames);
      where.push(`btrim(COALESCE(rep_name, '')) = ANY($${++p}::text[])`);
    }

    // Rep filter: allow partial typing; never 403.
    if (requestedLike) {
      params.push(`%${requestedLike}%`);
      where.push(`btrim(COALESCE(rep_name, '')) ILIKE $${++p}`);
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
      where.push(`close_date IS NOT NULL`);
      where.push(`close_date >= qp.period_start`);
      where.push(`close_date <= qp.period_end`);
    }

    params.push(limit);
    const limitIdx = ++p;

    const baseSelectWithJoin = qpJoin ? baseSelect.replace("FROM opportunities", `FROM opportunities\n      ${qpJoin}`) : baseSelect;
    const whereSql = where.length ? `\n        AND ${where.join("\n        AND ")}\n` : "\n";

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

    // If manager scoping yields nothing (often due to rep_name mismatch with user account_owner_name),
    // fall back to showing org deals so uploads are still visible.
    if (isManagerish && !requestedLike && visibleRepNames.length && !(rows || []).length) {
      const { rows: allRows } = await pool.query(
        `
        ${baseSelect}
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT $2
        `,
        [auth.user.org_id, limit]
      );
      return NextResponse.json({
        ok: true,
        deals: (allRows || []).map(normalizeAiVerdictRow),
        warning: "No deals matched scoped reps; showing all org deals. Check REP users' account_owner_name vs opportunities.rep_name.",
      });
    }

    return NextResponse.json({ ok: true, deals: (rows || []).map(normalizeAiVerdictRow) });
  } catch (e: any) {
    return jsonError(500, e?.message || String(e));
  }
}

