// db.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: "postgresql://admin:Ar0gIJxTWVHIaNkKGnAvK1aq2WWCfrZY@dpg-d5n36bdactks73c7kmh0-a/verdict_storage",
});

// ... rest of your saveDealData function unchanged
/**
 * Save deal data, safely handling missing fields.
 * @param {Object} deal - The deal object (from local memory)
 * @param {Object} args - Partial updates (scores, tips, summaries, etc.)
 */
async function saveDealData(deal, args) {
  const categories = [
    "pain", "metrics", "champion", "eb", 
    "criteria", "process", "competition", "paper", "timing"
  ];

  // Build SQL SET clause dynamically for fields present in args
  const setClauses = [];
  const sqlParams = [];
  let paramIndex = 1;

  // --- Save scores, tips, summaries ---
  categories.forEach(cat => {
    const scoreKey = `${cat}_score`;
    const tipKey = `${cat}_tip`;
    const summaryKey = `${cat}_summary`;

    if (args.hasOwnProperty(scoreKey)) {
      setClauses.push(`${scoreKey}=$${paramIndex++}`);
      sqlParams.push(args[scoreKey]);
    } else {
      sqlParams.push(deal[scoreKey] ?? null);
    }

    if (args.hasOwnProperty(tipKey)) {
      setClauses.push(`${tipKey}=$${paramIndex++}`);
      sqlParams.push(args[tipKey] ?? null);
    } else {
      sqlParams.push(deal[tipKey] ?? null);
    }

    if (args.hasOwnProperty(summaryKey)) {
      setClauses.push(`${summaryKey}=$${paramIndex++}`);
      sqlParams.push(args[summaryKey] ?? null);
    } else {
      sqlParams.push(deal[summaryKey] ?? null);
    }
  });

  // --- Other fields ---
  const otherFields = [
    "risk_summary", "next_steps", "champion_name", "champion_title",
    "eb_name", "eb_title", "rep_comments", "manager_comments", "aiOpinion"
  ];
  otherFields.forEach(field => {
    if (args.hasOwnProperty(field)) {
      setClauses.push(`${field}=$${paramIndex++}`);
      sqlParams.push(args[field] ?? null);
    } else {
      sqlParams.push(deal[field] ?? null);
    }
  });

  // --- Run count & timestamp ---
  setClauses.push(`run_count = COALESCE(run_count, 0) + 1`);
  setClauses.push(`updated_at = NOW()`);

  const sqlQuery = `
    UPDATE opportunities
    SET ${setClauses.join(", ")}
    WHERE id = $${paramIndex}
  `;
  sqlParams.push(deal.id);

  try {
    await pool.query(sqlQuery, sqlParams);
    console.log(`✅ Saved deal: ${deal.account_name}`);
  } catch (err) {
    console.error("❌ saveDealData failed:", err);
    throw err;
  }
}

module.exports = { saveDealData };
