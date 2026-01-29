// db.js (ES module)
// Vault: the ONLY place that writes to PostgreSQL.
// Safe partial updates: preserves existing values when args omit a field.

import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Helpers
function isNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}
function clampScore(x) {
  if (!isNumber(x)) return null;
  if (x < 0) return 0;
  if (x > 3) return 3;
  return x;
}
function pickScore(argsVal, dealVal) {
  // Only update if argsVal is a number; otherwise preserve DB value
  const c = clampScore(argsVal);
  return c === null ? (dealVal ?? 0) : c;
}
function pickString(argsVal, dealVal) {
  // Only update if argsVal is a non-empty string; otherwise preserve DB value
  if (typeof argsVal === "string") {
    const s = argsVal.trim();
    if (s.length > 0) return s;
  }
  return dealVal ?? null;
}

export async function saveDealData(deal, args) {
  const runCount = Number(deal.run_count || 0) + 1;
  const updatedAt = new Date();

  // Build safe, non-destructive updates
  const values = [
    pickScore(args.pain_score, deal.pain_score),
    pickString(args.pain_summary, deal.pain_summary),
    pickString(args.pain_tip, deal.pain_tip),

    pickScore(args.metrics_score, deal.metrics_score),
    pickString(args.metrics_summary, deal.metrics_summary),
    pickString(args.metrics_tip, deal.metrics_tip),

    pickScore(args.champion_score, deal.champion_score),
    pickString(args.champion_summary, deal.champion_summary),
    pickString(args.champion_tip, deal.champion_tip),
    pickString(args.champion_name, deal.champion_name),
    pickString(args.champion_title, deal.champion_title),

    pickScore(args.eb_score, deal.eb_score),
    pickString(args.eb_summary, deal.eb_summary),
    pickString(args.eb_tip, deal.eb_tip),
    pickString(args.eb_name, deal.eb_name),
    pickString(args.eb_title, deal.eb_title),

    pickScore(args.criteria_score, deal.criteria_score),
    pickString(args.criteria_summary, deal.criteria_summary),
    pickString(args.criteria_tip, deal.criteria_tip),

    pickScore(args.process_score, deal.process_score),
    pickString(args.process_summary, deal.process_summary),
    pickString(args.process_tip, deal.process_tip),

    pickScore(args.competition_score, deal.competition_score),
    pickString(args.competition_summary, deal.competition_summary),
    pickString(args.competition_tip, deal.competition_tip),

    pickScore(args.paper_score, deal.paper_score),
    pickString(args.paper_summary, deal.paper_summary),
    pickString(args.paper_tip, deal.paper_tip),

    pickScore(args.timing_score, deal.timing_score),
    pickString(args.timing_summary, deal.timing_summary),
    pickString(args.timing_tip, deal.timing_tip),

    pickString(args.risk_summary, deal.risk_summary),
    pickString(args.next_steps, deal.next_steps),
    pickString(args.rep_comments, deal.rep_comments),

    pickString(args.ai_forecast, deal.ai_forecast),
    runCount,
    updatedAt,

    deal.id,
  ];

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
      ai_forecast=$35,
      run_count=$36,
      updated_at=$37
    WHERE id=$38
    RETURNING *;
  `;

  const result = await pool.query(q, values);
  return result.rows[0];
}
