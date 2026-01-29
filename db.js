// db.js (ES module)
import pkg from "pg";
const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("⚠️ DATABASE_URL must be set!");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const ALLOWED = new Set([
  "pain_score","pain_summary","pain_tip",
  "metrics_score","metrics_summary","metrics_tip",
  "champion_score","champion_summary","champion_tip","champion_name","champion_title",
  "eb_score","eb_summary","eb_tip","eb_name","eb_title",
  "criteria_score","criteria_summary","criteria_tip",
  "process_score","process_summary","process_tip",
  "competition_score","competition_summary","competition_tip",
  "paper_score","paper_summary","paper_tip",
  "timing_score","timing_summary","timing_tip",
  "risk_summary",
  "next_steps",
  "rep_comments",
  "ai_forecast",
  // If your table has it and you want it:
  // "audit_details",
]);

function isBlankString(v) {
  return typeof v === "string" && v.trim().length === 0;
}

export async function saveDealData(deal, args) {
  try {
    if (!deal?.id) throw new Error("saveDealData: missing deal.id");

    const set = [];
    const values = [];
    let i = 1;

    for (const [k, v] of Object.entries(args || {})) {
      if (!ALLOWED.has(k)) continue;
      if (v === undefined || v === null) continue;
      if (isBlankString(v)) continue;

      set.push(`${k} = $${i}`);
      values.push(typeof v === "string" ? v.trim() : v);
      i++;
    }

    // Always touch these (atomic, stable, no reliance on in-memory deal)
    set.push(`run_count = COALESCE(run_count, 0) + 1`);
    set.push(`updated_at = NOW()`);

    const sql = `
      UPDATE opportunities
      SET ${set.join(", ")}
      WHERE id = $${i}
      RETURNING *;
    `;
    values.push(deal.id);

    const result = await pool.query(sql, values);
    return result.rows[0];
  } catch (err) {
    console.error("❌ saveDealData failed:", err);
    throw err;
  }
}
