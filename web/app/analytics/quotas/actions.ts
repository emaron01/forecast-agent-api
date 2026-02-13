"use server";

import { pool } from "../../../lib/pool";
import { requireAuth } from "../../../lib/auth";
import type { QuotaPeriodRow, QuotaRow } from "../../../lib/quotaModels";
import { getCompanyAttainmentForPeriod, type CompanyAttainmentRow } from "../../../lib/quotaComparisons";
import type { CroAttainmentRow, ManagerAttainmentRow, RepAttainmentRow } from "../../../lib/quotaRollups";
import { z } from "zod";
import {
  type ActionResult,
  AssignQuotaToUserSchema,
  CreateQuotaPeriodSchema,
  GetDistinctFiscalYearsSchema,
  GetQuotaByUserSchema,
  GetQuotaPeriodsSchema,
  GetQuotaRollupByManagerSchema,
  GetQuotaRollupCompanySchema,
  UpdateQuotaPeriodSchema,
  UpdateQuotaSchema,
} from "./schemas";

async function authOrg() {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") return { ok: false as const, error: "forbidden" };
  return { ok: true as const, ctx, orgId: ctx.user.org_id };
}

async function managerRepIdForUser(args: { orgId: number; userId: number }) {
  const { rows } = await pool.query<{ id: number }>(
    `
    SELECT r.id
      FROM reps r
     WHERE r.organization_id = $1
       AND r.user_id = $2
     LIMIT 1
    `,
    [args.orgId, args.userId]
  );
  const id = rows?.[0]?.id;
  return Number.isFinite(id) ? Number(id) : null;
}

async function directRepIdsForManagerRep(args: { orgId: number; managerRepId: number }) {
  const { rows } = await pool.query<{ id: number }>(
    `
    SELECT r.id
      FROM reps r
     WHERE r.organization_id = $1
       AND r.manager_rep_id = $2
       AND r.active IS TRUE
     ORDER BY r.id ASC
    `,
    [args.orgId, args.managerRepId]
  );
  return (rows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
}

function ensureNotRep(role: string) {
  return role !== "REP";
}

export async function getQuotaPeriods(): Promise<ActionResult<QuotaPeriodRow[]>> {
  const a = await authOrg();
  if (!a.ok) return { ok: false, error: a.error };
  if (!ensureNotRep(a.ctx.user.role)) return { ok: false, error: "forbidden" };

  GetQuotaPeriodsSchema.parse({});

  const { rows } = await pool.query<QuotaPeriodRow>(
    `
    SELECT
      id::text AS id,
      org_id::text AS org_id,
      period_name,
      period_start::text AS period_start,
      period_end::text AS period_end,
      fiscal_year,
      fiscal_quarter,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM quota_periods
    WHERE org_id = $1::bigint
    ORDER BY period_start DESC, id DESC
    `,
    [a.orgId]
  );
  return { ok: true, data: rows as QuotaPeriodRow[] };
}

export async function getDistinctFiscalYears(): Promise<ActionResult<Array<{ fiscal_year: string }>>> {
  const a = await authOrg();
  if (!a.ok) return { ok: false, error: a.error };
  if (!ensureNotRep(a.ctx.user.role)) return { ok: false, error: "forbidden" };

  GetDistinctFiscalYearsSchema.parse({});

  const { rows } = await pool.query<{ fiscal_year: string }>(
    `
    SELECT DISTINCT fiscal_year
      FROM quota_periods
     WHERE org_id = $1::bigint
     ORDER BY fiscal_year DESC
    `,
    [a.orgId]
  );
  return { ok: true, data: (rows || []).map((r) => ({ fiscal_year: String(r.fiscal_year || "").trim() })).filter((r) => !!r.fiscal_year) };
}

export async function getFiscalYears(): Promise<ActionResult<Array<{ fiscal_year: string }>>> {
  return await getDistinctFiscalYears();
}

export async function createQuotaPeriod(input: {
  period_name: string;
  period_start: string;
  period_end: string;
  fiscal_year: string;
  fiscal_quarter: string;
}): Promise<ActionResult<QuotaPeriodRow>> {
  const a = await authOrg();
  if (!a.ok) return { ok: false, error: a.error };
  if (a.ctx.user.role !== "ADMIN") return { ok: false, error: "forbidden" };

  const parsed = CreateQuotaPeriodSchema.parse(input);

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
    [a.orgId, parsed.period_name, parsed.period_start, parsed.period_end, parsed.fiscal_year, parsed.fiscal_quarter]
  );
  const row = rows?.[0];
  if (!row) return { ok: false, error: "create_failed" };
  return { ok: true, data: row };
}

export async function updateQuotaPeriod(input: {
  id: string;
  period_name: string;
  period_start: string;
  period_end: string;
  fiscal_year: string;
  fiscal_quarter: string;
}): Promise<ActionResult<QuotaPeriodRow>> {
  const a = await authOrg();
  if (!a.ok) return { ok: false, error: a.error };
  if (a.ctx.user.role !== "ADMIN") return { ok: false, error: "forbidden" };

  const parsed = UpdateQuotaPeriodSchema.parse(input);

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
    [a.orgId, parsed.id, parsed.period_name, parsed.period_start, parsed.period_end, parsed.fiscal_year, parsed.fiscal_quarter]
  );
  const row = rows?.[0];
  if (!row) return { ok: false, error: "not_found" };
  return { ok: true, data: row };
}

function normalizeQuotaRow(rows: any[]): QuotaRow | null {
  const row = rows?.[0] as any;
  return row ? (row as QuotaRow) : null;
}

export async function assignQuotaToUser(input: z.input<typeof AssignQuotaToUserSchema>): Promise<ActionResult<QuotaRow>> {
  const a = await authOrg();
  if (!a.ok) return { ok: false, error: a.error };
  if (!ensureNotRep(a.ctx.user.role)) return { ok: false, error: "forbidden" };

  const parsed = AssignQuotaToUserSchema.parse(input);
  const role = a.ctx.user.role;

  const roleLevel = Number(parsed.role_level);
  const repId = parsed.rep_id ? String(parsed.rep_id) : null;
  const managerId = parsed.manager_id ? String(parsed.manager_id) : null;

  if (role === "MANAGER") {
    // Managers can only assign rep quotas for direct reports (role_level = 3).
    if (roleLevel !== 3) return { ok: false, error: "forbidden" };
    if (!repId) return { ok: false, error: "invalid_rep_id" };

    const mgrRepId = await managerRepIdForUser({ orgId: a.orgId, userId: a.ctx.user.id });
    if (!mgrRepId) return { ok: false, error: "forbidden" };
    const directRepIds = await directRepIdsForManagerRep({ orgId: a.orgId, managerRepId: mgrRepId });
    if (!directRepIds.includes(Number(repId))) return { ok: false, error: "forbidden" };
  } else if (role !== "ADMIN") {
    // EXEC_MANAGER can view company rollups; assignment flows are admin/manager only.
    return { ok: false, error: "forbidden" };
  }

  const existing = await pool.query<{ id: string }>(
    `
    SELECT id::text AS id
      FROM quotas
     WHERE org_id = $1::bigint
       AND quota_period_id = $2::bigint
       AND role_level = $3::int
       AND COALESCE(rep_id, 0) = COALESCE($4::bigint, 0)
       AND COALESCE(manager_id, 0) = COALESCE($5::bigint, 0)
     ORDER BY id DESC
     LIMIT 1
    `,
    [a.orgId, parsed.quota_period_id, roleLevel, repId, managerId]
  );

  const id = existing.rows?.[0]?.id ? String(existing.rows[0].id) : "";

  if (id) {
    const { rows } = await pool.query<QuotaRow>(
      `
      UPDATE quotas
         SET quota_amount = $6::numeric,
             annual_target = $7::numeric,
             carry_forward = $8::numeric,
             adjusted_quarterly_quota = $9::numeric,
             updated_at = NOW()
       WHERE org_id = $1::bigint
         AND id = $2::bigint
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
        a.orgId,
        id,
        repId,
        managerId,
        roleLevel,
        parsed.quota_amount,
        parsed.annual_target ?? null,
        parsed.carry_forward ?? null,
        parsed.adjusted_quarterly_quota ?? null,
      ]
    );
    const out = await normalizeQuotaRow(rows as any[]);
    if (!out) return { ok: false, error: "update_failed" };
    return { ok: true, data: out };
  }

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
      a.orgId,
      repId,
      managerId,
      roleLevel,
      parsed.quota_period_id,
      parsed.quota_amount,
      parsed.annual_target ?? null,
      parsed.carry_forward ?? null,
      parsed.adjusted_quarterly_quota ?? null,
    ]
  );

  const out = await normalizeQuotaRow(rows as any[]);
  if (!out) return { ok: false, error: "create_failed" };
  return { ok: true, data: out };
}

export async function updateQuota(input: z.input<typeof UpdateQuotaSchema>): Promise<ActionResult<QuotaRow>> {
  const a = await authOrg();
  if (!a.ok) return { ok: false, error: a.error };
  if (!ensureNotRep(a.ctx.user.role)) return { ok: false, error: "forbidden" };

  const parsed = UpdateQuotaSchema.parse(input);
  const role = a.ctx.user.role;

  if (role !== "ADMIN" && role !== "MANAGER") return { ok: false, error: "forbidden" };

  if (role === "MANAGER") {
    const mgrRepId = await managerRepIdForUser({ orgId: a.orgId, userId: a.ctx.user.id });
    if (!mgrRepId) return { ok: false, error: "forbidden" };
    const directRepIds = await directRepIdsForManagerRep({ orgId: a.orgId, managerRepId: mgrRepId });

    const { rows: qrows } = await pool.query<{ rep_id: string | null; role_level: number }>(
      `SELECT rep_id::text AS rep_id, role_level FROM quotas WHERE org_id = $1::bigint AND id = $2::bigint LIMIT 1`,
      [a.orgId, parsed.id]
    );
    const q = qrows?.[0];
    if (!q) return { ok: false, error: "not_found" };
    if (Number(q.role_level) !== 3) return { ok: false, error: "forbidden" };
    if (!q.rep_id || !directRepIds.includes(Number(q.rep_id))) return { ok: false, error: "forbidden" };
  }

  const repId = parsed.rep_id ? String(parsed.rep_id) : null;
  const managerId = parsed.manager_id ? String(parsed.manager_id) : null;

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
       AND id = $2::bigint
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
      a.orgId,
      parsed.id,
      repId,
      managerId,
      parsed.role_level,
      parsed.quota_period_id,
      parsed.quota_amount,
      parsed.annual_target ?? null,
      parsed.carry_forward ?? null,
      parsed.adjusted_quarterly_quota ?? null,
    ]
  );

  const row = rows?.[0];
  if (!row) return { ok: false, error: "not_found" };
  return { ok: true, data: row };
}

export async function getQuotaByUser(input: z.input<typeof GetQuotaByUserSchema>): Promise<ActionResult<QuotaRow | null>> {
  const a = await authOrg();
  if (!a.ok) return { ok: false, error: a.error };
  if (!ensureNotRep(a.ctx.user.role)) return { ok: false, error: "forbidden" };

  const parsed = GetQuotaByUserSchema.parse(input);
  const role = a.ctx.user.role;

  if (role !== "ADMIN" && parsed.user_id !== a.ctx.user.id) return { ok: false, error: "forbidden" };

  const { rows: repRows } = await pool.query<{ id: number | null }>(
    `
    SELECT r.id
      FROM reps r
     WHERE r.organization_id = $1
       AND r.user_id = $2
     LIMIT 1
    `,
    [a.orgId, parsed.user_id]
  );
  const repId = repRows?.[0]?.id ? Number(repRows[0].id) : null;

  const userRoleLevel = role === "ADMIN" ? 0 : role === "EXEC_MANAGER" ? 1 : role === "MANAGER" ? 2 : 3;

  if (userRoleLevel !== 0 && !repId) return { ok: true, data: null };

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
      AND quota_period_id = $2::bigint
      AND role_level = $3::int
      AND (
        ($3::int = 0)
        OR ($3::int = 3 AND rep_id = $4::bigint)
        OR ($3::int IN (1,2) AND manager_id = $4::bigint)
      )
    ORDER BY id DESC
    LIMIT 1
    `,
    [a.orgId, parsed.quota_period_id, userRoleLevel, repId]
  );
  return { ok: true, data: (rows?.[0] as QuotaRow | undefined) || null };
}

export type ManagerQuotaRollup = {
  manager_attainment: ManagerAttainmentRow | null;
  rep_attainment: RepAttainmentRow[];
};

export async function getQuotaRollupByManager(input: z.input<typeof GetQuotaRollupByManagerSchema>): Promise<ActionResult<ManagerQuotaRollup>> {
  const a = await authOrg();
  if (!a.ok) return { ok: false, error: a.error };
  if (a.ctx.user.role !== "MANAGER") return { ok: false, error: "forbidden" };

  const parsed = GetQuotaRollupByManagerSchema.parse(input);

  const mgrRepId = await managerRepIdForUser({ orgId: a.orgId, userId: a.ctx.user.id });
  if (!mgrRepId) return { ok: false, error: "forbidden" };

  const directRepIds = await directRepIdsForManagerRep({ orgId: a.orgId, managerRepId: mgrRepId });
  const repIdsBigint = directRepIds.map((n) => String(n));

  const repRes = repIdsBigint.length
    ? await pool.query<RepAttainmentRow>(
        `
        SELECT
          quota_id::text AS quota_id,
          rep_id::text AS rep_id,
          rep_name,
          quota_amount::float8 AS quota_amount,
          carry_forward::float8 AS carry_forward,
          adjusted_quota_amount::float8 AS adjusted_quota_amount,
          actual_amount::float8 AS actual_amount,
          attainment::float8 AS attainment
        FROM public.rep_attainment($1::int, $2::bigint)
        WHERE rep_id = ANY($3::bigint[])
        ORDER BY attainment DESC NULLS LAST, actual_amount DESC, rep_id ASC
        `,
        [a.orgId, parsed.quota_period_id, repIdsBigint]
      )
    : ({ rows: [] as RepAttainmentRow[] } as any);

  const mgrRes = await pool.query<ManagerAttainmentRow>(
    `
    SELECT
      quota_id::text AS quota_id,
      manager_id::text AS manager_id,
      manager_name,
      quota_amount::float8 AS quota_amount,
      carry_forward::float8 AS carry_forward,
      adjusted_quota_amount::float8 AS adjusted_quota_amount,
      actual_amount::float8 AS actual_amount,
      attainment::float8 AS attainment
    FROM public.manager_attainment($1::int, $2::bigint)
    WHERE manager_id = $3::bigint
    LIMIT 1
    `,
    [a.orgId, parsed.quota_period_id, mgrRepId]
  );

  return { ok: true, data: { manager_attainment: (mgrRes.rows?.[0] as any) || null, rep_attainment: (repRes.rows || []) as any } };
}

export type CompanyQuotaRollup = {
  company_attainment: CompanyAttainmentRow | null;
  company_quota_row: CroAttainmentRow | null;
};

export async function getQuotaRollupCompany(input: z.input<typeof GetQuotaRollupCompanySchema>): Promise<ActionResult<CompanyQuotaRollup>> {
  const a = await authOrg();
  if (!a.ok) return { ok: false, error: a.error };
  if (a.ctx.user.role !== "EXEC_MANAGER" && a.ctx.user.role !== "ADMIN") return { ok: false, error: "forbidden" };

  const parsed = GetQuotaRollupCompanySchema.parse(input);

  const company_attainment = await getCompanyAttainmentForPeriod({ orgId: a.orgId, quotaPeriodId: parsed.quota_period_id }).catch(() => null);

  const { rows } = await pool.query<CroAttainmentRow>(
    `
    SELECT
      quota_id::text AS quota_id,
      quota_amount::float8 AS quota_amount,
      carry_forward::float8 AS carry_forward,
      adjusted_quota_amount::float8 AS adjusted_quota_amount,
      actual_amount::float8 AS actual_amount,
      attainment::float8 AS attainment
    FROM public.cro_attainment($1::int, $2::bigint)
    LIMIT 1
    `,
    [a.orgId, parsed.quota_period_id]
  );

  return { ok: true, data: { company_attainment, company_quota_row: (rows?.[0] as any) || null } };
}

