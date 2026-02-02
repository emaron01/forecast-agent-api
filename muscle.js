/**
 * muscle.js
 * - Core tool handler for saving category data, auditing, and light deal state updates.
 * - MUST export handleFunctionCall as a named export.
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
 * Compute running total score/max score if present in opportunity row
 * (kept minimal: muscle does not invent weights; server/db own scoring tables).
 */
async function recomputeTotalScore(pool, orgId, opportunityId) {
  // Keep your existing schema assumptions: category columns end in _score
  // We'll sum whatever exists for MEDDPICC+TB (safe generic).
  const { rows } = await pool.query(
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

  // max_score depends on what categories exist; keep null if unknown.
  return { total_score: hasAny ? total : null, max_score: null };
}

/**
 * Insert audit event row.
 */
async function insertAuditEvent(pool, {
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
}) {
  const q = `
    INSERT INTO opportunity_audit_events
      (org_id, opportunity_id, actor_type, event_type, schema_version, prompt_version, logic_version,
       forecast_stage, ai_forecast, total_score, max_score, risk_summary, risk_flags, delta, definitions, meta, run_id, call_id)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18)
    RETURNING id
  `;

  const { rows } = await pool.query(q, [
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
  // Only allow known patterns: *_score, *_summary, *_tip, *_name, *_title, etc.
  const allowed = Object.keys(args).filter((k) =>
    /_(score|summary|tip|name|title|source|notes)$/.test(k)
  );

  const sets = [];
  const vals = [];
  let i = 1;

  for (const k of allowed) {
    sets.push(`${k} = $${++i}`);
    vals.push(args[k]);
  }

  // Also update last_summary/risk_summary if provided by tool.
  // (keeping backwards compatibility)
  if (args.last_summary != null) {
    sets.push(`last_summary = $${++i}`);
    vals.push(args.last_summary);
  }
  if (args.risk_summary != null) {
    sets.push(`risk_summary = $${++i}`);
    vals.push(args.risk_summary);
  }

  // Always stamp updated_at if exists
  sets.push(`updated_at = NOW()`);

  // Start transaction
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

    // Pull latest opp row for audit context fields
    const { rows } = await client.query(
      `SELECT id, org_id, forecast_stage, ai_forecast, health_score, risk_summary
         FROM opportunities
        WHERE org_id = $1 AND id = $2
        LIMIT 1`,
      [orgId, opportunityId]
    );

    const opp = rows[0] || {};
    const recomputed = await recomputeTotalScore(client, orgId, opportunityId);

    // Create audit event (compact delta)
    const runId = args.run_id || null; // if you pass it later
    const auditId = await insertAuditEvent(client, {
      orgId,
      opportunityId,
      actorType: "agent",
      eventType: "score_save",
      forecastStage: opp.forecast_stage ?? null,
      aiForecast: opp.ai_forecast ?? null,
      totalScore: opp.health_score ?? recomputed.total_score ?? null,
      maxScore: 30,
      riskSummary: opp.risk_summary ?? null,
      riskFlags: args.risk_flags ?? null,
      delta,
      definitions: args.definitions ?? null,
      meta: {
        rep_name: repName,
        category,
        saved_at: nowIso(),
      },
      runId: runId || cryptoRandomUUIDSafe(),
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
 * Safe UUID if crypto.randomUUID exists; otherwise null-ish.
 */
function cryptoRandomUUIDSafe() {
  try {
    // Node 18+ supports global crypto.randomUUID in many runtimes
    // but not all; guard it.
    // eslint-disable-next-line no-undef
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      // eslint-disable-next-line no-undef
      return globalThis.crypto.randomUUID();
    }
  } catch {}
  // fallback: pseudo
  return `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
