import { NextResponse } from "next/server";
import { getAuth } from "../../../../lib/auth";
import { computeAiForecastFromHealthScore, toOpenStage } from "../../../../lib/aiForecast";
import { computeCommitAdmission, isCommitAdmissionApplicable } from "../../../../lib/commitAdmission";
import { computeConfidence, type ScoreSource } from "../../../../lib/confidence";
import { isAdmin, isChannelRole, isSalesLeader } from "../../../../lib/roleHelpers";
import { pool } from "../../../../lib/pool";

export const runtime = "nodejs";

type OrgStageMapping = { stage_value: string; bucket: string };

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function clamp(v: number, lo: number, hi: number) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function healthPctFromScore30(score: any) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  return clamp(Math.round((n / 30) * 100), 0, 100);
}

type RiskCategoryKey =
  | "pain"
  | "metrics"
  | "champion"
  | "criteria"
  | "competition"
  | "timing"
  | "budget"
  | "economic_buyer"
  | "process"
  | "paper"
  | "suppressed";

function isRiskScore(score: number | null) {
  if (score == null) return true;
  if (!Number.isFinite(score)) return true;
  return score <= 1;
}

function uniqueNonEmpty(lines: Array<string | null | undefined>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines || []) {
    const s = String(raw || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function cleanText(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function normalizeScoreSource(value: unknown): ScoreSource {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "rep_review" || s === "ai_notes" || s === "manager_override" || s === "system") {
    return s;
  }
  return "system";
}

function stageBucketFromStages(
  forecastStage: any,
  salesStage: any,
  orgStageMappings?: OrgStageMapping[]
): "commit" | "best_case" | "pipeline" | null {
  if (orgStageMappings?.length) {
    const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
    const normBucket = (v: unknown) => norm(v).replace(/\s+/g, "_");

    const ss = norm(salesStage);
    const fs = norm(forecastStage);

    const salesMatch = orgStageMappings.find((m) => norm(m.stage_value) === ss);
    if (salesMatch) {
      const b = normBucket(salesMatch.bucket);
      if (b === "commit" || b === "best_case" || b === "pipeline") return b;
      return null;
    }

    const forecastMatch = orgStageMappings.find((m) => norm(m.stage_value) === fs);
    if (forecastMatch) {
      const b = normBucket(forecastMatch.bucket);
      if (b === "commit" || b === "best_case" || b === "pipeline") return b;
      return null;
    }
  }

  const fs = String(forecastStage || "").trim();
  const ss = String(salesStage || "").trim();
  const combined = `${fs} ${ss}`.trim().toLowerCase();
  if (!combined) return null;
  if (combined.includes("won") || combined.includes("lost") || combined.includes("loss") || combined.includes("closed")) return null;
  if (combined.includes("commit")) return "commit";
  if (combined.includes("best")) return "best_case";
  return "pipeline";
}

function bucketLabel(b: "commit" | "best_case" | "pipeline" | null): "Commit" | "Best Case" | "Pipeline" {
  if (b === "commit") return "Commit";
  if (b === "best_case") return "Best Case";
  return "Pipeline";
}

function normalizeOpenStageLabel(stageLike: any): "Commit" | "Best Case" | "Pipeline" | null {
  const s = String(stageLike || "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("commit")) return "Commit";
  if (s.includes("best")) return "Best Case";
  if (s.includes("pipeline")) return "Pipeline";
  return null;
}

function downgradeAiVerdictOneLevel(ai: "Commit" | "Best Case" | "Pipeline"): "Best Case" | "Pipeline" {
  if (ai === "Commit") return "Best Case";
  if (ai === "Best Case") return "Pipeline";
  return "Pipeline";
}

type DealCoachingCardDeal = {
  id: string;
  rep: { rep_id: string | null; rep_public_id: string | null; rep_name: string | null };
  deal_name: { account_name: string | null; opportunity_name: string | null };
  close_date: string | null;
  crm_stage: { forecast_stage: string | null; bucket: "commit" | "best_case" | "pipeline" | null; label: string };
  ai_verdict_stage: "Commit" | "Best Case" | "Pipeline" | null;
  amount: number;
  health: {
    health_score: number | null;
    health_pct: number | null;
    suppression: boolean;
    probability_modifier: number;
    health_modifier: number;
  };
  weighted: {
    stage_probability: number;
    crm_weighted: number;
    ai_weighted: number;
    gap: number;
  };
  meddpicc_tb: Array<{
    key:
      | "pain"
      | "metrics"
      | "champion"
      | "criteria"
      | "competition"
      | "timing"
      | "budget"
      | "economic_buyer"
      | "process"
      | "paper";
    score: number | null;
    score_label: string;
    tip: string | null;
    evidence: string | null;
  }>;
  signals: {
    risk_summary: string | null;
    next_steps: string | null;
  };
  risk_flags: Array<{ key: RiskCategoryKey; label: string; tip: string | null }>;
  coaching_insights: string[];
  commit_admission_status?: "admitted" | "not_admitted" | "needs_review";
  commit_admission_reasons?: string[];
  verdict_note?: string | null;
  _commit_high_conf_count?: number;
  partner_name?: string | null;
  confidence_band?: "high" | "medium" | "low" | null;
  confidence_summary?: string | null;
};

export async function GET(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return jsonError(401, "Unauthorized");
    if (auth.kind !== "user") return jsonError(403, "Forbidden");

    const canViewDealCard = isSalesLeader(auth.user) || isAdmin(auth.user) || isChannelRole(auth.user);
    if (!canViewDealCard) return jsonError(403, "Forbidden");

    const url = new URL(req.url);
    const id = String(url.searchParams.get("id") || "").trim();
    if (!id) return jsonError(400, "Missing id");

    const { rows } = await pool.query<{
      id: string;
      opportunity_name: string | null;
      account_name: string | null;
      close_date: string | null;
      forecast_stage: string | null;
      sales_stage: string | null;
      amount: number | null;
      health_score: number | null;
      pain_score: number | null;
      metrics_score: number | null;
      champion_score: number | null;
      criteria_score: number | null;
      competition_score: number | null;
      timing_score: number | null;
      budget_score: number | null;
      eb_score: number | null;
      process_score: number | null;
      paper_score: number | null;
      pain_summary: string | null;
      metrics_summary: string | null;
      champion_summary: string | null;
      criteria_summary: string | null;
      competition_summary: string | null;
      timing_summary: string | null;
      budget_summary: string | null;
      eb_summary: string | null;
      process_summary: string | null;
      paper_summary: string | null;
      pain_tip: string | null;
      metrics_tip: string | null;
      champion_tip: string | null;
      criteria_tip: string | null;
      competition_tip: string | null;
      timing_tip: string | null;
      budget_tip: string | null;
      eb_tip: string | null;
      process_tip: string | null;
      paper_tip: string | null;
      risk_summary: string | null;
      next_steps: string | null;
      paper_confidence: string | null;
      process_confidence: string | null;
      timing_confidence: string | null;
      budget_confidence: string | null;
      health_score_source: string | null;
      audit_details: any | null;
      updated_at: string | null;
      rep_public_id: string | null;
      rep_name: string | null;
      partner_name: string | null;
      ai_verdict: string | null;
      ai_forecast: string | null;
    }>(
      `
      SELECT
        o.public_id::text AS id,
        o.opportunity_name,
        o.account_name,
        o.close_date::text,
        o.forecast_stage,
        o.sales_stage,
        o.ai_verdict,
        o.ai_forecast,
        o.amount,
        o.health_score,
        o.pain_score, o.metrics_score, o.champion_score,
        o.criteria_score, o.competition_score,
        o.timing_score, o.budget_score, o.eb_score,
        o.process_score, o.paper_score,
        o.pain_summary, o.metrics_summary,
        o.champion_summary, o.criteria_summary,
        o.competition_summary, o.timing_summary,
        o.budget_summary, o.eb_summary,
        o.process_summary, o.paper_summary,
        o.pain_tip, o.metrics_tip, o.champion_tip,
        o.criteria_tip, o.competition_tip,
        o.timing_tip, o.budget_tip, o.eb_tip,
        o.process_tip, o.paper_tip,
        o.risk_summary, o.next_steps,
        o.paper_confidence, o.process_confidence,
        o.timing_confidence, o.budget_confidence,
        o.health_score_source,
        o.audit_details,
        o.updated_at,
        r.public_id::text AS rep_public_id,
        COALESCE(
          NULLIF(btrim(r.display_name), ''),
          NULLIF(btrim(r.rep_name), '')
        ) AS rep_name,
        NULLIF(btrim(o.partner_name), '') AS partner_name
      FROM opportunities o
      LEFT JOIN reps r ON r.id = o.rep_id
      WHERE o.public_id = $1::uuid
        AND o.org_id = $2::bigint
      `,
      [id, auth.user.org_id]
    );

    const row = rows?.[0] ?? null;
    if (!row) return jsonError(404, "Not found");

    const orgStageMappings: OrgStageMapping[] = await pool
      .query(`SELECT stage_value, bucket FROM org_stage_mappings WHERE org_id = $1`, [auth.user.org_id])
      .then((r) => (r.rows || []) as any[])
      .catch(() => []);

    const bucket = stageBucketFromStages(row.forecast_stage, row.sales_stage, orgStageMappings);
    const computedAiForecast = computeAiForecastFromHealthScore({
      healthScore: row.health_score,
      forecastStage: row.forecast_stage,
      salesStage: row.sales_stage,
    });
    const applicable = isCommitAdmissionApplicable(row, computedAiForecast, orgStageMappings);
    const admission = computeCommitAdmission(row, applicable);
    const highConfCount = [row.paper_confidence, row.process_confidence, row.timing_confidence, row.budget_confidence].filter(
      (v) => String(v || "").trim().toLowerCase() === "high"
    ).length;

    let aiVerdictStage =
      toOpenStage(computedAiForecast) ??
      normalizeOpenStageLabel(row.ai_verdict) ??
      normalizeOpenStageLabel(row.ai_forecast) ??
      normalizeOpenStageLabel(row.forecast_stage) ??
      null;

    let verdictNote: string | null = null;
    if (applicable && aiVerdictStage) {
      if (admission.status === "not_admitted") {
        aiVerdictStage = downgradeAiVerdictOneLevel(aiVerdictStage);
        verdictNote = admission.reasons[0] || "Commit not supported";
      } else if (admission.status === "needs_review") {
        verdictNote = "Low-confidence evidence";
      }
    }

    const persistedScoring = (row as any)?.audit_details?.scoring ?? null;
    const scoreSource = normalizeScoreSource(persistedScoring?.score_source ?? row.health_score_source);
    const computedScoring = computeConfidence({
      opportunity: row,
      source: scoreSource,
      now: new Date(),
    });
    const confidenceBand = computedScoring.confidence_band;
    const confidenceSummary = computedScoring.confidence_summary;

    const riskFlags: Array<{ key: RiskCategoryKey; label: string; tip: string | null }> = [];
    const push = (key: RiskCategoryKey, displayName: string, score: number | null, tip: string | null) => {
      if (!isRiskScore(score)) return;
      const scorePart = score == null ? "unscored" : `score ${score}`;
      riskFlags.push({
        key,
        label: `${displayName}: ${scorePart}`,
        tip: tip && String(tip).trim() ? String(tip).trim() : null,
      });
    };
    push("economic_buyer", "Economic Buyer", row.eb_score, row.eb_tip);
    push("paper", "Paper Process", row.paper_score, row.paper_tip);
    push("champion", "Internal Sponsor", row.champion_score, row.champion_tip);
    push("process", "Decision Process", row.process_score, row.process_tip);
    push("timing", "Timing", row.timing_score, row.timing_tip);
    push("criteria", "Criteria", row.criteria_score, row.criteria_tip);
    push("competition", "Competition", row.competition_score, row.competition_tip);
    push("budget", "Budget", row.budget_score, row.budget_tip);
    push("pain", "Pain", row.pain_score, row.pain_tip);
    push("metrics", "Metrics", row.metrics_score, row.metrics_tip);

    const deal: DealCoachingCardDeal = {
      id: String(row.id),
      rep: {
        rep_id: null,
        rep_public_id: row.rep_public_id ?? null,
        rep_name: row.rep_name ?? null,
      },
      deal_name: {
        account_name: row.account_name ?? null,
        opportunity_name: row.opportunity_name ?? null,
      },
      close_date: row.close_date ?? null,
      crm_stage: {
        forecast_stage: row.forecast_stage ?? null,
        bucket,
        label: bucketLabel(bucket),
      },
      ai_verdict_stage: aiVerdictStage,
      amount: Number(row.amount || 0) || 0,
      health: {
        health_score: row.health_score ?? null,
        health_pct: healthPctFromScore30(row.health_score),
        suppression: false,
        probability_modifier: 1,
        health_modifier: 1,
      },
      weighted: {
        stage_probability: 0,
        crm_weighted: 0,
        ai_weighted: 0,
        gap: 0,
      },
      meddpicc_tb: [
        { key: "pain", score: row.pain_score, score_label: "", tip: cleanText(row.pain_tip), evidence: cleanText(row.pain_summary) },
        { key: "metrics", score: row.metrics_score, score_label: "", tip: cleanText(row.metrics_tip), evidence: cleanText(row.metrics_summary) },
        { key: "champion", score: row.champion_score, score_label: "", tip: cleanText(row.champion_tip), evidence: cleanText(row.champion_summary) },
        { key: "criteria", score: row.criteria_score, score_label: "", tip: cleanText(row.criteria_tip), evidence: cleanText(row.criteria_summary) },
        { key: "competition", score: row.competition_score, score_label: "", tip: cleanText(row.competition_tip), evidence: cleanText(row.competition_summary) },
        { key: "timing", score: row.timing_score, score_label: "", tip: cleanText(row.timing_tip), evidence: cleanText(row.timing_summary) },
        { key: "budget", score: row.budget_score, score_label: "", tip: cleanText(row.budget_tip), evidence: cleanText(row.budget_summary) },
        { key: "economic_buyer", score: row.eb_score, score_label: "", tip: cleanText(row.eb_tip), evidence: cleanText(row.eb_summary) },
        { key: "process", score: row.process_score, score_label: "", tip: cleanText(row.process_tip), evidence: cleanText(row.process_summary) },
        { key: "paper", score: row.paper_score, score_label: "", tip: cleanText(row.paper_tip), evidence: cleanText(row.paper_summary) },
      ],
      signals: {
        risk_summary: row.risk_summary ?? null,
        next_steps: row.next_steps ?? null,
      },
      risk_flags: riskFlags,
      coaching_insights: uniqueNonEmpty(riskFlags.map((r) => r.tip)),
      commit_admission_status: applicable ? admission.status : undefined,
      commit_admission_reasons: applicable ? admission.reasons : undefined,
      verdict_note: verdictNote,
      _commit_high_conf_count: highConfCount,
      partner_name: row.partner_name ?? null,
      confidence_band: confidenceBand,
      confidence_summary: confidenceSummary,
    };

    return NextResponse.json({ ok: true, deal });
  } catch (e: any) {
    return jsonError(500, e?.message || String(e));
  }
}
