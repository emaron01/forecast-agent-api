import { z } from "zod";
import { pool } from "./pool";

/**
 * Hybrid ID model (read this if you're unsure which key to use).
 *
 * - PUBLIC UUID KEY (external): `public_id` (uuid -> TS `string`)
 *   - Used in: URLs, API params, request bodies, query params, UI routing, CRM integrations.
 *   - Never guessable; stable across future PK migrations.
 *
 * - INTERNAL DB KEY (internal): `id` (int -> TS `number`, or bigint -> TS `string`)
 *   - Used in: joins, foreign keys, internal DB helper functions.
 *   - Must never be exposed to clients.
 *
 * Boundary rule: resolve UUID -> internal id immediately when entering the server boundary.
 *
 * See `docs/ID_POLICY.md`.
 */

export const zPublicId = z.string().uuid();

// IMPORTANT: Some tables use BIGINT primary keys.
// We treat BIGINT ids as TEXT in TS to avoid JS precision issues.
// External surfaces still use UUID `public_id`; resolve to internal TEXT ids with resolvePublicTextId().
const INT_ID_TABLES: Record<string, string> = {
  organizations: "organizations",
  users: "users",
  opportunities: "opportunities",
  reps: "reps",
  // NOTE: Add more *int id* tables here only if their PK is an integer safely representable in JS.
};

const TEXT_ID_TABLES: Record<string, string> = {
  field_mapping_sets: "field_mapping_sets",
  field_mappings: "field_mappings",
  ingestion_staging: "ingestion_staging",
  email_templates: "email_templates",
  user_sessions: "user_sessions",
  password_reset_tokens: "password_reset_tokens",
  // opportunity_audit_events / score_definitions vary by env; add only if you confirm PK type.
};

export async function resolvePublicId(table: string, publicId: string): Promise<number> {
  const t = String(table || "").trim();
  const tableName = INT_ID_TABLES[t];
  if (!tableName) throw Object.assign(new Error("invalid_table"), { statusCode: 400 });

  const pid = zPublicId.parse(publicId);
  // INTERNAL DB KEY (int) lookup by PUBLIC UUID KEY.
  const { rows } = await pool.query(`SELECT id FROM ${tableName} WHERE public_id = $1 LIMIT 1`, [pid]);
  const id = Number(rows?.[0]?.id || 0);
  if (!id) throw Object.assign(new Error("not_found"), { statusCode: 404 });
  return id;
}

export async function resolvePublicTextId(table: string, publicId: string): Promise<string> {
  const t = String(table || "").trim();
  const tableName = TEXT_ID_TABLES[t];
  if (!tableName) throw Object.assign(new Error("invalid_table"), { statusCode: 400 });

  const pid = zPublicId.parse(publicId);
  // INTERNAL DB KEY (bigint-as-text) lookup by PUBLIC UUID KEY.
  const { rows } = await pool.query(`SELECT id::text AS id FROM ${tableName} WHERE public_id = $1 LIMIT 1`, [pid]);
  const id = String(rows?.[0]?.id || "").trim();
  if (!id) throw Object.assign(new Error("not_found"), { statusCode: 404 });
  return id;
}

