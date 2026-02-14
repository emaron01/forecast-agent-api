import { z } from "zod";
import { pool } from "./pool";

const zOrganizationId = z.coerce.number().int().positive();
const zQuotaPeriodId = z.string().regex(/^\d+$/);

export type RepAttainmentRow = {
  quota_id: string; // uuid as text
  rep_id: string; // bigint as text
  rep_name: string | null;
  quota_amount: number;
  carry_forward: number;
  adjusted_quota_amount: number;
  actual_amount: number;
  attainment: number | null;
};

export type ManagerAttainmentRow = {
  quota_id: string; // uuid as text
  manager_id: string; // bigint as text
  manager_name: string | null;
  quota_amount: number;
  carry_forward: number;
  adjusted_quota_amount: number;
  actual_amount: number;
  attainment: number | null;
};

export type VpAttainmentRow = {
  quota_id: string; // uuid as text
  vp_id: string; // bigint as text
  vp_name: string | null;
  quota_amount: number;
  carry_forward: number;
  adjusted_quota_amount: number;
  actual_amount: number;
  attainment: number | null;
};

export type CroAttainmentRow = {
  quota_id: string; // uuid as text
  quota_amount: number;
  carry_forward: number;
  adjusted_quota_amount: number;
  actual_amount: number;
  attainment: number | null;
};

export async function listRepAttainment(args: { orgId: number; quotaPeriodId: string }): Promise<RepAttainmentRow[]> {
  const orgId = zOrganizationId.parse(args.orgId);
  const quotaPeriodId = zQuotaPeriodId.parse(args.quotaPeriodId);

  const { rows } = await pool.query<RepAttainmentRow>(
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
    ORDER BY attainment DESC NULLS LAST, actual_amount DESC, rep_id ASC
    `,
    [orgId, quotaPeriodId]
  );
  return rows as RepAttainmentRow[];
}

export async function listManagerAttainment(args: { orgId: number; quotaPeriodId: string }): Promise<ManagerAttainmentRow[]> {
  const orgId = zOrganizationId.parse(args.orgId);
  const quotaPeriodId = zQuotaPeriodId.parse(args.quotaPeriodId);

  const { rows } = await pool.query<ManagerAttainmentRow>(
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
    ORDER BY attainment DESC NULLS LAST, actual_amount DESC, manager_id ASC
    `,
    [orgId, quotaPeriodId]
  );
  return rows as ManagerAttainmentRow[];
}

export async function listVpAttainment(args: { orgId: number; quotaPeriodId: string }): Promise<VpAttainmentRow[]> {
  const orgId = zOrganizationId.parse(args.orgId);
  const quotaPeriodId = zQuotaPeriodId.parse(args.quotaPeriodId);

  const { rows } = await pool.query<VpAttainmentRow>(
    `
    SELECT
      quota_id::text AS quota_id,
      vp_id::text AS vp_id,
      vp_name,
      quota_amount::float8 AS quota_amount,
      carry_forward::float8 AS carry_forward,
      adjusted_quota_amount::float8 AS adjusted_quota_amount,
      actual_amount::float8 AS actual_amount,
      attainment::float8 AS attainment
    FROM public.vp_attainment($1::int, $2::bigint)
    ORDER BY attainment DESC NULLS LAST, actual_amount DESC, vp_id ASC
    `,
    [orgId, quotaPeriodId]
  );
  return rows as VpAttainmentRow[];
}

export async function listCroAttainment(args: { orgId: number; quotaPeriodId: string }): Promise<CroAttainmentRow[]> {
  const orgId = zOrganizationId.parse(args.orgId);
  const quotaPeriodId = zQuotaPeriodId.parse(args.quotaPeriodId);

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
    ORDER BY attainment DESC NULLS LAST, actual_amount DESC, quota_id ASC
    `,
    [orgId, quotaPeriodId]
  );
  return rows as CroAttainmentRow[];
}

