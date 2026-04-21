import { pool } from "./pool";

async function resolveRepRoleLevel(args: { orgId: number; repId: number }): Promise<number> {
  const { rows } = await pool.query<{ hierarchy_level: number | null }>(
    `
    SELECT u.hierarchy_level
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
  return Number.isFinite(roleLevel) ? roleLevel : 3;
}

export async function upsertRepQuotaForPeriod(args: {
  orgId: number;
  repId: number;
  quotaPeriodId: number;
  quotaAmount: number;
  annualTarget: number;
  managerId?: number | null;
  isManual?: boolean;
}): Promise<void> {
  const roleLevel = await resolveRepRoleLevel({ orgId: args.orgId, repId: args.repId });
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
      args.isManual === true,
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
