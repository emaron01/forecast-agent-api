import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment } from "react";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { pool } from "../../../lib/pool";
import { getHealthAveragesByPeriods } from "../../../lib/analyticsHealth";
import { UserTopNav } from "../../_components/UserTopNav";
import { ExportToExcelButton } from "../../_components/ExportToExcelButton";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function fmtNum(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString();
}

function healthFracFrom30(score: any) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(0, Math.min(1, n / 30));
}

function safeDiv(n: number, d: number) {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

function deltaLabel(curr: number | null, prev: number | null, kind: "money" | "pct" | "num" | "days") {
  if (curr == null || prev == null) return "—";
  const d = curr - prev;
  const sign = d > 0 ? "+" : d < 0 ? "−" : "";
  const abs = Math.abs(d);
  if (kind === "money") return `${sign}${fmtMoney(abs)}`;
  if (kind === "pct") return `${sign}${fmtPct(abs)}`;
  if (kind === "days") return `${sign}${Math.round(abs)}d`;
  return `${sign}${fmtNum(abs)}`;
}

type QuotaPeriodLite = {
  id: string;
  period_name: string;
  period_start: string;
  period_end: string;
  fiscal_year: string;
  fiscal_quarter: string;
};

type RepLite = { id: number; rep_name: string; display_name: string | null; manager_rep_id: number | null; active: boolean | null };
type ManagerOption = { id: number; name: string };
type RepOption = { id: number; name: string; manager_rep_id: number | null };

type PeriodKpisRow = {
  quota_period_id: string;
  period_start: string;
  period_end: string;
  total_count: number;
  won_count: number;
  lost_count: number;
  active_count: number;
  won_amount: number;
  lost_amount: number;
  active_amount: number;
  commit_amount: number;
  best_amount: number;
  pipeline_amount: number;
  created_amount: number;
  created_count: number;
  partner_closed_amount: number;
  closed_amount: number;
  partner_won_count: number;
  partner_closed_count: number;
  avg_days_won: number | null;
  avg_days_lost: number | null;
  avg_days_active: number | null;
};

type QuotaTotalsRow = { quota_period_id: string; quota_amount: number };
type QuotaByRepPeriodRow = { quota_period_id: string; rep_id: string; quota_amount: number };
type QuotaByManagerRow = { manager_id: string; manager_name: string; quota_amount: number };
type QuotaByRepRow = { rep_id: string; rep_name: string; quota_amount: number };

type RepPeriodKpisRow = {
  quota_period_id: string;
  rep_id: string;
  rep_name: string;
  total_count: number;
  won_count: number;
  lost_count: number;
  active_count: number;
  won_amount: number;
  active_amount: number;
  commit_amount: number;
  best_amount: number;
  pipeline_amount: number;
  partner_closed_amount: number;
  closed_amount: number;
  partner_won_count: number;
  partner_closed_count: number;
  avg_days_won: number | null;
  avg_days_lost: number | null;
  avg_days_active: number | null;
};

type CreatedByRepRow = { quota_period_id: string; rep_id: string; created_amount: number; created_count: number };

export const runtime = "nodejs";

async function listQuotaPeriodsForOrg(orgId: number): Promise<QuotaPeriodLite[]> {
  const { rows } = await pool.query<QuotaPeriodLite>(
    `
    SELECT
      id::text AS id,
      period_name,
      period_start::text AS period_start,
      period_end::text AS period_end,
      fiscal_year,
      fiscal_quarter::text AS fiscal_quarter
    FROM quota_periods
    WHERE org_id = $1::bigint
    ORDER BY period_start DESC, id DESC
    `,
    [orgId]
  );
  return (rows || []) as QuotaPeriodLite[];
}

async function listRepsForOrg(orgId: number): Promise<RepLite[]> {
  const { rows } = await pool.query<RepLite>(
    `
    SELECT
      id,
      rep_name,
      display_name,
      manager_rep_id,
      active
    FROM reps
    WHERE organization_id = $1
    ORDER BY COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(rep_name), ''), id::text) ASC, id ASC
    `,
    [orgId]
  );
  return (rows || []) as RepLite[];
}

async function listManagerOptions(orgId: number): Promise<ManagerOption[]> {
  const { rows } = await pool.query<{ id: number; name: string }>(
    `
    WITH mgr_ids AS (
      SELECT DISTINCT manager_rep_id AS id
        FROM reps
       WHERE organization_id = $1
         AND manager_rep_id IS NOT NULL
    )
    SELECT
      r.id,
      COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), ('Manager ' || r.id::text)) AS name
    FROM reps r
    JOIN mgr_ids m ON m.id = r.id
    WHERE r.organization_id = $1
    ORDER BY name ASC, r.id ASC
    `,
    [orgId]
  );
  return (rows || []) as any[];
}

async function listDirectRepIds(orgId: number, managerRepId: number): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(
    `
    SELECT id
      FROM reps
     WHERE organization_id = $1
       AND manager_rep_id = $2
       AND active IS TRUE
     ORDER BY id ASC
    `,
    [orgId, managerRepId]
  );
  return (rows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
}

async function getQuotaTotals(args: { orgId: number; quotaPeriodIds: string[]; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<QuotaTotalsRow>(
    `
    SELECT
      quota_period_id::text AS quota_period_id,
      COALESCE(SUM(quota_amount), 0)::float8 AS quota_amount
    FROM quotas
    WHERE org_id = $1::bigint
      AND role_level = 3
      AND quota_period_id = ANY($2::bigint[])
      AND (NOT $4::boolean OR rep_id = ANY($3::bigint[]))
    GROUP BY quota_period_id
    ORDER BY quota_period_id DESC
    `,
    [args.orgId, args.quotaPeriodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

async function getPeriodKpis(args: { orgId: number; periodIds: string[]; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<PeriodKpisRow>(
    `
    WITH periods AS (
      SELECT
        id::bigint AS quota_period_id,
        period_start::date AS period_start,
        period_end::date AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = ANY($2::bigint[])
    ),
    base AS (
      SELECT
        p.quota_period_id::text AS quota_period_id,
        p.period_start::text AS period_start,
        p.period_end::text AS period_end,
        COALESCE(o.amount, 0)::float8 AS amount,
        o.partner_name,
        o.create_date,
        o.close_date,
        lower(
          regexp_replace(
            COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
            '[^a-zA-Z]+',
            ' ',
            'g'
          )
        ) AS fs,
        p.period_end::timestamptz AS period_end_ts
      FROM periods p
      JOIN opportunities o
        ON o.org_id = $1
       AND o.close_date IS NOT NULL
       AND o.close_date >= p.period_start
       AND o.close_date <= p.period_end
       AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
    ),
    classified AS (
      SELECT
        *,
        ((' ' || fs || ' ') LIKE '% won %') AS is_won,
        ((' ' || fs || ' ') LIKE '% lost %') AS is_lost,
        (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) AS is_active,
        CASE
          WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) AND fs LIKE '%commit%' THEN 'commit'
          WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) AND fs LIKE '%best%' THEN 'best'
          WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) THEN 'pipeline'
          WHEN ((' ' || fs || ' ') LIKE '% won %') THEN 'won'
          WHEN ((' ' || fs || ' ') LIKE '% lost %') THEN 'lost'
          ELSE 'other'
        END AS bucket
      FROM base
    )
    SELECT
      quota_period_id,
      period_start,
      period_end,
      COUNT(*)::int AS total_count,
      COALESCE(SUM(CASE WHEN is_won THEN 1 ELSE 0 END), 0)::int AS won_count,
      COALESCE(SUM(CASE WHEN is_lost THEN 1 ELSE 0 END), 0)::int AS lost_count,
      COALESCE(SUM(CASE WHEN is_active THEN 1 ELSE 0 END), 0)::int AS active_count,
      COALESCE(SUM(CASE WHEN is_won THEN amount ELSE 0 END), 0)::float8 AS won_amount,
      COALESCE(SUM(CASE WHEN is_lost THEN amount ELSE 0 END), 0)::float8 AS lost_amount,
      COALESCE(SUM(CASE WHEN is_active THEN amount ELSE 0 END), 0)::float8 AS active_amount,
      COALESCE(SUM(CASE WHEN bucket = 'commit' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
      COALESCE(SUM(CASE WHEN bucket = 'best' THEN amount ELSE 0 END), 0)::float8 AS best_amount,
      COALESCE(SUM(CASE WHEN bucket = 'pipeline' THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
      COALESCE(SUM(CASE WHEN create_date IS NOT NULL AND (create_date::date >= period_start::date AND create_date::date <= period_end::date) THEN amount ELSE 0 END), 0)::float8 AS created_amount,
      COALESCE(SUM(CASE WHEN create_date IS NOT NULL AND (create_date::date >= period_start::date AND create_date::date <= period_end::date) THEN 1 ELSE 0 END), 0)::int AS created_count,
      COALESCE(SUM(CASE WHEN (is_won OR is_lost) AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN amount ELSE 0 END), 0)::float8 AS partner_closed_amount,
      COALESCE(SUM(CASE WHEN (is_won OR is_lost) THEN amount ELSE 0 END), 0)::float8 AS closed_amount,
      COALESCE(SUM(CASE WHEN is_won AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN 1 ELSE 0 END), 0)::int AS partner_won_count,
      COALESCE(SUM(CASE WHEN (is_won OR is_lost) AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN 1 ELSE 0 END), 0)::int AS partner_closed_count,
      AVG(
        CASE
          WHEN is_won AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0
          ELSE NULL
        END
      )::float8 AS avg_days_won,
      AVG(
        CASE
          WHEN is_lost AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0
          ELSE NULL
        END
      )::float8 AS avg_days_lost,
      AVG(
        CASE
          WHEN is_active AND create_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (LEAST(NOW(), period_end_ts) - create_date)) / 86400.0
          ELSE NULL
        END
      )::float8 AS avg_days_active
    FROM classified
    GROUP BY quota_period_id, period_start, period_end
    ORDER BY period_start DESC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

async function getQuotaByRepPeriod(args: { orgId: number; quotaPeriodIds: string[]; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<QuotaByRepPeriodRow>(
    `
    SELECT
      quota_period_id::text AS quota_period_id,
      rep_id::text AS rep_id,
      COALESCE(SUM(quota_amount), 0)::float8 AS quota_amount
    FROM quotas
    WHERE org_id = $1::bigint
      AND role_level = 3
      AND rep_id IS NOT NULL
      AND quota_period_id = ANY($2::bigint[])
      AND (NOT $4::boolean OR rep_id = ANY($3::bigint[]))
    GROUP BY quota_period_id, rep_id
    ORDER BY quota_period_id DESC, rep_id ASC
    `,
    [args.orgId, args.quotaPeriodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

async function getQuotaBreakdownForPeriod(args: { orgId: number; quotaPeriodId: string; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const [byManager, byRep] = await Promise.all([
    pool
      .query<QuotaByManagerRow>(
        `
        SELECT
          q.manager_id::text AS manager_id,
          COALESCE(NULLIF(btrim(m.display_name), ''), NULLIF(btrim(m.rep_name), ''), ('Manager ' || q.manager_id::text)) AS manager_name,
          COALESCE(SUM(q.quota_amount), 0)::float8 AS quota_amount
        FROM quotas q
        LEFT JOIN reps m
          ON m.organization_id = $1
         AND m.id = q.manager_id
        WHERE q.org_id = $1::bigint
          AND q.role_level = 3
          AND q.quota_period_id = $2::bigint
          AND q.manager_id IS NOT NULL
          AND (NOT $4::boolean OR q.rep_id = ANY($3::bigint[]))
        GROUP BY q.manager_id, manager_name
        ORDER BY quota_amount DESC, manager_name ASC
        `,
        [args.orgId, args.quotaPeriodId, args.repIds || [], useRepFilter]
      )
      .then((r) => r.rows || [])
      .catch(() => []),
    pool
      .query<QuotaByRepRow>(
        `
        SELECT
          q.rep_id::text AS rep_id,
          COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), ('Rep ' || q.rep_id::text)) AS rep_name,
          COALESCE(SUM(q.quota_amount), 0)::float8 AS quota_amount
        FROM quotas q
        LEFT JOIN reps r
          ON r.organization_id = $1
         AND r.id = q.rep_id
        WHERE q.org_id = $1::bigint
          AND q.role_level = 3
          AND q.quota_period_id = $2::bigint
          AND q.rep_id IS NOT NULL
          AND (NOT $4::boolean OR q.rep_id = ANY($3::bigint[]))
        GROUP BY q.rep_id, rep_name
        ORDER BY quota_amount DESC, rep_name ASC
        `,
        [args.orgId, args.quotaPeriodId, args.repIds || [], useRepFilter]
      )
      .then((r) => r.rows || [])
      .catch(() => []),
  ]);

  return { byManager, byRep };
}

async function getRepKpisByPeriod(args: { orgId: number; periodIds: string[]; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<RepPeriodKpisRow>(
    `
    WITH periods AS (
      SELECT
        id::bigint AS quota_period_id,
        period_start::date AS period_start,
        period_end::date AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = ANY($2::bigint[])
    ),
    base AS (
      SELECT
        p.quota_period_id::text AS quota_period_id,
        o.rep_id::text AS rep_id,
        COALESCE(NULLIF(btrim(r.display_name), ''), NULLIF(btrim(r.rep_name), ''), NULLIF(btrim(o.rep_name), ''), '(Unknown rep)') AS rep_name,
        COALESCE(o.amount, 0)::float8 AS amount,
        o.partner_name,
        o.create_date,
        o.close_date,
        lower(
          regexp_replace(
            COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
            '[^a-zA-Z]+',
            ' ',
            'g'
          )
        ) AS fs,
        p.period_end::timestamptz AS period_end_ts
      FROM periods p
      JOIN opportunities o
        ON o.org_id = $1
       AND o.rep_id IS NOT NULL
       AND o.close_date IS NOT NULL
       AND o.close_date >= p.period_start
       AND o.close_date <= p.period_end
       AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
      LEFT JOIN reps r
        ON r.organization_id = $1
       AND r.id = o.rep_id
    ),
    classified AS (
      SELECT
        *,
        ((' ' || fs || ' ') LIKE '% won %') AS is_won,
        ((' ' || fs || ' ') LIKE '% lost %') AS is_lost,
        (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) AS is_active,
        CASE
          WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) AND fs LIKE '%commit%' THEN 'commit'
          WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) AND fs LIKE '%best%' THEN 'best'
          WHEN (NOT ((' ' || fs || ' ') LIKE '% won %') AND NOT ((' ' || fs || ' ') LIKE '% lost %')) THEN 'pipeline'
          WHEN ((' ' || fs || ' ') LIKE '% won %') THEN 'won'
          WHEN ((' ' || fs || ' ') LIKE '% lost %') THEN 'lost'
          ELSE 'other'
        END AS bucket
      FROM base
    )
    SELECT
      quota_period_id,
      rep_id,
      rep_name,
      COUNT(*)::int AS total_count,
      COALESCE(SUM(CASE WHEN is_won THEN 1 ELSE 0 END), 0)::int AS won_count,
      COALESCE(SUM(CASE WHEN is_lost THEN 1 ELSE 0 END), 0)::int AS lost_count,
      COALESCE(SUM(CASE WHEN is_active THEN 1 ELSE 0 END), 0)::int AS active_count,
      COALESCE(SUM(CASE WHEN is_won THEN amount ELSE 0 END), 0)::float8 AS won_amount,
      COALESCE(SUM(CASE WHEN is_active THEN amount ELSE 0 END), 0)::float8 AS active_amount,
      COALESCE(SUM(CASE WHEN bucket = 'commit' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
      COALESCE(SUM(CASE WHEN bucket = 'best' THEN amount ELSE 0 END), 0)::float8 AS best_amount,
      COALESCE(SUM(CASE WHEN bucket = 'pipeline' THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
      COALESCE(SUM(CASE WHEN (is_won OR is_lost) AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN amount ELSE 0 END), 0)::float8 AS partner_closed_amount,
      COALESCE(SUM(CASE WHEN (is_won OR is_lost) THEN amount ELSE 0 END), 0)::float8 AS closed_amount,
      COALESCE(SUM(CASE WHEN is_won AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN 1 ELSE 0 END), 0)::int AS partner_won_count,
      COALESCE(SUM(CASE WHEN (is_won OR is_lost) AND partner_name IS NOT NULL AND btrim(partner_name) <> '' THEN 1 ELSE 0 END), 0)::int AS partner_closed_count,
      AVG(
        CASE
          WHEN is_won AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0
          ELSE NULL
        END
      )::float8 AS avg_days_won,
      AVG(
        CASE
          WHEN is_lost AND create_date IS NOT NULL AND close_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (close_date::timestamptz - create_date)) / 86400.0
          ELSE NULL
        END
      )::float8 AS avg_days_lost,
      AVG(
        CASE
          WHEN is_active AND create_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (LEAST(NOW(), period_end_ts) - create_date)) / 86400.0
          ELSE NULL
        END
      )::float8 AS avg_days_active
    FROM classified
    GROUP BY quota_period_id, rep_id, rep_name
    ORDER BY rep_name ASC, rep_id ASC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

async function getCreatedByRep(args: { orgId: number; periodIds: string[]; repIds: number[] | null }) {
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<CreatedByRepRow>(
    `
    WITH periods AS (
      SELECT
        id::bigint AS quota_period_id,
        period_start::date AS period_start,
        period_end::date AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = ANY($2::bigint[])
    )
    SELECT
      p.quota_period_id::text AS quota_period_id,
      o.rep_id::text AS rep_id,
      COALESCE(SUM(COALESCE(o.amount, 0)), 0)::float8 AS created_amount,
      COUNT(*)::int AS created_count
    FROM periods p
    JOIN opportunities o
      ON o.org_id = $1
     AND o.rep_id IS NOT NULL
     AND o.create_date IS NOT NULL
     AND o.create_date::date >= p.period_start
     AND o.create_date::date <= p.period_end
     AND (NOT $4::boolean OR o.rep_id = ANY($3::bigint[]))
    GROUP BY p.quota_period_id, o.rep_id
    ORDER BY p.quota_period_id DESC, created_amount DESC
    `,
    [args.orgId, args.periodIds, args.repIds || [], useRepFilter]
  );
  return (rows || []) as any[];
}

export default async function ExecutiveAnalyticsKpisPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role !== "EXEC_MANAGER" && ctx.user.role !== "ADMIN") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const fiscal_year = String(sp(searchParams.fiscal_year) || "").trim();
  const quota_period_id = String(sp(searchParams.quota_period_id) || "").trim();
  const scope = String(sp(searchParams.scope) || "company").trim(); // company | manager | rep
  const manager_rep_id_raw = String(sp(searchParams.manager_rep_id) || "").trim();
  const rep_id_raw = String(sp(searchParams.rep_id) || "").trim();
  const rep_sort = String(sp(searchParams.rep_sort) || "attainment").trim(); // attainment | won | pipeline | win_rate | aov
  const rep_dir = String(sp(searchParams.rep_dir) || "desc").trim(); // asc | desc

  const periods = await listQuotaPeriodsForOrg(ctx.user.org_id).catch(() => []);
  const fiscalYears = Array.from(new Set(periods.map((p) => String(p.fiscal_year || "").trim()).filter(Boolean))).sort((a, b) =>
    b.localeCompare(a)
  );
  const yearToUse = fiscal_year || fiscalYears[0] || "";
  const periodsForYear = yearToUse ? periods.filter((p) => String(p.fiscal_year) === yearToUse) : periods;

  const todayIso = new Date().toISOString().slice(0, 10);
  const currentForYear = periodsForYear.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;

  const selectedPeriod =
    (quota_period_id && periodsForYear.find((p) => String(p.id) === quota_period_id)) || currentForYear || periodsForYear[0] || null;

  const prevPeriod =
    selectedPeriod && periods.length
      ? periods
          .filter((p) => new Date(p.period_start).getTime() < new Date(selectedPeriod.period_start).getTime())
          .sort((a, b) => new Date(b.period_start).getTime() - new Date(a.period_start).getTime())[0] || null
      : null;

  const managers = await listManagerOptions(ctx.user.org_id).catch(() => []);
  const reps = await listRepsForOrg(ctx.user.org_id).catch(() => []);
  const repOptions: RepOption[] = reps
    .filter((r) => r && r.active !== false)
    .map((r) => ({
      id: Number(r.id),
      name: String(r.display_name || "").trim() || String(r.rep_name || "").trim() || `Rep ${r.id}`,
      manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    }))
    .filter((r) => Number.isFinite(r.id) && r.id > 0);

  const repIdToManagerId = new Map<string, string>();
  for (const r of reps) {
    const id = Number(r.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const mid = r.manager_rep_id == null ? "" : String(r.manager_rep_id);
    repIdToManagerId.set(String(id), mid);
  }

  const managerNameById = new Map<string, string>();
  for (const m of managers) managerNameById.set(String(m.id), String(m.name));

  const managerRepId = manager_rep_id_raw ? Number(manager_rep_id_raw) : null;
  const repId = rep_id_raw ? Number(rep_id_raw) : null;

  let scopeRepIds: number[] | null = null;
  if (scope === "manager" && managerRepId && Number.isFinite(managerRepId)) {
    scopeRepIds = await listDirectRepIds(ctx.user.org_id, managerRepId).catch(() => []);
  } else if (scope === "rep" && repId && Number.isFinite(repId)) {
    scopeRepIds = [repId];
  } else {
    scopeRepIds = null; // company
  }

  const selectedPeriodId = selectedPeriod ? String(selectedPeriod.id) : "";
  const prevPeriodId = prevPeriod ? String(prevPeriod.id) : "";
  const comparePeriodIds = [selectedPeriodId, prevPeriodId].filter(Boolean);

  const [kpiRows, quotaTotals, repKpisRows, createdByRepRows, quotaByRepPeriod, quotaBreakdown, healthAvgRows] = selectedPeriodId
    ? await Promise.all([
        getPeriodKpis({ orgId: ctx.user.org_id, periodIds: comparePeriodIds, repIds: scopeRepIds }),
        getQuotaTotals({ orgId: ctx.user.org_id, quotaPeriodIds: comparePeriodIds, repIds: scopeRepIds }),
        getRepKpisByPeriod({ orgId: ctx.user.org_id, periodIds: comparePeriodIds, repIds: scopeRepIds }),
        getCreatedByRep({ orgId: ctx.user.org_id, periodIds: comparePeriodIds, repIds: scopeRepIds }),
        getQuotaByRepPeriod({ orgId: ctx.user.org_id, quotaPeriodIds: comparePeriodIds, repIds: scopeRepIds }),
        getQuotaBreakdownForPeriod({ orgId: ctx.user.org_id, quotaPeriodId: selectedPeriodId, repIds: scopeRepIds }),
        getHealthAveragesByPeriods({ orgId: ctx.user.org_id, periodIds: comparePeriodIds, repIds: scopeRepIds }),
      ])
    : [[], [], [], [], [], { byManager: [], byRep: [] }, []];

  const kpiByPeriod = new Map<string, PeriodKpisRow>();
  for (const r of kpiRows) kpiByPeriod.set(String(r.quota_period_id), r);

  const quotaByPeriod = new Map<string, number>();
  for (const q of quotaTotals) quotaByPeriod.set(String(q.quota_period_id), Number(q.quota_amount || 0) || 0);

  const curr = selectedPeriodId ? kpiByPeriod.get(selectedPeriodId) || null : null;
  const prev = prevPeriodId ? kpiByPeriod.get(prevPeriodId) || null : null;

  const healthByPeriod = new Map<string, any>();
  for (const r of healthAvgRows || []) healthByPeriod.set(String((r as any).quota_period_id), r);
  const currHealth = selectedPeriodId ? healthByPeriod.get(selectedPeriodId) || null : null;

  const currQuota = selectedPeriodId ? quotaByPeriod.get(selectedPeriodId) || 0 : 0;
  const prevQuota = prevPeriodId ? quotaByPeriod.get(prevPeriodId) || 0 : 0;

  const currAov = curr ? safeDiv(curr.won_amount, curr.won_count) : null;
  const prevAov = prev ? safeDiv(prev.won_amount, prev.won_count) : null;

  const currWinRate = curr ? safeDiv(curr.won_count, curr.won_count + curr.lost_count) : null;
  const prevWinRate = prev ? safeDiv(prev.won_count, prev.won_count + prev.lost_count) : null;

  const currOppToWin = curr ? safeDiv(curr.won_count, curr.total_count) : null;
  const prevOppToWin = prev ? safeDiv(prev.won_count, prev.total_count) : null;

  const currPartnerContribution = curr ? safeDiv(curr.partner_closed_amount, curr.closed_amount) : null;
  const prevPartnerContribution = prev ? safeDiv(prev.partner_closed_amount, prev.closed_amount) : null;

  const currPartnerWinRate = curr ? safeDiv(curr.partner_won_count, curr.partner_closed_count) : null;
  const prevPartnerWinRate = prev ? safeDiv(prev.partner_won_count, prev.partner_closed_count) : null;

  const currCommitCoverage = curr ? safeDiv(curr.commit_amount, currQuota) : null;
  const prevCommitCoverage = prev ? safeDiv(prev.commit_amount, prevQuota) : null;

  const currBestCoverage = curr ? safeDiv(curr.best_amount, currQuota) : null;
  const prevBestCoverage = prev ? safeDiv(prev.best_amount, prevQuota) : null;

  const currAttainment = curr ? safeDiv(curr.won_amount, currQuota) : null;
  const prevAttainment = prev ? safeDiv(prev.won_amount, prevQuota) : null;

  // Forecast mix is: Pipeline/Best/Commit/Won over (Pipeline+Best+Commit+Won)
  const currMixDen = curr ? curr.pipeline_amount + curr.best_amount + curr.commit_amount + curr.won_amount : 0;
  const prevMixDen = prev ? prev.pipeline_amount + prev.best_amount + prev.commit_amount + prev.won_amount : 0;

  const scopeLabel =
    scope === "manager"
      ? `Manager: ${managers.find((m) => String(m.id) === String(managerRepId))?.name || manager_rep_id_raw || "—"}`
      : scope === "rep"
        ? `Rep: ${repOptions.find((r) => String(r.id) === String(repId))?.name || rep_id_raw || "—"}`
        : "Company";

  const quotaByRepPeriodMap = new Map<string, number>();
  for (const q of quotaByRepPeriod) {
    const k = `${String(q.quota_period_id)}|${String(q.rep_id)}`;
    quotaByRepPeriodMap.set(k, Number(q.quota_amount || 0) || 0);
  }

  const repKpisByKey = new Map<string, RepPeriodKpisRow>();
  for (const r of repKpisRows) {
    repKpisByKey.set(`${String(r.quota_period_id)}|${String(r.rep_id)}`, r);
  }

  const createdByKey = new Map<string, { created_amount: number; created_count: number }>();
  for (const r of createdByRepRows) {
    const k = `${String(r.quota_period_id)}|${String(r.rep_id)}`;
    createdByKey.set(k, {
      created_amount: Number((r as any).created_amount || 0) || 0,
      created_count: Number((r as any).created_count || 0) || 0,
    });
  }

  type RepRow = {
    rep_id: string;
    rep_name: string;
    manager_id: string;
    manager_name: string;
    quota: number;
    total_count: number;
    won_amount: number;
    won_count: number;
    lost_count: number;
    active_amount: number;
    commit_amount: number;
    best_amount: number;
    pipeline_amount: number;
    created_amount: number;
    created_count: number;
    win_rate: number | null;
    opp_to_win: number | null;
    aov: number | null;
    attainment: number | null;
    commit_coverage: number | null;
    best_coverage: number | null;
    partner_contribution: number | null;
    partner_win_rate: number | null;
    avg_days_won: number | null;
    avg_days_lost: number | null;
    avg_days_active: number | null;
    mix_pipeline: number | null;
    mix_best: number | null;
    mix_commit: number | null;
    mix_won: number | null;
    qoq_attainment_delta: number | null;
  };

  const repIdsInData = new Set<string>();
  for (const r of repKpisRows) repIdsInData.add(String(r.rep_id));
  for (const q of quotaByRepPeriod) repIdsInData.add(String(q.rep_id));

  const repRows: RepRow[] = [];
  for (const rep_id of repIdsInData) {
    const currK = `${selectedPeriodId}|${rep_id}`;
    const prevK = prevPeriodId ? `${prevPeriodId}|${rep_id}` : "";
    const c = repKpisByKey.get(currK) || null;
    const p = prevK ? repKpisByKey.get(prevK) || null : null;
    const quota = quotaByRepPeriodMap.get(currK) || 0;
    const prevQuotaForRep = prevK ? quotaByRepPeriodMap.get(prevK) || 0 : 0;

    const total_count = c ? Number((c as any).total_count || 0) || 0 : 0;
    const won_amount = c ? Number(c.won_amount || 0) || 0 : 0;
    const won_count = c ? Number(c.won_count || 0) || 0 : 0;
    const active_amount = c ? Number(c.active_amount || 0) || 0 : 0;
    const lost_count = c ? Number((c as any).lost_count || 0) || 0 : 0;
    const commit_amount = c ? Number((c as any).commit_amount || 0) || 0 : 0;
    const best_amount = c ? Number((c as any).best_amount || 0) || 0 : 0;
    const pipeline_amount = c ? Number((c as any).pipeline_amount || 0) || 0 : 0;
    const win_rate = c ? safeDiv(won_count, won_count + lost_count) : null;
    const opp_to_win = c ? safeDiv(won_count, total_count) : null;
    const aov = c ? safeDiv(won_amount, won_count) : null;
    const attainment = c ? safeDiv(won_amount, quota) : null;
    const partner_contribution = c ? safeDiv(Number(c.partner_closed_amount || 0) || 0, Number(c.closed_amount || 0) || 0) : null;
    const partner_win_rate = c ? safeDiv(Number((c as any).partner_won_count || 0) || 0, Number((c as any).partner_closed_count || 0) || 0) : null;
    const commit_coverage = c ? safeDiv(commit_amount, quota) : null;
    const best_coverage = c ? safeDiv(best_amount, quota) : null;
    const prevAttainment = p ? safeDiv(Number(p.won_amount || 0) || 0, prevQuotaForRep) : null;

    const created = createdByKey.get(currK) || { created_amount: 0, created_count: 0 };

    const manager_id = repIdToManagerId.get(String(rep_id)) || "";
    const manager_name = manager_id ? managerNameById.get(manager_id) || `Manager ${manager_id}` : "(Unassigned)";

    const mixDen = pipeline_amount + best_amount + commit_amount + won_amount;
    const mix_pipeline = safeDiv(pipeline_amount, mixDen);
    const mix_best = safeDiv(best_amount, mixDen);
    const mix_commit = safeDiv(commit_amount, mixDen);
    const mix_won = safeDiv(won_amount, mixDen);

    const rep_name =
      (c && String(c.rep_name || "").trim()) ||
      repOptions.find((r) => String(r.id) === String(rep_id))?.name ||
      `Rep ${rep_id}`;

    repRows.push({
      rep_id: String(rep_id),
      rep_name,
      manager_id,
      manager_name,
      quota,
      total_count,
      won_amount,
      won_count,
      lost_count,
      active_amount,
      commit_amount,
      best_amount,
      pipeline_amount,
      created_amount: created.created_amount,
      created_count: created.created_count,
      win_rate,
      opp_to_win,
      aov,
      attainment,
      commit_coverage,
      best_coverage,
      partner_contribution,
      partner_win_rate,
      avg_days_won: c?.avg_days_won ?? null,
      avg_days_lost: c?.avg_days_lost ?? null,
      avg_days_active: c?.avg_days_active ?? null,
      mix_pipeline,
      mix_best,
      mix_commit,
      mix_won,
      qoq_attainment_delta: attainment != null && prevAttainment != null ? attainment - prevAttainment : null,
    });
  }

  const dirMult = rep_dir === "asc" ? 1 : -1;
  const repSortValue = (r: RepRow) => {
    if (rep_sort === "won") return r.won_amount;
    if (rep_sort === "pipeline") return r.active_amount;
    if (rep_sort === "win_rate") return r.win_rate ?? -1;
    if (rep_sort === "aov") return r.aov ?? -1;
    return r.attainment ?? -1;
  };
  repRows.sort((a, b) => {
    const av = repSortValue(a);
    const bv = repSortValue(b);
    if (bv !== av) return (bv - av) * dirMult;
    return a.rep_name.localeCompare(b.rep_name);
  });

  type ManagerRow = {
    manager_id: string;
    manager_name: string;
    quota: number;
    won_amount: number;
    active_amount: number;
    attainment: number | null;
    win_rate: number | null;
    partner_contribution: number | null;
  };
  const managerAgg = new Map<string, { quota: number; won_amount: number; won_count: number; lost_count: number; active_amount: number; partner_closed_amount: number; closed_amount: number }>();
  for (const repRow of repRows) {
    const mid = repIdToManagerId.get(String(repRow.rep_id)) || "";
    const a = managerAgg.get(mid) || { quota: 0, won_amount: 0, won_count: 0, lost_count: 0, active_amount: 0, partner_closed_amount: 0, closed_amount: 0 };
    a.quota += repRow.quota;
    a.won_amount += repRow.won_amount;
    a.won_count += repRow.won_count;
    // lost_count isn't on repRow; approximate by looking up currK row
    const ck = `${selectedPeriodId}|${String(repRow.rep_id)}`;
    const c = repKpisByKey.get(ck);
    a.lost_count += Number(c?.lost_count || 0) || 0;
    a.active_amount += repRow.active_amount;
    a.partner_closed_amount += Number(c?.partner_closed_amount || 0) || 0;
    a.closed_amount += Number(c?.closed_amount || 0) || 0;
    managerAgg.set(mid, a);
  }

  const managerRows: ManagerRow[] = [];
  for (const [manager_id, a] of managerAgg.entries()) {
    const manager_name = manager_id ? managerNameById.get(manager_id) || `Manager ${manager_id}` : "(Unassigned)";
    const attainment = safeDiv(a.won_amount, a.quota);
    const win_rate = safeDiv(a.won_count, a.won_count + a.lost_count);
    const partner_contribution = safeDiv(a.partner_closed_amount, a.closed_amount);
    managerRows.push({
      manager_id,
      manager_name,
      quota: a.quota,
      won_amount: a.won_amount,
      active_amount: a.active_amount,
      attainment,
      win_rate,
      partner_contribution,
    });
  }
  managerRows.sort((a, b) => (Number(b.attainment ?? -1) - Number(a.attainment ?? -1)) || (b.won_amount - a.won_amount) || a.manager_name.localeCompare(b.manager_name));

  const repExportRows = repRows.map((r) => ({
    rep: r.rep_name,
    manager: r.manager_name,
    quota: r.quota,
    won_amount: r.won_amount,
    won_count: r.won_count,
    attainment_pct: r.attainment == null ? "" : Math.round(r.attainment * 100),
    pipeline_amount: r.active_amount,
    win_rate_pct: r.win_rate == null ? "" : Math.round(r.win_rate * 100),
    aov: r.aov == null ? "" : r.aov,
    partner_contribution_pct: r.partner_contribution == null ? "" : Math.round(r.partner_contribution * 100),
    aging_days: r.avg_days_active == null ? "" : Math.round(r.avg_days_active),
  }));
  const managerExportRows = managerRows.map((m) => ({
    manager: m.manager_name,
    quota: m.quota,
    won_amount: m.won_amount,
    attainment_pct: m.attainment == null ? "" : Math.round(m.attainment * 100),
    pipeline_amount: m.active_amount,
    win_rate_pct: m.win_rate == null ? "" : Math.round(m.win_rate * 100),
    partner_contribution_pct: m.partner_contribution == null ? "" : Math.round(m.partner_contribution * 100),
  }));

  const repsByManager = new Map<string, RepRow[]>();
  for (const r of repRows) {
    const k = r.manager_id || "";
    const arr = repsByManager.get(k) || [];
    arr.push(r);
    repsByManager.set(k, arr);
  }
  const managerIdsInRepRows = Array.from(repsByManager.keys());
  const orderedManagerIds = [
    ...managerRows.map((m) => m.manager_id || ""),
    ...managerIdsInRepRows.filter((id) => !managerRows.some((m) => String(m.manager_id || "") === String(id || ""))),
  ];

  const sortKey: "attainment" | "won" | "pipeline" | "win_rate" | "aov" =
    rep_sort === "won" || rep_sort === "pipeline" || rep_sort === "win_rate" || rep_sort === "aov" ? (rep_sort as any) : "attainment";
  const sortHighlight = (k: typeof sortKey) => (sortKey === k ? "text-yellow-700" : "");
  const sortHighlightCell = (k: typeof sortKey) => (sortKey === k ? "bg-yellow-50 text-yellow-800" : "");

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Executive KPIs</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Quarter KPIs driven by <span className="font-mono text-xs">forecast_stage</span> and quarter scoping via{" "}
              <span className="font-mono text-xs">close_date</span> (new-pipeline uses <span className="font-mono text-xs">create_date</span>) (scope: {scopeLabel}).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/analytics" className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
              Analytics home
            </Link>
          </div>
        </div>

        <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Filters</h2>
          <form method="GET" action="/analytics/executive" className="mt-3 grid gap-3 md:grid-cols-4">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Fiscal Year</label>
              <select
                name="fiscal_year"
                defaultValue={yearToUse}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                {fiscalYears.map((fy) => (
                  <option key={fy} value={fy}>
                    {fy}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Quarter</label>
              <select
                name="quota_period_id"
                defaultValue={selectedPeriodId}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              >
                {periodsForYear.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.period_name} (FY{p.fiscal_year} Q{p.fiscal_quarter})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Compare scope</label>
              <select
                name="scope"
                defaultValue={scope}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                <option value="company">Company</option>
                <option value="manager">Manager (direct reports)</option>
                <option value="rep">Rep</option>
              </select>
            </div>
            <div className="flex items-end justify-end gap-2 md:col-span-1">
              <Link
                href="/analytics/executive"
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Reset
              </Link>
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Apply
              </button>
            </div>

            {/* Scope-specific selects (always render; ignored unless scope matches) */}
            <div className="grid gap-1 md:col-span-2">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Manager</label>
              <select
                name="manager_rep_id"
                defaultValue={manager_rep_id_raw}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                <option value="">(select)</option>
                {managers.map((m) => (
                  <option key={String(m.id)} value={String(m.id)}>
                    {m.name}
                  </option>
                ))}
              </select>
              <div className="text-xs text-[color:var(--sf-text-disabled)]">Used when scope = Manager.</div>
            </div>
            <div className="grid gap-1 md:col-span-2">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Rep</label>
              <select
                name="rep_id"
                defaultValue={rep_id_raw}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                <option value="">(select)</option>
                {repOptions.map((r) => (
                  <option key={String(r.id)} value={String(r.id)}>
                    {r.name}
                  </option>
                ))}
              </select>
              <div className="text-xs text-[color:var(--sf-text-disabled)]">Used when scope = Rep.</div>
            </div>
          </form>
        </section>

        {!selectedPeriod ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <p className="text-sm text-[color:var(--sf-text-secondary)]">Create quota periods to use Executive KPIs.</p>
          </section>
        ) : null}

        {selectedPeriod && curr ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">KPI summary</h2>
                <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                  Period: <span className="font-mono text-xs">{curr.period_start}</span> → <span className="font-mono text-xs">{curr.period_end}</span>
                  {prev ? (
                    <>
                      {" "}
                      · QoQ compares to <span className="font-mono text-xs">{prev.period_start}</span> →{" "}
                      <span className="font-mono text-xs">{prev.period_end}</span>
                    </>
                  ) : null}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Quota Attainment</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(currAttainment)}</div>
                <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">QoQ: {deltaLabel(currAttainment, prevAttainment, "pct")}</div>
              </div>
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Average Health Score</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(healthFracFrom30(currHealth?.avg_health_all))}</div>
                <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                  Commit: {fmtPct(healthFracFrom30(currHealth?.avg_health_commit))} · Best: {fmtPct(healthFracFrom30(currHealth?.avg_health_best))} · Pipeline:{" "}
                  {fmtPct(healthFracFrom30(currHealth?.avg_health_pipeline))} · Won: {fmtPct(healthFracFrom30(currHealth?.avg_health_won))} · Closed:{" "}
                  {fmtPct(healthFracFrom30(currHealth?.avg_health_closed))}
                </div>
              </div>
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Win Rate (Won / (Won+Lost))</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(currWinRate)}</div>
                <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">QoQ: {deltaLabel(currWinRate, prevWinRate, "pct")}</div>
              </div>
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Pipeline Value (open)</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(curr.active_amount)}</div>
                <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">QoQ: {deltaLabel(curr.active_amount, prev?.active_amount ?? null, "money")}</div>
              </div>
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Average Order Value (AOV)</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(currAov)}</div>
                <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">QoQ: {deltaLabel(currAov, prevAov, "money")}</div>
              </div>
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Commit Coverage</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(currCommitCoverage)}</div>
                <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">QoQ: {deltaLabel(currCommitCoverage, prevCommitCoverage, "pct")}</div>
              </div>
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Best Case Coverage</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(currBestCoverage)}</div>
                <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">QoQ: {deltaLabel(currBestCoverage, prevBestCoverage, "pct")}</div>
              </div>
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Partner Contribution % (closed)</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(currPartnerContribution)}</div>
                <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">QoQ: {deltaLabel(currPartnerContribution, prevPartnerContribution, "pct")}</div>
              </div>
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Partner Win Rate (closed)</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(currPartnerWinRate)}</div>
                <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">QoQ: {deltaLabel(currPartnerWinRate, prevPartnerWinRate, "pct")}</div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
                <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Sales cycle length (days)</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <div>
                    <div className="text-xs text-[color:var(--sf-text-secondary)]">Won</div>
                    <div className="mt-0.5 font-mono text-sm font-semibold text-[color:var(--sf-text-primary)]">
                      {curr.avg_days_won == null ? "—" : `${Math.round(curr.avg_days_won)}d`}
                    </div>
                    <div className="mt-0.5 text-xs text-[color:var(--sf-text-secondary)]">
                      QoQ: {deltaLabel(curr.avg_days_won, prev?.avg_days_won ?? null, "days")}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[color:var(--sf-text-secondary)]">Lost</div>
                    <div className="mt-0.5 font-mono text-sm font-semibold text-[color:var(--sf-text-primary)]">
                      {curr.avg_days_lost == null ? "—" : `${Math.round(curr.avg_days_lost)}d`}
                    </div>
                    <div className="mt-0.5 text-xs text-[color:var(--sf-text-secondary)]">
                      QoQ: {deltaLabel(curr.avg_days_lost, prev?.avg_days_lost ?? null, "days")}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[color:var(--sf-text-secondary)]">Active (age)</div>
                    <div className="mt-0.5 font-mono text-sm font-semibold text-[color:var(--sf-text-primary)]">
                      {curr.avg_days_active == null ? "—" : `${Math.round(curr.avg_days_active)}d`}
                    </div>
                    <div className="mt-0.5 text-xs text-[color:var(--sf-text-secondary)]">
                      QoQ: {deltaLabel(curr.avg_days_active, prev?.avg_days_active ?? null, "days")}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
                <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Forecast category mix (amount %)</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  {[
                    { label: "Pipeline", v: safeDiv(curr.pipeline_amount, currMixDen), pv: prev ? safeDiv(prev.pipeline_amount, prevMixDen) : null },
                    { label: "Best", v: safeDiv(curr.best_amount, currMixDen), pv: prev ? safeDiv(prev.best_amount, prevMixDen) : null },
                    { label: "Commit", v: safeDiv(curr.commit_amount, currMixDen), pv: prev ? safeDiv(prev.commit_amount, prevMixDen) : null },
                    { label: "Won", v: safeDiv(curr.won_amount, currMixDen), pv: prev ? safeDiv(prev.won_amount, prevMixDen) : null },
                  ].map((x) => (
                    <div key={x.label}>
                      <div className="text-xs text-[color:var(--sf-text-secondary)]">{x.label}</div>
                      <div className="mt-0.5 font-mono text-sm font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(x.v)}</div>
                      <div className="mt-0.5 text-xs text-[color:var(--sf-text-secondary)]">QoQ: {deltaLabel(x.v, x.pv, "pct")}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">New pipeline created (by create_date)</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(curr.created_amount)}</div>
                <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Deals: {fmtNum(curr.created_count)}</div>
              </div>
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Opportunity→Win conversion</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(currOppToWin)}</div>
                <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">QoQ: {deltaLabel(currOppToWin, prevOppToWin, "pct")}</div>
              </div>
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Closed Won (amount)</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(curr.won_amount)}</div>
                <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Deals: {fmtNum(curr.won_count)}</div>
              </div>
            </div>
          </section>
        ) : null}

        {selectedPeriod && curr ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Rep comparison</h2>
                <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                  Quarter-scoped by <span className="font-mono text-xs">close_date</span> in the selected period. Won/Lost/Open are derived from{" "}
                  <span className="font-mono text-xs">forecast_stage</span> only.
                </p>
              </div>
              <form method="GET" action="/analytics/executive" className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="fiscal_year" value={yearToUse} />
                <input type="hidden" name="quota_period_id" value={selectedPeriodId} />
                <input type="hidden" name="scope" value={scope} />
                <input type="hidden" name="manager_rep_id" value={manager_rep_id_raw} />
                <input type="hidden" name="rep_id" value={rep_id_raw} />
                <div className="grid gap-1">
                  <label className="text-xs text-[color:var(--sf-text-secondary)]">Sort</label>
                  <select
                    name="rep_sort"
                    defaultValue={rep_sort}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm"
                  >
                    <option value="attainment">Attainment</option>
                    <option value="won">Closed Won</option>
                    <option value="pipeline">Pipeline Value</option>
                    <option value="win_rate">Win Rate</option>
                    <option value="aov">AOV</option>
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-[color:var(--sf-text-secondary)]">Dir</label>
                  <select
                    name="rep_dir"
                    defaultValue={rep_dir}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm"
                  >
                    <option value="desc">desc</option>
                    <option value="asc">asc</option>
                  </select>
                </div>
                <button className="h-[40px] self-end rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                  Apply sort
                </button>
              </form>
            </div>

            <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
              <table className="w-full min-w-[1200px] text-left text-sm">
                <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="px-4 py-3">rep</th>
                    <th className="px-4 py-3 text-right">quota</th>
                    <th className={`px-4 py-3 text-right ${sortHighlight("won")}`}>won</th>
                    <th className={`px-4 py-3 text-right ${sortHighlight("attainment")}`}>attainment</th>
                    <th className="px-4 py-3 text-right">QoQ Δ attn</th>
                    <th className={`px-4 py-3 text-right ${sortHighlight("pipeline")}`}>pipeline</th>
                    <th className={`px-4 py-3 text-right ${sortHighlight("win_rate")}`}>win rate</th>
                    <th className={`px-4 py-3 text-right ${sortHighlight("aov")}`}>AOV</th>
                    <th className="px-4 py-3 text-right">partner %</th>
                    <th className="px-4 py-3 text-right">cycle (won)</th>
                    <th className="px-4 py-3 text-right">cycle (lost)</th>
                    <th className="px-4 py-3 text-right">age (active)</th>
                  </tr>
                </thead>
                <tbody>
                  {repRows.length ? (
                    orderedManagerIds
                      .filter((mid) => (repsByManager.get(mid) || []).length)
                      .map((mid) => {
                        const repsForMgr = (repsByManager.get(mid) || []).slice();
                        const mgr = managerRows.find((m) => String(m.manager_id || "") === String(mid || "")) || null;
                        const managerLabel = mgr?.manager_name || (mid ? managerNameById.get(mid) || `Manager ${mid}` : "(Unassigned)");
                        return (
                          <Fragment key={`team:${mid || "unassigned"}`}>
                            <tr
                              key={`mgr:${mid || "unassigned"}`}
                              className="border-t-2 border-yellow-300 bg-yellow-50 text-[color:var(--sf-text-primary)]"
                            >
                              <td className="px-4 py-3 font-semibold">
                                {managerLabel} <span className="text-xs font-normal text-[color:var(--sf-text-secondary)]">(team)</span>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(mgr?.quota ?? 0)}</td>
                              <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("won")}`}>{fmtMoney(mgr?.won_amount ?? 0)}</td>
                              <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("attainment")}`}>{fmtPct(mgr?.attainment ?? null)}</td>
                              <td className="px-4 py-3 text-right font-mono text-xs">—</td>
                              <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("pipeline")}`}>{fmtMoney(mgr?.active_amount ?? 0)}</td>
                              <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("win_rate")}`}>{fmtPct(mgr?.win_rate ?? null)}</td>
                              <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("aov")}`}>—</td>
                              <td className="px-4 py-3 text-right font-mono text-xs">{fmtPct(mgr?.partner_contribution ?? null)}</td>
                              <td className="px-4 py-3 text-right font-mono text-xs">—</td>
                              <td className="px-4 py-3 text-right font-mono text-xs">—</td>
                              <td className="px-4 py-3 text-right font-mono text-xs">—</td>
                            </tr>
                            {repsForMgr.map((r) => (
                              <tr
                                key={`rep:${mid || "unassigned"}:${r.rep_id}`}
                                className="border-t border-[color:var(--sf-border)] text-[color:var(--sf-text-primary)]"
                              >
                                <td className="px-4 py-3 font-medium border-l-4 border-yellow-200">{r.rep_name}</td>
                                <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(r.quota)}</td>
                                <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("won")}`}>
                                  {fmtMoney(r.won_amount)} <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(r.won_count)})</span>
                                </td>
                                <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("attainment")}`}>{fmtPct(r.attainment)}</td>
                                <td className="px-4 py-3 text-right font-mono text-xs">
                                  {r.qoq_attainment_delta == null ? "—" : fmtPct(r.qoq_attainment_delta)}
                                </td>
                                <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("pipeline")}`}>{fmtMoney(r.active_amount)}</td>
                                <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("win_rate")}`}>{fmtPct(r.win_rate)}</td>
                                <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("aov")}`}>{fmtMoney(r.aov)}</td>
                                <td className="px-4 py-3 text-right font-mono text-xs">{fmtPct(r.partner_contribution)}</td>
                                <td className="px-4 py-3 text-right font-mono text-xs">{r.avg_days_won == null ? "—" : `${Math.round(r.avg_days_won)}d`}</td>
                                <td className="px-4 py-3 text-right font-mono text-xs">{r.avg_days_lost == null ? "—" : `${Math.round(r.avg_days_lost)}d`}</td>
                                <td className="px-4 py-3 text-right font-mono text-xs">{r.avg_days_active == null ? "—" : `${Math.round(r.avg_days_active)}d`}</td>
                              </tr>
                            ))}
                          </Fragment>
                        );
                      })
                  ) : (
                    <tr>
                      <td colSpan={12} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                        No rep data found for this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-end">
              <ExportToExcelButton
                fileName={`Executive KPIs - Rep comparison - ${selectedPeriod?.period_name || ""}`}
                sheets={[
                  { name: "Reps", rows: repExportRows as any },
                  { name: "Managers", rows: managerExportRows as any },
                ]}
              />
            </div>
          </section>
        ) : null}

        {selectedPeriod && curr ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Build Custom Reports</h2>
                <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                  Save/load custom rep comparison reports (pick reps + KPI fields).
                </p>
              </div>
              <Link
                href="/analytics/custom-reports"
                className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
              >
                Open Custom Reports
              </Link>
            </div>
          </section>
        ) : null}

        {selectedPeriod && curr ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Team comparison (manager roll-ups)</h2>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Roll-ups are derived from rep-level KPIs and mapped using <span className="font-mono text-xs">reps.manager_rep_id</span>.
            </p>

            <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="px-4 py-3">manager</th>
                    <th className="px-4 py-3 text-right">quota</th>
                    <th className="px-4 py-3 text-right">won</th>
                    <th className="px-4 py-3 text-right">attainment</th>
                    <th className="px-4 py-3 text-right">pipeline</th>
                    <th className="px-4 py-3 text-right">win rate</th>
                    <th className="px-4 py-3 text-right">partner %</th>
                  </tr>
                </thead>
                <tbody>
                  {managerRows.length ? (
                    managerRows.map((m) => (
                      <tr key={m.manager_id || "unassigned"} className="border-t border-[color:var(--sf-border)] text-[color:var(--sf-text-primary)]">
                        <td className="px-4 py-3 font-medium">{m.manager_name}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(m.quota)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(m.won_amount)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtPct(m.attainment)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(m.active_amount)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtPct(m.win_rate)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtPct(m.partner_contribution)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                        No manager roll-ups available.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {selectedPeriod && curr ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <details className="flex flex-col">
              <summary className="cursor-pointer text-sm font-semibold text-[color:var(--sf-text-primary)]">Quota breakdown</summary>
              <div className="mt-2 grid gap-2 text-sm text-[color:var(--sf-text-secondary)]">
                <div>
                  Total quota (rep quotas): <span className="font-mono text-xs">{fmtMoney(currQuota)}</span>
                </div>
                <div className="text-xs text-[color:var(--sf-text-disabled)]">
                  This is the sum of all <span className="font-mono">quotas</span> rows with <span className="font-mono">role_level=3</span> in the selected quarter
                  (filtered by scope when scope ≠ Company).
                </div>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <div className="overflow-auto rounded-md border border-[color:var(--sf-border)]">
                    <table className="w-full min-w-[380px] text-left text-sm">
                      <thead className="bg-[color:var(--sf-surface)] text-xs text-[color:var(--sf-text-secondary)]">
                        <tr>
                          <th className="px-3 py-2">manager</th>
                          <th className="px-3 py-2 text-right">quota</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quotaBreakdown.byManager.length ? (
                          quotaBreakdown.byManager.map((m) => (
                            <tr key={m.manager_id} className="border-t border-[color:var(--sf-border)]">
                              <td className="px-3 py-2">{m.manager_name}</td>
                              <td className="px-3 py-2 text-right font-mono text-xs">{fmtMoney(m.quota_amount)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={2} className="px-3 py-4 text-center text-[color:var(--sf-text-disabled)]">
                              No manager quotas found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="overflow-auto rounded-md border border-[color:var(--sf-border)]">
                    <table className="w-full min-w-[380px] text-left text-sm">
                      <thead className="bg-[color:var(--sf-surface)] text-xs text-[color:var(--sf-text-secondary)]">
                        <tr>
                          <th className="px-3 py-2">rep</th>
                          <th className="px-3 py-2 text-right">quota</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quotaBreakdown.byRep.length ? (
                          quotaBreakdown.byRep.slice(0, 50).map((r) => (
                            <tr key={r.rep_id} className="border-t border-[color:var(--sf-border)]">
                              <td className="px-3 py-2">{r.rep_name}</td>
                              <td className="px-3 py-2 text-right font-mono text-xs">{fmtMoney(r.quota_amount)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={2} className="px-3 py-4 text-center text-[color:var(--sf-text-disabled)]">
                              No rep quotas found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </details>
          </section>
        ) : null}

        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Next</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            If you like this Executive view, I’ll add the same KPI panels as manager/team views (scoped by visibility) and rep-only views.
          </p>
        </section>
      </main>
    </div>
  );
}

