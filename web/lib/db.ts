import { z } from "zod";
import { pool } from "./pool";
import type { PoolClient } from "pg";

/**
 * DB contract + helpers (INTERNAL).
 *
 * This module is allowed to use internal DB keys (`id`, `org_id`, `user_id`, etc.) because it speaks directly to Postgres.
 *
 * IMPORTANT:
 * - External surfaces (API routes, server actions, UI routing) must use UUID `public_id` only.
 * - Resolve public UUIDs at the boundary using `resolvePublicId()` / `resolvePublicTextId()`, then call these helpers with internal ids.
 *
 * See `docs/ID_POLICY.md`.
 */

// -----------------------------
// Zod helpers (inputs)
// -----------------------------

// Internal DB key validators (do NOT use these for API input validation).
export const zOrganizationId = z.coerce.number().int().positive();
export const zOpportunityId = z.coerce.number().int().positive();
// mapping_set_id is BIGINT; we accept number-like strings to avoid JS bigint pitfalls.
export const zMappingSetId = z.union([z.coerce.number().int().positive(), z.string().regex(/^\d+$/)]).transform(String);

export const zJsonObject = z.record(z.string(), z.unknown());

// -----------------------------
// Contract types (best-effort)
// -----------------------------

export type RepRow = {
  id: number;
  public_id: string;
  rep_name: string;
  display_name: string | null;
  crm_owner_id: string | null;
  crm_owner_name: string | null;
  user_id: number | null;
  user_public_id?: string | null;
  manager_rep_id: number | null;
  manager_rep_public_id?: string | null;
  role: string | null;
  active: boolean | null;
  organization_id: number;
};

export type OpportunityRow = {
  id: number;
  public_id: string;
  org_id: number;
  rep_id: number | null;
  rep_name: string | null;
  account_name: string | null;
  opportunity_name: string | null;
  crm_opp_id: string | null;
  product: string | null;
  amount: number | null;
  create_date_raw: string | null;
  create_date: string | null;
  close_date: string | null;
  updated_at: string | null;
};

export type OpportunityAuditEventRow = {
  id: number;
  public_id: string;
  org_id: number;
  opportunity_id: number;
  actor_rep_id: number | null;
  event_type: string;
  schema_version: number | null;
  prompt_version: string | null;
  logic_version: string | null;
  delta: unknown;
  definitions: unknown;
  meta: unknown;
  ts: string;
};

export type FieldMappingSetRow = {
  id: string; // BIGINT as text
  public_id: string;
  organization_id: number;
  name: string;
  source_system: string | null;
};

export type FieldMappingRow = {
  id: string; // BIGINT as text
  public_id: string;
  mapping_set_id: string; // BIGINT as text
  source_field: string;
  target_field: string;
};

export type IngestionStagingRow = {
  id: string; // BIGINT as text (safe)
  public_id: string;
  organization_id: number;
  mapping_set_id: string; // BIGINT as text
  raw_row: unknown;
  normalized_row: unknown;
  status: string | null;
  error_message: string | null;
};

export type IngestionBatchSummaryRow = {
  organization_id: number;
  mapping_set_public_id: string;
  total: number;
  pending: number;
  processed: number;
  error: number;
  last_public_id: string | null;
};

// -----------------------------
// Query helpers
// -----------------------------

async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

// -----------------------------
// Contract reads
// -----------------------------

export async function listReps(args: { organizationId: number; activeOnly?: boolean }) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const activeOnly = args.activeOnly ?? true;

  const { rows } = await pool.query(
    `
    SELECT
      r.id,
      r.public_id::text AS public_id,
      r.rep_name,
      r.display_name,
      r.crm_owner_id,
      r.crm_owner_name,
      r.user_id,
      u.public_id::text AS user_public_id,
      r.manager_rep_id,
      mgr.public_id::text AS manager_rep_public_id,
      r.role,
      r.active,
      r.organization_id
    FROM reps r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN reps mgr ON mgr.id = r.manager_rep_id
    WHERE r.organization_id = $1
      AND ($2::bool IS FALSE OR r.active IS TRUE)
    ORDER BY r.rep_name ASC, r.id ASC
    `,
    [organizationId, activeOnly]
  );

  return rows as RepRow[];
}

export async function getRep(args: { organizationId: number; repId: number }) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const repId = z.coerce.number().int().positive().parse(args.repId);
  const { rows } = await pool.query(
    `
    SELECT
      r.id,
      r.public_id::text AS public_id,
      r.rep_name,
      r.display_name,
      r.crm_owner_id,
      r.crm_owner_name,
      r.user_id,
      u.public_id::text AS user_public_id,
      r.manager_rep_id,
      mgr.public_id::text AS manager_rep_public_id,
      r.role,
      r.active,
      r.organization_id
    FROM reps r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN reps mgr ON mgr.id = r.manager_rep_id
    WHERE r.organization_id = $1
      AND r.id = $2
    LIMIT 1
    `,
    [organizationId, repId]
  );
  return (rows?.[0] as RepRow | undefined) || null;
}

export async function searchOpportunities(args: {
  orgId: number;
  q: string;
  repId?: number;
  repName?: string;
  limit?: number;
}) {
  const orgId = zOrganizationId.parse(args.orgId);
  const q = String(args.q || "").trim();
  const repId = args.repId == null ? null : z.coerce.number().int().positive().parse(args.repId);
  const repName = String(args.repName || "").trim() || null;
  const limit = Math.max(1, Math.min(100, Number(args.limit ?? 25) || 25));

  if (!q) return [] as OpportunityRow[];

  const like = `%${q}%`;
  const where: string[] = ["org_id = $1", "(account_name ILIKE $2 OR opportunity_name ILIKE $2)"];
  const params: any[] = [orgId, like];
  let idx = params.length;

  if (repId != null) {
    where.push(`rep_id = $${++idx}`);
    params.push(repId);
  } else if (repName) {
    where.push(`rep_name = $${++idx}`);
    params.push(repName);
  }

  params.push(limit);
  const limIdx = ++idx;

  const { rows } = await pool.query(
    `
    SELECT
      id,
      public_id::text AS public_id,
      org_id,
      rep_id,
      rep_name,
      account_name,
      opportunity_name,
      crm_opp_id,
      product,
      amount,
      create_date_raw,
      create_date,
      close_date,
      updated_at
    FROM opportunities
    WHERE ${where.join(" AND ")}
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT $${limIdx}
    `,
    params
  );

  return rows as OpportunityRow[];
}

export async function getOpportunity(args: { orgId: number; opportunityId: number }) {
  const orgId = zOrganizationId.parse(args.orgId);
  const opportunityId = zOpportunityId.parse(args.opportunityId);

  const { rows } = await pool.query(
    `
    SELECT
      id,
      public_id::text AS public_id,
      org_id,
      rep_id,
      rep_name,
      account_name,
      opportunity_name,
      crm_opp_id,
      product,
      amount,
      create_date_raw,
      create_date,
      close_date,
      updated_at
    FROM opportunities
    WHERE org_id = $1
      AND id = $2
    LIMIT 1
    `,
    [orgId, opportunityId]
  );
  return (rows?.[0] as OpportunityRow | undefined) || null;
}

export async function listOpportunityAuditEvents(args: { orgId: number; opportunityId: number; limit?: number }) {
  const orgId = zOrganizationId.parse(args.orgId);
  const opportunityId = zOpportunityId.parse(args.opportunityId);
  const limit = Math.max(1, Math.min(200, Number(args.limit ?? 50) || 50));

  const { rows } = await pool.query(
    `
    SELECT
      id,
      public_id::text AS public_id,
      org_id,
      opportunity_id,
      actor_rep_id,
      event_type,
      schema_version,
      prompt_version,
      logic_version,
      delta,
      definitions,
      meta,
      ts
    FROM opportunity_audit_events
    WHERE org_id = $1
      AND opportunity_id = $2
    ORDER BY ts DESC, id DESC
    LIMIT $3
    `,
    [orgId, opportunityId, limit]
  );
  return rows as OpportunityAuditEventRow[];
}

export async function listFieldMappingSets(args: { organizationId: number }) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const { rows } = await pool.query(
    `
    SELECT
      id::text AS id,
      public_id::text AS public_id,
      organization_id,
      name,
      source_system
    FROM field_mapping_sets
    WHERE organization_id = $1
    ORDER BY id DESC
    `,
    [organizationId]
  );
  return rows as FieldMappingSetRow[];
}

export async function getFieldMappingSet(args: { organizationId: number; mappingSetId: string }) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const mappingSetId = zMappingSetId.parse(args.mappingSetId);
  const { rows } = await pool.query(
    `
    SELECT
      id::text AS id,
      public_id::text AS public_id,
      organization_id,
      name,
      source_system
    FROM field_mapping_sets
    WHERE organization_id = $1
      AND id = $2::bigint
    LIMIT 1
    `,
    [organizationId, mappingSetId]
  );
  return (rows?.[0] as FieldMappingSetRow | undefined) || null;
}

export async function listFieldMappings(args: { mappingSetId: string }) {
  const mappingSetId = zMappingSetId.parse(args.mappingSetId);
  const { rows } = await pool.query(
    `
    SELECT
      id::text AS id,
      public_id::text AS public_id,
      mapping_set_id::text AS mapping_set_id,
      source_field,
      target_field
    FROM field_mappings
    WHERE mapping_set_id = $1::bigint
    ORDER BY id ASC
    `,
    [mappingSetId]
  );
  return rows as FieldMappingRow[];
}

export async function replaceFieldMappings(args: {
  mappingSetId: string;
  mappings: Array<{ source_field: string; target_field: string }>;
}) {
  const mappingSetId = zMappingSetId.parse(args.mappingSetId);
  const mappings = Array.isArray(args.mappings) ? args.mappings : [];

  // Normalize and de-dupe by target_field (last one wins).
  const byTarget = new Map<string, { source_field: string; target_field: string }>();
  for (const m of mappings) {
    // IMPORTANT: keep source_field EXACT (Excel headers may include whitespace).
    const rawSource = String(m?.source_field ?? "");
    const source_field = rawSource;
    const target_field = String(m?.target_field || "").trim();
    if (!rawSource.trim() || !target_field) continue;
    byTarget.set(target_field, { source_field, target_field });
  }
  const uniq = Array.from(byTarget.values());

  return await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`DELETE FROM field_mappings WHERE mapping_set_id = $1::bigint`, [mappingSetId]);
      if (uniq.length) {
        const values: any[] = [];
        const rowsSql: string[] = [];
        let p = 0;
        for (const m of uniq) {
          values.push(mappingSetId, m.source_field, m.target_field);
          rowsSql.push(`($${p + 1}::bigint, $${p + 2}, $${p + 3})`);
          p += 3;
        }
        await c.query(`INSERT INTO field_mappings (mapping_set_id, source_field, target_field) VALUES ${rowsSql.join(", ")}`, values);
      }
      await c.query("COMMIT");
      return { ok: true, count: uniq.length };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });
}

export async function listIngestionStaging(args: {
  organizationId: number;
  mappingSetId?: string;
  limit?: number;
}) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const mappingSetId = args.mappingSetId ? zMappingSetId.parse(args.mappingSetId) : null;
  const limit = Math.max(1, Math.min(200, Number(args.limit ?? 50) || 50));

  if (mappingSetId) {
    const { rows } = await pool.query(
      `
      SELECT
        id::text AS id,
        public_id::text AS public_id,
        organization_id,
        mapping_set_id::text AS mapping_set_id,
        raw_row,
        normalized_row,
        status,
        error_message
      FROM ingestion_staging
      WHERE organization_id = $1
        AND mapping_set_id = $2::bigint
      ORDER BY id DESC
      LIMIT $3
      `,
      [organizationId, mappingSetId, limit]
    );
    return rows as IngestionStagingRow[];
  }

  const { rows } = await pool.query(
    `
    SELECT
      id::text AS id,
      public_id::text AS public_id,
      organization_id,
      mapping_set_id::text AS mapping_set_id,
      raw_row,
      normalized_row,
      status,
      error_message
    FROM ingestion_staging
    WHERE organization_id = $1
    ORDER BY id DESC
    LIMIT $2
    `,
    [organizationId, limit]
  );
  return rows as IngestionStagingRow[];
}

export async function listIngestionStagingByFilter(args: {
  organizationId: number;
  mappingSetId: string;
  filter: "all" | "pending" | "processed" | "error";
  limit?: number;
}) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const mappingSetId = zMappingSetId.parse(args.mappingSetId);
  const limit = Math.max(1, Math.min(500, Number(args.limit ?? 100) || 100));

  const where: string[] = ["organization_id = $1", "mapping_set_id = $2::bigint"];
  const params: any[] = [organizationId, mappingSetId];

  // NOTE: We do not assume any particular status enum values.
  // We infer "error/pending/processed" from presence of normalized_row and error_message.
  if (args.filter === "error") where.push("error_message IS NOT NULL");
  if (args.filter === "pending") where.push("normalized_row IS NULL AND error_message IS NULL");
  if (args.filter === "processed") where.push("normalized_row IS NOT NULL AND error_message IS NULL");

  params.push(limit);

  const { rows } = await pool.query(
    `
    SELECT
      id::text AS id,
      public_id::text AS public_id,
      organization_id,
      mapping_set_id::text AS mapping_set_id,
      raw_row,
      normalized_row,
      status,
      error_message
    FROM ingestion_staging
    WHERE ${where.join(" AND ")}
    ORDER BY id DESC
    LIMIT $3
    `,
    params
  );
  return rows as IngestionStagingRow[];
}

export async function listIngestionBatchSummaries(args: { organizationId: number }) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const { rows } = await pool.query(
    `
    WITH agg AS (
      SELECT
        organization_id,
        mapping_set_id,
        COUNT(*)::int AS total,
        SUM(CASE WHEN normalized_row IS NULL AND error_message IS NULL THEN 1 ELSE 0 END)::int AS pending,
        SUM(CASE WHEN normalized_row IS NOT NULL AND error_message IS NULL THEN 1 ELSE 0 END)::int AS processed,
        SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END)::int AS error,
        MAX(id) AS last_id
      FROM ingestion_staging
      WHERE organization_id = $1
      GROUP BY organization_id, mapping_set_id
    )
    SELECT
      a.organization_id,
      fms.public_id::text AS mapping_set_public_id,
      a.total,
      a.pending,
      a.processed,
      a.error,
      last_row.public_id::text AS last_public_id
    FROM agg a
    JOIN field_mapping_sets fms ON fms.id = a.mapping_set_id
    LEFT JOIN ingestion_staging last_row ON last_row.id = a.last_id
    ORDER BY a.last_id DESC NULLS LAST
    `,
    [organizationId]
  );
  return rows as IngestionBatchSummaryRow[];
}

// -----------------------------
// Contract writes (CRUD + ingestion pipeline)
// -----------------------------

export async function createRep(args: {
  organizationId: number;
  rep_name: string;
  display_name?: string | null;
  crm_owner_id?: string | null;
  crm_owner_name?: string | null;
  user_id?: number | null;
  manager_rep_id?: number | null;
  role?: string | null;
  active?: boolean | null;
}) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const rep_name = String(args.rep_name || "").trim();
  if (!rep_name) throw new Error("rep_name is required");

  const { rows } = await pool.query(
    `
    INSERT INTO reps
      (rep_name, display_name, crm_owner_id, crm_owner_name, user_id, manager_rep_id, role, active, organization_id)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING
      id,
      public_id::text AS public_id,
      rep_name,
      display_name,
      crm_owner_id,
      crm_owner_name,
      user_id,
      manager_rep_id,
      role,
      active,
      organization_id
    `,
    [
      rep_name,
      args.display_name ?? null,
      args.crm_owner_id ?? null,
      args.crm_owner_name ?? null,
      args.user_id ?? null,
      args.manager_rep_id ?? null,
      args.role ?? null,
      args.active ?? true,
      organizationId,
    ]
  );
  return rows[0] as RepRow;
}

export async function updateRep(args: {
  organizationId: number;
  repId: number;
  rep_name: string;
  display_name?: string | null;
  crm_owner_id?: string | null;
  crm_owner_name?: string | null;
  user_id?: number | null;
  manager_rep_id?: number | null;
  role?: string | null;
  active?: boolean | null;
}) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const repId = z.coerce.number().int().positive().parse(args.repId);
  const rep_name = String(args.rep_name || "").trim();
  if (!rep_name) throw new Error("rep_name is required");

  const { rows } = await pool.query(
    `
    UPDATE reps
       SET rep_name = $3,
           display_name = $4,
           crm_owner_id = $5,
           crm_owner_name = $6,
           user_id = $7,
           manager_rep_id = $8,
           role = $9,
           active = $10
     WHERE organization_id = $1
       AND id = $2
    RETURNING
      id,
      public_id::text AS public_id,
      rep_name,
      display_name,
      crm_owner_id,
      crm_owner_name,
      user_id,
      manager_rep_id,
      role,
      active,
      organization_id
    `,
    [
      organizationId,
      repId,
      rep_name,
      args.display_name ?? null,
      args.crm_owner_id ?? null,
      args.crm_owner_name ?? null,
      args.user_id ?? null,
      args.manager_rep_id ?? null,
      args.role ?? null,
      args.active ?? true,
    ]
  );
  return (rows?.[0] as RepRow | undefined) || null;
}

export async function deleteRep(args: { organizationId: number; repId: number }) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const repId = z.coerce.number().int().positive().parse(args.repId);
  await pool.query(`DELETE FROM reps WHERE organization_id = $1 AND id = $2`, [organizationId, repId]);
  return { ok: true };
}

export async function createFieldMappingSet(args: {
  organizationId: number;
  name: string;
  source_system?: string | null;
}) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const name = String(args.name || "").trim();
  if (!name) throw new Error("name is required");
  const { rows } = await pool.query(
    `
    INSERT INTO field_mapping_sets (organization_id, name, source_system)
    VALUES ($1, $2, $3)
    RETURNING id::text AS id, public_id::text AS public_id, organization_id, name, source_system
    `,
    [organizationId, name, args.source_system ?? null]
  );
  return rows[0] as FieldMappingSetRow;
}

export async function updateFieldMappingSet(args: {
  organizationId: number;
  mappingSetId: string;
  name: string;
  source_system?: string | null;
}) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const mappingSetId = zMappingSetId.parse(args.mappingSetId);
  const name = String(args.name || "").trim();
  if (!name) throw new Error("name is required");

  const { rows } = await pool.query(
    `
    UPDATE field_mapping_sets
       SET name = $3,
           source_system = $4
     WHERE organization_id = $1
       AND id = $2::bigint
    RETURNING id::text AS id, public_id::text AS public_id, organization_id, name, source_system
    `,
    [organizationId, mappingSetId, name, args.source_system ?? null]
  );
  return (rows?.[0] as FieldMappingSetRow | undefined) || null;
}

export async function deleteFieldMappingSet(args: { organizationId: number; mappingSetId: string }) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const mappingSetId = zMappingSetId.parse(args.mappingSetId);
  await pool.query(`DELETE FROM field_mapping_sets WHERE organization_id = $1 AND id = $2::bigint`, [
    organizationId,
    mappingSetId,
  ]);
  return { ok: true };
}

export async function createFieldMapping(args: { mappingSetId: string; source_field: string; target_field: string }) {
  const mappingSetId = zMappingSetId.parse(args.mappingSetId);
  // IMPORTANT: keep source_field EXACT (Excel headers may include whitespace).
  const source_field = String(args.source_field ?? "");
  const target_field = String(args.target_field || "").trim();
  if (!source_field.trim()) throw new Error("source_field is required");
  if (!target_field) throw new Error("target_field is required");

  const { rows } = await pool.query(
    `
    INSERT INTO field_mappings (mapping_set_id, source_field, target_field)
    VALUES ($1::bigint, $2, $3)
    RETURNING id::text AS id, public_id::text AS public_id, mapping_set_id::text AS mapping_set_id, source_field, target_field
    `,
    [mappingSetId, source_field, target_field]
  );
  return rows[0] as FieldMappingRow;
}

export async function updateFieldMapping(args: {
  mappingId: string;
  mappingSetId: string;
  source_field: string;
  target_field: string;
}) {
  const mappingId = zMappingSetId.parse(args.mappingId);
  const mappingSetId = zMappingSetId.parse(args.mappingSetId);
  // IMPORTANT: keep source_field EXACT (Excel headers may include whitespace).
  const source_field = String(args.source_field ?? "");
  const target_field = String(args.target_field || "").trim();
  if (!source_field.trim()) throw new Error("source_field is required");
  if (!target_field) throw new Error("target_field is required");

  const { rows } = await pool.query(
    `
    UPDATE field_mappings
       SET source_field = $3,
           target_field = $4
     WHERE id = $1::bigint
       AND mapping_set_id = $2::bigint
    RETURNING id::text AS id, public_id::text AS public_id, mapping_set_id::text AS mapping_set_id, source_field, target_field
    `,
    [mappingId, mappingSetId, source_field, target_field]
  );
  return (rows?.[0] as FieldMappingRow | undefined) || null;
}

export async function deleteFieldMapping(args: { mappingId: string; mappingSetId: string }) {
  const mappingId = zMappingSetId.parse(args.mappingId);
  const mappingSetId = zMappingSetId.parse(args.mappingSetId);
  await pool.query(`DELETE FROM field_mappings WHERE id = $1::bigint AND mapping_set_id = $2::bigint`, [
    mappingId,
    mappingSetId,
  ]);
  return { ok: true };
}

export async function stageIngestionRows(args: { organizationId: number; mappingSetId: string; rawRows: unknown[] }) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const mappingSetId = zMappingSetId.parse(args.mappingSetId);
  const rawRows = Array.isArray(args.rawRows) ? args.rawRows : [];
  if (!rawRows.length) return { inserted: 0 };

  // Insert only contract columns; allow DB defaults for status/error fields.
  return await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      let inserted = 0;
      // Chunk inserts to keep statement size reasonable.
      const chunkSize = 250;
      for (let i = 0; i < rawRows.length; i += chunkSize) {
        const chunk = rawRows.slice(i, i + chunkSize);
        const values: any[] = [];
        const rowsSql: string[] = [];
        let p = 0;
        for (const r of chunk) {
          values.push(organizationId, mappingSetId, JSON.stringify(r ?? {}));
          rowsSql.push(`($${p + 1}, $${p + 2}::bigint, $${p + 3}::jsonb)`);
          p += 3;
        }
        await c.query(
          `
          INSERT INTO ingestion_staging (organization_id, mapping_set_id, raw_row)
          VALUES ${rowsSql.join(", ")}
          `,
          values
        );
        inserted += chunk.length;
      }
      await c.query("COMMIT");
      return { inserted };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });
}

export async function processIngestionBatch(args: { organizationId: number; mappingSetId: string }) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const mappingSetId = zMappingSetId.parse(args.mappingSetId);
  // Always call the public schema function to avoid accidentally hitting a legacy overload
  // in a different schema on the DB search_path.
  const { rows } = await pool.query<{ result: any }>(`SELECT public.process_ingestion_batch($1::int, $2::bigint) AS result`, [
    organizationId,
    mappingSetId,
  ]);

  const raw = rows?.[0]?.result;
  const parsed =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  const SummarySchema = z.object({
    ok: z.boolean(),
    processed: z.coerce.number().int().nonnegative().default(0),
    error: z.coerce.number().int().nonnegative().default(0),
  });

  const s = SummarySchema.safeParse(parsed);
  if (!s.success) return { ok: true, processed: 0, error: 0, changed: 0 };

  return { ok: s.data.ok, processed: s.data.processed, error: s.data.error, changed: s.data.processed };
}

export async function retryFailedStagingRows(args: {
  organizationId: number;
  mappingSetId: string;
  stagingIds?: string[];
}) {
  const organizationId = zOrganizationId.parse(args.organizationId);
  const mappingSetId = zMappingSetId.parse(args.mappingSetId);
  const ids = Array.isArray(args.stagingIds) ? args.stagingIds.map(String).filter(Boolean) : [];

  // We retry by re-staging raw_row into *new* ingestion_staging rows.
  // This avoids guessing/overwriting status values.
  if (ids.length) {
    const placeholders = ids.map((_, i) => `$${i + 3}::bigint`).join(", ");
    const result = await pool.query(
      `
      INSERT INTO ingestion_staging (organization_id, mapping_set_id, raw_row)
      SELECT organization_id, mapping_set_id, raw_row
        FROM ingestion_staging
       WHERE organization_id = $1
         AND mapping_set_id = $2::bigint
         AND id IN (${placeholders})
         AND error_message IS NOT NULL
      `,
      [organizationId, mappingSetId, ...ids]
    );
    return { ok: true, retried: result.rowCount || 0 };
  }

  // Bulk retry for this mapping set (all failed rows with error_message).
  const result = await pool.query(
    `
    INSERT INTO ingestion_staging (organization_id, mapping_set_id, raw_row)
    SELECT organization_id, mapping_set_id, raw_row
      FROM ingestion_staging
     WHERE organization_id = $1
       AND mapping_set_id = $2::bigint
       AND error_message IS NOT NULL
    `,
    [organizationId, mappingSetId]
  );
  return { ok: true, retried: result.rowCount || 0 };
}

// -----------------------------
// Organizations + users + auth
// -----------------------------

export const zUserId = z.coerce.number().int().positive();
export const zUserRole = z.enum(["ADMIN", "EXEC_MANAGER", "MANAGER", "REP"]);

export type OrganizationRow = {
  id: number;
  public_id: string;
  name: string;
  active: boolean;
  parent_org_id: number | null;
  billing_plan: string | null;
  hq_address_line1: string | null;
  hq_address_line2: string | null;
  hq_city: string | null;
  hq_state: string | null;
  hq_postal_code: string | null;
  hq_country: string | null;
  created_at: string;
  updated_at: string;
};

export type UserRow = {
  id: number;
  public_id: string;
  org_id: number;
  email: string;
  password_hash: string;
  role: "ADMIN" | "EXEC_MANAGER" | "MANAGER" | "REP";
  hierarchy_level: number;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  account_owner_name: string | null;
  manager_user_id: number | null;
  admin_has_full_analytics_access: boolean;
  see_all_visibility: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type UserPublicRow = Omit<UserRow, "password_hash">;

export type UserSessionRow = {
  id: string; // bigint as text
  user_id: number;
  session_token_hash: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

export type PasswordResetTokenRow = {
  id: string; // bigint as text
  user_id: number;
  token_hash: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

export type EmailTemplateRow = {
  id: string; // bigint as text
  template_key: string;
  subject: string;
  body: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type HierarchyLevelRow = {
  level: number;
  label: string;
  description: string;
};

export type UserWithOrgRow = UserPublicRow & {
  org_public_id: string;
  org_name: string;
  org_active: boolean;
};

export async function listHierarchyLevels() {
  const { rows } = await pool.query(
    `
    SELECT level, label, description
      FROM hierarchy_levels
     ORDER BY level ASC
    `
  );
  return rows as HierarchyLevelRow[];
}

export async function listOrganizations(args?: { activeOnly?: boolean }) {
  const activeOnly = args?.activeOnly ?? false;
  const { rows } = await pool.query(
    `
    SELECT
      id,
      public_id::text AS public_id,
      name,
      active,
      parent_org_id,
      billing_plan,
      hq_address_line1,
      hq_address_line2,
      hq_city,
      hq_state,
      hq_postal_code,
      hq_country,
      created_at,
      updated_at
      FROM organizations
     WHERE ($1::bool IS FALSE OR active IS TRUE)
     ORDER BY id ASC
    `,
    [activeOnly]
  );
  return rows as OrganizationRow[];
}

export async function listAllUsersAcrossOrgs(args?: { includeInactive?: boolean; includeSuspendedOrgs?: boolean }) {
  const includeInactive = args?.includeInactive ?? true;
  const includeSuspendedOrgs = args?.includeSuspendedOrgs ?? true;
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.public_id::text AS public_id,
      u.org_id,
      u.email,
      u.role,
      u.hierarchy_level,
      u.first_name,
      u.last_name,
      u.display_name,
      u.account_owner_name,
      u.manager_user_id,
      u.admin_has_full_analytics_access,
      u.see_all_visibility,
      u.active,
      u.created_at,
      u.updated_at,
      o.public_id::text AS org_public_id,
      o.name AS org_name,
      o.active AS org_active
    FROM users u
    JOIN organizations o ON o.id = u.org_id
    WHERE ($1::bool IS TRUE OR u.active IS TRUE)
      AND ($2::bool IS TRUE OR o.active IS TRUE)
    ORDER BY o.id ASC, u.role ASC, u.hierarchy_level DESC, u.display_name ASC, u.id ASC
    `,
    [includeInactive, includeSuspendedOrgs]
  );
  return rows as UserWithOrgRow[];
}

export async function getOrganization(args: { id: number }) {
  const id = zOrganizationId.parse(args.id);
  const { rows } = await pool.query(
    `
    SELECT
      id,
      public_id::text AS public_id,
      name,
      active,
      parent_org_id,
      billing_plan,
      hq_address_line1,
      hq_address_line2,
      hq_city,
      hq_state,
      hq_postal_code,
      hq_country,
      created_at,
      updated_at
    FROM organizations
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );
  return (rows?.[0] as OrganizationRow | undefined) || null;
}

export async function createOrganization(args: {
  name: string;
  active?: boolean;
  parent_org_id?: number | null;
  billing_plan?: string | null;
  hq_address_line1?: string | null;
  hq_address_line2?: string | null;
  hq_city?: string | null;
  hq_state?: string | null;
  hq_postal_code?: string | null;
  hq_country?: string | null;
}) {
  const name = String(args.name || "").trim();
  if (!name) throw new Error("name is required");
  const parent_org_id = args.parent_org_id == null || args.parent_org_id === ("" as any) ? null : zOrganizationId.parse(args.parent_org_id);
  const { rows } = await pool.query(
    `
    INSERT INTO organizations (
      name,
      active,
      parent_org_id,
      billing_plan,
      hq_address_line1,
      hq_address_line2,
      hq_city,
      hq_state,
      hq_postal_code,
      hq_country,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
    RETURNING
      id,
      public_id::text AS public_id,
      name,
      active,
      parent_org_id,
      billing_plan,
      hq_address_line1,
      hq_address_line2,
      hq_city,
      hq_state,
      hq_postal_code,
      hq_country,
      created_at,
      updated_at
    `,
    [
      name,
      args.active ?? true,
      parent_org_id,
      args.billing_plan ?? null,
      args.hq_address_line1 ?? null,
      args.hq_address_line2 ?? null,
      args.hq_city ?? null,
      args.hq_state ?? null,
      args.hq_postal_code ?? null,
      args.hq_country ?? null,
    ]
  );
  return rows[0] as OrganizationRow;
}

export async function createOrganizationWithFirstAdmin(args: {
  organization: {
    name: string;
    active?: boolean;
    parent_org_id?: number | null;
    billing_plan?: string | null;
    hq_address_line1?: string | null;
    hq_address_line2?: string | null;
    hq_city?: string | null;
    hq_state?: string | null;
    hq_postal_code?: string | null;
    hq_country?: string | null;
  };
  admin: {
    email: string;
    password_hash: string;
    first_name?: string | null;
    last_name?: string | null;
    display_name: string;
    account_owner_name?: string | null;
    admin_has_full_analytics_access?: boolean;
    active?: boolean;
  };
  inviteReset?: { token_hash: string; expires_at: Date } | null;
}) {
  const orgName = String(args.organization?.name || "").trim();
  if (!orgName) throw new Error("organization.name is required");

  const email = String(args.admin?.email || "")
    .trim()
    .toLowerCase();
  if (!email) throw new Error("admin.email is required");

  const password_hash = String(args.admin?.password_hash || "").trim();
  if (!password_hash) throw new Error("admin.password_hash is required");

  const display_name = String(args.admin?.display_name || "").trim();
  const account_owner_name = String(args.admin?.account_owner_name || "").trim() || null;
  if (!display_name) throw new Error("admin.display_name is required");

  const parent_org_id =
    args.organization?.parent_org_id == null || args.organization.parent_org_id === ("" as any)
      ? null
      : zOrganizationId.parse(args.organization.parent_org_id);

  return await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      const orgRes = await c.query(
        `
        INSERT INTO organizations (
          name,
          active,
          parent_org_id,
          billing_plan,
          hq_address_line1,
          hq_address_line2,
          hq_city,
          hq_state,
          hq_postal_code,
          hq_country,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        RETURNING
          id,
          public_id::text AS public_id,
          name,
          active,
          parent_org_id,
          billing_plan,
          hq_address_line1,
          hq_address_line2,
          hq_city,
          hq_state,
          hq_postal_code,
          hq_country,
          created_at,
          updated_at
        `,
        [
          orgName,
          args.organization?.active ?? true,
          parent_org_id,
          args.organization?.billing_plan ?? null,
          args.organization?.hq_address_line1 ?? null,
          args.organization?.hq_address_line2 ?? null,
          args.organization?.hq_city ?? null,
          args.organization?.hq_state ?? null,
          args.organization?.hq_postal_code ?? null,
          args.organization?.hq_country ?? null,
        ]
      );
      const org = orgRes.rows[0] as OrganizationRow;

      const userRes = await c.query(
        `
        INSERT INTO users
          (
            org_id,
            email,
            password_hash,
            role,
            hierarchy_level,
            first_name,
            last_name,
            display_name,
            account_owner_name,
            manager_user_id,
            admin_has_full_analytics_access,
            active,
            created_at,
            updated_at
          )
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
        RETURNING
          id,
          public_id::text AS public_id,
          org_id,
          email,
          password_hash,
          role,
          hierarchy_level,
          first_name,
          last_name,
          display_name,
          account_owner_name,
          manager_user_id,
          admin_has_full_analytics_access,
          see_all_visibility,
          active,
          created_at,
          updated_at
        `,
        [
          org.id,
          email,
          password_hash,
          "ADMIN",
          0,
          args.admin?.first_name ?? null,
          args.admin?.last_name ?? null,
          display_name,
          account_owner_name,
          null,
          !!args.admin?.admin_has_full_analytics_access,
          args.admin?.active ?? true,
        ]
      );
      const user = userRes.rows[0] as UserRow;

      if (args.inviteReset?.token_hash) {
        const token_hash = String(args.inviteReset.token_hash || "").trim();
        if (!token_hash) throw new Error("inviteReset.token_hash is required");
        await c.query(
          `
          INSERT INTO password_reset_tokens (user_id, token_hash, created_at, expires_at, used_at)
          VALUES ($1, $2, NOW(), $3, NULL)
          `,
          [user.id, token_hash, args.inviteReset.expires_at.toISOString()]
        );
      }

      await c.query("COMMIT");
      return { org, user };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });
}

export async function updateOrganization(args: {
  id: number;
  name: string;
  active: boolean;
  parent_org_id?: number | null;
  billing_plan?: string | null;
  hq_address_line1?: string | null;
  hq_address_line2?: string | null;
  hq_city?: string | null;
  hq_state?: string | null;
  hq_postal_code?: string | null;
  hq_country?: string | null;
}) {
  const id = zOrganizationId.parse(args.id);
  const name = String(args.name || "").trim();
  if (!name) throw new Error("name is required");
  const parent_org_id = args.parent_org_id == null || args.parent_org_id === ("" as any) ? null : zOrganizationId.parse(args.parent_org_id);
  const { rows } = await pool.query(
    `
    UPDATE organizations
       SET name = $2,
           active = $3,
           parent_org_id = COALESCE($4, parent_org_id),
           billing_plan = COALESCE($5, billing_plan),
           hq_address_line1 = COALESCE($6, hq_address_line1),
           hq_address_line2 = COALESCE($7, hq_address_line2),
           hq_city = COALESCE($8, hq_city),
           hq_state = COALESCE($9, hq_state),
           hq_postal_code = COALESCE($10, hq_postal_code),
           hq_country = COALESCE($11, hq_country),
           updated_at = NOW()
     WHERE id = $1
    RETURNING
      id,
      public_id::text AS public_id,
      name,
      active,
      parent_org_id,
      billing_plan,
      hq_address_line1,
      hq_address_line2,
      hq_city,
      hq_state,
      hq_postal_code,
      hq_country,
      created_at,
      updated_at
    `,
    [
      id,
      name,
      !!args.active,
      parent_org_id,
      args.billing_plan ?? null,
      args.hq_address_line1 ?? null,
      args.hq_address_line2 ?? null,
      args.hq_city ?? null,
      args.hq_state ?? null,
      args.hq_postal_code ?? null,
      args.hq_country ?? null,
    ]
  );
  return (rows?.[0] as OrganizationRow | undefined) || null;
}

export async function deleteOrganization(args: { id: number }) {
  const id = zOrganizationId.parse(args.id);
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [id]);
  return { ok: true };
}

export async function listUsers(args: { orgId: number; includeInactive?: boolean }) {
  const orgId = zOrganizationId.parse(args.orgId);
  const includeInactive = args.includeInactive ?? true;
  const { rows } = await pool.query(
    `
    SELECT
      id,
      public_id::text AS public_id,
      org_id,
      email,
      role,
      hierarchy_level,
      first_name,
      last_name,
      display_name,
      account_owner_name,
      manager_user_id,
      admin_has_full_analytics_access,
      see_all_visibility,
      active,
      created_at,
      updated_at
    FROM users
    WHERE org_id = $1
      AND ($2::bool IS TRUE OR active IS TRUE)
    ORDER BY role ASC, display_name ASC, id ASC
    `,
    [orgId, includeInactive]
  );
  return rows as UserPublicRow[];
}

export async function listOrganizationDescendantIds(args: { orgId: number }) {
  const orgId = zOrganizationId.parse(args.orgId);
  const { rows } = await pool.query(
    `
    WITH RECURSIVE org_tree AS (
      SELECT id
        FROM organizations
       WHERE id = $1
      UNION ALL
      SELECT o.id
        FROM organizations o
        JOIN org_tree t ON o.parent_org_id = t.id
    )
    SELECT id FROM org_tree ORDER BY id ASC
    `,
    [orgId]
  );
  return (rows || []).map((r: any) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
}

export async function getVisibleUsers(args: {
  currentUserId: number;
  orgId: number;
  role: "ADMIN" | "EXEC_MANAGER" | "MANAGER" | "REP";
  hierarchy_level?: number;
  see_all_visibility?: boolean;
}) {
  const currentUserId = zUserId.parse(args.currentUserId);
  const orgId = zOrganizationId.parse(args.orgId);
  const role = zUserRole.parse(args.role);
  const hierarchy_level = Number.isFinite(Number(args.hierarchy_level)) ? Number(args.hierarchy_level) : null;
  const seeAll = !!args.see_all_visibility;

  // REP: only themselves.
  if (role === "REP") {
    const u = await getUserById({ orgId, userId: currentUserId }).catch(() => null);
    return u ? ([u] as UserPublicRow[]) : ([] as UserPublicRow[]);
  }

  // ADMIN: always sees all (in-org).
  if (role === "ADMIN") {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        public_id::text AS public_id,
        org_id,
        email,
        role,
        hierarchy_level,
        first_name,
        last_name,
        display_name,
        account_owner_name,
        manager_user_id,
        admin_has_full_analytics_access,
        see_all_visibility,
        active,
        created_at,
        updated_at
      FROM users
      WHERE org_id = $1
        AND active IS TRUE
      ORDER BY hierarchy_level ASC, role ASC, display_name ASC, id ASC
      `,
      [orgId]
    );
    return rows as UserPublicRow[];
  }

  // EXEC_MANAGER / MANAGER:
  // - If see_all_visibility=true, see all users at same or lower hierarchy (downward visibility).
  // - Else, use explicit edges in manager_visibility (recursive).
  if (seeAll && hierarchy_level != null) {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        public_id::text AS public_id,
        org_id,
        email,
        role,
        hierarchy_level,
        first_name,
        last_name,
        display_name,
        account_owner_name,
        manager_user_id,
        admin_has_full_analytics_access,
        see_all_visibility,
        active,
        created_at,
        updated_at
      FROM users
      WHERE org_id = $1
        AND active IS TRUE
        AND hierarchy_level >= $2
      ORDER BY hierarchy_level ASC, role ASC, display_name ASC, id ASC
      `,
      [orgId, hierarchy_level]
    );
    return rows as UserPublicRow[];
  }

  const { rows } = await pool.query(
    `
    WITH RECURSIVE vis AS (
      SELECT $2::int AS id
      UNION
      SELECT mv.visible_user_id AS id
        FROM manager_visibility mv
        JOIN vis v ON v.id = mv.manager_user_id
        JOIN users u ON u.id = mv.visible_user_id
       WHERE u.org_id = $1
         AND u.active IS TRUE
    )
    SELECT
      u.id,
      u.public_id::text AS public_id,
      u.org_id,
      u.email,
      u.role,
      u.hierarchy_level,
      u.first_name,
      u.last_name,
      u.display_name,
      u.account_owner_name,
      u.manager_user_id,
      u.admin_has_full_analytics_access,
      u.see_all_visibility,
      u.active,
      u.created_at,
      u.updated_at
    FROM users u
    JOIN vis v ON v.id = u.id
    WHERE u.org_id = $1
      AND u.active IS TRUE
    ORDER BY u.hierarchy_level ASC, u.role ASC, u.display_name ASC, u.id ASC
    `,
    [orgId, currentUserId]
  );
  return rows as UserPublicRow[];
}

export async function getUserById(args: { orgId: number; userId: number }) {
  const orgId = zOrganizationId.parse(args.orgId);
  const userId = zUserId.parse(args.userId);
  const { rows } = await pool.query(
    `
    SELECT
      id,
      public_id::text AS public_id,
      org_id,
      email,
      password_hash,
      role,
      hierarchy_level,
      first_name,
      last_name,
      display_name,
      account_owner_name,
      manager_user_id,
      admin_has_full_analytics_access,
      see_all_visibility,
      active,
      created_at,
      updated_at
    FROM users
    WHERE org_id = $1
      AND id = $2
    LIMIT 1
    `,
    [orgId, userId]
  );
  return (rows?.[0] as UserRow | undefined) || null;
}

export async function getUserByOrgEmail(args: { orgId: number; email: string }) {
  const email = String(args.email || "").trim().toLowerCase();
  if (!email) throw new Error("email is required");
  const { rows } = await pool.query(
    `
    SELECT
      id,
      public_id::text AS public_id,
      org_id,
      email,
      password_hash,
      role,
      hierarchy_level,
      first_name,
      last_name,
      display_name,
      account_owner_name,
      manager_user_id,
      admin_has_full_analytics_access,
      see_all_visibility,
      active,
      created_at,
      updated_at
    FROM users
    WHERE email = $1
    LIMIT 1
    `,
    [email]
  );
  return (rows?.[0] as UserRow | undefined) || null;
}

export async function getUserByEmail(args: { email: string }) {
  const email = String(args.email || "").trim().toLowerCase();
  if (!email) throw new Error("email is required");
  return await getUserByOrgEmail({ orgId: 1, email }); // orgId ignored; kept for backward compat.
}

export async function createUser(args: {
  org_id: number;
  email: string;
  password_hash: string;
  role: "ADMIN" | "EXEC_MANAGER" | "MANAGER" | "REP";
  hierarchy_level?: number;
  first_name?: string | null;
  last_name?: string | null;
  display_name: string;
  account_owner_name?: string | null;
  manager_user_id?: number | null;
  admin_has_full_analytics_access?: boolean;
  see_all_visibility?: boolean;
  active?: boolean;
}) {
  const org_id = zOrganizationId.parse(args.org_id);
  const email = String(args.email || "").trim().toLowerCase();
  if (!email) throw new Error("email is required");
  const role = zUserRole.parse(args.role);
  const hierarchy_level = Number.isFinite(Number(args.hierarchy_level)) ? Number(args.hierarchy_level) : 0;
  const display_name = String(args.display_name || "").trim();
  const account_owner_name = String(args.account_owner_name || "").trim() || null;
  if (!display_name) throw new Error("display_name is required");
  const password_hash = String(args.password_hash || "").trim();
  if (!password_hash) throw new Error("password_hash is required");
  const manager_user_id =
    args.manager_user_id == null || args.manager_user_id === ("" as any) ? null : zUserId.parse(args.manager_user_id);
  const admin_has_full_analytics_access = !!args.admin_has_full_analytics_access;
  const see_all_visibility = !!args.see_all_visibility;

  const { rows } = await pool.query(
    `
    INSERT INTO users
      (
        org_id,
        email,
        password_hash,
        role,
        hierarchy_level,
        first_name,
        last_name,
        display_name,
        account_owner_name,
        manager_user_id,
        admin_has_full_analytics_access,
        see_all_visibility,
        active,
        created_at,
        updated_at
      )
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
    RETURNING
      id,
      public_id::text AS public_id,
      org_id,
      email,
      password_hash,
      role,
      hierarchy_level,
      first_name,
      last_name,
      display_name,
      account_owner_name,
      manager_user_id,
      admin_has_full_analytics_access,
      see_all_visibility,
      active,
      created_at,
      updated_at
    `,
    [
      org_id,
      email,
      password_hash,
      role,
      hierarchy_level,
      args.first_name ?? null,
      args.last_name ?? null,
      display_name,
      account_owner_name,
      manager_user_id,
      admin_has_full_analytics_access,
      see_all_visibility,
      args.active ?? true,
    ]
  );
  return rows[0] as UserRow;
}

export async function updateUser(args: {
  org_id: number;
  id: number;
  email: string;
  role: "ADMIN" | "EXEC_MANAGER" | "MANAGER" | "REP";
  hierarchy_level?: number;
  first_name?: string | null;
  last_name?: string | null;
  display_name: string;
  account_owner_name?: string | null;
  manager_user_id?: number | null;
  admin_has_full_analytics_access?: boolean;
  see_all_visibility?: boolean;
  active: boolean;
}) {
  const org_id = zOrganizationId.parse(args.org_id);
  const id = zUserId.parse(args.id);
  const email = String(args.email || "").trim().toLowerCase();
  if (!email) throw new Error("email is required");
  const role = zUserRole.parse(args.role);
  const hierarchy_level = Number.isFinite(Number(args.hierarchy_level)) ? Number(args.hierarchy_level) : 0;
  const display_name = String(args.display_name || "").trim();
  const account_owner_name = String(args.account_owner_name || "").trim() || null;
  if (!display_name) throw new Error("display_name is required");
  const manager_user_id =
    args.manager_user_id == null || args.manager_user_id === ("" as any) ? null : zUserId.parse(args.manager_user_id);
  const admin_has_full_analytics_access = !!args.admin_has_full_analytics_access;
  const see_all_visibility = !!args.see_all_visibility;

  const { rows } = await pool.query(
    `
    UPDATE users
       SET email = $3,
           role = $4,
           hierarchy_level = $5,
           first_name = $6,
           last_name = $7,
           display_name = $8,
           account_owner_name = $9,
           manager_user_id = $10,
           admin_has_full_analytics_access = $11,
           see_all_visibility = $12,
           active = $13,
           updated_at = NOW()
     WHERE org_id = $1
       AND id = $2
    RETURNING
      id,
      public_id::text AS public_id,
      org_id,
      email,
      password_hash,
      role,
      hierarchy_level,
      first_name,
      last_name,
      display_name,
      account_owner_name,
      manager_user_id,
      admin_has_full_analytics_access,
      see_all_visibility,
      active,
      created_at,
      updated_at
    `,
    [
      org_id,
      id,
      email,
      role,
      hierarchy_level,
      args.first_name ?? null,
      args.last_name ?? null,
      display_name,
      account_owner_name,
      manager_user_id,
      admin_has_full_analytics_access,
      see_all_visibility,
      !!args.active,
    ]
  );
  return (rows?.[0] as UserRow | undefined) || null;
}

export async function deleteUser(args: { orgId: number; userId: number }) {
  const orgId = zOrganizationId.parse(args.orgId);
  const userId = zUserId.parse(args.userId);
  await pool.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [orgId, userId]);
  return { ok: true };
}

export async function setUserPasswordHash(args: { orgId: number; userId: number; password_hash: string }) {
  const orgId = zOrganizationId.parse(args.orgId);
  const userId = zUserId.parse(args.userId);
  const password_hash = String(args.password_hash || "").trim();
  if (!password_hash) throw new Error("password_hash is required");
  const { rowCount } = await pool.query(
    `UPDATE users SET password_hash = $3, updated_at = NOW() WHERE org_id = $1 AND id = $2`,
    [orgId, userId, password_hash]
  );
  return { ok: rowCount === 1 };
}

export async function createUserSession(args: { userId: number; session_token_hash: string; expires_at: Date }) {
  const userId = zUserId.parse(args.userId);
  const session_token_hash = String(args.session_token_hash || "").trim();
  if (!session_token_hash) throw new Error("session_token_hash is required");
  const { rows } = await pool.query(
    `
    INSERT INTO user_sessions (user_id, session_token_hash, created_at, expires_at, revoked_at)
    VALUES ($1, $2, NOW(), $3, NULL)
    RETURNING id::text AS id, user_id, session_token_hash, created_at, expires_at, revoked_at
    `,
    [userId, session_token_hash, args.expires_at.toISOString()]
  );
  return rows[0] as UserSessionRow;
}

export async function getUserSessionByTokenHash(args: { session_token_hash: string }) {
  const session_token_hash = String(args.session_token_hash || "").trim();
  if (!session_token_hash) return null;
  const { rows } = await pool.query(
    `
    SELECT id::text AS id, user_id, session_token_hash, created_at, expires_at, revoked_at
      FROM user_sessions
     WHERE session_token_hash = $1
     LIMIT 1
    `,
    [session_token_hash]
  );
  return (rows?.[0] as UserSessionRow | undefined) || null;
}

export async function revokeSessionByTokenHash(args: { session_token_hash: string }) {
  const session_token_hash = String(args.session_token_hash || "").trim();
  if (!session_token_hash) return { ok: true };
  await pool.query(`UPDATE user_sessions SET revoked_at = NOW() WHERE session_token_hash = $1 AND revoked_at IS NULL`, [
    session_token_hash,
  ]);
  return { ok: true };
}

export async function revokeAllUserSessions(args: { userId: number }) {
  const userId = zUserId.parse(args.userId);
  await pool.query(`UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  return { ok: true };
}

export async function createPasswordResetToken(args: { userId: number; token_hash: string; expires_at: Date }) {
  const userId = zUserId.parse(args.userId);
  const token_hash = String(args.token_hash || "").trim();
  if (!token_hash) throw new Error("token_hash is required");
  const { rows } = await pool.query(
    `
    INSERT INTO password_reset_tokens (user_id, token_hash, created_at, expires_at, used_at)
    VALUES ($1, $2, NOW(), $3, NULL)
    RETURNING id::text AS id, user_id, token_hash, created_at, expires_at, used_at
    `,
    [userId, token_hash, args.expires_at.toISOString()]
  );
  return rows[0] as PasswordResetTokenRow;
}

export async function listEmailTemplates() {
  const { rows } = await pool.query(
    `
    SELECT id::text AS id, template_key, subject, body, active, created_at, updated_at
      FROM email_templates
     ORDER BY template_key ASC, id ASC
    `
  );
  return rows as EmailTemplateRow[];
}

export async function getEmailTemplateByKey(args: { template_key: string }) {
  const template_key = String(args.template_key || "").trim();
  if (!template_key) throw new Error("template_key is required");
  const { rows } = await pool.query(
    `SELECT id::text AS id, template_key, subject, body, active, created_at, updated_at FROM email_templates WHERE template_key = $1 LIMIT 1`,
    [template_key]
  );
  return (rows?.[0] as EmailTemplateRow | undefined) || null;
}

export async function upsertEmailTemplate(args: { template_key: string; subject: string; body: string; active?: boolean }) {
  const template_key = String(args.template_key || "").trim();
  const subject = String(args.subject || "").trim();
  const body = String(args.body || "").trim();
  if (!template_key) throw new Error("template_key is required");
  if (!subject) throw new Error("subject is required");
  if (!body) throw new Error("body is required");

  const { rows } = await pool.query(
    `
    INSERT INTO email_templates (template_key, subject, body, active, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    ON CONFLICT (template_key)
    DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, active = EXCLUDED.active, updated_at = NOW()
    RETURNING id::text AS id, template_key, subject, body, active, created_at, updated_at
    `,
    [template_key, subject, body, args.active ?? true]
  );
  return rows[0] as EmailTemplateRow;
}

export async function consumePasswordResetToken(args: { token_hash: string }) {
  const token_hash = String(args.token_hash || "").trim();
  if (!token_hash) return null;

  // Atomically mark used if valid.
  const { rows } = await pool.query(
    `
    UPDATE password_reset_tokens
       SET used_at = NOW()
     WHERE token_hash = $1
       AND used_at IS NULL
       AND expires_at > NOW()
    RETURNING id::text AS id, user_id, token_hash, created_at, expires_at, used_at
    `,
    [token_hash]
  );
  return (rows?.[0] as PasswordResetTokenRow | undefined) || null;
}

export async function getUserByIdAny(args: { userId: number }) {
  const userId = zUserId.parse(args.userId);
  const { rows } = await pool.query(
    `
    SELECT
      id,
      public_id::text AS public_id,
      org_id,
      email,
      password_hash,
      role,
      hierarchy_level,
      first_name,
      last_name,
      display_name,
      account_owner_name,
      manager_user_id,
      admin_has_full_analytics_access,
      see_all_visibility,
      active,
      created_at,
      updated_at
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId]
  );
  return (rows?.[0] as UserRow | undefined) || null;
}

export async function setUserPasswordHashByUserId(args: { userId: number; password_hash: string }) {
  const userId = zUserId.parse(args.userId);
  const password_hash = String(args.password_hash || "").trim();
  if (!password_hash) throw new Error("password_hash is required");
  const { rowCount } = await pool.query(`UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`, [
    userId,
    password_hash,
  ]);
  return { ok: rowCount === 1 };
}

export async function listRecentOpportunitiesForAccountOwner(args: {
  orgId: number;
  accountOwnerName: string;
  limit?: number;
}) {
  const orgId = zOrganizationId.parse(args.orgId);
  const accountOwnerName = String(args.accountOwnerName || "").trim();
  const limit = Math.max(1, Math.min(200, Number(args.limit ?? 50) || 50));
  if (!accountOwnerName) return [] as OpportunityRow[];

  const { rows } = await pool.query(
    `
    SELECT
      id,
      public_id::text AS public_id,
      org_id,
      rep_id,
      rep_name,
      account_name,
      opportunity_name,
      crm_opp_id,
      product,
      amount,
      create_date_raw,
      create_date,
      close_date,
      updated_at
    FROM opportunities
    WHERE org_id = $1
      AND rep_name = $2
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT $3
    `,
    [orgId, accountOwnerName, limit]
  );
  return rows as OpportunityRow[];
}

export async function listRepUsersForManager(args: { orgId: number; managerUserId: number; includeUnassigned?: boolean }) {
  const orgId = zOrganizationId.parse(args.orgId);
  const managerUserId = zUserId.parse(args.managerUserId);
  const includeUnassigned = args.includeUnassigned ?? false;

  const { rows } = await pool.query(
    `
    SELECT
      id,
      public_id::text AS public_id,
      org_id,
      email,
      role,
      hierarchy_level,
      display_name,
      account_owner_name,
      manager_user_id,
      admin_has_full_analytics_access,
      see_all_visibility,
      active,
      created_at,
      updated_at
    FROM users
    WHERE org_id = $1
      AND role = 'REP'
      AND (
        manager_user_id = $2
        OR ($3::bool IS TRUE AND manager_user_id IS NULL)
      )
    ORDER BY active DESC, display_name ASC, id ASC
    `,
    [orgId, managerUserId, includeUnassigned]
  );

  return rows as UserPublicRow[];
}

export async function setUserManagerUserId(args: { orgId: number; userId: number; manager_user_id: number | null }) {
  const orgId = zOrganizationId.parse(args.orgId);
  const userId = zUserId.parse(args.userId);
  const manager_user_id = args.manager_user_id == null ? null : zUserId.parse(args.manager_user_id);

  const { rows } = await pool.query(
    `
    UPDATE users
       SET manager_user_id = $3,
           updated_at = NOW()
     WHERE org_id = $1
       AND id = $2
    RETURNING
      id,
      public_id::text AS public_id,
      org_id,
      email,
      role,
      hierarchy_level,
      display_name,
      account_owner_name,
      manager_user_id,
      admin_has_full_analytics_access,
      see_all_visibility,
      active,
      created_at,
      updated_at
    `,
    [orgId, userId, manager_user_id]
  );

  return (rows?.[0] as UserPublicRow | undefined) || null;
}

export async function listManagerVisibility(args: { orgId: number; managerUserId: number }) {
  const orgId = zOrganizationId.parse(args.orgId);
  const managerUserId = zUserId.parse(args.managerUserId);
  const { rows } = await pool.query(
    `
    SELECT mv.visible_user_id
      FROM manager_visibility mv
      JOIN users mgr ON mgr.id = mv.manager_user_id
      JOIN users vis ON vis.id = mv.visible_user_id
     WHERE mv.manager_user_id = $1
       AND mgr.org_id = $2
       AND vis.org_id = $2
     ORDER BY mv.visible_user_id ASC
    `,
    [managerUserId, orgId]
  );
  return (rows || [])
    .map((r: any) => Number(r.visible_user_id))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export async function replaceManagerVisibility(args: {
  orgId: number;
  managerUserId: number;
  visibleUserIds: number[];
  see_all_visibility: boolean;
}) {
  const orgId = zOrganizationId.parse(args.orgId);
  const managerUserId = zUserId.parse(args.managerUserId);
  const see_all_visibility = !!args.see_all_visibility;
  const visibleUserIds = Array.isArray(args.visibleUserIds)
    ? args.visibleUserIds.map((n) => zUserId.parse(n)).filter((n) => n !== managerUserId)
    : [];

  return await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      // Ensure manager exists in org.
      const mgrRes = await c.query(`SELECT id, role, hierarchy_level FROM users WHERE id = $1 AND org_id = $2 LIMIT 1`, [managerUserId, orgId]);
      const mgr = mgrRes.rows?.[0] as any;
      if (!mgr) throw new Error("manager_user_id not found in org");
      const mgrLevel = Number(mgr.hierarchy_level);
      const isConfigurable = mgrLevel === 1 || mgrLevel === 2;
      if (!isConfigurable && (see_all_visibility || visibleUserIds.length)) {
        throw new Error("visibility is only configurable for EXEC_MANAGER (level 1) and MANAGER (level 2)");
      }

      // Update manager see-all flag.
      await c.query(`UPDATE users SET see_all_visibility = $3, updated_at = NOW() WHERE id = $1 AND org_id = $2`, [
        managerUserId,
        orgId,
        see_all_visibility,
      ]);

      // Clear existing edges.
      await c.query(`DELETE FROM manager_visibility WHERE manager_user_id = $1`, [managerUserId]);

      if (!see_all_visibility && visibleUserIds.length) {
        // Insert only users in this org that are valid visibility targets.
        // Exec managers and managers can see only level 2 (managers) and level 3 (reps); never admins.
        const targetsRes = await c.query(
          `
          SELECT id, role, hierarchy_level
            FROM users
           WHERE org_id = $1
             AND id = ANY($2::int[])
          `,
          [orgId, visibleUserIds]
        );
        const allowedIds = (targetsRes.rows || [])
          .filter((r: any) => r && r.role !== "ADMIN" && Number(r.hierarchy_level) >= 2)
          .map((r: any) => Number(r.id))
          .filter((n) => Number.isFinite(n) && n > 0);

        const uniq = Array.from(new Set(allowedIds)).filter((n) => n !== managerUserId);
        if (uniq.length) {
          // Cycle prevention: adding edge manager -> X must not create a loop where X can already reach manager.
          const cycleRes = await c.query(
            `
            WITH RECURSIVE walk(start_id, id) AS (
              SELECT x AS start_id, x AS id
                FROM unnest($1::int[]) AS x
              UNION ALL
              SELECT w.start_id, mv.visible_user_id
                FROM walk w
                JOIN manager_visibility mv ON mv.manager_user_id = w.id
            )
            SELECT DISTINCT start_id
              FROM walk
             WHERE id = $2
             LIMIT 1
            `,
            [uniq, managerUserId]
          );
          if (cycleRes.rows?.length) {
            throw new Error("invalid visibility: would create a circular visibility assignment");
          }

          const values: any[] = [];
          const rowsSql: string[] = [];
          let p = 0;
          for (const id of uniq) {
            values.push(managerUserId, id);
            rowsSql.push(`($${p + 1}, $${p + 2})`);
            p += 2;
          }
          await c.query(`INSERT INTO manager_visibility (manager_user_id, visible_user_id) VALUES ${rowsSql.join(", ")}`, values);
        }
      }

      await c.query("COMMIT");
      return { ok: true, count: see_all_visibility ? 0 : visibleUserIds.length };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });
}

