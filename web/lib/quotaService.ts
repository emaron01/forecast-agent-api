import { pool } from "./pool";

async function resolveRepQuotaContext(args: { orgId: number; repId: number }): Promise<{
  roleLevel: number;
  managerRepId: number | null;
}> {
  const { rows } = await pool.query<{ hierarchy_level: number | null; manager_rep_id: number | null }>(
    `
    SELECT
      u.hierarchy_level,
      r.manager_rep_id
      FROM reps r
      LEFT JOIN users u
        ON u.id = r.user_id
       AND u.org_id = r.organization_id
     WHERE COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
       AND r.id = $2::bigint
     LIMIT 1
    `,
    [args.orgId, args.repId]
  );
  const roleLevel = Number(rows?.[0]?.hierarchy_level);
  const managerRepId = Number(rows?.[0]?.manager_rep_id);
  return {
    roleLevel: Number.isFinite(roleLevel) ? roleLevel : 3,
    managerRepId: Number.isFinite(managerRepId) && managerRepId > 0 ? managerRepId : null,
  };
}

async function resolveFiscalYearForPeriod(args: { orgId: number; quotaPeriodId: number }): Promise<string | null> {
  const { rows } = await pool.query<{ fiscal_year: string | null }>(
    `
    SELECT fiscal_year
      FROM quota_periods
     WHERE org_id = $1::bigint
       AND id = $2::bigint
     LIMIT 1
    `,
    [args.orgId, args.quotaPeriodId]
  );
  const fiscalYear = String(rows?.[0]?.fiscal_year || "").trim();
  return fiscalYear || null;
}

async function checkManagerHasQuota(args: {
  orgId: number;
  managerRepId: number;
  fiscalYear: string;
}): Promise<boolean> {
  const { rows } = await pool.query<{ has_quota: boolean }>(
    `
    SELECT COALESCE(SUM(q.quota_amount), 0) > 0 AS has_quota
      FROM quotas q
      JOIN quota_periods qp
        ON qp.id = q.quota_period_id
       AND qp.org_id = q.org_id
     WHERE q.org_id = $1::bigint
       AND q.rep_id = $2::bigint
       AND qp.fiscal_year = $3
    `,
    [args.orgId, args.managerRepId, args.fiscalYear]
  );
  return rows?.[0]?.has_quota === true;
}

export async function upsertRepQuotaForPeriod(args: {
  orgId: number;
  repId: number;
  quotaPeriodId: number;
  quotaAmount: number;
  annualTarget: number;
  managerId?: number | null;
  isAdmin?: boolean;
}): Promise<void> {
  const { roleLevel, managerRepId } = await resolveRepQuotaContext({ orgId: args.orgId, repId: args.repId });
  const fiscalYear = await resolveFiscalYearForPeriod({ orgId: args.orgId, quotaPeriodId: args.quotaPeriodId });
  if (!args.isAdmin && (roleLevel === 3 || roleLevel === 8) && managerRepId != null && fiscalYear) {
    const managerHasQuota = await checkManagerHasQuota({
      orgId: args.orgId,
      managerRepId,
      fiscalYear,
    });
    if (!managerHasQuota) {
      throw new Error("manager_quota_required");
    }
  }

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
      is_manual
    ) VALUES (
      $1::bigint,
      $2::bigint,
      $3::bigint,
      $4::int,
      $5::bigint,
      $6::numeric,
      $7::numeric,
      $8::boolean
    )
    ON CONFLICT (org_id, rep_id, quota_period_id)
    DO UPDATE SET
      manager_id = EXCLUDED.manager_id,
      role_level = EXCLUDED.role_level,
      quota_amount = EXCLUDED.quota_amount,
      annual_target = EXCLUDED.annual_target,
      is_manual = EXCLUDED.is_manual,
      updated_at = NOW()
    `,
    [
      args.orgId,
      args.repId,
      args.managerId ?? null,
      roleLevel,
      args.quotaPeriodId,
      args.quotaAmount,
      args.annualTarget,
      true,
    ]
  );
}

export async function protectLeaderQuotaRows(args: {
  orgId: number;
  leaderRepId: number;
}): Promise<void> {
  await pool.query(
    `
    UPDATE quotas
       SET is_manual = true,
           updated_at = NOW()
     WHERE org_id = $1::bigint
       AND rep_id = $2::bigint
    `,
    [args.orgId, args.leaderRepId]
  );
}
