export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "../../../../../../lib/pool";
import { signExtensionToken, type HubSpotExtensionTokenPayload } from "../../../../../../lib/hubspotExtensionJwt";
import type { HubSpotDealState } from "../../../../../crm/hubspot/review/types";

function jsonError(status: number, msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function toDealState(row: any): HubSpotDealState {
  const health_pct =
    row.health_score != null
      ? Math.min(100, Math.max(0, Math.round((Number(row.health_score) / 30) * 100)))
      : null;

  return {
    account_name: row.account_name ?? null,
    opportunity_name: row.opportunity_name ?? null,
    forecast_stage: row.forecast_stage ?? null,
    amount: row.amount != null ? Number(row.amount) : null,
    close_date: row.close_date ?? null,
    rep_name: row.rep_name ?? null,
    partner_name: row.partner_name ?? null,
    champion_name: row.champion_name ?? null,
    champion_title: row.champion_title ?? null,
    eb_name: row.eb_name ?? null,
    eb_title: row.eb_title ?? null,
    risk_summary: row.risk_summary ?? null,
    next_steps: row.next_steps ?? null,
    health_score: row.health_score ?? null,
    health_pct,
    confidence_band: null,
    ai_verdict: row.ai_verdict ?? null,
    review_request_note: row.review_request_note ?? null,
    review_requested_at: row.review_requested_at ?? null,
    review_requested_by_name: row.review_requested_by_name ?? null,
    pain_score: row.pain_score ?? null,
    metrics_score: row.metrics_score ?? null,
    champion_score: row.champion_score ?? null,
    eb_score: row.eb_score ?? null,
    criteria_score: row.criteria_score ?? null,
    process_score: row.process_score ?? null,
    competition_score: row.competition_score ?? null,
    paper_score: row.paper_score ?? null,
    timing_score: row.timing_score ?? null,
    budget_score: row.budget_score ?? null,
    pain_summary: row.pain_summary ?? null,
    metrics_summary: row.metrics_summary ?? null,
    champion_summary: row.champion_summary ?? null,
    eb_summary: row.eb_summary ?? null,
    criteria_summary: row.criteria_summary ?? null,
    process_summary: row.process_summary ?? null,
    competition_summary: row.competition_summary ?? null,
    paper_summary: row.paper_summary ?? null,
    timing_summary: row.timing_summary ?? null,
    budget_summary: row.budget_summary ?? null,
    pain_tip: row.pain_tip ?? null,
    metrics_tip: row.metrics_tip ?? null,
    champion_tip: row.champion_tip ?? null,
    eb_tip: row.eb_tip ?? null,
    criteria_tip: row.criteria_tip ?? null,
    process_tip: row.process_tip ?? null,
    competition_tip: row.competition_tip ?? null,
    paper_tip: row.paper_tip ?? null,
    timing_tip: row.timing_tip ?? null,
    budget_tip: row.budget_tip ?? null,
  };
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();

    const url = new URL(req.url);
    const qsPortalId = url.searchParams.get("portalId") || "";

    let body: any = {};
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = {};
    }

    const portalId = String(body.portalId || qsPortalId || "").trim();
    const dealId = String(body.dealId || "").trim();
    const userEmail = String(body.userEmail || "").trim().toLowerCase();
    if (!portalId || !dealId || !userEmail) return jsonError(400, "Missing required fields");

    console.log("[hs-extension:token] hit, portalId:", portalId);

    const orgRes = await pool.query<{ org_id: number }>(
      `SELECT org_id
         FROM hubspot_connections
        WHERE hub_id = $1
        LIMIT 1`,
      [portalId]
    );
    if (!orgRes.rows[0]) return jsonError(401, "Organization not found");
    const org_id = Number(orgRes.rows[0].org_id);

    const repRes = await pool.query<{ rep_id: number }>(
      `SELECT r.id AS rep_id
         FROM reps r
         JOIN users u ON u.id = r.user_id
        WHERE LOWER(u.email) = $1
          AND r.org_id = $2
          AND (r.active IS TRUE OR r.active IS NULL)
        LIMIT 1`,
      [userEmail, org_id]
    );
    if (!repRes.rows[0]) return jsonError(404, "Rep not found");
    const rep_id = Number(repRes.rows[0].rep_id);

    const oppRes = await pool.query<
      {
        id: number;
        public_id: string;
        crm_opp_id: string;
      } & HubSpotDealState & { health_score: number | null }
    >(
      `SELECT
         o.id,
         o.public_id::text,
         o.crm_opp_id,
         o.account_name,
         o.opportunity_name,
         o.forecast_stage,
         o.amount,
         o.close_date::text AS close_date,
         o.risk_summary,
         o.next_steps,
         o.health_score,
         o.ai_verdict,
         o.review_request_note,
         o.review_requested_at::text AS review_requested_at,
         COALESCE(
           NULLIF(btrim(u_req.first_name || ' ' || u_req.last_name), ''),
           NULLIF(btrim(u_req.email), '')
         ) AS review_requested_by_name,
         o.champion_name,
         o.champion_title,
         o.eb_name,
         o.eb_title,
         o.pain_score, o.metrics_score,
         o.champion_score, o.eb_score,
         o.criteria_score, o.process_score,
         o.competition_score, o.paper_score,
         o.timing_score, o.budget_score,
         o.pain_summary, o.metrics_summary,
         o.champion_summary, o.eb_summary,
         o.criteria_summary, o.process_summary,
         o.competition_summary, o.paper_summary,
         o.timing_summary, o.budget_summary,
         o.pain_tip, o.metrics_tip,
         o.champion_tip, o.eb_tip,
         o.criteria_tip, o.process_tip,
         o.competition_tip, o.paper_tip,
         o.timing_tip, o.budget_tip,
         COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), '')) AS rep_name,
         NULLIF(btrim(o.partner_name), '') AS partner_name
       FROM opportunities o
       LEFT JOIN reps r ON r.id = o.rep_id
       LEFT JOIN users u_req
         ON u_req.id = o.review_requested_by
      WHERE o.crm_opp_id = $1
        AND o.org_id = $2
      LIMIT 1`,
      [dealId, org_id]
    );
    if (!oppRes.rows[0]) return jsonError(404, "Opportunity not found");

    const opp = oppRes.rows[0] as any;
    const opportunity_id = Number(opp.id);
    const public_id = String(opp.public_id);
    const crm_opp_id = String(opp.crm_opp_id);

    const basePayload: Omit<HubSpotExtensionTokenPayload, "purpose"> = {
      org_id,
      rep_id,
      opportunity_id,
      public_id,
      crm_opp_id,
    };

    const [reviewToken, dashboardToken] = await Promise.all([
      signExtensionToken({ ...basePayload, purpose: "review" }, 3600),
      signExtensionToken({ ...basePayload, purpose: "dashboard" }, 3600),
    ]);

    const dealState = toDealState(opp);

    return NextResponse.json({
      ok: true,
      reviewToken,
      dashboardToken,
      dealState,
    });
  } catch (e) {
    console.error("[hs-extension:token]", e);
    return jsonError(500, "Server error");
  }
}

