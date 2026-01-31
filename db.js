import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;

  if (process.env.DEBUG_DB === "true") {
    console.log("🧠 DB query", {
      text: text.replace(/\s+/g, " ").trim().slice(0, 120),
      duration,
      rows: res.rowCount,
    });
  }

  return res;
}

export async function getRepByPhone(phone) {
  const res = await query(
    `
    SELECT id, org_id, rep_name, phone
    FROM reps
    WHERE phone = $1
    LIMIT 1
  `,
    [phone]
  );

  return res.rows[0] || null;
}

export async function getOpportunitiesForRep(orgId, repName, onlyReviewNow = true) {
  const where = onlyReviewNow ? "AND review_now = TRUE" : "";
  const res = await query(
    `
    SELECT *
    FROM opportunities
    WHERE org_id = $1
      AND rep_name = $2
      ${where}
    ORDER BY id ASC
  `,
    [orgId, repName]
  );

  return res.rows || [];
}

export async function getOpportunityById(orgId, opportunityId) {
  const res = await query(
    `
    SELECT *
    FROM opportunities
    WHERE org_id = $1
      AND id = $2
    LIMIT 1
  `,
    [orgId, opportunityId]
  );

  return res.rows[0] || null;
}

export async function updateOpportunity(orgId, opportunityId, patch) {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (keys.length === 0) return await getOpportunityById(orgId, opportunityId);

  const setClauses = keys.map((k, idx) => `${k} = $${idx + 3}`);
  const values = keys.map((k) => patch[k]);

  const sql = `
    UPDATE opportunities
    SET ${setClauses.join(", ")},
        updated_at = now()
    WHERE org_id = $1
      AND id = $2
    RETURNING *
  `;

  const res = await query(sql, [orgId, opportunityId, ...values]);
  return res.rows[0] || null;
}

export async function insertAuditEvent({
  org_id,
  opportunity_id,
  run_id,
  call_id,
  actor_type,
  event_type,
  schema_version,
  prompt_version,
  logic_version,
  forecast_stage,
  ai_forecast,
  total_score,
  max_score,
  risk_summary,
  risk_flags,
  delta,
  definitions,
  meta,
}) {
  const res = await query(
    `
    INSERT INTO opportunity_audit_events (
      org_id,
      opportunity_id,
      run_id,
      call_id,
      actor_type,
      event_type,
      schema_version,
      prompt_version,
      logic_version,
      forecast_stage,
      ai_forecast,
      total_score,
      max_score,
      risk_summary,
      risk_flags,
      delta,
      definitions,
      meta
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
    )
    RETURNING *
  `,
    [
      org_id,
      opportunity_id,
      run_id,
      call_id,
      actor_type,
      event_type,
      schema_version,
      prompt_version,
      logic_version,
      forecast_stage,
      ai_forecast,
      total_score,
      max_score,
      risk_summary,
      risk_flags,
      delta,
      definitions,
      meta,
    ]
  );

  return res.rows[0] || null;
}

export async function getScoreDefinitions(orgId) {
  const res = await query(
    `
    SELECT category, score, label, criteria
    FROM score_definitions
    WHERE org_id = $1
    ORDER BY category, score ASC
  `,
    [orgId]
  );

  return res.rows || [];
}
