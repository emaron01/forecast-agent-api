const { Pool } = require("pg");

// Use DATABASE_URL from environment for production
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false },
});

/**
 * Save deal data to the database.
 * @param {object} deal - The existing deal row from the DB.
 * @param {object} args - Scores, summaries, tips, ai_forecast, etc.
 */
async function saveDealData(deal, args) {
  try {
    const updatedFields = {
      ...args,
      run_count: (deal.run_count || 0) + 1,
      updated_at: new Date(),
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
        ai_forecast = $35, run_count = $36, updated_at = $37
      WHERE id = $38
      RETURNING *;
    `;

    const values = [
      updatedFields.pain_score, updatedFields.pain_summary, updatedFields.pain_tip,
      updatedFields.metrics_score, updatedFields.metrics_summary, updatedFields.metrics_tip,
      updatedFields.champion_score, updatedFields.champion_summary, updatedFields.champion_tip, updatedFields.champion_name, updatedFields.champion_title,
      updatedFields.eb_score, updatedFields.eb_summary, updatedFields.eb_tip, updatedFields.eb_name, updatedFields.eb_title,
      updatedFields.criteria_score, updatedFields.criteria_summary, updatedFields.criteria_tip,
      updatedFields.process_score, updatedFields.process_summary, updatedFields.process_tip,
      updatedFields.competition_score, updatedFields.competition_summary, updatedFields.competition_tip,
      updatedFields.paper_score, updatedFields.paper_summary, updatedFields.paper_tip,
      updatedFields.timing_score, updatedFields.timing_summary, updatedFields.timing_tip,
      updatedFields.risk_summary, updatedFields.next_steps, updatedFields.rep_comments,
      updatedFields.ai_forecast, updatedFields.run_count, updatedFields.updated_at,
      deal.id
    ];

    const result = await pool.query(updateQuery, values);
    return result.rows[0];

  } catch (err) {
    console.error("❌ saveDealData failed:", err);
    throw err;
  }
}

module.exports = { saveDealData };
