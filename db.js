// db.js (ES module)
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function pick(deal, args, key) {
  const v = args?.[key];
  if (v === undefined) return deal?.[key];
  if (typeof v === "string" && v.trim() === "") return deal?.[key];
  return v;
}

export async function saveDealData(deal, args) {
  try {
    const run_count = (deal.run_count || 0) + 1;
    const updated_at = new Date();

    const merged = {
      pain_score: pick(deal, args, "pain_score"),
      pain_summary: pick(deal, args, "pain_summary"),
      pain_tip: pick(deal, args, "pain_tip"),

      metrics_score: pick(deal, args, "metrics_score"),
      metrics_summary: pick(deal, args, "metrics_summary"),
      metrics_tip: pick(deal, args, "metrics_tip"),

      champion_score: pick(deal, args, "champion_score"),
      champion_summary: pick(deal, args, "champion_summary"),
      champion_tip: pick(deal, args, "champion_tip"),
      champion_name: pick(deal, args, "champion_name"),
      champion_title: pick(deal, args, "champion_title"),

      eb_score: pick(deal, args, "eb_score"),
      eb_summary: pick(deal, args, "eb_summary"),
      eb_tip: pick(deal, args, "eb_tip"),
      eb_name: pick(deal, args, "eb_name"),
      eb_title: pick(deal, args, "eb_title"),

      criteria_score: pick(deal, args, "criteria_score"),
      criteria_summary: pick(deal, args, "criteria_summary"),
      criteria_tip: pick(deal, args, "criteria_tip"),

      process_score: pick(deal, args, "process_score"),
      process_summary: pick(deal, args, "process_summary"),
      process_tip: pick(deal, args, "process_tip"),

      competition_score: pick(deal, args, "competition_score"),
      competition_summary: pick(deal, args, "competition_summary"),
      competition_tip: pick(deal, args, "competition_tip"),

      paper_score: pick(deal, args, "paper_score"),
      paper_summary: pick(deal, args, "paper_summary"),
      paper_tip: pick(deal, args, "paper_tip"),

      timing_score: pick(deal, args, "timing_score"),
      timing_summary: pick(deal, args, "timing_summary"),
      timing_tip: pick(deal, args, "timing_tip"),

      risk_summary: pick(deal, args, "risk_summary"),
      next_steps: pick(deal, args, "next_steps"),
      rep_comments: pick(deal, args, "rep_comments"),

      ai_forecast: pick(deal, args, "ai_forecast"),
    };

    const updateQuery = `
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
        ai_forecast = $35,
        run_count = $36,
        updated_at = $37
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
      merged.ai_forecast,
      run_count,
      updated_at,
      deal.id,
    ];

    const result = await pool.query(updateQuery, values);
    return result.rows[0];
  } catch (err) {
    console.error("❌ saveDealData failed:", err);
    throw err;
  }
}
