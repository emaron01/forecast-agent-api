/**
 * muscle.js
 * - Core tool handler for saving category data, auditing, and light deal state updates.
 * - MUST export handleFunctionCall as a named export.
 *
 * SAVE-ONLY FIXES:
 *  1) Placeholder numbering: WHERE uses $1,$2 so SET values must start at $3  -> let i = 2
 *  2) opportunities has forecast_stage (NOT stage)
 *  3) opportunities does NOT have total_score -> use previous_total_score (existing column)
 */

function nowIso() {
  return new Date().toISOString();
}

function cleanText(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Detect which category is being saved from tool args.
 * We store <category>_score, <category>_summary, <category>_tip.
 */
function detectCategoryFromArgs(args) {
  const keys = Object.keys(args || {});
  const scoreKey = keys.find((k) => k.endsWith("_score"));
  if (!scoreKey) return null;
  return scoreKey.replace(/_score$/, "");
}

/**
 * Build a "delta" JSON payload for opportunity_audit_events.
 * Keep it compact: only store fields the tool provided for this save.
 */
function buildDelta(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (k === "org_id" || k === "opportunity_id" || k === "rep_name" || k === "call_id") continue;
    out[k] = v;
  }
  return out;
}

/**
 * Compute running total score/max score if present in opportunity row.
 * We sum all *_score numeric columns that exist on the row.
 */
async function recomputeTotalScore(poolOrClient, orgId, opportunityId) {
  const { rows } = await poolOrClient.query(
    `SELECT *
       FROM opportunities
      WHERE org_id = $1 AND id = $2
      LIMIT 1`,
    [orgId, opportunityId]
  );
  if (!rows.length) return { total_score: null, max_score: null };

  const row = rows[0];
  let total = 0;
  let hasAny = false;

  for (const [k, v] of Object.entries(row)) {
    if (!k.endsWith("_score")) continue;
    if (typeof v !== "number") continue;
    total += v;
    hasAny = true;
  }

  return { total_score: hasAny ? total : null, max_score: null };
}

/**
 * Insert audit event row.
 * NOTE: Do not change the column list shape here unless schema demands it.
 */
async function insertAuditEvent(
  poolOrClient,
  {
    orgId,
    opportunityId,
    actorType,
    eventType,
    forecastStage,
    aiForecast,
    totalScore,
    maxScore,
    riskSummary,
    riskFlags,
    delta,
    definitions,
    meta,
    runId,
    callId,
    schemaVersion = 1,
    promptVersion = "v1",
    logicVersion = "v1",
  }
) {
  const q = `
    INSERT INTO opportunity_audit_events
      (org_id, opportunity_id, actor_type, event_type, schema_version, prompt_version, logic_version,
       forecast_stage, ai_forecast, total_score, max_score, risk_summary, risk_flags, delta, definitions, meta, run_id, call_id)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18)
    RETURNING id
  `;

  const { rows } = await poolOrClient.query(q, [
    orgId,
    opportunityId,
    actorType,
    eventType,
    schemaVersion,
    promptVersion,
    logicVersion,
    forecastStage,
    aiForecast,
    totalScore,
    maxScore,
    riskSummary,
    riskFlags,
    JSON.stringify(delta || {}),
    JSON.stringify(definitions || {}),
    JSON.stringify(meta || {}),
    runId,
    callId,
  ]);

  return rows[0]?.id ?? null;
}

/**
 * Main tool handler (named export)
 */
export async function handleFunctionCall({ toolName, args, pool }) {
  if (toolName !== "save_deal_data") {
    return { ok: true, ignored: toolName };
  }

  const orgId = Number(args.org_id);
  const opportunityId = Number(args.opportunity_id);
  if (!orgId || !opportunityId) {
    throw new Error("save_deal_data requires org_id and opportunity_id");
  }

  const repName = cleanText(args.rep_name);
  const callId = cleanText(args.call_id);

  const category = detectCategoryFromArgs(args);
  const delta = buildDelta(args);

  // Update opportunity columns that are present in args (score/summary/tip + optional extras)
  const allowed = Object.keys(args).filter((k) =>
    /_(score|summary|tip|name|title|source|notes)$/.test(k)
  );

  const sets = [];
  const vals = [];

  // ✅ FIX #1: WHERE uses $1,$2 (org_id,id), so SET must start at $3
  let i = 2;

  for (const k of allowed) {
    sets.push(`${k} = $${++i}`);
    vals.push(args[k]);
  }

  if (args.last_summary != null) {
    sets.push(`last_summary = $${++i}`);
    vals.push(args.last_summary);
  }
  if (args.risk_summary != null) {
    sets.push(`risk_summary = $${++i}`);
    vals.push(args.risk_summary);
  }

  // updated_at exists in your schema
  sets.push(`updated_at = NOW()`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (sets.length) {
      const q = `
        UPDATE opportunities
           SET ${sets.join(", ")}
         WHERE org_id = $1
           AND id = $2
      `;
      await client.query(q, [orgId, opportunityId, ...vals]);
    }

    // ✅ FIX #2: opportunities column is forecast_stage (NOT stage)
    // Also: opportunities does NOT have total_score; it has previous_total_score.
    const { rows } = await client.query(
      `SELECT id, org_id, forecast_stage, ai_forecast, previous_total_score, risk_summary
         FROM opportunities
        WHERE org_id = $1 AND id = $2
        LIMIT 1`,
      [orgId, opportunityId]
    );

    const opp = rows[0] || {};
    const recomputed = await recomputeTotalScore(client, orgId, opportunityId);

    // ✅ FIX #3: write computed total into previous_total_score (since total_score column does not exist)
    if (recomputed.total_score != null) {
      await client.query(
        `UPDATE opportunities
            SET previous_total_score = $3,
                previous_updated_at = NOW()
          WHERE org_id = $1 AND id = $2`,
        [orgId, opportunityId, recomputed.total_score]
      );
      opp.previous_total_score = recomputed.total_score;
    }

    const runId = args.run_id || cryptoRandomUUIDSafe();

    // Audit event (keep insert shape the same)
    const auditId = await insertAuditEvent(client, {
      orgId,
      opportunityId,
      actorType: "agent",
      eventType: "score_save",
      forecastStage: opp.forecast_stage ?? null,
      aiForecast: opp.ai_forecast ?? null,
      // audit table expects total_score; we provide computed total (from previous_total_score)
      totalScore: recomputed.total_score ?? opp.previous_total_score ?? null,
      maxScore: null,
      riskSummary: opp.risk_summary ?? null,
      riskFlags: args.risk_flags ?? null,
      delta,
      definitions: args.definitions ?? null,
      meta: {
        rep_name: repName,
        category,
        saved_at: nowIso(),
      },
      runId,
      callId,
      schemaVersion: 1,
      promptVersion: args.prompt_version || "v1",
      logicVersion: args.logic_version || "v1",
    });

    await client.query("COMMIT");

    return {
      ok: true,
      saved: true,
      opportunity_id: opportunityId,
      audit_event_id: auditId,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Safe UUID if crypto.randomUUID exists; otherwise pseudo-id.
 */
function cryptoRandomUUIDSafe() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {}
  return `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
