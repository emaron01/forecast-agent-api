const { Pool } = require('pg');

// Your Render External Connection String
const connectionString = "postgresql://admin:Ar0gIJxTWVHIaNkKGnAvK1aq2WWCfrZY@dpg-d5n36bdactks73c7kmh0-a.oregon-postgres.render.com/verdict_storage";

const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false } // Required for Render connections
});

async function runSkepticTest() {
  console.log("--- 🕵️ Connecting to The Verdict Database ---");
  try {
    // 1. Fetch the "Stale" deal we created (Stark Industries)
    const res = await pool.query('SELECT * FROM opportunities WHERE id = $1', [4]);
    const deal = res.rows[0];

    if (!deal) {
      console.log("❌ Error: Could not find Stark Industries (ID 4).");
      return;
    }

    // 2. Logic Engine: Calculate True Aging
    const createdDate = new Date(deal.opp_created_date);
    const ageInDays = Math.floor((new Date() - createdDate) / (1000 * 60 * 60 * 24));

    console.log(`✅ Connection Success! Analyzing: ${deal.account_name}`);
    console.log(`-----------------------------------------------`);
    console.log(`Run History: ${deal.run_count} previous audits`);
    console.log(`True Aging:  ${ageInDays} days since creation`);
    
    // 3. The "Switchboard": Deciding the AI's Persona
    if (deal.run_count > 0 && ageInDays > 180) {
      console.log(`\n🤖 SYSTEM INSTRUCTION GENERATED:`);
      console.log(`"You are an AGGRESSIVE AUDITOR. This deal is ${ageInDays} days old (STALE).`);
      console.log(`Ignore the fluff. ATTACK the gaps: Champion is only a ${deal.c_champions}`);
      console.log(`and Paper Process is a ${deal.p_paper_process}. Demand proof of life."`);
    }

  } catch (err) {
    console.error("❌ Database Connection Error:", err.message);
  } finally {
    await pool.end();
  }
}

runSkepticTest();