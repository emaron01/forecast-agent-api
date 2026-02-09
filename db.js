/**
 * db.js
 * Minimal DB helpers for Postgres.
 * Used by the Next.js web app routes for shared DB access helpers.
 */

import { Pool } from "pg";

export function makePool(connectionString) {
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
}

/**
 * Normalize the category key at the DB boundary so callers can pass either:
 * - "eb" (internal prefix) OR "economic_buyer" (canonical)
 *
 * DB key is always the canonical `question_definitions.category` value.
 */
export function normalizeQuestionCategoryKey(category) {
  const s = String(category || "").trim();
  if (!s) return "";
  // Internal code sometimes uses "eb" as the opportunity column prefix.
  // The `question_definitions.category` values must match the canonical keys.
  if (s === "eb") return "economic_buyer";
  return s;
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

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(a, b) {
  const left = isPlainObject(a) ? a : {};
  const right = isPlainObject(b) ? b : {};
  const out = { ...left };
  for (const [k, v] of Object.entries(right)) {
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

export async function getRepSettings(pool, { orgId, repId }) {
  const org = Number(orgId);
  const rep = Number(repId);
  if (!org) throw new Error("getRepSettings requires orgId");
  if (!rep) throw new Error("getRepSettings requires repId");
  const { rows } = await pool.query(
    `
    SELECT settings
      FROM rep_settings
     WHERE org_id = $1
       AND rep_id = $2
     LIMIT 1
    `,
    [org, rep]
  );
  return (rows?.[0]?.settings ?? null) || null;
}

export async function patchRepSettings(pool, { orgId, repId, patch }) {
  const org = Number(orgId);
  const rep = Number(repId);
  if (!org) throw new Error("patchRepSettings requires orgId");
  if (!rep) throw new Error("patchRepSettings requires repId");
  const p = isPlainObject(patch) ? patch : {};

  const existing = (await getRepSettings(pool, { orgId: org, repId: rep })) || {};
  const merged = deepMerge(existing, p);

  const { rows } = await pool.query(
    `
    INSERT INTO rep_settings (org_id, rep_id, settings, created_at, updated_at)
    VALUES ($1, $2, $3::jsonb, NOW(), NOW())
    ON CONFLICT (org_id, rep_id)
    DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()
    RETURNING settings
    `,
    [org, rep, JSON.stringify(merged)]
  );

  return rows?.[0]?.settings ?? merged;
}

/**
 * Fetch active question definitions for an org/category/type.
 * - category keys must match `question_definitions.category` (e.g. economic_buyer, not eb)
 * - criteriaId applies ONLY to rows with a min/max window; rows with NULL window always qualify
 *
 * No caching: callers should fetch per request/turn so edits take effect immediately.
 */
export async function getQuestionDefinitions(pool, { orgId, category, questionType, criteriaId }) {
  const org = Number(orgId);
  const cat = normalizeQuestionCategoryKey(category);
  const qt = String(questionType || "").trim();
  const cId = criteriaId == null ? null : Number(criteriaId);
  if (!org) throw new Error("getQuestionDefinitions requires orgId");
  if (!cat) throw new Error("getQuestionDefinitions requires category");
  if (qt !== "base" && qt !== "clarifier") throw new Error("getQuestionDefinitions requires questionType base|clarifier");

  const { rows } = await pool.query(
    `
    SELECT id, question_text, min_criteria_id, max_criteria_id, priority
      FROM question_definitions
     WHERE org_id = $1
       AND category = $2
       AND question_type = $3
       AND active = TRUE
       AND (
         (min_criteria_id IS NULL AND max_criteria_id IS NULL)
         OR
         ($4::int IS NOT NULL AND min_criteria_id <= $4::int AND max_criteria_id >= $4::int)
       )
     ORDER BY priority ASC, id ASC
    `,
    [org, cat, qt, Number.isFinite(cId) ? cId : null]
  );

  return rows || [];
}

/**
 * Fetch question pack for one category.
 * - base: all eligible base questions (ordered)
 * - primary: first base question (or empty string if none)
 * - clarifiers: all eligible clarifier questions (ordered)
 *
 * (We keep base questions separate so the prompt builder can decide whether
 * to ask only the primary or additional base questions.)
 */
export async function getQuestionPack(pool, { orgId, category, criteriaId }) {
  const bases = await getQuestionDefinitions(pool, { orgId, category, questionType: "base", criteriaId });
  const clar = await getQuestionDefinitions(pool, { orgId, category, questionType: "clarifier", criteriaId });

  const base = (bases || [])
    .map((r) => String(r?.question_text || "").trim())
    .map((s) => s.trim())
    .filter(Boolean);

  const primary = base[0] || "";

  const clarifiers = (clar || [])
    .map((r) => String(r?.question_text || "").trim())
    .map((s) => s.trim())
    .filter(Boolean);

  return { base, primary, clarifiers };
}
