import { getOpportunityById, updateOpportunity, insertAuditEvent } from "./db.js";

function cleanText(s) {
  if (!s) return null;
  const t = String(s).trim();
  return t.length ? t : null;
}

function toIntOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function safeArray(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  return [v];
}

function buildDelta(updates) {
  // Keep audit deltas lean: only write keys that are actually changing on this save
  const delta = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) continue;
    if (k.startsWith("_")) continue; // internal/meta
    delta[k] = v;
  }
  return delta;
}

function computeTotalsFromDeal(deal) {
  // Conservative: sum known score fields if present. If not, treat as 0.
  // Update these keys if you add categories.
  const scoreKeys = [
    "pain_score",
    "metrics_score",
    "champion_score",
    "competition_score",
    "criteria_score",
    "timing_score",
    "budget_score",
    "eb_score",
    "process_score",
    "paper_score",
  ];

  let total = 0;
  let max = 0;

  for (const key of scoreKeys) {
    if (deal[key] === null || deal[key] === undefined) continue;
    const n = Number(deal[key]);
    if (Number.isFinite(n)) total += n;
  }

  // If you have a max-score model per stage, set max accordingly.
  // Placeholder default; can be overwritten upstream.
  max = 27;

  return { totalScore: total, maxScore: max };
}

export async function saveDealData(deal, updates) {
  const orgId = deal.org_id;
  const oppId = deal.id;

  const updated = await updateOpportunity(orgId, oppId, updates);
  return updated;
}

export async function handleSaveDealToolCall({
  orgId,
  opportunityId,
  callId,
  runId,
  args,
  definitions,
  meta,
}) {
  try {
    const deal = await getOpportunityById(orgId, opportunityId);
    if (!deal) throw new Error(`Opportunity not found: orgId=${orgId} id=${opportunityId}`);

    const currentAccount = deal.account_name || deal.account || `opp_${deal.id}`;

    // Build updates from tool args (only keys provided)
    const updates = {};

    // Common score fields
    for (const [k, v] of Object.entries(args || {})) {
      if (k.endsWith("_score")) updates[k] = toIntOrNull(v);
      else if (k.endsWith("_summary")) updates[k] = cleanText(v);
      else if (k.endsWith("_tip")) updates[k] = cleanText(v);
      else if (k.endsWith("_name")) updates[k] = cleanText(v);
      else if (k.endsWith("_title")) updates[k] = cleanText(v);
      else updates[k] = v; // allow additional fields if tool evolves
    }

    // Risk fields (optional)
    if (args?.risk_summary !== undefined) updates.risk_summary = cleanText(args.risk_summary);
    if (args?.risk_flags !== undefined) updates.risk_flags = safeArray(args.risk_flags);

    // Increment run_count if present in schema
    if (deal.run_count !== undefined && deal.run_count !== null) {
      updates.run_count = Number(deal.run_count) + 1;
    }

    // Update totals
    const nextDealForTotals = { ...deal, ...updates };
    const { totalScore, maxScore } = computeTotalsFromDeal(nextDealForTotals);

    updates.total_score = totalScore;
    updates.max_score = maxScore;

    // Keep a compact audit snapshot
    const scoreSnapshot = {};
    const summarySnapshot = {};
    for (const [k, v] of Object.entries(updates)) {
      if (k.endsWith("_score")) scoreSnapshot[k] = v;
      if (k.endsWith("_summary")) summarySnapshot[k] = v;
    }

    // Insert audit event (delta-focused)
    const delta = buildDelta(updates);

    await insertAuditEvent({
      org_id: orgId,
      opportunity_id: opportunityId,
      run_id: runId,
      call_id: callId || null,
      actor_type: "agent",
      event_type: "score_save",
      schema_version: 1,
      prompt_version: meta?.prompt_version || "v1",
      logic_version: meta?.logic_version || "v1",
      forecast_stage: deal.stage || deal.forecast_stage || null,
      ai_forecast: updates.ai_forecast || deal.ai_forecast || null,
      total_score: totalScore,
      max_score: maxScore,
      risk_summary: updates.risk_summary || deal.risk_summary || null,
      risk_flags: updates.risk_flags || deal.risk_flags || null,
      delta,
      definitions: definitions || null,
      meta: {
        ...meta,
        account: currentAccount,
        changed_keys: Object.keys(updates).filter((k) => updates[k] !== undefined && !k.startsWith("_")),
        scores: scoreSnapshot,
        summaries: summarySnapshot,
      },
    });

    const updatedDeal = await saveDealData(deal, updates);

    console.log(
      `✅ Saved deal id=${updatedDeal.id} account="${currentAccount}" ai_forecast=${updatedDeal.ai_forecast} run_count=${updatedDeal.run_count}`
    );

    return updatedDeal;
  } catch (err) {
    console.error("❌ save_deal_data failed:", err?.message || err);
    throw err;
  }
}
