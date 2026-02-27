/**
 * Apply comment ingestion extraction to opportunity.
 * Writes MEDDPICC-TB category scores, summaries, tips, risk_summary, next_steps
 * via muscle save_deal_data with source ai_notes.
 */

import { handleFunctionCall } from "../../muscle.js";
import { pool } from "./pool";
import { listScoreDefinitions, type ScoreDefRow } from "./db";
import { isClosedOpportunityRow } from "./opportunityOutcome";
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

function extractSinglePersonAndTitleFromNotes(rawNotes: string): { name?: string; title?: string; reason?: string } {
  const raw = String(rawNotes || "").trim();
  if (!raw) return {};
  const role =
    /\b(ceo|cfo|coo|cto|cio|cmo|cro|chief|president|owner|svp|evp|vp|vice president|director|head|manager|lead)\b/i;
  const nameLike = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/;
  const sentences = raw
    .split(/[\n.!?]+/g)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 200);

  const candidates: Array<{ name: string; title: string }> = [];
  for (const s of sentences) {
    // Name is (the) Title
    const m1 = s.match(new RegExp(`${nameLike.source}\\s+is\\s+(?:the\\s+)?([^,;]+)`, "i"));
    if (m1?.[1]) {
      const name = String(m1[1]).trim();
      const tail = String(m1[2] || "").trim();
      const title = tail && role.test(tail) ? tail.split(/\b(?:and|but)\b/i)[0].trim() : "";
      if (name && title) candidates.push({ name, title });
    }
    // Name, Title
    const m2 = s.match(new RegExp(`${nameLike.source}\\s*,\\s*([^,;]+)`, "i"));
    if (m2?.[1] && m2?.[2] && role.test(m2[2])) candidates.push({ name: String(m2[1]).trim(), title: String(m2[2]).trim() });
    // Title Name
    const m3 = s.match(new RegExp(`\\b(${role.source})\\b\\s+${nameLike.source}`, "i"));
    if (m3?.[1] && m3?.[2]) candidates.push({ title: String(m3[1]).trim(), name: String(m3[2]).trim() });
  }

  const key = (c: { name: string; title: string }) => `${c.name.toLowerCase()}|${c.title.toLowerCase()}`;
  const uniq = new Map<string, { name: string; title: string }>();
  for (const c of candidates) uniq.set(key(c), c);
  const out = Array.from(uniq.values());
  if (out.length === 1) return { ...out[0], reason: "single_candidate" };
  return { reason: out.length ? "ambiguous_multiple_candidates" : "no_candidates" };
}

export async function applyCommentIngestionToOpportunity(args: {
  orgId: number;
  opportunityId: number;
  extracted: CommentIngestionExtracted;
  commentIngestionId: number;
  scoreEventSource?: "baseline" | "agent";
  salesStage?: string | null;
  /** When true (e.g. manual paste), apply even if baseline_health_score_ts is set (scores + entity fields). */
  allowWhenBaselineExists?: boolean;
  /** Raw notes (manual paste / CRM notes). Used only for conservative fallback entity capture. */
  rawNotes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { orgId, opportunityId, extracted, commentIngestionId, scoreEventSource = "baseline", salesStage, allowWhenBaselineExists, rawNotes } = args;

  try {
    const { rows: oppRows } = await pool.query(
      `SELECT baseline_health_score_ts, forecast_stage, sales_stage FROM opportunities WHERE org_id = $1 AND id = $2 LIMIT 1`,
      [orgId, opportunityId]
    );
    const opp = oppRows?.[0];
    if (opp?.baseline_health_score_ts != null && !allowWhenBaselineExists) return { ok: true };
    if (isClosedOpportunityRow(opp)) {
      return { ok: true };
    }

    const defs = await listScoreDefinitions().catch(() => []);
    const categoryArgs = buildCategoryArgs(extracted, defs);
    const riskSummary = buildRiskSummary(extracted);
    const nextSteps = buildNextSteps(extracted);

    // People fields: ingestion can mis-route EB vs champion when the person is clearly a budget owner.
    // We keep this conservative: only remap when Economic Buyer category exists AND the title/evidence indicates EB.
    let championName = String(extracted.champion_name ?? "").trim();
    let championTitle = String(extracted.champion_title ?? "").trim();
    let ebName = String(extracted.eb_name ?? "").trim();
    let ebTitle = String(extracted.eb_title ?? "").trim();

    const ebCat: any = (extracted as any)?.meddpicc?.economic_buyer;
    const hasEbCategorySignal =
      !!ebCat &&
      ((typeof ebCat.signal === "string" && ebCat.signal.toLowerCase() !== "missing") ||
        (Number.isFinite(ebCat.score) && Number(ebCat.score) > 0));
    const looksLikeEconomicBuyerTitle = /\b(ceo|cfo|coo|cto|cio|chief|president|owner)\b/i.test(championTitle);
    const ebEvidenceText = [
      String(ebCat?.evidence_text ?? "").trim(),
      Array.isArray(ebCat?.evidence) ? ebCat.evidence.join(" ") : "",
    ]
      .join(" ")
      .toLowerCase();
    const evidenceMentionsBudget = /\bbudget\b|\bowns?\s+budgets?\b|\bapprov(e|al)\b/.test(ebEvidenceText);

    if (!ebName && championName && hasEbCategorySignal && (looksLikeEconomicBuyerTitle || evidenceMentionsBudget)) {
      ebName = championName;
      if (!ebTitle && championTitle) ebTitle = championTitle;
      championName = "";
      championTitle = "";
    }

    // Conservative fallback: if extraction signaled EB/Champion but left name/title empty, try to parse ONE unambiguous
    // Name+Title from the raw notes. If multiple candidates exist, leave blank.
    const champCat: any = (extracted as any)?.meddpicc?.champion;
    const hasChampSignal =
      !!champCat &&
      ((typeof champCat.signal === "string" && champCat.signal.toLowerCase() !== "missing") ||
        (Number.isFinite(champCat.score) && Number(champCat.score) > 0));
    if (rawNotes && !ebName && hasEbCategorySignal) {
      const c = extractSinglePersonAndTitleFromNotes(rawNotes);
      if (c?.name && c?.title) {
        ebName = c.name;
        if (!ebTitle) ebTitle = c.title;
      }
    }
    if (rawNotes && !championName && hasChampSignal) {
      const c = extractSinglePersonAndTitleFromNotes(rawNotes);
      if (c?.name && c?.title) {
        championName = c.name;
        if (!championTitle) championTitle = c.title;
      }
    }

    const toolArgs: Record<string, unknown> = {
      org_id: orgId,
      opportunity_id: opportunityId,
      score_source: "ai_notes",
      score_event_source: scoreEventSource,
      comment_ingestion_id: commentIngestionId,
      extraction_confidence: extracted.extraction_confidence || null,
      ...categoryArgs,
    };
    if (salesStage != null) toolArgs.sales_stage_for_closed = salesStage;
    if (riskSummary) toolArgs.risk_summary = riskSummary;
    if (nextSteps) toolArgs.next_steps = nextSteps;
    if (championName) toolArgs.champion_name = championName;
    if (championTitle) toolArgs.champion_title = championTitle;
    if (ebName) toolArgs.eb_name = ebName;
    if (ebTitle) toolArgs.eb_title = ebTitle;

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
