/**
 * muscle.js
 * - Core tool handler for saving category data, auditing, and light deal state updates.
 * - MUST export handleFunctionCall as a named export.
 */

import { computeConfidence } from "./confidence.js";
import { computeAiForecastFromHealthScore } from "./aiForecast.js";

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

/** CRO-safe: returns "Won"|"Lost"|null from forecast_stage or sales_stage. Matches web/lib/opportunityOutcome. */
function closedOutcomeFromOpportunityRow(row) {
  const s = (v) => String(v || "").trim().toLowerCase();
  const check = (val) => {
    if (!val) return null;
    const v = s(val);
    if (/\bwon\b/.test(v)) return "Won";
    if (/\blost\b/.test(v)) return "Lost";
    if (/\bclosed\b/.test(v)) return "Lost";
    return null;
  };
  return check(row?.forecast_stage) || check(row?.sales_stage) || null;
}

/** CRO-safe: true if stage indicates Closed Won or Closed Lost. WON/LOST/CLOSED(standalone)=Lost. */
function isClosedStage(stageLike) {
  const s = String(stageLike || "").trim().toLowerCase();
  if (!s) return false;
  return /\bwon\b/.test(s) || /\blost\b/.test(s) || /\bclosed\b/.test(s);
}

/** CRO-safe: canonical ai_forecast/ai_verdict. Won=>Closed Won, Lost/Closed=>Closed Lost. */
function normalizeClosedForecast(stageLike) {
  const s = String(stageLike || "").trim().toLowerCase();
  if (!s) return null;
  if (/\bwon\b/.test(s)) return "Closed Won";
  if (/\blost\b/.test(s) || /\bclosed\b/.test(s)) return "Closed Lost";
  return null;
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
const EXCLUDED_SCORE_FIELDS = new Set(["health_score", "baseline_health_score"]);

async function recomputeTotalScore(pool, orgId, opportunityId) {
  // Keep your existing schema assumptions: category columns end in _score
  // We'll sum whatever exists for MEDDPICC+TB (safe generic).
  // Exclude derived fields (health_score, baseline_health_score) to prevent double-counting.
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
    if (EXCLUDED_SCORE_FIELDS.has(k)) continue;
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

// Feature flags: persist Champion/EB name and title; safe rollout and debug logging.
const ENTITY_PERSIST_ENABLED = process.env.ENTITY_PERSIST_ENABLED === "true";
const DEBUG_ENTITY_PERSIST = process.env.DEBUG_ENTITY_PERSIST === "true";
const ENTITY_FIELDS = ["eb_name", "eb_title", "champion_name", "champion_title"];

/** Persistence safety: prefer full name (>=2 words) over single word. */
function isBetterName(existing, incoming) {
  const inVal = cleanText(incoming);
  if (!inVal) return false;
  const exVal = cleanText(existing);
  if (!exVal) return true;
  const inWords = inVal.split(/\s+/).filter(Boolean).length;
  const exWords = exVal.split(/\s+/).filter(Boolean).length;
  return inWords >= 2 && exWords < 2;
}

/** Persistence safety: prefer specific title (role-like or longer) over generic. */
function isBetterTitle(existing, incoming) {
  const inVal = cleanText(incoming);
  if (!inVal) return false;
  const exVal = cleanText(existing);
  if (!exVal) return true;
  const roleLike = /\b(director|vp|vice president|manager|head|lead|chief|engineer|architect)\b/i;
  const inSpecific = inVal.length > 3 || roleLike.test(inVal);
  const exSpecific = exVal.length > 3 || roleLike.test(exVal);
  if (inSpecific && !exSpecific) return true;
  if (inVal.length > exVal.length && inSpecific) return true;
  return false;
}

/** Returns value to persist, or null to skip (never overwrite non-empty with empty; prefer higher quality). */
function mergeEntityValue(key, existingVal, incomingVal) {
  const incoming = cleanText(incomingVal);
  if (!incoming) return null;
  const existing = cleanText(existingVal);
  if (!existing) return incoming;
  const isName = key.endsWith("_name");
  const isTitle = key.endsWith("_title");
  if (isName && !isBetterName(existing, incoming)) return null;
  if (isTitle && !isBetterTitle(existing, incoming)) return null;
  return incoming;
}

export { isBetterName, isBetterTitle, mergeEntityValue };

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
    for (const suffix of ["score", "summary", "tip", "evidence_strength", "confidence"]) {
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
    // Scoring skepticism: EB/Champion identified but missing name/title → lower confidence.
    if (hasScore && (category === "champion" || category === "eb")) {
      const nameKey = category === "champion" ? "champion_name" : "eb_name";
      const titleKey = category === "champion" ? "champion_title" : "eb_title";
      const hasName = !!cleanText(args[nameKey]);
      const hasTitle = !!cleanText(args[titleKey]);
      if (!hasName || !hasTitle) {
        const confKey = `${category === "eb" ? "eb" : "champion"}_confidence`;
        const current = String(args[confKey] || "").trim().toLowerCase();
        if (current !== "high" && current !== "medium") args[confKey] = "low";
      }
    }
  }

  // Telemetry: derive confidence from evidence_strength when missing (locked mapping).
  const EVIDENCE_TO_CONFIDENCE = {
    explicit_verified: "high",
    credible_indirect: "medium",
    vague_rep_assertion: "low",
    unknown_missing: "low",
  };
  for (const k of Object.keys(args || {})) {
    const m = k.match(/^(.+)_evidence_strength$/);
    if (!m) continue;
    const cat = m[1];
    const confKey = `${cat}_confidence`;
    if (args[confKey] != null && String(args[confKey]).trim()) continue;
    const es = String(args[k] || "").trim();
    const derived = EVIDENCE_TO_CONFIDENCE[es] || null;
    if (derived) args[confKey] = derived;
  }

  // Update opportunity columns that are present in args (score/summary/tip + optional extras)
  // Only allow known patterns: *_score, *_summary, *_tip, *_name, *_title, *_evidence_strength, *_confidence, etc.
  const allowed = Object.keys(args).filter((k) =>
    /_(score|summary|tip|name|title|source|notes|evidence_strength|confidence)$/.test(k)
  );
  // Exclude metadata keys (not DB columns) and special summary fields handled below.
  const safeAllowed = allowed.filter(
    (k) =>
      k !== "risk_summary" &&
      k !== "next_steps" &&
      k !== "score_source" &&
      k !== "score_event_source" &&
      k !== "comment_ingestion_id" &&
      k !== "extraction_confidence" &&
      k !== "sales_stage_for_closed" &&
      k !== "entity_override"
  );
  // Ensure entity fields in args are always considered (in case they were omitted from allowed by regex).
  const entityKeysInArgs = ENTITY_FIELDS.filter((f) => args[f] !== undefined);
  const keysToProcess = [...new Set([...safeAllowed, ...entityKeysInArgs])];

  const sets = [];
  const vals = [];
  let i = 2;

  // Entity merge: fetch current values when any entity field is in args or entity_override is set.
  const hasEntityArg = ENTITY_FIELDS.some((f) => args[f] != null && String(args[f]).trim() !== "");
  const hasAnyEntityKeyInArgs = entityKeysInArgs.length > 0;
  const entityOverride = args.entity_override === true;
  const needEntityFetch = hasEntityArg || entityOverride || hasAnyEntityKeyInArgs;
  let currentEntity = null;
  if (needEntityFetch) {
    try {
      const { rows } = await pool.query(
        `SELECT eb_name, eb_title, champion_name, champion_title FROM opportunities WHERE org_id = $1 AND id = $2 LIMIT 1`,
        [orgId, opportunityId]
      );
      currentEntity = rows?.[0] || {};
    } catch (e) {
      if (String(e?.code || "") !== "42703") throw e;
      currentEntity = {};
    }
  }
  if (DEBUG_ENTITY_PERSIST && needEntityFetch) {
    const sanit = (v) => (v != null && String(v).trim() ? String(v).trim().slice(0, 40) + (String(v).length > 40 ? "…" : "") : "");
    console.log(
      JSON.stringify({
        event: "entity_persist_extracted",
        eb_name: sanit(args.eb_name),
        eb_title: sanit(args.eb_title),
        champion_name: sanit(args.champion_name),
        champion_title: sanit(args.champion_title),
        entity_override: entityOverride,
      })
    );
    console.log(
      JSON.stringify({ event: "entity_persist_payload_keys", keys: Object.keys(args).filter((k) => ENTITY_FIELDS.includes(k)) })
    );
  }

  for (const k of keysToProcess) {
    // Entity fields: when entity_override true, allow overwrite/clear; else upgrade-only merge.
    if (ENTITY_FIELDS.includes(k)) {
      const existing = currentEntity ? (currentEntity[k] ?? null) : null;
      const incomingVal = args[k];
      const incomingCleaned = cleanText(incomingVal);
      let merged;
      let changed;
      if (entityOverride) {
        if (args[k] === undefined) continue;
        merged = incomingCleaned || null;
        changed = (existing != null ? String(existing).trim() : "") !== (merged != null ? String(merged) : "");
      } else {
        merged = mergeEntityValue(k, existing, incomingVal);
        changed = merged != null && (existing == null || String(existing).trim() !== merged);
      }
      if (merged === undefined) continue;
      sets.push(`${k} = $${++i}`);
      vals.push(merged);
      if (DEBUG_ENTITY_PERSIST) {
        const ex = existing != null ? String(existing).trim() : "";
        console.log(
          JSON.stringify({
            event: "entity_persist_merge",
            field: k,
            entity_override: entityOverride,
            existing: ex.slice(0, 30) + (ex.length > 30 ? "…" : ""),
            incoming: String(incomingVal ?? "").trim().slice(0, 30) + (String(incomingVal ?? "").length > 30 ? "…" : ""),
            merged: merged != null ? String(merged).slice(0, 30) + (String(merged).length > 30 ? "…" : "") : "null",
            changed,
          })
        );
      }
      continue;
    }
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
    // Telemetry: evidence_strength/confidence — store NULL when empty (missing = NULL per spec)
    if ((k.endsWith("_evidence_strength") || k.endsWith("_confidence")) && !cleanText(args[k])) {
      sets.push(`${k} = $${++i}`);
      vals.push(null);
    } else {
      sets.push(`${k} = $${++i}`);
      vals.push(args[k]);
    }
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

    let updateRowCount = null;
    if (sets.length) {
      const q = `
        UPDATE opportunities
           SET ${sets.join(", ")}
         WHERE org_id = $1
           AND id = $2
      `;
      const updateResult = await client.query(q, [orgId, opportunityId, ...vals]);
      updateRowCount = updateResult?.rowCount ?? null;
      if (DEBUG_ENTITY_PERSIST) {
        console.log(JSON.stringify({ event: "entity_persist_update_rowcount", rowCount: updateRowCount }));
      }
    }

    if (DEBUG_ENTITY_PERSIST && needEntityFetch) {
      try {
        const { rows } = await client.query(
          `SELECT eb_name, eb_title, champion_name, champion_title FROM opportunities WHERE org_id = $1 AND id = $2 LIMIT 1`,
          [orgId, opportunityId]
        );
        const row = rows?.[0] || {};
        const sanitize = (v) => {
          const s = v != null ? String(v).trim() : "";
          return s ? (s.length > 40 ? s.slice(0, 40) + "…" : s) : "";
        };
        console.log(
          JSON.stringify({
            event: "entity_persist_after_update",
            eb_name: sanitize(row.eb_name),
            eb_title: sanitize(row.eb_title),
            champion_name: sanitize(row.champion_name),
            champion_title: sanitize(row.champion_title),
          })
        );
      } catch (e) {
        if (String(e?.code || "") !== "42703") console.warn("[DEBUG_ENTITY_PERSIST] post-select", e?.message);
      }
    }

    // Pull latest opp row for audit context (sales_stage for CRO-safe closed guard)
    const { rows } = await client.query(
      `SELECT id, org_id, forecast_stage, sales_stage, ai_forecast, health_score, risk_summary, baseline_health_score_ts
         FROM opportunities
        WHERE org_id = $1 AND id = $2
        LIMIT 1`,
      [orgId, opportunityId]
    );

    const opp = rows[0] || {};
    const baselineAlreadyExists = opp.baseline_health_score_ts != null;
    const recomputed = await recomputeTotalScore(client, orgId, opportunityId);

    // Telemetry: predictive_eligible = TRUE when NOT Closed Won/Lost (for training data filtering).
    const closed = closedOutcomeFromOpportunityRow(opp);
    const predictiveEligible = closed == null;
    try {
      await client.query(
        `UPDATE opportunities SET predictive_eligible = $3 WHERE org_id = $1 AND id = $2`,
        [orgId, opportunityId, predictiveEligible]
      );
    } catch (e) {
      if (String(e?.code || "") !== "42703") throw e; // ignore if column missing
    }

    // Provenance: score_event_source from args overrides; else baselineAlreadyExists ? 'agent' : 'baseline'
    const scoreEventSource = args.score_event_source === "baseline" || args.score_event_source === "agent"
      ? args.score_event_source
      : baselineAlreadyExists ? "agent" : "baseline";

    // CRO-safe closed pinning: if sales_stage indicates Closed Won/Lost, NEVER write Pipeline/Best Case/Commit.
    const stageForClosed = args.sales_stage_for_closed ?? opp.sales_stage ?? opp.forecast_stage;
    const pinnedClosed = isClosedStage(stageForClosed) ? normalizeClosedForecast(stageForClosed) : null;

    // Persist computed health_score so the agent always has a real number to speak (never invent).
    // Baseline immutability: only set baseline_* when baseline_health_score_ts IS NULL.
    if (recomputed.total_score != null && Number.isFinite(recomputed.total_score)) {
      const aiForecast = pinnedClosed ?? computeAiForecastFromHealthScore({
        healthScore: recomputed.total_score,
        salesStageForClosed: stageForClosed,
        salesStage: opp.sales_stage,
        forecastStage: opp.forecast_stage,
      });
      const scoreSource = scoreEventSource;
      try {
        if (baselineAlreadyExists) {
          // Agent update: do NOT touch baseline_*; only update health_score and provenance.
          await client.query(
            `UPDATE opportunities
                SET health_score = $3,
                    ai_verdict = $4,
                    ai_forecast = $4,
                    health_score_source = $5,
                    updated_at = NOW()
              WHERE org_id = $1 AND id = $2`,
            [orgId, opportunityId, recomputed.total_score, aiForecast, scoreSource]
          );
        } else {
          // First scoring: set baseline and provenance.
          await client.query(
            `UPDATE opportunities
                SET health_score = $3,
                    ai_verdict = $4,
                    ai_forecast = $4,
                    baseline_health_score = COALESCE(baseline_health_score, $3),
                    baseline_health_score_ts = COALESCE(baseline_health_score_ts, NOW()),
                    health_score_source = $5,
                    updated_at = NOW()
              WHERE org_id = $1 AND id = $2`,
            [orgId, opportunityId, recomputed.total_score, aiForecast, scoreSource]
          );
        }
      } catch (e) {
        // If ai_verdict or health_score_source column doesn't exist yet, try fallbacks.
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

    // Fetch full opp for confidence computation (includes updated_at, close_date, category scores)
    const { rows: oppRows } = await client.query(
      `SELECT * FROM opportunities WHERE org_id = $1 AND id = $2 LIMIT 1`,
      [orgId, opportunityId]
    );
    const fullOpp = oppRows?.[0] || opp;
    const scoreSource = args.score_source === "ai_notes" ? "ai_notes" : "rep_review";
    const commentIngestionId = args.comment_ingestion_id != null ? Number(args.comment_ingestion_id) : null;
    const extractionConfidence = args.extraction_confidence || null;
    const scoring = computeConfidence({
      opportunity: fullOpp,
      source: scoreSource,
      extractionConfidence: extractionConfidence || undefined,
      commentIngestionId: Number.isFinite(commentIngestionId) ? commentIngestionId : null,
      now: new Date(),
    });

    // Update audit_details.scoring (merge; do not overwrite other keys)
    try {
      await client.query(
        `UPDATE opportunities
           SET audit_details = jsonb_set(COALESCE(audit_details, '{}'), '{scoring}', $3::jsonb)
         WHERE org_id = $1 AND id = $2`,
        [orgId, opportunityId, JSON.stringify(scoring)]
      );
    } catch (e) {
      if (String(e?.code || "") === "42703") {
        // audit_details column may not exist in some DBs
      } else {
        throw e;
      }
    }

    // Create audit event (compact delta) with meta.scoring
    const runId = args.run_id || null; // if you pass it later
    const meta = {
      rep_name: repName,
      category,
      saved_at: nowIso(),
      scoring,
    };
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
      meta,
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
