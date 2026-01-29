/// db.js (ES module)
/// DB writer: merges args with existing deal, protects against empty overwrites,
/// and appends audit_details.audit_log when audit_log_entry is provided.

import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/// ------------------------------
/// SECTION: Helpers
/// ------------------------------
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function pickString(next, prev) {
  if (typeof next !== "string") return prev;
  const t = next.trim();
  if (t.length === 0) return prev;
  return t;
}

function pickNumber(next, prev) {
  const n = Number(next);
  if (!Number.isFinite(n)) return prev;
  return n;
}

/// Optional extra safety; muscle.js already clamps.
/// If a model somehow bypasses tool schema, we still keep 0–3.
function clampInt0to3(next, prev) {
  const n = Number(next);
  if (!Number.isFinite(n)) return prev;
  if (n < 0) return 0;
  if (n > 3) return 3;
  return Math.round(n);
}

/// ------------------------------
/// SECTION: saveDealData
/// ------------------------------
export async function saveDealData(deal, args) {
  try {
    const runCount = (deal.run_count || 0) + 1;
    const updatedAt = new Date();

    // Merge only provided keys; prevent "deletes" (empty strings) by using pickString.
    const merged = {
      pain_score: hasOwn(args, "pain_score") ? clampInt0to3(args.pain_score, deal.pain_score) : deal.pain_score,
      pain_summary: hasOwn(args, "pain_summary") ? pickString(args.pain_summary, deal.pain_summary) : deal.pain_summary,
      pain_tip: hasOwn(args, "pain_tip") ? pickString(args.pain_tip, deal.pain_tip) : deal.pain_tip,

      metrics_score: hasOwn(args, "metrics_score") ? clampInt0to3(args.metrics_score, deal.metrics_score) : deal.metrics_score,
      metrics_summary: hasOwn(args, "metrics_summary") ? pickString(args.metrics_summary, deal.metrics_summary) : deal.metrics_summary,
      metrics_tip: hasOwn(args, "metrics_tip") ? pickString(args.metrics_tip, deal.metrics_tip) : deal.metrics_tip,

      champion_score: hasOwn(args, "champion_score") ? clampInt0to3(args.champion_score, deal.champion_score) : deal.champion_score,
      champion_summary: hasOwn(args, "champion_summary") ? pickString(args.champion_summary, deal.champion_summary) : deal.champion_summary,
      champion_tip: hasOwn(args, "champion_tip") ? pickString(args.champion_tip, deal.champion_tip) : deal.champion_tip,
      champion_name: hasOwn(args, "champion_name") ? pickString(args.champion_name, deal.champion_name) : deal.champion_name,
      champion_title: hasOwn(args, "champion_title") ? pickString(args.champion_title, deal.champion_title) : deal.champion_title,

      eb_score: hasOwn(args, "eb_score") ? clampInt0to3(args.eb_score, deal.eb_score) : deal.eb_score,
      eb_summary: hasOwn(args, "eb_summary") ? pickString(args.eb_summary, deal.eb_summary) : deal.eb_summary,
      eb_tip: hasOwn(args, "eb_tip") ? pickString(args.eb_tip, deal.eb_tip) : deal.eb_tip,
      eb_name: hasOwn(args, "eb_name") ? pickString(args.eb_name, deal.eb_name) : deal.eb_name,
      eb_title: hasOwn(args, "eb_title") ? pickString(args.eb_title, deal.eb_title) : deal.eb_title,

      criteria_score: hasOwn(args, "criteria_score") ? clampInt0to3(args.criteria_score, deal.criteria_score) : deal.criteria_score,
      criteria_summary: hasOwn(args, "criteria_summary") ? pickString(args.criteria_summary, deal.criteria_summary) : deal.criteria_summary,
      criteria_tip: hasOwn(args, "criteria_tip") ? pickString(args.criteria_tip, deal.criteria_tip) : deal.criteria_tip,

      process_score: hasOwn(args, "process_score") ? clampInt0to3(args.process_score, deal.process_score) : deal.process_score,
      process_summary: hasOwn(args, "process_summary") ? pickString(args.process_summary, deal.process_summary) : deal.process_summary,
      process_tip: hasOwn(args, "process_tip") ? pickString(args.process_tip, deal.process_tip) : deal.process_tip,

      competition_score: hasOwn(args, "competition_score") ? clampInt0to3(args.competition_score, deal.competition_score) : deal.competition_score,
      competition_summary: hasOwn(args, "competition_summary") ? pickString(args.competition_summary, deal.competition_summary) : deal.competition_summary,
      competition_tip: hasOwn(args, "competition_tip") ? pickString(args.competition_tip, deal.competition_tip) : deal.competition_tip,

      paper_score: hasOwn(args, "paper_score") ? clampInt0to3(args.paper_score, deal.paper_score) : deal.paper_score,
      paper_summary: hasOwn(args, "paper_summary") ? pickString(args.paper_summary, deal.paper_summary) : deal.paper_summary,
      paper_tip: hasOwn(args, "paper_tip") ? pickString(args.paper_tip, deal.paper_tip) : deal.paper_tip,

      timing_score: hasOwn(args, "timing_score") ? clampInt0to3(args.timing_score, deal.timing_score) : deal.timing_score,
      timing_summary: hasOwn(args, "timing_summary") ? pickString(args.timing_summary, deal.timing_summary) : deal.timing_summary,
      timing_tip: hasOwn(args, "timing_tip") ? pickString(args.timing_tip, deal.timing_tip) : deal.timing_tip,

      // Deterministic from muscle.js
      risk_summary: hasOwn(args, "risk_summary") ? pickString(args.risk_summary, deal.risk_summary) : deal.risk_summary,

      next_steps: hasOwn(args, "next_steps") ? pickString(args.next_steps, deal.next_steps) : deal.next_steps,
      rep_comments: hasOwn(args, "rep_comments") ? pickString(args.rep_comments, deal.rep_comments) : deal.rep_comments,

      ai_forecast: hasOwn(args, "ai_forecast") ? pickString(args.ai_forecast, deal.ai_forecast) : deal.ai_forecast,

      run_count: runCount,
      updated_at: updatedAt,
    };

    // Optional audit log entry
    const auditEntry = args?.audit_log_entry ?? null;

    // If you DO have audit_details (jsonb), this appends safely.
    // If you DON'T have the column, Postgres will error — so only enable this query
    // if the column exists. (Given your note, you do.)
    const q = `
      UPDATE opportunities
      SET
        pain_score=$1, pain_summary=$2, pain_tip=$3,
        metrics_score=$4, metrics_summary=$5, metrics_tip=$6,
        champion_score=$7, champion_summary=$8, champion_tip=$9, champion_name=$10, champion_title=$11,
        eb_score=$12, eb_summary=$13, eb_tip=$14, eb_name=$15, eb_title=$16,
        criteria_score=$17, criteria_summary=$18, criteria_tip=$19,
        process_score=$20, process_summary=$21, process_tip=$22,
        competition_score=$23, competition_summary=$24, competition_tip=$25,
        paper_score=$26, paper_summary=$27, paper_tip=$28,
        timing_score=$29, timing_summary=$30, timing_tip=$31,
        risk_summary=$32, next_steps=$33, rep_comments=$34,
        ai_forecast=$35, run_count=$36, updated_at=$37,
        audit_details = CASE
          WHEN $39::jsonb IS NULL THEN audit_details
          ELSE jsonb_set(
            COALESCE(audit_details, '{}'::jsonb),
            '{audit_log}',
            COALESCE(audit_details->'audit_log', '[]'::jsonb) || jsonb_build_array($39::jsonb),
            true
          )
        END
      WHERE id=$38
      RETURNING *;
    `;

    const values = [
      merged.pain_score, merged.pain_summary, merged.pain_tip,
      merged.metrics_score, merged.metrics_summary, merged.metrics_tip,
      merged.champion_score, merged.champion_summary, merged.champion_tip, merged.champion_name, merged.champion_title,
      merged.eb_score, merged.eb_summary, merged.eb_tip, merged.eb_name, merged.eb_title,
      merged.criteria_score, merged.criteria_summary, merged.criteria_tip,
      merged.process_score, merged.process_summary, merged.process_tip,
      merged.competition_score, merged.competition_summary, merged.competition_tip,
      merged.paper_score, merged.paper_summary, merged.paper_tip,
      merged.timing_score, merged.timing_summary, merged.timing_tip,
      merged.risk_summary, merged.next_steps, merged.rep_comments,
      merged.ai_forecast, merged.run_count, merged.updated_at,
      deal.id,
      auditEntry ? JSON.stringify(auditEntry) : null,
    ];

    const result = await pool.query(q, values);
    return result.rows[0];
  } catch (err) {
    console.error("❌ saveDealData failed:", err);
    throw err;
  }
}
