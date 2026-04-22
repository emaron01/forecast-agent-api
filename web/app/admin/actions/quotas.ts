"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { pool } from "../../../lib/pool";
import { requireOrgContext } from "../../../lib/auth";
import type { QuotaPeriodRow, QuotaRow } from "../../../lib/quotaModels";
import { isAdmin } from "../../../lib/roleHelpers";

const zBigintText = z.string().regex(/^\d+$/);

function orgIdBigintParam(orgId: unknown): number {
  const s = String(orgId ?? "").trim();
  // Never allow empty-string params to reach Postgres.
  if (!s || !/^\d+$/.test(s)) redirect("/admin/organizations");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) redirect("/admin/organizations");
  return Math.trunc(n);
}

const CreateQuotaPeriodSchema = z.object({
  period_name: z.string().min(1),
  period_start: z.string().min(1),
  period_end: z.string().min(1),
  fiscal_year: z.string().min(1),
  fiscal_quarter: z.string().min(1),
});

const UpdateQuotaPeriodSchema = CreateQuotaPeriodSchema.extend({
  id: zBigintText,
});

const DeleteQuotaPeriodSchema = z.object({
  id: zBigintText,
});

export async function createQuotaPeriod(formData: FormData): Promise<QuotaPeriodRow> {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && !isAdmin(ctx.user)) redirect("/admin/users");
  const orgIdParam = orgIdBigintParam(orgId);

  const parsed = CreateQuotaPeriodSchema.parse({
    period_name: formData.get("period_name"),
    period_start: formData.get("period_start"),
    period_end: formData.get("period_end"),
    fiscal_year: formData.get("fiscal_year"),
    fiscal_quarter: formData.get("fiscal_quarter"),
  });

  const { rows } = await pool.query<QuotaPeriodRow>(
    `
    INSERT INTO quota_periods (
      org_id,
      period_name,
      period_start,
      period_end,
      fiscal_year,
      fiscal_quarter
    ) VALUES (
      $1::bigint,
      $2,
      $3::date,
      $4::date,
      $5,
      $6
    )
    RETURNING
      id::text AS id,
      org_id::text AS org_id,
      period_name,
      period_start::text AS period_start,
      period_end::text AS period_end,
      fiscal_year,
      fiscal_quarter,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    `,
    [orgIdParam, parsed.period_name, parsed.period_start, parsed.period_end, parsed.fiscal_year, parsed.fiscal_quarter]
  );

  const row = rows?.[0];
  if (!row) throw new Error("create_failed");
  return row;
}

export async function updateQuotaPeriod(formData: FormData): Promise<QuotaPeriodRow> {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && !isAdmin(ctx.user)) redirect("/admin/users");
  const orgIdParam = orgIdBigintParam(orgId);

  const parsed = UpdateQuotaPeriodSchema.parse({
    id: formData.get("id"),
    period_name: formData.get("period_name"),
    period_start: formData.get("period_start"),
    period_end: formData.get("period_end"),
    fiscal_year: formData.get("fiscal_year"),
    fiscal_quarter: formData.get("fiscal_quarter"),
  });

  const { rows } = await pool.query<QuotaPeriodRow>(
    `
    UPDATE quota_periods
       SET period_name = $3,
           period_start = $4::date,
           period_end = $5::date,
           fiscal_year = $6,
           fiscal_quarter = $7,
           updated_at = NOW()
     WHERE org_id = $1::bigint
       AND id = $2::bigint
    RETURNING
      id::text AS id,
      org_id::text AS org_id,
      period_name,
      period_start::text AS period_start,
      period_end::text AS period_end,
      fiscal_year,
      fiscal_quarter,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    `,
    [orgIdParam, parsed.id, parsed.period_name, parsed.period_start, parsed.period_end, parsed.fiscal_year, parsed.fiscal_quarter]
  );

  const row = rows?.[0];
  if (!row) throw new Error("not_found");
  return row;
}

export async function listQuotaPeriods(): Promise<QuotaPeriodRow[]> {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && !isAdmin(ctx.user)) redirect("/admin/users");
  const orgIdParam = orgIdBigintParam(orgId);

  const { rows } = await pool.query<QuotaPeriodRow>(
    `
    SELECT
      id::text AS id,
      org_id::text AS org_id,
      period_name,
      period_start::text AS period_start,
      period_end::text AS period_end,
      fiscal_year,
      fiscal_quarter::text AS fiscal_quarter,
      created_at::text AS created_at,
      updated_at::text AS updated_at
      FROM quota_periods
     WHERE org_id = NULLIF($1::text, '')::bigint
     ORDER BY
       fiscal_year DESC,
       CASE
         WHEN fiscal_quarter = 1 THEN 1
         WHEN fiscal_quarter = 2 THEN 2
         WHEN fiscal_quarter = 3 THEN 3
         WHEN fiscal_quarter = 4 THEN 4
         ELSE 99
       END ASC,
       period_start ASC,
       id ASC
    `,
    [orgIdParam]
  );
  return rows as QuotaPeriodRow[];
}

export async function deleteQuotaPeriod(formData: FormData): Promise<{ ok: true }> {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && !isAdmin(ctx.user)) redirect("/admin/users");
  const orgIdParam = orgIdBigintParam(orgId);

  const parsed = DeleteQuotaPeriodSchema.parse({
    id: formData.get("id"),
  });

  await pool.query(
    `
    DELETE FROM quota_periods
     WHERE org_id = $1::bigint
       AND id = $2::bigint
    `,
    [orgIdParam, parsed.id]
  );

  return { ok: true };
}

const DeleteRepQuotaSetSchema = z.object({
  rep_id: zBigintText,
  fiscal_year: z.string().min(1),
});

function quarterNumberFromAny(v: unknown): "" | "1" | "2" | "3" | "4" {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "1" || s === "q1" || s.includes("1st")) return "1";
  if (s === "2" || s === "q2" || s.includes("2nd")) return "2";
  if (s === "3" || s === "q3" || s.includes("3rd")) return "3";
  if (s === "4" || s === "q4" || s.includes("4th")) return "4";
  return "";
}

async function getQuarterPeriodIdsForYear(args: { orgId: number; fiscal_year: string }) {
  const { rows } = await pool.query<{ id: string; fiscal_quarter: string; period_name: string }>(
    `
    SELECT
      id::text AS id,
      fiscal_quarter,
      period_name
    FROM quota_periods
    WHERE org_id = $1::bigint
      AND fiscal_year = $2
    `,
    [orgIdBigintParam(args.orgId), args.fiscal_year]
  );

  const byQ = new Map<"1" | "2" | "3" | "4", string>();
  for (const r of rows || []) {
    const q = (quarterNumberFromAny(r.fiscal_quarter) || quarterNumberFromAny(r.period_name)) as any;
    if (q === "1" || q === "2" || q === "3" || q === "4") {
      if (!byQ.has(q)) byQ.set(q, String(r.id));
    }
  }

  return {
    q1: byQ.get("1") || "",
    q2: byQ.get("2") || "",
    q3: byQ.get("3") || "",
    q4: byQ.get("4") || "",
  };
}

export async function deleteRepQuotaSet(formData: FormData): Promise<{ ok: true }> {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && !isAdmin(ctx.user)) redirect("/admin/users");

  const parsed = DeleteRepQuotaSetSchema.parse({
    rep_id: formData.get("rep_id"),
    fiscal_year: formData.get("fiscal_year"),
  });

  const periods = await getQuarterPeriodIdsForYear({ orgId, fiscal_year: parsed.fiscal_year });
  const ids = [periods.q1, periods.q2, periods.q3, periods.q4].filter(Boolean);
  if (!ids.length) return { ok: true };

  await pool.query(
    `
    DELETE FROM quotas
     WHERE org_id = $1::bigint
       AND rep_id = $2::bigint
       AND role_level = (
         SELECT COALESCE(u.hierarchy_level, 3)
           FROM reps r
           JOIN users u ON u.id = r.user_id
          WHERE r.id = $2::bigint
          LIMIT 1
       )
       AND quota_period_id = ANY($3::bigint[])
    `,
    [orgId, parsed.rep_id, ids]
  );

  return { ok: true };
}

export async function listQuotasByRep(args: { rep_id: string }): Promise<QuotaRow[]> {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && !isAdmin(ctx.user)) redirect("/admin/users");

  const parsed = z.object({ rep_id: zBigintText }).parse(args);

  const { rows } = await pool.query<QuotaRow>(
    `
    SELECT
      id::text AS id,
      org_id::text AS org_id,
      rep_id::text AS rep_id,
      manager_id::text AS manager_id,
      role_level,
      quota_period_id::text AS quota_period_id,
      quota_amount::float8 AS quota_amount,
      annual_target::float8 AS annual_target,
      carry_forward::float8 AS carry_forward,
      adjusted_quarterly_quota::float8 AS adjusted_quarterly_quota,
      created_at::text AS created_at,
      updated_at::text AS updated_at
      FROM quotas
     WHERE org_id = $1::bigint
       AND rep_id = $2::bigint
    `,
    [orgId, parsed.rep_id]
  );
  return rows as QuotaRow[];
}

export async function listQuotasByManager(args: { manager_id: string }): Promise<QuotaRow[]> {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && !isAdmin(ctx.user)) redirect("/admin/users");

  const parsed = z.object({ manager_id: zBigintText }).parse(args);

  const { rows } = await pool.query<QuotaRow>(
    `
    SELECT
      id::text AS id,
      org_id::text AS org_id,
      rep_id::text AS rep_id,
      manager_id::text AS manager_id,
      role_level,
      quota_period_id::text AS quota_period_id,
      quota_amount::float8 AS quota_amount,
      annual_target::float8 AS annual_target,
      carry_forward::float8 AS carry_forward,
      adjusted_quarterly_quota::float8 AS adjusted_quarterly_quota,
      created_at::text AS created_at,
      updated_at::text AS updated_at
      FROM quotas
     WHERE org_id = $1::bigint
       AND manager_id = $2::bigint
    `,
    [orgId, parsed.manager_id]
  );
  return rows as QuotaRow[];
}

export async function listQuotasByVP(): Promise<QuotaRow[]> {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && !isAdmin(ctx.user)) redirect("/admin/users");

  // role_level mapping aligns with hierarchy_levels.level:
  // 1 = Executive Manager (used as VP in quota assignment flows).
  const { rows } = await pool.query<QuotaRow>(
    `
    SELECT
      id::text AS id,
      org_id::text AS org_id,
      rep_id::text AS rep_id,
      manager_id::text AS manager_id,
      role_level,
      quota_period_id::text AS quota_period_id,
      quota_amount::float8 AS quota_amount,
      annual_target::float8 AS annual_target,
      carry_forward::float8 AS carry_forward,
      adjusted_quarterly_quota::float8 AS adjusted_quarterly_quota,
      created_at::text AS created_at,
      updated_at::text AS updated_at
      FROM quotas
     WHERE org_id = $1::bigint
       AND role_level = 1
    `,
    [orgId]
  );
  return rows as QuotaRow[];
}

export async function listQuotasByCRO(): Promise<QuotaRow[]> {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && !isAdmin(ctx.user)) redirect("/admin/users");

  // role_level mapping aligns with hierarchy_levels.level:
  // 0 = Admin (used as CRO/company level in quota assignment flows).
  const { rows } = await pool.query<QuotaRow>(
    `
    SELECT
      id::text AS id,
      org_id::text AS org_id,
      rep_id::text AS rep_id,
      manager_id::text AS manager_id,
      role_level,
      quota_period_id::text AS quota_period_id,
      quota_amount::float8 AS quota_amount,
      annual_target::float8 AS annual_target,
      carry_forward::float8 AS carry_forward,
      adjusted_quarterly_quota::float8 AS adjusted_quarterly_quota,
      created_at::text AS created_at,
      updated_at::text AS updated_at
      FROM quotas
     WHERE org_id = $1::bigint
       AND role_level = 0
    `,
    [orgId]
  );
  return rows as QuotaRow[];
}

