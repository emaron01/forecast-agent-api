#!/usr/bin/env node
/**
 * RISK 2: Backfill predictive_eligible for existing opportunities.
 * Idempotent. Run: node scripts/backfill-predictive-eligible.mjs
 * Requires: DATABASE_URL
 */
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    const closed = await client.query(`
      UPDATE opportunities
         SET predictive_eligible = false
       WHERE org_id IS NOT NULL
         AND (
           COALESCE(forecast_stage ~* '\\y(won|lost|closed)\\y', false)
           OR COALESCE(sales_stage ~* '\\y(won|lost|closed)\\y', false)
         )
         AND (predictive_eligible IS NULL OR predictive_eligible != false)
    `);
    const open = await client.query(`
      UPDATE opportunities
         SET predictive_eligible = true
       WHERE org_id IS NOT NULL
         AND NOT COALESCE(forecast_stage ~* '\\y(won|lost|closed)\\y', false)
         AND NOT COALESCE(sales_stage ~* '\\y(won|lost|closed)\\y', false)
         AND (predictive_eligible IS NULL OR predictive_eligible != true)
    `);
    console.log(
      `[backfill] predictive_eligible: closed=${closed.rowCount ?? 0} open=${open.rowCount ?? 0}`
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
