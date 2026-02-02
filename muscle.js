// muscle.js
// SAVE + audit logic only. Do NOT refactor beyond fixing broken SAVE.
// Schema-aligned to your tables:
// opportunities: forecast_stage, previous_total_score, previous_updated_at, updated_at
// opportunity_audit_events: run_id (uuid NOT NULL), delta (jsonb NOT NULL)
// Critical fixes:
// 1) Placeholder numbering: WHERE uses $1,$2 so SET placeholders must start at $3 (let i = 2)
// 2) Use forecast_stage (NOT stage)
// 3) Do not write opportunities.total_score (does not exist); write previous_total_score instead
// 4) Always provide a valid UUID for opportunity_audit_events.run_id

import crypto from "crypto";

function cleanText(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function detectCategoryFromArgs(args) {
  const cats = [
    "pain",
    "metrics",
    "champion",
    "eb",
    "criteria",
    "process",
    "competition",
    "paper",
    "timing",
    "budget",
  ];
  for (const c of cats) {
    if (
      args[`${c}_score`] != null ||
      args[`${c}_summary`] != null ||
      args[`${c}_tip`] != null ||
      args[`${c}_name`] != null ||
      args[`${c}_title`] != null
    ) {
      return c;
    }
  }
  return null;
}

function buildDelta(args) {
  const delta = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (k === "org_id" || k === "opportunity_id" || k === "rep_name" || k === "call_id") continue;
    if (v === undefined) continue;
    delta[k] = v;
  }
  return delta;
}

async function computeTotalScore(client, orgId, opportunityId) {
  const { rows } = await client.query(
    `SELECT
        pain_score, metrics_score, champion_score, eb_score, criteria_score,
        process_score, competition_score, paper_score, timing_score, budget_score
     FROM opportunities
     WHERE org_id = $1 AND id = $2
     LIMIT 1`,
    [orgId, opportunityId]
  );

  if (!rows.length) return null;
  const r = rows[0];

  const fields = [
    "pain_score",
    "metrics_score",
    "champion_score",
    "eb_score",
    "criteria_score",
    "process_score",
    "competition_score",
    "paper_score",
    "timing_score",
    "budget_score",
  ];

  let total = 0;
  for (const f of fields) total += Number(r[f] || 0);
  return total;
}

export async function handleFunctionCall({ toolName, args, pool }) {
  if (toolName !== "save_deal_data") return { ok: true, ignored: toolName };

  const orgId = Number(args.org_id);
  const opportunityId = Number(args.opportunity_id);

  if (!orgId || !opportunityId) {
    throw new Error("save_deal_data requires org_id and opportunity_id");
  }

  const repName = cleanText(args.rep_name);
  const callId = cleanText(args.call_id);

  const category = detectCategoryFromArgs(args);
  const delta = buildDelta(args);

  // Only update columns that exist in opportunities (based on your schema):
  // - *_score, *_summary, *_tip, *_name, *_title
  // - risk_summary, next_steps, rep_comments
  const allowed = Object.keys(args).filter((k) => /_(score|summary|tip|name|title)$/.test(k));
  for (const k of ["risk_summary", "next_steps", "rep_comments"]) {
    if (args[k] !== undefined) allowed.push(k);
  }

  const sets = [];
  const vals = [];

  // ✅ FIX #1: WHERE uses $1,$2 (org_id,id), so SET must start at $3
  let i = 2;

  for (const k of allowed) {
    sets.push(`${k} = $${++i}`);
    vals.push(args[k]);
  }

  // updated_at exists
  sets.push(`updated_at = NOW()`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Update opportunity
    if (sets.length) {
      const q = `
        UPDATE opportunities
           SET ${sets.join(", ")}
         WHERE org_id = $1
           AND id = $2
      `;
      await client.query(q, [orgId, opportunityId, ...vals]);
    }

    // 2) Reload context fields for audit (schema-aligned)
    const { rows } = await client.query(
      `SELECT id, org_id, forecast_stage, ai_forecast, risk_summary
         FROM opportunities
        WHERE org_id = $1 AND id = $2
        LIMIT 1`,
      [orgId, opportunityId]
    );
    const opp = rows[0];
    if (!opp) throw new Error("Opportunity not found after update");

    // 3) Compute total score and persist into previous_total_score
    const totalScore = await computeTotalScore(client, orgId, opportunityId);
    if (totalScore != null) {
      await client.query(
        `UPDATE opportunities
            SET previous_total_score = $3,
                previous_updated_at = NOW()
          WHERE org_id = $1 AND id = $2`,
        [orgId, opportunityId, totalScore]
      );
    }

    // 4) Insert audit event (schema-aligned)
    const runId = crypto.randomUUID(); // uuid NOT NULL
    const schemaVersion = 1; // NOT NULL
    const promptVersion = "v1"; // NOT NULL
    const logicVersion = "v1"; // NOT NULL

    await client.query(
      `
      INSERT INTO opportunity_audit_events (
        org_id, opportunity_id, ts, run_id, call_id, actor_type, event_type,
        schema_version, prompt_version, logic_version,
        forecast_stage, ai_forecast, total_score, max_score,
        risk_summary, risk_flags, delta, definitions, meta
      )
      VALUES (
        $1, $2, NOW(), $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16::jsonb, $17::jsonb, $18::jsonb
      )
      `,
      [
        orgId,
        opportunityId,
        runId,
        callId,
        "agent",
        "save_deal_data",
        schemaVersion,
        promptVersion,
        logicVersion,
        opp.forecast_stage || null,
        opp.ai_forecast || null,
        totalScore != null ? Number(totalScore) : null,
        30, // max_score (10 categories x 3)
        opp.risk_summary || null,
        null, // risk_flags text[]
        JSON.stringify(delta || {}), // delta jsonb NOT NULL
        JSON.stringify({}), // definitions jsonb nullable
        JSON.stringify({ rep_name: repName, category }), // meta jsonb nullable
      ]
    );

    await client.query("COMMIT");
    return { ok: true, saved: true, org_id: orgId, opportunity_id: opportunityId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
