/**
 * db.js
 * Minimal DB helpers for Postgres.
 * Note: server.js currently uses Pool directly, but keep this file for structure and reuse.
 */

import { Pool } from "pg";

export function makePool(connectionString) {
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
}

export async function getRepByPhone(pool, phone) {
  const { rows } = await pool.query(
    `SELECT org_id, rep_name
       FROM reps
      WHERE phone = $1
      LIMIT 1`,
    [phone]
  );
  return rows[0] || null;
}

export async function getReviewNowDeals(pool, orgId, repName) {
  const { rows } = await pool.query(
    `
    SELECT id, org_id, rep_name, account_name, stage, amount, close_date, review_now,
           ai_forecast, total_score, last_summary, risk_summary,
           pain_score, pain_summary
    FROM opportunities
    WHERE org_id = $1
      AND rep_name = $2
      AND review_now = TRUE
    ORDER BY id ASC
    `,
    [orgId, repName]
  );
  return rows;
}

export async function getScoreDefinitions(pool, orgId) {
  const { rows } = await pool.query(
    `
    SELECT category, score, label, criteria
    FROM score_definitions
    WHERE org_id = $1
    ORDER BY category ASC, score ASC
    `,
    [orgId]
  );
  return rows;
}
