"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { pool } from "../../../lib/pool";
import { requireOrgContext } from "../../../lib/auth";
import type { QuotaPeriodRow, QuotaRow } from "../../../lib/quotaModels";

const zBigintText = z.string().regex(/^\d+$/);
const zUuidText = z.string().uuid();

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
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");
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
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");
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
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");
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
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");
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

const CreateQuotaSchema = z.object({
  rep_id: zBigintText.optional(),
  manager_id: zBigintText.optional(),
  role_level: z.coerce.number().int(),
  quota_period_id: zBigintText,
  quota_amount: z.coerce.number(),
  annual_target: z.coerce.number().optional(),
  carry_forward: z.coerce.number().optional(),
  adjusted_quarterly_quota: z.coerce.number().optional(),
});

const UpdateQuotaSchema = CreateQuotaSchema.extend({
  id: zUuidText,
});

const UpsertRepQuotaSetSchema = z.object({
  rep_id: zBigintText,
  fiscal_year: z.string().min(1),
  q1_quota_amount: z.coerce.number(),
  q2_quota_amount: z.coerce.number(),
  q3_quota_amount: z.coerce.number(),
  q4_quota_amount: z.coerce.number(),
});

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

export async function createQuota(formData: FormData): Promise<QuotaRow> {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = CreateQuotaSchema.parse({
    rep_id: formData.get("rep_id") || undefined,
    manager_id: formData.get("manager_id") || undefined,
    role_level: formData.get("role_level"),
    quota_period_id: formData.get("quota_period_id"),
    quota_amount: formData.get("quota_amount"),
    annual_target: formData.get("annual_target") || undefined,
    carry_forward: formData.get("carry_forward") || undefined,
    adjusted_quarterly_quota: formData.get("adjusted_quarterly_quota") || undefined,
  });

  const { rows } = await pool.query<QuotaRow>(
    `
    INSERT INTO quotas (
      org_id,
      rep_id,
      manager_id,
      role_level,
      quota_period_id,
      quota_amount,
      annual_target,
      carry_forward,
      adjusted_quarterly_quota
    ) VALUES (
      $1::bigint,
      $2::bigint,
      $3::bigint,
      $4::int,
      $5::bigint,
      $6::numeric,
      $7::numeric,
      $8::numeric,
      $9::numeric
    )
    RETURNING
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
    `,
    [
      orgId,
      parsed.rep_id ?? null,
      parsed.manager_id ?? null,
      parsed.role_level,
      parsed.quota_period_id,
      parsed.quota_amount,
      parsed.annual_target ?? null,
      parsed.carry_forward ?? null,
      parsed.adjusted_quarterly_quota ?? null,
    ]
  );

  const row = rows?.[0];
  if (!row) throw new Error("create_failed");
  return row;
}

export async function updateQuota(formData: FormData): Promise<QuotaRow> {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = UpdateQuotaSchema.parse({
    id: formData.get("id"),
    rep_id: formData.get("rep_id") || undefined,
    manager_id: formData.get("manager_id") || undefined,
    role_level: formData.get("role_level"),
    quota_period_id: formData.get("quota_period_id"),
    quota_amount: formData.get("quota_amount"),
    annual_target: formData.get("annual_target") || undefined,
    carry_forward: formData.get("carry_forward") || undefined,
    adjusted_quarterly_quota: formData.get("adjusted_quarterly_quota") || undefined,
  });

  const { rows } = await pool.query<QuotaRow>(
    `
    UPDATE quotas
       SET rep_id = $3::bigint,
           manager_id = $4::bigint,
           role_level = $5::int,
           quota_period_id = $6::bigint,
           quota_amount = $7::numeric,
           annual_target = $8::numeric,
           carry_forward = $9::numeric,
           adjusted_quarterly_quota = $10::numeric,
           updated_at = NOW()
     WHERE org_id = $1::bigint
       AND id = $2::uuid
    RETURNING
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
    `,
    [
      orgId,
      parsed.id,
      parsed.rep_id ?? null,
      parsed.manager_id ?? null,
      parsed.role_level,
      parsed.quota_period_id,
      parsed.quota_amount,
      parsed.annual_target ?? null,
      parsed.carry_forward ?? null,
      parsed.adjusted_quarterly_quota ?? null,
    ]
  );

  const row = rows?.[0];
  if (!row) throw new Error("not_found");
  return row;
}

export async function upsertRepQuotaSet(formData: FormData): Promise<{ ok: true }> {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const parsed = UpsertRepQuotaSetSchema.parse({
    rep_id: formData.get("rep_id"),
    fiscal_year: formData.get("fiscal_year"),
    q1_quota_amount: formData.get("q1_quota_amount"),
    q2_quota_amount: formData.get("q2_quota_amount"),
    q3_quota_amount: formData.get("q3_quota_amount"),
    q4_quota_amount: formData.get("q4_quota_amount"),
  });

  const periods = await getQuarterPeriodIdsForYear({ orgId, fiscal_year: parsed.fiscal_year });
  if (!periods.q1 || !periods.q2 || !periods.q3 || !periods.q4) throw new Error("missing_quarter_periods");

  const annual_target = parsed.q1_quota_amount + parsed.q2_quota_amount + parsed.q3_quota_amount + parsed.q4_quota_amount;

  const rep = await pool.query<{ manager_rep_id: number | null }>(
    `
    SELECT manager_rep_id
      FROM reps
     WHERE organization_id = $1
       AND id = $2::bigint
     LIMIT 1
    `,
    [orgId, parsed.rep_id]
  );
  const manager_id = rep.rows?.[0]?.manager_rep_id == null ? null : String(rep.rows[0].manager_rep_id);

  const quarterRows: Array<{ quota_period_id: string; quota_amount: number }> = [
    { quota_period_id: periods.q1, quota_amount: parsed.q1_quota_amount },
    { quota_period_id: periods.q2, quota_amount: parsed.q2_quota_amount },
    { quota_period_id: periods.q3, quota_amount: parsed.q3_quota_amount },
    { quota_period_id: periods.q4, quota_amount: parsed.q4_quota_amount },
  ];

  for (const q of quarterRows) {
    const updated = await pool.query<{ id: string }>(
      `
      UPDATE quotas
         SET quota_amount = $4::numeric,
             annual_target = $5::numeric,
             manager_id = $6::bigint,
             updated_at = NOW()
       WHERE org_id = $1::bigint
         AND rep_id = $2::bigint
         AND role_level = 3
         AND quota_period_id = $3::bigint
      RETURNING id::text AS id
      `,
      [orgId, parsed.rep_id, q.quota_period_id, q.quota_amount, annual_target, manager_id]
    );

    if (updated.rows?.[0]?.id) continue;

    await pool.query(
      `
      INSERT INTO quotas (
        org_id,
        rep_id,
        manager_id,
        role_level,
        quota_period_id,
        quota_amount,
        annual_target,
        carry_forward,
        adjusted_quarterly_quota
      ) VALUES (
        $1::bigint,
        $2::bigint,
        $3::bigint,
        3,
        $4::bigint,
        $5::numeric,
        $6::numeric,
        0,
        NULL
      )
      `,
      [orgId, parsed.rep_id, manager_id, q.quota_period_id, q.quota_amount, annual_target]
    );
  }

  return { ok: true };
}

export async function deleteRepQuotaSet(formData: FormData): Promise<{ ok: true }> {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

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
       AND role_level = 3
       AND quota_period_id = ANY($3::bigint[])
    `,
    [orgId, parsed.rep_id, ids]
  );

  return { ok: true };
}

export async function listQuotasByRep(args: { rep_id: string }): Promise<QuotaRow[]> {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

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
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

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
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

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
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

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

