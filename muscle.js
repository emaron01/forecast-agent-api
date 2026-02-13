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

function vpTipForCategory(category) {
  const tips = {
    pain:
      "Quantify the business impact, clarify who feels it most, and tie it to a deadline the buyer owns.",
    metrics:
      "Define one measurable outcome with a baseline and target, and get the buyer to confirm it in writing.",
    champion:
      "Confirm the internal sponsor’s influence and actions this cycle, and secure a concrete next step they will drive.",
    competition:
      "Document the competitive alternative and your differentiation in the buyer’s words, then validate it with the sponsor.",
    budget:
      "Identify the funding source, approval path, and exact amount required; secure the approver’s acknowledgement.",
    criteria:
      "Get the decision criteria prioritized by the buyer and map how you meet the top two in their language.",
    process:
      "Map the decision process step‑by‑step, owners and dates, and validate where the deal can stall.",
    paper:
      "Confirm contracting steps, legal review owner, and the earliest signature date the buyer will commit to.",
    timing:
      "Anchor the close to a buyer‑owned event and validate the critical path milestones to reach it.",
    eb:
      "Identify the economic buyer, confirm their priorities, and secure direct access or a committed intro.",
  };
  return tips[category] || "Validate the critical evidence and confirm ownership for this category.";
}

/**
 * Map health_score (0-30) to an AI verdict stage for analytics.
 * - Commit: 24+
 * - Best Case: 18-23
 * - Pipeline: 0-17
 *
 * Note: This does NOT change CRM forecast_stage; it writes ai_verdict only.
 */
function computeAiVerdictFromHealthScore(healthScore) {
  const n = Number(healthScore);
  if (!Number.isFinite(n)) return null;
  if (n >= 24) return "Commit";
  if (n >= 18) return "Best Case";
  return "Pipeline";
}

function computeAiForecastFromHealthScore(healthScore) {
  // AI Forecast uses the same Health Score → Forecast Stage mapping already in the codebase.
  return computeAiVerdictFromHealthScore(healthScore);
}

async function getScoreLabel(pool, orgId, category, score) {
  if (!category || score == null) return null;
  const cat = String(category || "").trim();
  const sc = Number(score);
  if (!cat || !Number.isFinite(sc)) return null;

  // Some environments treat score_definitions as global (no org_id column).
  const hasOrgId = await hasScoreDefinitionsOrgIdColumn(pool);
  const tryCats = cat === "eb" ? ["eb", "economic_buyer"] : [cat];

  for (const c of tryCats) {
    const sql = hasOrgId
      ? `
        SELECT label
          FROM score_definitions
         WHERE org_id = $1
           AND category = $2
           AND score = $3
         LIMIT 1
        `
      : `
        SELECT label
          FROM score_definitions
         WHERE category = $1
           AND score = $2
         LIMIT 1
        `;
    const params = hasOrgId ? [orgId, c, sc] : [c, sc];
    try {
      const { rows } = await pool.query(sql, params);
      const label = rows?.[0]?.label ?? null;
      if (label) return label;
    } catch (e) {
      // If the table doesn't exist or schema differs, treat labels as optional.
      const code = String(e?.code || "");
      if (code === "42703" || code === "42P01") return null;
      throw e;
    }
  }
  return null;
}

let __scoreDefinitionsHasOrgIdColumn = null;
async function hasScoreDefinitionsOrgIdColumn(pool) {
  if (__scoreDefinitionsHasOrgIdColumn !== null) return __scoreDefinitionsHasOrgIdColumn;
  try {
    const { rows } = await pool.query(
      `
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'score_definitions'
         AND column_name = 'org_id'
       LIMIT 1
      `,
      []
    );
    __scoreDefinitionsHasOrgIdColumn = !!rows?.length;
    return __scoreDefinitionsHasOrgIdColumn;
  } catch {
    __scoreDefinitionsHasOrgIdColumn = false;
    return __scoreDefinitionsHasOrgIdColumn;
  }
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
  // Legacy DBs may use `organization_id` instead of `org_id` in audit tables.
  // Deal Review MUST NOT fail if audit schema varies; audit is best-effort.
  const orgCol = await detectOpportunityAuditEventsOrgColumn(pool);
  const cols = [
    orgCol ? orgCol : null,
    "opportunity_id",
    "actor_type",
    "event_type",
    "schema_version",
    "prompt_version",
    "logic_version",
    "forecast_stage",
    "ai_forecast",
    "total_score",
    "max_score",
    "risk_summary",
    "risk_flags",
    "delta",
    "definitions",
    "meta",
    "run_id",
    "call_id",
  ].filter(Boolean);

  // Build positional parameters dynamically based on which org column exists.
  const values = [
    ...(orgCol ? [orgId] : []),
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
  ];

  const placeholders = values.map((_, i) => `$${i + 1}`);
  const casted = cols.map((c, idx) => {
    const name = String(c);
    // Cast JSON columns for safety (works whether they're json/jsonb).
    if (name === "delta" || name === "definitions" || name === "meta") return `${name} = ${placeholders[idx]}::jsonb`;
    return null;
  });

  // Prefer explicit column list + VALUES; keep JSON casts in VALUES position.
  const valuesSql = cols.map((c, idx) => {
    const name = String(c);
    if (name === "delta" || name === "definitions" || name === "meta") return `${placeholders[idx]}::jsonb`;
    return placeholders[idx];
  });

  const q = `
    INSERT INTO opportunity_audit_events
      (${cols.join(", ")})
    VALUES
      (${valuesSql.join(", ")})
    RETURNING id
  `;

  try {
    const { rows } = await pool.query(q, values);
    return rows[0]?.id ?? null;
  } catch (e) {
    // If the table exists but schema differs, do not block deal review saves.
    // Postgres undefined_column is 42703.
    const code = String(e?.code || "");
    if (code === "42703") return null; // undefined_column
    if (code === "42P01") return null; // undefined_table
    throw e;
  }
}

let __opportunityAuditEventsOrgColumn = null;
async function detectOpportunityAuditEventsOrgColumn(pool) {
  if (__opportunityAuditEventsOrgColumn !== null) return __opportunityAuditEventsOrgColumn;
  try {
    const { rows } = await pool.query(
      `
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'opportunity_audit_events'
         AND column_name IN ('org_id', 'organization_id')
      `,
      []
    );
    const names = new Set((rows || []).map((r) => String(r.column_name || "").trim()).filter(Boolean));
    __opportunityAuditEventsOrgColumn = names.has("org_id") ? "org_id" : names.has("organization_id") ? "organization_id" : "";
    return __opportunityAuditEventsOrgColumn;
  } catch {
    __opportunityAuditEventsOrgColumn = "";
    return __opportunityAuditEventsOrgColumn;
  }
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

  // Normalize common camelCase variants (models sometimes emit these).
  // DB columns and the rest of the app expect snake_case.
  if (args && args.risk_summary == null && args.riskSummary != null) {
    args.risk_summary = args.riskSummary;
  }
  if (args && args.next_steps == null && args.nextSteps != null) {
    args.next_steps = args.nextSteps;
  }

  // Normalize Economic Buyer key prefix: models sometimes emit `economic_buyer_*`,
  // but the DB schema uses `eb_*`.
  if (args) {
    for (const suffix of ["score", "summary", "tip"]) {
      const fromKey = `economic_buyer_${suffix}`;
      const toKey = `eb_${suffix}`;
      if (args[fromKey] !== undefined) {
        if (args[toKey] === undefined) args[toKey] = args[fromKey];
        try {
          delete args[fromKey];
        } catch {}
      }
    }
  }

  const category = detectCategoryFromArgs(args);
  const delta = buildDelta(args);

  // Enforce: summary saved as "Label: <summary>" and always write *_tip key.
  // This makes saved data consistent even if the model omits label/tip.
  if (category) {
    const scoreKey = `${category}_score`;
    const summaryKey = `${category}_summary`;
    const tipKey = `${category}_tip`;

    const scoreVal = args?.[scoreKey];
    const scoreNum = Number(scoreVal);
    const hasScore = Number.isFinite(scoreNum);

    // Ensure tip key exists so DB column is written (can be empty string)
    if (args?.[tipKey] === undefined || args?.[tipKey] == null) args[tipKey] = "";

    if (hasScore && args?.[summaryKey] != null) {
      const rawSummary = cleanText(args[summaryKey]);
      if (rawSummary) {
        const label = await getScoreLabel(pool, orgId, category, scoreNum);
        if (label) {
          const prefix = `${label}:`;
          args[summaryKey] = rawSummary.startsWith(prefix)
            ? rawSummary
            : `${label}: ${rawSummary}`;
        } else {
          // If no label definition exists, still keep the summary clean.
          args[summaryKey] = rawSummary;
        }
      }
    }

    // If tip is missing/blank, generate a minimal deterministic coaching tip
    // without inventing facts.
    const cleanedTip = cleanText(args[tipKey]);
    if (!cleanedTip) {
      if (hasScore && scoreNum >= 3) {
        args[tipKey] = `Maintain current evidence; monitor for changes in ${category}.`;
      } else if (hasScore) {
        args[tipKey] = vpTipForCategory(category);
      } else {
        args[tipKey] = vpTipForCategory(category);
      }
    }
  }

  // Update opportunity columns that are present in args (score/summary/tip + optional extras)
  // Only allow known patterns: *_score, *_summary, *_tip, *_name, *_title, etc.
  const allowed = Object.keys(args).filter((k) =>
    /_(score|summary|tip|name|title|source|notes)$/.test(k)
  );
  // Avoid double-assigning special summary fields handled below.
  const safeAllowed = allowed.filter((k) => k !== "risk_summary" && k !== "next_steps");

  const sets = [];
  const vals = [];
  let i = 2;

  for (const k of safeAllowed) {
    // Prevent wiping summaries with empty strings
    if (k.endsWith("_summary")) {
      const cleaned = cleanText(args[k]);
      if (!cleaned) continue;
      args[k] = cleaned;
    }
    // Always persist tip (empty allowed) to satisfy required output
    if (k.endsWith("_tip") && args[k] == null) {
      args[k] = "";
    }
    sets.push(`${k} = $${++i}`);
    vals.push(args[k]);
  }

  // Also update risk_summary/next_steps if provided by tool (only persist non-empty to avoid wiping).
  const riskSummaryCleaned = cleanText(args.risk_summary);
  if (riskSummaryCleaned) {
    sets.push(`risk_summary = $${++i}`);
    vals.push(riskSummaryCleaned);
  }
  const nextStepsCleaned = cleanText(args.next_steps);
  if (nextStepsCleaned) {
    sets.push(`next_steps = $${++i}`);
    vals.push(nextStepsCleaned);
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

    // Persist computed health_score so the agent always has a real number to speak (never invent).
    if (recomputed.total_score != null && Number.isFinite(recomputed.total_score)) {
      const aiForecast = computeAiForecastFromHealthScore(recomputed.total_score);
      try {
        await client.query(
          `UPDATE opportunities
              SET health_score = $3,
                  ai_verdict = $4,
                  ai_forecast = $4,
                  baseline_health_score = COALESCE(baseline_health_score, $3),
                  baseline_health_score_ts = COALESCE(baseline_health_score_ts, NOW()),
                  updated_at = NOW()
            WHERE org_id = $1 AND id = $2`,
          [orgId, opportunityId, recomputed.total_score, aiForecast]
        );
      } catch (e) {
      // If ai_verdict column doesn't exist yet, try ai_forecast. Otherwise, still persist health_score.
      // Postgres undefined_column error code is 42703.
      if (String(e?.code || "") === "42703") {
        try {
          await client.query(
            `UPDATE opportunities
                SET health_score = $3,
                    ai_forecast = $4,
                    updated_at = NOW()
              WHERE org_id = $1 AND id = $2`,
            [orgId, opportunityId, recomputed.total_score, aiForecast]
          );
        } catch (e2) {
          if (String(e2?.code || "") === "42703") {
            await client.query(
              `UPDATE opportunities SET health_score = $3, updated_at = NOW() WHERE org_id = $1 AND id = $2`,
              [orgId, opportunityId, recomputed.total_score]
            );
          } else {
            throw e2;
          }
        }
      } else {
        throw e;
      }
      }

      // Keep in-memory opp consistent for audit event fields below.
      opp.health_score = recomputed.total_score;
      opp.ai_forecast = aiForecast;
    }

    // Create audit event (compact delta)
    const runId = args.run_id || null; // if you pass it later
    const auditId = await insertAuditEvent(client, {
      orgId,
      opportunityId,
      actorType: "agent",
      eventType: "score_save",
      forecastStage: opp.forecast_stage ?? null,
      aiForecast: opp.ai_forecast ?? null,
      totalScore: opp.health_score ?? null,
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
