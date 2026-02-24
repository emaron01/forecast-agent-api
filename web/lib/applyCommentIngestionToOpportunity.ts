/**
 * Apply comment ingestion extraction to opportunity.
 * Writes MEDDPICC-TB category scores, summaries, tips, risk_summary, next_steps
 * via muscle save_deal_data with source ai_notes.
 */

import { handleFunctionCall } from "../../muscle.js";
import { pool } from "./pool";
import { listScoreDefinitions, type ScoreDefRow } from "./db";
import type { CommentIngestionExtracted, CategoryExtraction } from "./commentIngestionValidation";

const EXTRACTION_TO_DB: Record<string, string> = {
  economic_buyer: "eb",
  decision_criteria: "criteria",
  decision_process: "process",
  paper_process: "paper",
  metrics: "metrics",
  pain: "pain",
  champion: "champion",
  competition: "competition",
  timing: "timing",
  budget: "budget",
};

function signalToScore(signal: string): number {
  const s = String(signal || "").toLowerCase();
  if (s === "strong") return 3;
  if (s === "medium") return 2;
  if (s === "weak") return 1;
  return 0;
}

function getLabelForScore(defs: ScoreDefRow[], dbPrefix: string, score: number): string {
  const tryCats = dbPrefix === "eb" ? ["eb", "economic_buyer"] : [dbPrefix];
  for (const cat of tryCats) {
    const row = defs.find((d) => (d.category || "").toLowerCase() === cat && Number(d.score) === score);
    if (row?.label) return String(row.label).trim();
  }
  return "";
}

function vpTipForCategory(prefix: string): string {
  const tips: Record<string, string> = {
    pain: "Quantify the business impact, clarify who feels it most, and tie it to a deadline the buyer owns.",
    metrics: "Define one measurable outcome with a baseline and target, and get the buyer to confirm it in writing.",
    champion: "Confirm the internal sponsor's influence and actions this cycle, and secure a concrete next step they will drive.",
    competition: "Document the competitive alternative and your differentiation in the buyer's words, then validate it with the sponsor.",
    budget: "Identify the funding source, approval path, and exact amount required; secure the approver's acknowledgement.",
    criteria: "Get the decision criteria prioritized by the buyer and map how you meet the top two in their language.",
    process: "Map the decision process step‑by‑step, owners and dates, and validate where the deal can stall.",
    paper: "Confirm contracting steps, legal review owner, and the earliest signature date the buyer will commit to.",
    timing: "Anchor the close to a buyer‑owned event and validate the critical path milestones to reach it.",
    eb: "Identify the economic buyer, confirm their priorities, and secure direct access or a committed intro.",
  };
  return tips[prefix] || "Validate the critical evidence and confirm ownership for this category.";
}

function buildCategoryArgs(
  extracted: CommentIngestionExtracted,
  defs: ScoreDefRow[]
): Record<string, string | number> {
  const args: Record<string, string | number> = {};
  const cats: Array<{ key: string; data: CategoryExtraction }> = [];

  for (const [k, v] of Object.entries(extracted.meddpicc || {})) {
    const dbPrefix = EXTRACTION_TO_DB[k] || k;
    cats.push({ key: dbPrefix, data: v });
  }
  cats.push({ key: "timing", data: extracted.timing || { signal: "missing", evidence: [], gaps: [] } });
  cats.push({ key: "budget", data: extracted.budget || { signal: "missing", evidence: [], gaps: [] } });

  for (const { key: dbPrefix, data } of cats) {
    const score = Number.isFinite(data.score) && data.score != null
      ? Math.max(0, Math.min(3, Number(data.score)))
      : signalToScore(data.signal);
    const evidenceText = (data.evidence_text ?? (Array.isArray(data.evidence) ? data.evidence.join(" ").trim() : "")).trim();
    const tip = (data.tip ?? (score < 3 ? vpTipForCategory(dbPrefix) : "")).trim();

    args[`${dbPrefix}_score`] = score;
    const label = getLabelForScore(defs, dbPrefix, score);
    const summary = evidenceText ? (label ? `${label}: ${evidenceText}` : evidenceText) : "";
    args[`${dbPrefix}_summary`] = summary;
    args[`${dbPrefix}_tip`] = tip;
  }

  return args;
}

function buildRiskSummary(extracted: CommentIngestionExtracted): string {
  const parts: string[] = [];
  if (extracted.summary) parts.push(extracted.summary);
  for (const r of extracted.risk_flags || []) {
    const line = `${r.type} (${r.severity}): ${r.why}`.trim();
    if (line) parts.push(line);
  }
  return parts.join("\n\n").trim();
}

function buildNextSteps(extracted: CommentIngestionExtracted): string {
  return (extracted.next_steps || []).filter(Boolean).join("\n").trim();
}

export async function applyCommentIngestionToOpportunity(args: {
  orgId: number;
  opportunityId: number;
  extracted: CommentIngestionExtracted;
  commentIngestionId: number;
}): Promise<{ ok: boolean; error?: string }> {
  const { orgId, opportunityId, extracted, commentIngestionId } = args;

  try {
    // Ingestion "no rescore" guarantee: if baseline already exists, skip all scoring (no model, no health_score update).
    const { rows: oppRows } = await pool.query(
      `SELECT baseline_health_score_ts FROM opportunities WHERE org_id = $1 AND id = $2 LIMIT 1`,
      [orgId, opportunityId]
    );
    if (oppRows?.[0]?.baseline_health_score_ts != null) {
      return { ok: true }; // Skip; baseline already set; do not rescore from ingestion.
    }

    const defs = await listScoreDefinitions().catch(() => []);
    const categoryArgs = buildCategoryArgs(extracted, defs);
    const riskSummary = buildRiskSummary(extracted);
    const nextSteps = buildNextSteps(extracted);

    const toolArgs: Record<string, unknown> = {
      org_id: orgId,
      opportunity_id: opportunityId,
      score_source: "ai_notes",
      comment_ingestion_id: commentIngestionId,
      extraction_confidence: extracted.extraction_confidence || null,
      ...categoryArgs,
    };
    if (riskSummary) toolArgs.risk_summary = riskSummary;
    if (nextSteps) toolArgs.next_steps = nextSteps;
    const cn = String(extracted.champion_name ?? "").trim();
    if (cn) toolArgs.champion_name = cn;
    const ct = String(extracted.champion_title ?? "").trim();
    if (ct) toolArgs.champion_title = ct;
    const ebn = String(extracted.eb_name ?? "").trim();
    if (ebn) toolArgs.eb_name = ebn;
    const ebt = String(extracted.eb_title ?? "").trim();
    if (ebt) toolArgs.eb_title = ebt;

    await handleFunctionCall({
      toolName: "save_deal_data",
      args: toolArgs,
      pool,
    });

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
