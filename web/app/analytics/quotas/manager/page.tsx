import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth, type AuthUser } from "../../../../lib/auth";
import { getOrganization, syncManagerQuotas } from "../../../../lib/db";
import { pool } from "../../../../lib/pool";
import type { QuotaPeriodRow, QuotaRow } from "../../../../lib/quotaModels";
import { UserTopNav } from "../../../_components/UserTopNav";
import { dateOnly } from "../../../../lib/dateOnly";
import { FiscalYearSelector } from "../../../../components/quotas/FiscalYearSelector";
import { getDistinctFiscalYears, getQuotaPeriods } from "../actions";
import { ExportToExcelButton } from "../../../_components/ExportToExcelButton";
import { RepQuotaSetupClient } from "./RepQuotaSetupClient";
import { getChannelTerritoryRepIds } from "../../../../lib/channelTerritoryScope";
import {
  isChannelExec,
  isChannelManager,
  isChannelRep,
  isExecManager,
  isManager,
} from "../../../../lib/roleHelpers";
import { crmBucketCaseSql } from "../../../../lib/crmBucketCaseSql";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function quarterNumberFromAny(v: unknown): "" | "1" | "2" | "3" | "4" {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "1" || s === "q1" || s.includes("1st")) return "1";
  if (s === "2" || s === "q2" || s.includes("2nd")) return "2";
  if (s === "3" || s === "q3" || s.includes("3rd")) return "3";
  if (s === "4" || s === "q4" || s.includes("4th")) return "4";
  return "";
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

type DirectRep = { id: number; public_id: string; rep_name: string | null; hierarchy_level: number | null };

async function listDirectReps(args: { orgId: number; managerRepId: number }): Promise<DirectRep[]> {
  const { rows } = await pool.query<DirectRep>(
    `
    SELECT
      r.id,
      r.public_id::text AS public_id,
      COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), ('Rep ' || r.id::text)) AS rep_name,
      u.hierarchy_level
      FROM reps r
      LEFT JOIN users u
        ON u.id = r.user_id
       AND u.org_id = r.organization_id
     WHERE r.organization_id = $1
       AND r.manager_rep_id = $2
       AND r.active IS TRUE
       AND u.id IS NOT NULL
       AND COALESCE(u.active, TRUE) IS TRUE
     ORDER BY rep_name ASC, r.id ASC
    `,
    [args.orgId, args.managerRepId]
  );
  return rows as DirectRep[];
}

async function listChannelDirectReps(args: { orgId: number; channelLeaderUserId: number }): Promise<DirectRep[]> {
  const { rows } = await pool.query<DirectRep>(
    `
    SELECT
      r.id,
      r.public_id::text AS public_id,
      COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), ('Rep ' || r.id::text)) AS rep_name,
      u.hierarchy_level
    FROM reps r
    JOIN users u
      ON u.id = r.user_id
     AND u.org_id = r.organization_id
    WHERE r.organization_id = $1
      AND u.manager_user_id = $2
      AND u.hierarchy_level = 8
      AND r.active IS TRUE
      AND COALESCE(u.active, TRUE) IS TRUE
    ORDER BY rep_name ASC, r.id ASC
    `,
    [args.orgId, args.channelLeaderUserId]
  );
  return rows as DirectRep[];
}

async function listSelfRep(args: { orgId: number; userId: number }): Promise<DirectRep[]> {
  const { rows } = await pool.query<DirectRep>(
    `
    SELECT
      r.id,
      r.public_id::text AS public_id,
      COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), ('Rep ' || r.id::text)) AS rep_name,
      u.hierarchy_level
    FROM reps r
    JOIN users u
      ON u.id = r.user_id
     AND u.org_id = r.organization_id
    WHERE r.organization_id = $1
      AND r.user_id = $2
      AND r.active IS TRUE
      AND COALESCE(u.active, TRUE) IS TRUE
    ORDER BY r.id DESC
    LIMIT 1
    `,
    [args.orgId, args.userId]
  );
  return rows as DirectRep[];
}

async function listQuotaScopedReps(args: {
  orgId: number;
  user: AuthUser;
}) {
  const managerRepId = await managerRepIdForUser({ orgId: args.orgId, userId: args.user.id });

  if (isChannelRep(args.user)) {
    const selfRep = await listSelfRep({ orgId: args.orgId, userId: args.user.id }).catch(() => []);
    return { managerRepId, reps: selfRep, showTeam: false };
  }

  if (isChannelExec(args.user) || isChannelManager(args.user)) {
    const reps = await listChannelDirectReps({
      orgId: args.orgId,
      channelLeaderUserId: args.user.id,
    }).catch(() => []);
    return { managerRepId, reps, showTeam: true };
  }

  if (isManager(args.user) || isExecManager(args.user)) {
    const reps = managerRepId
      ? await listDirectReps({ orgId: args.orgId, managerRepId }).catch(() => [])
      : [];
    return { managerRepId, reps, showTeam: true };
  }

  return { managerRepId, reps: [] as DirectRep[], showTeam: false };
}

async function upsertRepQuota(args: {
  orgId: number;
  repId: number;
  managerId: number | null;
  roleLevel: number;
  quotaPeriodId: string;
  quotaAmount: number;
  annualTarget: number;
  isManual?: boolean;
}) {
  const isManual = args.isManual === true;
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
    [args.orgId, args.quotaPeriodId, args.roleLevel, args.repId, args.managerId]
  );

  const id = String(existing.rows?.[0]?.id || "").trim();
  if (id) {
    await pool.query(
      `
      UPDATE quotas
         SET quota_amount = $3::numeric,
             annual_target = $4::numeric,
             is_manual = $5::boolean,
             updated_at = NOW()
       WHERE org_id = $1::bigint
         AND id = $2::uuid
      `,
      [args.orgId, id, args.quotaAmount, args.annualTarget, isManual]
    );
    return;
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
      quota_amount = EXCLUDED.quota_amount,
      is_manual = EXCLUDED.is_manual,
      updated_at = NOW()
    `,
    [args.orgId, args.repId, args.managerId, args.roleLevel, args.quotaPeriodId, args.quotaAmount, args.annualTarget, isManual]
  );
}

async function resolveRepByPublicId(args: { orgId: number; repPublicId: string }) {
  const { rows } = await pool.query<{ id: number; hierarchy_level: number | null }>(
    `
    SELECT
      r.id,
      u.hierarchy_level
      FROM reps r
      LEFT JOIN users u
        ON u.id = r.user_id
       AND u.org_id = r.organization_id
     WHERE r.organization_id = $1
       AND r.public_id::text = $2
     LIMIT 1
    `,
    [args.orgId, args.repPublicId]
  );
  const row = rows?.[0];
  const id = row?.id;
  if (!Number.isFinite(id)) return null;
  return {
    id: Number(id),
    hierarchy_level: row?.hierarchy_level == null ? null : Number(row.hierarchy_level),
  };
}

async function listRepQuotasByPeriodIds(args: { orgId: number; repId: number; quotaPeriodIds: string[] }): Promise<QuotaRow[]> {
  if (!args.quotaPeriodIds.length) return [];
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
      AND role_level = (
        SELECT COALESCE(u.hierarchy_level, 3)
          FROM reps r
          JOIN users u ON u.id = r.user_id
         WHERE r.id = $2::bigint
         LIMIT 1
      )
      AND rep_id = $2::bigint
      AND quota_period_id = ANY($3::bigint[])
    ORDER BY quota_period_id DESC, id DESC
    `,
    [args.orgId, args.repId, args.quotaPeriodIds.map((n) => String(n))]
  );
  return rows as QuotaRow[];
}

async function saveRepQuotasForYearAction(formData: FormData) {
  "use server";
  const fiscal_year = String(formData.get("fiscal_year") || "").trim();
  const rep_public_id = String(formData.get("rep_public_id") || "").trim();
  const annual_target_raw = String(formData.get("annual_target") || "").trim();
  const annual_target = annual_target_raw ? Number(annual_target_raw) : NaN;
  const q1_quota = Number(formData.get("q1_quota") || 0) || 0;
  const q2_quota = Number(formData.get("q2_quota") || 0) || 0;
  const q3_quota = Number(formData.get("q3_quota") || 0) || 0;
  const q4_quota = Number(formData.get("q4_quota") || 0) || 0;

  if (!fiscal_year) redirect(`/analytics/quotas/manager?error=${encodeURIComponent("fiscal_year is required")}`);
  if (!rep_public_id)
    redirect(`/analytics/quotas/manager?fiscal_year=${encodeURIComponent(fiscal_year)}&error=${encodeURIComponent("rep is required")}`);
  if (!Number.isFinite(annual_target) || annual_target <= 0) {
    redirect(
      `/analytics/quotas/manager?fiscal_year=${encodeURIComponent(fiscal_year)}&rep_public_id=${encodeURIComponent(rep_public_id)}&error=${encodeURIComponent(
        "annual_target is required"
      )}`
    );
  }
  const annualTarget = Number(annual_target);
  const sum = (Number(q1_quota) || 0) + (Number(q2_quota) || 0) + (Number(q3_quota) || 0) + (Number(q4_quota) || 0);
  if (sum - annualTarget > 1e-6) {
    redirect(
      `/analytics/quotas/manager?fiscal_year=${encodeURIComponent(fiscal_year)}&rep_public_id=${encodeURIComponent(rep_public_id)}&error=${encodeURIComponent(
        "Quarter quotas exceed annual quota"
      )}`
    );
  }

  const ctx = await requireAuth();
  if (
    ctx.kind !== "user" ||
    (!isExecManager(ctx.user) && !isManager(ctx.user) && !isChannelExec(ctx.user) && !isChannelManager(ctx.user) && !isChannelRep(ctx.user))
  ) {
    redirect("/dashboard");
  }

  const quotaScope = await listQuotaScopedReps({ orgId: ctx.user.org_id, user: ctx.user });
  const allowedRepIds = new Set(quotaScope.reps.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0));

  const rep = await resolveRepByPublicId({ orgId: ctx.user.org_id, repPublicId: rep_public_id });
  const repId = rep?.id ?? null;
  if (!repId || !allowedRepIds.has(repId))
    redirect(`/analytics/quotas/manager?fiscal_year=${encodeURIComponent(fiscal_year)}&rep_public_id=${encodeURIComponent(rep_public_id)}&error=${encodeURIComponent("rep not found")}`);

  const periodsRes = await getQuotaPeriods().catch(() => ({ ok: true as const, data: [] as QuotaPeriodRow[] }));
  const allPeriods = periodsRes.ok ? periodsRes.data : [];
  const yearPeriods = allPeriods.filter((p) => String(p.fiscal_year) === fiscal_year);
  const byQuarter = new Map<string, QuotaPeriodRow>();
  for (const p of yearPeriods) {
    const fq = quarterNumberFromAny(p.fiscal_quarter);
    if (fq) byQuarter.set(fq, p);
  }
  const q1p = byQuarter.get("1") || null;
  const q2p = byQuarter.get("2") || null;
  const q3p = byQuarter.get("3") || null;
  const q4p = byQuarter.get("4") || null;
  if (!q1p || !q2p || !q3p || !q4p) {
    redirect(
      `/analytics/quotas/manager?fiscal_year=${encodeURIComponent(fiscal_year)}&rep_public_id=${encodeURIComponent(rep_public_id)}&error=${encodeURIComponent(
        "Missing quota periods for this fiscal year (Q1-Q4). Ask Admin to set quarter dates."
      )}`
    );
  }

  const manualLevels = new Set([0, 1, 2, 6, 7]);
  let quotaIsManual = false;
  const hl = ctx.user.hierarchy_level;
  if (hl != null && Number.isFinite(Number(hl)) && manualLevels.has(Number(hl))) {
    const chk = await pool.query<{ ok: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
          FROM reps r
         WHERE r.id = $1::bigint
           AND r.organization_id = $2::bigint
           AND r.user_id = $3::bigint
      ) AS ok
      `,
      [repId, ctx.user.org_id, ctx.user.id]
    );
    quotaIsManual = chk.rows[0]?.ok === true;
  }

  const quarterAssignments = [
    { quota_period_id: String(q1p.id), quota_amount: q1_quota },
    { quota_period_id: String(q2p.id), quota_amount: q2_quota },
    { quota_period_id: String(q3p.id), quota_amount: q3_quota },
    { quota_period_id: String(q4p.id), quota_amount: q4_quota },
  ];
  for (const qa of quarterAssignments) {
    await upsertRepQuota({
      orgId: ctx.user.org_id,
      repId,
      managerId: quotaScope.managerRepId ?? null,
      roleLevel: rep?.hierarchy_level ?? 3,
      quotaPeriodId: qa.quota_period_id,
      quotaAmount: qa.quota_amount,
      annualTarget,
      isManual: quotaIsManual,
    });
  }

  await syncManagerQuotas({ orgId: ctx.user.org_id, startRepId: repId }).catch(() => null);

  revalidatePath("/analytics/quotas/manager");

  const directReps = quotaScope.reps;
  const repList = (directReps || []).map((r) => String(r.public_id || "")).filter(Boolean);
  const idx = repList.findIndex((x) => x === rep_public_id);
  const nextRep = idx >= 0 && idx + 1 < repList.length ? repList[idx + 1] : rep_public_id;
  redirect(`/analytics/quotas/manager?fiscal_year=${encodeURIComponent(fiscal_year)}&rep_public_id=${encodeURIComponent(nextRep)}`);
}

export const runtime = "nodejs";

export default async function AnalyticsQuotasManagerPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (
    !isExecManager(ctx.user) &&
    !isManager(ctx.user) &&
    !isChannelExec(ctx.user) &&
    !isChannelManager(ctx.user) &&
    !isChannelRep(ctx.user)
  ) {
    redirect("/dashboard");
  }

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const fiscal_year_raw = String(sp(searchParams.fiscal_year) || "").trim();
  const rep_public_id = String(sp(searchParams.rep_public_id) || "").trim();
  const error = String(sp(searchParams.error) || "").trim();

  const fyRes = await getDistinctFiscalYears().catch(() => ({ ok: true as const, data: [] as Array<{ fiscal_year: string }> }));
  const fiscalYears = fyRes.ok ? fyRes.data : [];

  const periodsRes = await getQuotaPeriods().catch(() => ({ ok: true as const, data: [] as QuotaPeriodRow[] }));
  const allPeriods = periodsRes.ok ? periodsRes.data : [];
  const todayIso = dateOnly(new Date()) || new Date().toISOString().slice(0, 10);
  const periodContainingToday =
    allPeriods.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;
  const defaultYear = periodContainingToday ? String(periodContainingToday.fiscal_year) : String(fiscalYears[0]?.fiscal_year || "").trim();
  const fiscal_year = fiscal_year_raw || defaultYear;
  const periods = fiscal_year ? allPeriods.filter((p) => String(p.fiscal_year) === fiscal_year) : allPeriods;

  const quotaScope = await listQuotaScopedReps({ orgId: ctx.user.org_id, user: ctx.user });
  const directReps = quotaScope.reps;
  const directRepIds = (directReps || [])
    .map((r) => Number(r.id))
    .filter((n) => Number.isFinite(n) && n > 0);
  const closedWonRepIds =
    isChannelExec(ctx.user) || isChannelManager(ctx.user)
      ? (
          await getChannelTerritoryRepIds({
            orgId: ctx.user.org_id,
            channelUserId: ctx.user.id,
          }).catch(() => ({ repIds: [] as number[], partnerNames: [] as string[] }))
        ).repIds
      : directRepIds;
  const repOptions = (directReps || []).map((r) => ({ public_id: String(r.public_id || ""), rep_name: String(r.rep_name || "") })).filter((r) => !!r.public_id);
  const selectedRepPublicId = rep_public_id || repOptions[0]?.public_id || "";
  const selectedRepName = repOptions.find((r) => r.public_id === selectedRepPublicId)?.rep_name || "";

  const yearPeriods = fiscal_year ? periods : [];
  const byQuarter = new Map<string, QuotaPeriodRow>();
  for (const p of yearPeriods) {
    const qn = quarterNumberFromAny(p.fiscal_quarter) || quarterNumberFromAny(p.period_name);
    if (!qn) continue;
    byQuarter.set(qn, p);
    byQuarter.set(`Q${qn}`, p);
  }
  const q1p = byQuarter.get("Q1") || null;
  const q2p = byQuarter.get("Q2") || null;
  const q3p = byQuarter.get("Q3") || null;
  const q4p = byQuarter.get("Q4") || null;
  const quarterPeriodIds = [q1p?.id, q2p?.id, q3p?.id, q4p?.id].filter(Boolean).map(String);

  const selectedRep = selectedRepPublicId ? await resolveRepByPublicId({ orgId: ctx.user.org_id, repPublicId: selectedRepPublicId }) : null;
  const selectedRepId = selectedRep?.id ?? null;
  const quotas =
    selectedRepId && quarterPeriodIds.length
      ? await listRepQuotasByPeriodIds({ orgId: ctx.user.org_id, repId: selectedRepId, quotaPeriodIds: quarterPeriodIds }).catch(() => [])
      : [];
  const quotaByPeriodId = new Map<string, QuotaRow>();
  for (const q of quotas) {
    const k = String(q.quota_period_id || "");
    if (!k) continue;
    if (!quotaByPeriodId.has(k)) quotaByPeriodId.set(k, q);
  }

  const existingAnnualQuota = (() => {
    for (const q of quotas || []) {
      const n = (q as any).annual_target;
      const v = n == null ? null : Number(n);
      if (v != null && Number.isFinite(v) && v > 0) return v;
    }
    return null;
  })();

  // --------------------------------------------
  // Rep list: quota by quarter + closed won by quarter
  // --------------------------------------------
  const quarters = [
    { key: "Q1", p: q1p },
    { key: "Q2", p: q2p },
    { key: "Q3", p: q3p },
    { key: "Q4", p: q4p },
  ].filter((q) => !!q.p) as Array<{ key: "Q1" | "Q2" | "Q3" | "Q4"; p: QuotaPeriodRow }>;

  const quarterIds = quarters.map((q) => String(q.p.id));

  const repQuotaRows =
    fiscal_year && directRepIds.length && quarterIds.length
      ? await pool
          .query<{ rep_id: string; quota_period_id: string; quota_amount: number }>(
            `
            SELECT
              q.rep_id::text AS rep_id,
              q.quota_period_id::text AS quota_period_id,
              COALESCE(q.quota_amount, 0)::float8 AS quota_amount
            FROM quotas q
            JOIN reps r
              ON r.id = q.rep_id
             AND r.organization_id = q.org_id
            JOIN users u
              ON u.id = r.user_id
             AND u.org_id = q.org_id
            WHERE q.org_id = $1::bigint
              AND q.role_level = COALESCE(u.hierarchy_level, 3)
              AND q.rep_id = ANY($2::bigint[])
              AND q.quota_period_id = ANY($3::bigint[])
            `,
            [ctx.user.org_id, directRepIds, quarterIds]
          )
          .then((r) => r.rows || [])
          .catch(() => [])
      : [];

  const repWonRows =
    fiscal_year && closedWonRepIds.length && quarterIds.length
      ? await pool
          .query<{ rep_id: string; quota_period_id: string; won_amount: number }>(
            `
            WITH periods AS (
              SELECT id, period_start::date AS period_start, period_end::date AS period_end
                FROM quota_periods
               WHERE org_id = $1::bigint
                 AND id = ANY($2::bigint[])
            ),
            deals AS (
              SELECT
                o.rep_id,
                COALESCE(o.amount, 0) AS amount,
                lower(
                  regexp_replace(
                    COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''),
                    '[^a-zA-Z]+',
                    ' ',
                    'g'
                  )
                ) AS fs,
                (${crmBucketCaseSql("o")}) AS crm_bucket,
                CASE
                  WHEN o.close_date IS NULL THEN NULL
                  WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
                  WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
                    to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'MM/DD/YYYY')
                  ELSE NULL
                END AS close_d
              FROM opportunities o
              LEFT JOIN org_stage_mappings stm
                ON stm.org_id = o.org_id
               AND stm.field = 'stage'
               AND lower(btrim(stm.stage_value)) = lower(btrim(COALESCE(o.sales_stage::text, '')))
              LEFT JOIN org_stage_mappings fcm
                ON fcm.org_id = o.org_id
               AND fcm.field = 'forecast_category'
               AND lower(btrim(fcm.stage_value)) = lower(btrim(COALESCE(o.forecast_stage::text, '')))
              WHERE o.org_id = $1
                AND o.rep_id = ANY($3::bigint[])
            )
            SELECT
              d.rep_id::text AS rep_id,
              p.id::text AS quota_period_id,
              COALESCE(SUM(d.amount), 0)::float8 AS won_amount
            FROM deals d
            JOIN periods p ON d.close_d IS NOT NULL AND d.close_d >= p.period_start AND d.close_d <= p.period_end
            WHERE d.crm_bucket = 'won'
            GROUP BY d.rep_id, p.id
            `,
            [ctx.user.org_id, quarterIds, closedWonRepIds]
          )
          .then((r) => r.rows || [])
          .catch(() => [])
      : [];

  const quotaByRepPeriod = new Map<string, number>();
  for (const r of repQuotaRows) {
    const k = `${String(r.rep_id)}|${String(r.quota_period_id)}`;
    quotaByRepPeriod.set(k, Number((r as any).quota_amount || 0) || 0);
  }
  const wonByRepPeriod = new Map<string, number>();
  for (const r of repWonRows) {
    const k = `${String(r.rep_id)}|${String(r.quota_period_id)}`;
    wonByRepPeriod.set(k, Number((r as any).won_amount || 0) || 0);
  }

  const channelLeaderClosedWon = isChannelExec(ctx.user) || isChannelManager(ctx.user);
  const territoryWonByPeriodId = channelLeaderClosedWon
    ? new Map(
        quarterIds.map((pid) => {
          let t = 0;
          for (const rid of closedWonRepIds) {
            t += wonByRepPeriod.get(`${rid}|${pid}`) || 0;
          }
          return [pid, t] as const;
        })
      )
    : null;

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Team Quotas</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Manager quota assignment and team rollups.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/analytics" className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
              Analytics home
            </Link>
          </div>
        </div>

        {error ? (
          <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="text-sm font-medium text-[color:var(--sf-text-primary)]">Error</div>
            <div className="mt-1 font-mono text-xs text-[color:var(--sf-text-secondary)]">{error}</div>
          </section>
        ) : null}

        <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Filters</h2>
          <form method="GET" action="/analytics/quotas/manager" className="mt-3 grid gap-3 md:grid-cols-3">
            <FiscalYearSelector name="fiscal_year" fiscalYears={fiscalYears} defaultValue={fiscal_year} required={false} label="Fiscal Year" />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Sales Rep</label>
              <select
                name="rep_public_id"
                defaultValue={selectedRepPublicId}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              >
                {repOptions.map((r) => (
                  <option key={r.public_id} value={r.public_id}>
                    {r.rep_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end justify-end gap-2">
              <Link
                href="/analytics/quotas/manager"
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Reset
              </Link>
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Apply
              </button>
            </div>
          </form>
        </section>

        {!fiscal_year ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <p className="text-sm text-[color:var(--sf-text-secondary)]">Select a fiscal year to set rep quotas by quarter.</p>
          </section>
        ) : null}

        {fiscal_year && quotaScope.showTeam ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Rep quota setup</h2>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Rep: <span className="font-medium">{selectedRepName || "—"}</span> · Fiscal year:{" "}
              <span className="font-mono text-xs">{fiscal_year}</span>
            </p>
            <RepQuotaSetupClient
              action={saveRepQuotasForYearAction}
              fiscalYear={fiscal_year}
              repPublicId={selectedRepPublicId}
              repName={selectedRepName}
              initialAnnualQuota={existingAnnualQuota}
              quarters={[
                {
                  key: "q1",
                  label: "1st Quarter",
                  periodLabel: q1p ? `${dateOnly(q1p.period_start)} → ${dateOnly(q1p.period_end)}` : "Missing quarter period",
                  initialQuotaAmount: q1p ? Number(quotaByPeriodId.get(String(q1p.id))?.quota_amount || 0) || 0 : 0,
                  disabled: !q1p,
                },
                {
                  key: "q2",
                  label: "2nd Quarter",
                  periodLabel: q2p ? `${dateOnly(q2p.period_start)} → ${dateOnly(q2p.period_end)}` : "Missing quarter period",
                  initialQuotaAmount: q2p ? Number(quotaByPeriodId.get(String(q2p.id))?.quota_amount || 0) || 0 : 0,
                  disabled: !q2p,
                },
                {
                  key: "q3",
                  label: "3rd Quarter",
                  periodLabel: q3p ? `${dateOnly(q3p.period_start)} → ${dateOnly(q3p.period_end)}` : "Missing quarter period",
                  initialQuotaAmount: q3p ? Number(quotaByPeriodId.get(String(q3p.id))?.quota_amount || 0) || 0 : 0,
                  disabled: !q3p,
                },
                {
                  key: "q4",
                  label: "4th Quarter",
                  periodLabel: q4p ? `${dateOnly(q4p.period_start)} → ${dateOnly(q4p.period_end)}` : "Missing quarter period",
                  initialQuotaAmount: q4p ? Number(quotaByPeriodId.get(String(q4p.id))?.quota_amount || 0) || 0 : 0,
                  disabled: !q4p,
                },
              ]}
            />
          </section>
        ) : null}

        {fiscal_year ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Rep quotas vs Closed Won (by quarter)</h2>
                <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                  Direct reports · Fiscal year: <span className="font-mono text-xs">{fiscal_year}</span>
                </p>
              </div>
            </div>

            {!quarters.length ? (
              <div className="mt-4 text-sm text-[color:var(--sf-text-secondary)]">
                Missing quota periods for this fiscal year (Q1–Q4). Ask Admin to set quarter dates in quota periods.
              </div>
            ) : !directReps.length ? (
              <div className="mt-4 text-sm text-[color:var(--sf-text-secondary)]">No direct-report reps found.</div>
            ) : (
              <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                    <tr>
                      <th className="px-4 py-3">rep</th>
                      {quarters.map((q) => (
                        <th key={q.key} className="px-4 py-3">
                          <div className="font-semibold text-[color:var(--sf-text-primary)]">{q.key}</div>
                          <div className="mt-0.5 text-[11px] font-normal text-[color:var(--sf-text-secondary)]">
                            {dateOnly(q.p.period_start)} → {dateOnly(q.p.period_end)}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {directReps.map((rep) => (
                      <tr key={rep.public_id} className="border-t border-[color:var(--sf-border)]">
                        <td className="px-4 py-3 font-medium text-[color:var(--sf-text-primary)]">{rep.rep_name || "—"}</td>
                        {quarters.map((q) => {
                          const pid = String(q.p.id);
                          const repId = String(rep.id);
                          const quota = quotaByRepPeriod.get(`${repId}|${pid}`) || 0;
                          return (
                            <td key={`${rep.public_id}:${q.key}`} className="px-4 py-3 align-top">
                              <div className="grid gap-1">
                                <div className="text-[11px] text-[color:var(--sf-text-secondary)]">quota</div>
                                <div className="font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(quota)}</div>
                                {!channelLeaderClosedWon ? (
                                  <>
                                    <div className="mt-1 text-[11px] text-[color:var(--sf-text-secondary)]">closed won</div>
                                    <div className="font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">
                                      {fmtMoney(wonByRepPeriod.get(`${repId}|${pid}`) || 0)}
                                    </div>
                                  </>
                                ) : null}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-3 flex items-center justify-end">
              <ExportToExcelButton
                fileName={`Team Quotas - Quota vs Won - ${fiscal_year}`}
                sheets={[
                  {
                    name: "Quota vs Won",
                    rows: directReps.map((rep) => {
                      const out: Record<string, any> = { rep: rep.rep_name || "—" };
                      for (const q of quarters) {
                        const pid = String(q.p.id);
                        const repId = String(rep.id);
                        const quota = quotaByRepPeriod.get(`${repId}|${pid}`) || 0;
                        const won = channelLeaderClosedWon
                          ? territoryWonByPeriodId!.get(pid) || 0
                          : wonByRepPeriod.get(`${repId}|${pid}`) || 0;
                        out[`${q.key}_quota`] = quota;
                        out[`${q.key}_won`] = won;
                      }
                      return out;
                    }) as any,
                  },
                ]}
              />
            </div>
          </section>
        ) : null}

      </main>
    </div>
  );
}

