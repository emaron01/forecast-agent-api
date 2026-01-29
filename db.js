// db.js (ES module)
// Vault: safe persistence w/ field-level fallback (avoid overwriting with undefined/null/empty)

import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function pickNumber(newVal, oldVal) {
  return newVal ?? oldVal ?? null;
}

function pickString(newVal, oldVal) {
  // Treat undefined/null/"" as "no update"
  if (newVal === undefined || newVal === null || newVal === "") return oldVal ?? null;
  return newVal;
}

export async function saveDealData(deal, args) {
  try {
    const runCount = (deal.run_count || 0) + 1;
    const updatedAt = new Date();

    const merged = {
      // Scores
      pain_score: pickNumber(args.pain_score, deal.pain_score),
      metrics_score: pickNumber(args.metrics_score, deal.metrics_score),
      champion_score: pickNumber(args.champion_score, deal.champion_score),
      eb_score: pickNumber(args.eb_score, deal.eb_score),
      criteria_score: pickNumber(args.criteria_score, deal.criteria_score),
      process_score: pickNumber(args.process_score, deal.process_score),
      competition_score: pickNumber(args.competition_score, deal.competition_score),
      paper_score: pickNumber(args.paper_score, deal.paper_score),
      timing_score: pickNumber(args.timing_score, deal.timing_score),

      // Summaries + tips
      pain_summary: pickString(args.pain_summary, deal.pain_summary),
      pain_tip: pickString(args.pain_tip, deal.pain_tip),

      metrics_summary: pickString(args.metrics_summary, deal.metrics_summary),
      metrics_tip: pickString(args.metrics_tip, deal.metrics_tip),

      champion_summary: pickString(args.champion_summary, deal.champion_summary),
      champion_tip: pickString(args.champion_tip, deal.champion_tip),
      champion_name: pickString(args.champion_name, deal.champion_name),
      champion_title: pickString(args.champion_title, deal.champion_title),

      eb_summary: pickString(args.eb_summary, deal.eb_summary),
      eb_tip: pickString(args.eb_tip, deal.eb_tip),
      eb_name: pickString(args.eb_name, deal.eb_name),
      eb_title: pickString(args.eb_title, deal.eb_title),

      criteria_summary: pickString(args.criteria_summary, deal.criteria_summary),
      criteria_tip: pickString(args.criteria_tip, deal.criteria_tip),

      process_summary: pickString(args.process_summary, deal.process_summary),
      process_tip: pickString(args.process_tip, deal.process_tip),

      competition_summary: pickString(args.competition_summary, deal.competition_summary),
      competition_tip: pickString(args.competition_tip, deal.competition_tip),

      paper_summary: pickString(args.paper_summary, deal.paper_summary),
      paper_tip: pickString(args.paper_tip, deal.paper_tip),

      timing_summary: pickString(args.timing_summary, deal.timing_summary),
      timing_tip: pickString(args.timing_tip, deal.timing_tip),

      // Rollups / misc
      risk_summary: pickString(args.risk_summary, deal.risk_summary),
      next_steps: pickString(args.next_steps, deal.next_steps),
      rep_comments: pickString(args.rep_comments, deal.rep_comments),

      ai_forecast: pickString(args.ai_forecast, deal.ai_forecast),

      run_count: runCount,
      updated_at: updatedAt,
    };

    const q = `
      UPDATE opportunities
      SET
        pain_score = $1, pain_summary = $2, pain_tip = $3,
        metrics_score = $4, metrics_summary = $5, metrics_tip = $6,
        champion_score = $7, champion_summary = $8, champion_tip = $9, champion_name = $10, champion_title = $11,
        eb_score = $12, eb_summary = $13, eb_tip = $14, eb_name = $15, eb_title = $16,
        criteria_score = $17, criteria_summary = $18, criteria_tip = $19,
        process_score = $20, process_summary = $21, process_tip = $22,
        competition_score = $23, competition_summary = $24, competition_tip = $25,
        paper_score = $26, paper_summary = $27, paper_tip = $28,
        timing_score = $29, timing_summary = $30, timing_tip = $31,
        risk_summary = $32, next_steps = $33, rep_comments = $34,
        ai_forecast = $35, run_count = $36, updated_at = $37
      WHERE id = $38
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
    ];

    const result = await pool.query(q, values);
    return result.rows[0];
  } catch (err) {
    console.error("❌ saveDealData failed:", err);
    throw err;
  }
}
