require("dotenv").config();
const { Pool } = require("pg");

// Connect to DB using your .env file
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function resetDeal() {
  console.log("🧨 Targeting Deal ID 1 (Cyberdyne Systems)...");

  try {
    const res = await pool.query(`
      UPDATE opportunities 
      SET 
        pain_score=0, metrics_score=0, champion_score=0, eb_score=0, 
        criteria_score=0, process_score=0, competition_score=0, paper_score=0, timing_score=0,
        risk_summary='', rep_comments='', manager_comments='', 
        champion_name='', eb_name='', champion_title='', eb_title='', 
        ai_forecast=NULL,
        run_count=0
      WHERE id = 1
    `);
    
    console.log(`✅ Success! Cyberdyne has been wiped. (${res.rowCount} row affected)`);
  } catch (err) {
    console.error("❌ Database Error:", err.message);
  } finally {
    pool.end(); // Close connection so script exits
  }
}

resetDeal();