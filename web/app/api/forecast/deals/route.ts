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
import { getChannelTerritoryRepIds } from "../../../../lib/channelTerritoryScope";
import { getScopedRepDirectory } from "../../../../lib/repScope";
import { computeAiForecastFromHealthScore, toOpenStage } from "../../../../lib/aiForecast";
import { isAdmin, isChannelRole } from "../../../../lib/roleHelpers";
import { channelDealScopeWhereStrict } from "../../../../lib/channelDealScope";

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
    const openStage = toOpenStage(aiForecast);
    aiVerdict = downgradeAiVerdictOneLevel(openStage ?? "Pipeline");
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

    const user = auth.user;
    console.log("FORECAST_DEALS_AUTH", {
      userId: user?.id,
      email: user?.email,
      role: user?.role,
      hierarchy_level: user?.hierarchy_level,
      hierarchyLevelCamel: (user as Record<string, unknown>)?.hierarchyLevel,
      isAdmin: isAdmin(user),
      isChannelRole: isChannelRole(user),
      isChannelComputed: !isAdmin(user) && isChannelRole(user),
      rawUser: JSON.stringify(user),
    });

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

    const isChannel = !isAdmin(user) && isChannelRole(user);

    const channelTerritoryScope = isChannel
      ? await getChannelTerritoryRepIds({
          orgId: user.org_id,
          channelUserId: user.id,
        }).catch(() => ({ repIds: [] as number[], partnerNames: [] as string[] }))
      : { repIds: [] as number[], partnerNames: [] as string[] };

    const territoryRepIds = channelTerritoryScope.repIds.filter((id) => Number.isFinite(id) && id > 0);
    const partnerNames = channelTerritoryScope.partnerNames;
    const channelScopeEmpty = partnerNames.length === 0 && territoryRepIds.length === 0;
    const useChannelScope =
      isChannel && (partnerNames.length > 0 || territoryRepIds.length > 0);

    // Channel roles: fail closed when neither territory nor partner assignments apply.
    if (isChannel && !useChannelScope) {
      console.log("CHANNEL_QUERY_DEBUG", {
        useChannelScope: false,
        channelScopeEmpty: true,
        channelUserId: user.id,
        partnerNames,
        territoryRepIds,
        dealsWhereSql: null,
        note: "early_return_empty_scope_no_query_executed",
        hasPartnerNameNullClause: false,
        channelTerritoryDollarIndex: undefined,
        channelPartnerDollarIndex: undefined,
        channelParamSlots: {},
        paramsArray: [],
        paramsLength: 0,
      });
      return NextResponse.json({ ok: true, deals: [] });
    }

    const scope = await getScopedRepDirectory({
      orgId: user.org_id,
      user,
    });
    const allowedRepIds = scope.allowedRepIds; // null => admin (no filter)

    // If we can't resolve a scope for a non-admin, return no deals (fail closed).
    if (!useChannelScope && allowedRepIds !== null && (!allowedRepIds.length || !Number.isFinite(allowedRepIds[0] as any))) {
      return NextResponse.json({ ok: true, deals: [] });
    }

    const requestedLike = String(requestedRepName || "").trim();

    const baseSelect = `
      SELECT
        o.public_id::text AS id,
        o.rep_id::text AS rep_id,
        COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), o.rep_name) AS rep_name,
        o.account_name,
        o.opportunity_name,
        o.crm_opp_id,
        o.product,
        o.amount,
        o.create_date_raw,
        o.create_date,
        o.close_date,
        o.forecast_stage AS stage,
        o.forecast_stage,
        o.sales_stage,
        o.ai_verdict,
        o.ai_forecast,
        o.partner_name,
        o.deal_registration,
        o.deal_reg_date,
        o.deal_reg_id,
        o.health_score,
        o.risk_summary,
        o.next_steps,
        o.rep_comments,
        o.pain_score, o.pain_summary, o.pain_tip,
        o.metrics_score, o.metrics_summary, o.metrics_tip,
        o.champion_score, o.champion_summary, o.champion_tip,
        o.eb_score, o.eb_summary, o.eb_tip,
        o.criteria_score, o.criteria_summary, o.criteria_tip,
        o.process_score, o.process_summary, o.process_tip,
        o.competition_score, o.competition_summary, o.competition_tip,
        o.paper_score, o.paper_summary, o.paper_tip,
        o.timing_score, o.timing_summary, o.timing_tip,
        o.budget_score, o.budget_summary, o.budget_tip,
        o.paper_confidence, o.process_confidence, o.timing_confidence, o.budget_confidence,
        o.updated_at
      FROM opportunities o
      LEFT JOIN reps r ON r.id = o.rep_id
      LEFT JOIN users u ON u.id = r.user_id
    `;

    // Build WHERE/params in a stable, index-safe way.
    const params: any[] = [user.org_id];
    let p = 1;
    const where: string[] = [`o.org_id = $1`];

    let channelTerritoryDollarIndex: number | undefined;
    let channelPartnerDollarIndex: number | undefined;

    // Channel (6/7/8): partner_name always required. Partner assignments and territory are mutually exclusive:
    // if assigned partner names exist, only match those; otherwise use territory rep ids only.
    if (useChannelScope) {
      params.push(territoryRepIds);
      const territoryIdx = ++p;
      channelTerritoryDollarIndex = territoryIdx;
      params.push(partnerNames);
      const partnerNamesIdx = ++p;
      channelPartnerDollarIndex = partnerNamesIdx;
      where.push(channelDealScopeWhereStrict(territoryIdx, partnerNamesIdx).replace(/^\s*AND\b/i, "").trim());
    } else if (allowedRepIds !== null) {
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
    const dealsWhereSql = whereSql;

    if (isChannel) {
      const queryParams = params;
      const channelParamSlots: Record<string, unknown> = {};
      if (channelTerritoryDollarIndex != null) {
        channelParamSlots[`$${channelTerritoryDollarIndex}`] = queryParams[channelTerritoryDollarIndex - 1];
      }
      if (channelPartnerDollarIndex != null) {
        channelParamSlots[`$${channelPartnerDollarIndex}`] = queryParams[channelPartnerDollarIndex - 1];
      }
      console.log("CHANNEL_QUERY_DEBUG", {
        useChannelScope,
        channelScopeEmpty,
        channelUserId: user.id,
        partnerNames,
        territoryRepIds,
        dealsWhereSql,
        hasPartnerNameNullClause: where.some((w) => /partner_name\s+IS\s+NOT\s+NULL/i.test(w)),
        channelTerritoryDollarIndex,
        channelPartnerDollarIndex,
        channelParamSlots,
        paramsArray: queryParams,
        paramsLength: queryParams.length,
      });
    }

    const { rows } = await pool.query(
      `
      WITH base AS (SELECT 1) ${qpCte}
      ${baseSelectWithJoin}
      ${whereSql}
      ORDER BY o.updated_at DESC NULLS LAST, o.id DESC
      LIMIT $${limitIdx}
      `,
      params
    );

    return NextResponse.json({ ok: true, deals: (rows || []).map(normalizeAiVerdictRow) });
  } catch (e: any) {
    return jsonError(500, e?.message || String(e));
  }
}

