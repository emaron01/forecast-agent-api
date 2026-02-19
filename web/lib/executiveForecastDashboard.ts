import "server-only";

import { pool } from "./pool";
import type { AuthUser } from "./auth";
import { getVisibleUsers } from "./db";
import { getScopedRepDirectory, type RepDirectoryRow } from "./repScope";
import { getForecastStageProbabilities } from "./forecastStageProbabilities";
import { computeSalesVsVerdictForecastSummary } from "./forecastSummary";
import { getQuarterKpisSnapshot, type QuarterKpisSnapshot } from "./quarterKpisSnapshot";
import type { PipelineMomentumData } from "./pipelineMomentum";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function isoDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function normalizeNameKey(s: any) {
  // Must match the Postgres normalization used in queries.
  // - trim
  // - collapse whitespace
  // - lowercase
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function listActiveRepsForOrg(orgId: number): Promise<RepDirectoryRow[]> {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(rep_name), ''), '(Unnamed)') AS name,
      role,
      manager_rep_id,
      user_id,
      active
    FROM reps
    WHERE organization_id = $1::bigint
      AND (active IS TRUE OR active IS NULL)
    ORDER BY
      CASE
        WHEN role = 'EXEC_MANAGER' THEN 0
        WHEN role = 'MANAGER' THEN 1
        WHEN role = 'REP' THEN 2
        ELSE 9
      END,
      name ASC,
      id ASC
    `,
    [orgId]
  );
  return (rows || []).map((r: any) => ({
    id: Number(r.id),
    name: String(r.name || "").trim() || "(Unnamed)",
    role: r.role == null ? null : String(r.role),
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    user_id: r.user_id == null ? null : Number(r.user_id),
    active: r.active == null ? null : !!r.active,
  }));
}

export type ExecQuotaPeriodLite = {
  id: string;
  fiscal_year: string;
  fiscal_quarter: string;
  period_name: string;
  period_start: string;
  period_end: string;
};

export type ExecRepOption = { public_id: string; name: string };

export type ExecutiveForecastSummary = {
  periods: ExecQuotaPeriodLite[];
  fiscalYearsSorted: string[];
  selectedFiscalYear: string;
  selectedQuotaPeriodId: string;
  selectedPeriod: ExecQuotaPeriodLite | null;
  reps: ExecRepOption[];
  scopeLabel: string;
  repDirectory: RepDirectoryRow[];
  myRepId: number | null;
  stageProbabilities: { commit: number; best_case: number; pipeline: number };
  healthModifiers: { commit_modifier: number; best_case_modifier: number; pipeline_modifier: number };
  repRollups: Array<{
    rep_id: string;
    rep_name: string;
    commit_amount: number;
    best_case_amount: number;
    pipeline_amount: number;
    won_amount: number;
    won_count: number;
  }>;
  productsClosedWon: Array<{
    product: string;
    won_amount: number;
    won_count: number;
    avg_order_value: number;
    avg_health_score: number | null;
  }>;
  productsClosedWonByRep: Array<{
    rep_name: string;
    product: string;
    won_amount: number;
    won_count: number;
    avg_order_value: number;
    avg_health_score: number | null;
  }>;
  quarterKpis: QuarterKpisSnapshot | null;
  pipelineMomentum: PipelineMomentumData | null;
  quota: number;
  crmForecast: {
    commit_amount: number;
    best_case_amount: number;
    pipeline_amount: number;
    won_amount: number;
    weighted_forecast: number;
  };
  aiForecast: {
    commit_amount: number;
    best_case_amount: number;
    pipeline_amount: number;
    weighted_forecast: number;
  };
  forecastGap: number; // AI - CRM (weighted)
  pctToGoal: number | null; // AI weighted / quota
  leftToGo: number; // quota - AI weighted
  bucketDeltas: { commit: number; best_case: number; pipeline: number; total: number }; // (AI - CRM) per bucket + total
};

type OpenPipelineSnapshot = {
  commit_amount: number;
  commit_count: number;
  best_case_amount: number;
  best_case_count: number;
  pipeline_amount: number;
  pipeline_count: number;
  total_amount: number;
  total_count: number;
};

async function getOpenPipelineSnapshot(args: {
  orgId: number;
  quotaPeriodId: string;
  useRepFilter: boolean;
  repIds: number[];
  repNameKeys: string[];
}): Promise<OpenPipelineSnapshot> {
  const empty: OpenPipelineSnapshot = {
    commit_amount: 0,
    commit_count: 0,
    best_case_amount: 0,
    best_case_count: 0,
    pipeline_amount: 0,
    pipeline_count: 0,
    total_amount: 0,
    total_count: 0,
  };

  const qpId = String(args.quotaPeriodId || "").trim();
  if (!qpId) return empty;

  const repIds = Array.isArray(args.repIds) ? args.repIds : [];
  const repNameKeys = Array.isArray(args.repNameKeys) ? args.repNameKeys : [];

  const { rows } = await pool
    .query<OpenPipelineSnapshot>(
      `
      WITH qp AS (
        SELECT period_start::date AS period_start, period_end::date AS period_end
          FROM quota_periods
         WHERE org_id = $1::bigint
           AND id = $2::bigint
         LIMIT 1
      ),
      deals AS (
        SELECT
          COALESCE(o.amount, 0)::float8 AS amount,
          lower(
            regexp_replace(
              COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
              '[^a-zA-Z]+',
              ' ',
              'g'
            )
          ) AS fs,
          CASE
            WHEN o.close_date IS NULL THEN NULL
            WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
            WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
              to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'MM/DD/YYYY')
            ELSE NULL
          END AS close_d
        FROM opportunities o
        WHERE o.org_id = $1
          AND (
            NOT $5::boolean
            OR (
              (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
              OR (
                COALESCE(array_length($4::text[], 1), 0) > 0
                AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
              )
            )
          )
      ),
      deals_in_qtr AS (
        SELECT d.*
          FROM deals d
          JOIN qp ON TRUE
         WHERE d.close_d IS NOT NULL
           AND d.close_d >= qp.period_start
           AND d.close_d <= qp.period_end
      ),
      open_deals AS (
        SELECT *
          FROM deals_in_qtr d
         WHERE NOT ((' ' || d.fs || ' ') LIKE '% won %')
           AND NOT ((' ' || d.fs || ' ') LIKE '% lost %')
           AND NOT ((' ' || d.fs || ' ') LIKE '% closed %')
      )
      SELECT
        COALESCE(SUM(CASE WHEN fs LIKE '%commit%' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
        COALESCE(SUM(CASE WHEN fs LIKE '%commit%' THEN 1 ELSE 0 END), 0)::int AS commit_count,
        COALESCE(SUM(CASE WHEN fs LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS best_case_amount,
        COALESCE(SUM(CASE WHEN fs LIKE '%best%' THEN 1 ELSE 0 END), 0)::int AS best_case_count,
        COALESCE(SUM(CASE WHEN fs NOT LIKE '%commit%' AND fs NOT LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
        COALESCE(SUM(CASE WHEN fs NOT LIKE '%commit%' AND fs NOT LIKE '%best%' THEN 1 ELSE 0 END), 0)::int AS pipeline_count,
        COALESCE(SUM(amount), 0)::float8 AS total_amount,
        COUNT(*)::int AS total_count
      FROM open_deals
      `,
      [args.orgId, qpId, repIds, repNameKeys, args.useRepFilter]
    )
    .then((r) => r.rows || [])
    .catch(() => []);

  return (rows?.[0] as any) || empty;
}

export async function getExecutiveForecastDashboardSummary(args: {
  orgId: number;
  user: AuthUser;
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<ExecutiveForecastSummary> {
  const selectedQuotaPeriodIdParam = String(sp(args.searchParams?.quota_period_id) || "").trim();
  const selectedFiscalYearParam = String(sp(args.searchParams?.fiscal_year) || "").trim();

  const periods: ExecQuotaPeriodLite[] = await pool
    .query<ExecQuotaPeriodLite>(
      `
      SELECT
        id::text AS id,
        COALESCE(NULLIF(btrim(fiscal_year), ''), substring(period_start::text from 1 for 4)) AS fiscal_year,
        fiscal_quarter::text AS fiscal_quarter,
        COALESCE(NULLIF(btrim(period_name), ''), (period_start::text || ' → ' || period_end::text)) AS period_name,
        period_start::text AS period_start,
        period_end::text AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
      ORDER BY period_start DESC, id DESC
      `,
      [args.orgId]
    )
    .then((r) => (r.rows || []) as any[])
    .catch(() => []);

  const fiscalYearsSorted = Array.from(new Set(periods.map((p) => String(p.fiscal_year || "").trim()).filter(Boolean))).sort((a, b) => b.localeCompare(a));

  const todayIso = isoDateOnly(new Date());
  const containingToday = periods.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;
  const defaultQuotaPeriodId = String(containingToday?.id || periods?.[0]?.id || "").trim();

  const selectedQuotaPeriodId = selectedQuotaPeriodIdParam || defaultQuotaPeriodId;
  const selectedPeriod = selectedQuotaPeriodId ? periods.find((p) => String(p.id) === selectedQuotaPeriodId) || null : null;

  const selectedFiscalYear =
    selectedFiscalYearParam ||
    String(selectedPeriod?.fiscal_year || "").trim() ||
    String(containingToday?.fiscal_year || "").trim() ||
    fiscalYearsSorted[0] ||
    "";

  const roleRaw = String(args.user.role || "").trim();
  const scopedRole =
    roleRaw === "ADMIN" || roleRaw === "EXEC_MANAGER" || roleRaw === "MANAGER" || roleRaw === "REP"
      ? (roleRaw as "ADMIN" | "EXEC_MANAGER" | "MANAGER" | "REP")
      : ("REP" as const);

  const visibleUsers = await getVisibleUsers({
    currentUserId: args.user.id,
    orgId: args.orgId,
    role: scopedRole,
    hierarchy_level: (args.user as any).hierarchy_level,
    see_all_visibility: (args.user as any).see_all_visibility,
  }).catch(() => []);

  const visibleRepUsers = (visibleUsers || []).filter((u: any) => u && u.role === "REP" && u.active);
  const visibleRepUserIds = Array.from(new Set(visibleRepUsers.map((u: any) => Number(u.id)).filter((n: number) => Number.isFinite(n) && n > 0)));
  const visibleRepNameKeys = Array.from(
    new Set(
      visibleRepUsers
        .flatMap((u: any) => [normalizeNameKey(u.account_owner_name || ""), normalizeNameKey(u.display_name || ""), normalizeNameKey(u.email || "")])
        .filter(Boolean)
    )
  );

  // Map visible REP users -> rep ids when possible (opportunities.rep_id is reps.id).
  const repIdsToUse =
    visibleRepUserIds.length || visibleRepNameKeys.length
      ? await pool
          .query<{ id: number }>(
            `
            SELECT DISTINCT r.id
              FROM reps r
             WHERE COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
               AND (
                 (COALESCE(array_length($2::int[], 1), 0) > 0 AND r.user_id = ANY($2::int[]))
                 OR (
                   COALESCE(array_length($3::text[], 1), 0) > 0
                   AND (
                     lower(regexp_replace(btrim(COALESCE(r.crm_owner_name, '')), '\\s+', ' ', 'g')) = ANY($3::text[])
                     OR lower(regexp_replace(btrim(COALESCE(r.rep_name, '')), '\\s+', ' ', 'g')) = ANY($3::text[])
                     OR lower(regexp_replace(btrim(COALESCE(r.display_name, '')), '\\s+', ' ', 'g')) = ANY($3::text[])
                   )
                 )
               )
            `,
            [args.orgId, visibleRepUserIds, visibleRepNameKeys]
          )
          .then((r) => (r.rows || []).map((x) => Number(x.id)).filter((n) => Number.isFinite(n) && n > 0))
          .catch(() => [] as number[])
      : ([] as number[]);

  let scope = await getScopedRepDirectory({ orgId: args.orgId, userId: args.user.id, role: scopedRole }).catch(() => ({
    repDirectory: [],
    allowedRepIds: scopedRole === "ADMIN" ? (null as number[] | null) : ([0] as number[]),
    myRepId: null as number | null,
  }));

  const seeAllVisibility = !!(args.user as any)?.see_all_visibility;
  if (scopedRole === "EXEC_MANAGER" && seeAllVisibility) {
    const all = await listActiveRepsForOrg(args.orgId).catch(() => []);
    // Treat execs with global visibility as "company-wide" scope for rollups + dropdowns.
    scope = { repDirectory: all, allowedRepIds: null, myRepId: scope.myRepId ?? null };
  }

  const scopeLabel = scope.allowedRepIds ? "Team" : "Company";

  const useScoped = scope.allowedRepIds !== null;
  const allowedRepIds = scope.allowedRepIds ?? [];

  const reps: ExecRepOption[] = await pool
    .query<ExecRepOption>(
      `
      SELECT
        public_id::text AS public_id,
        COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(rep_name), ''), NULLIF(btrim(crm_owner_name), ''), '(Unnamed)') AS name
      FROM reps
      WHERE COALESCE(organization_id, org_id::bigint) = $1::bigint
        AND (active IS TRUE OR active IS NULL)
        AND role = 'REP'
        AND (NOT $2::boolean OR id = ANY($3::bigint[]))
      ORDER BY name ASC, id ASC
      `,
      [args.orgId, useScoped, Array.isArray(allowedRepIds) ? allowedRepIds : []]
    )
    .then((r) => (r.rows || []).map((x: any) => ({ public_id: String(x.public_id), name: String(x.name || "").trim() || "(Unnamed)" })))
    .catch(() => []);

  const qpId = selectedQuotaPeriodId;

  // If we can't resolve any scope for a non-admin, fail closed (align with other dashboards).
  const useScopedRepIds = scopedRole !== "ADMIN";
  if (useScopedRepIds && repIdsToUse.length === 0 && visibleRepNameKeys.length === 0) {
    return {
      periods,
      fiscalYearsSorted,
      selectedFiscalYear,
      selectedQuotaPeriodId: qpId,
      selectedPeriod,
      reps,
      scopeLabel,
      repDirectory: scope.repDirectory || [],
      myRepId: scope.myRepId ?? null,
      stageProbabilities: { commit: 0.8, best_case: 0.325, pipeline: 0.1 },
      healthModifiers: { commit_modifier: 1, best_case_modifier: 1, pipeline_modifier: 1 },
      repRollups: [],
      productsClosedWon: [],
      productsClosedWonByRep: [],
      quarterKpis: null,
      pipelineMomentum: null,
      quota: 0,
      crmForecast: { commit_amount: 0, best_case_amount: 0, pipeline_amount: 0, won_amount: 0, weighted_forecast: 0 },
      aiForecast: { commit_amount: 0, best_case_amount: 0, pipeline_amount: 0, weighted_forecast: 0 },
      forecastGap: 0,
      pctToGoal: null,
      leftToGo: 0,
      bucketDeltas: { commit: 0, best_case: 0, pipeline: 0, total: 0 },
    };
  }

  // --- CRM totals (unweighted) + Won amount (quarter scoped) ---
  type TotalsRow = {
    commit_amount: number;
    best_case_amount: number;
    pipeline_amount: number;
    won_amount: number;
  };

  const totals: TotalsRow =
    qpId && (repIdsToUse.length || visibleRepNameKeys.length)
      ? await pool
          .query<TotalsRow>(
            `
            WITH qp AS (
              SELECT period_start::date AS period_start, period_end::date AS period_end
                FROM quota_periods
               WHERE org_id = $1::bigint
                 AND id = $2::bigint
               LIMIT 1
            ),
            deals AS (
              SELECT
                COALESCE(o.amount, 0)::float8 AS amount,
                lower(
                  regexp_replace(
                    COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
                    '[^a-zA-Z]+',
                    ' ',
                    'g'
                  )
                ) AS fs,
                CASE
                  WHEN o.close_date IS NULL THEN NULL
                  WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
                  WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
                    to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'MM/DD/YYYY')
                  ELSE NULL
                END AS close_d
              FROM opportunities o
              WHERE o.org_id = $1
                AND (
                  (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
                  OR (
                    COALESCE(array_length($4::text[], 1), 0) > 0
                    AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
                  )
                )
            ),
            deals_in_qtr AS (
              SELECT d.*
                FROM deals d
                JOIN qp ON TRUE
               WHERE d.close_d IS NOT NULL
                 AND d.close_d >= qp.period_start
                 AND d.close_d <= qp.period_end
            ),
            open_deals AS (
              SELECT *
                FROM deals_in_qtr d
               WHERE NOT ((' ' || d.fs || ' ') LIKE '% won %')
                 AND NOT ((' ' || d.fs || ' ') LIKE '% lost %')
                 AND NOT ((' ' || d.fs || ' ') LIKE '% closed %')
            )
            SELECT
              COALESCE(SUM(CASE WHEN fs LIKE '%commit%' THEN amount ELSE 0 END), 0)::float8 AS commit_amount,
              COALESCE(SUM(CASE WHEN fs LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS best_case_amount,
              COALESCE(SUM(CASE WHEN fs NOT LIKE '%commit%' AND fs NOT LIKE '%best%' THEN amount ELSE 0 END), 0)::float8 AS pipeline_amount,
              COALESCE(SUM(CASE WHEN ((' ' || fs || ' ') LIKE '% won %') THEN amount ELSE 0 END), 0)::float8 AS won_amount
            FROM deals_in_qtr
            `,
            [args.orgId, qpId, repIdsToUse, visibleRepNameKeys]
          )
          .then((r) => (r.rows?.[0] as any) || { commit_amount: 0, best_case_amount: 0, pipeline_amount: 0, won_amount: 0 })
          .catch(() => ({ commit_amount: 0, best_case_amount: 0, pipeline_amount: 0, won_amount: 0 }))
      : { commit_amount: 0, best_case_amount: 0, pipeline_amount: 0, won_amount: 0 };

  const canCompute = !!qpId && (repIdsToUse.length > 0 || visibleRepNameKeys.length > 0);

  type RepQuarterRollupRow = {
    rep_id: string; // may be '' when unknown
    rep_name: string;
    commit_amount: number;
    best_case_amount: number;
    pipeline_amount: number;
    won_amount: number;
    won_count: number;
  };

  const repRollups: RepQuarterRollupRow[] = canCompute
    ? await pool
        .query<RepQuarterRollupRow>(
          `
          WITH qp AS (
            SELECT period_start::date AS period_start, period_end::date AS period_end
              FROM quota_periods
             WHERE org_id = $1::bigint
               AND id = $2::bigint
             LIMIT 1
          ),
          deals AS (
            SELECT
              COALESCE(o.amount, 0) AS amount,
              o.rep_id,
              o.rep_name,
              lower(
                regexp_replace(
                  COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
                  '[^a-zA-Z]+',
                  ' ',
                  'g'
                )
              ) AS fs,
              CASE
                WHEN o.close_date IS NULL THEN NULL
                WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
                WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
                  to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'MM/DD/YYYY')
                ELSE NULL
              END AS close_d
            FROM opportunities o
            WHERE o.org_id = $1
              AND (
                (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
                OR (
                  COALESCE(array_length($4::text[], 1), 0) > 0
                  AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
                )
              )
          ),
          deals_in_qtr AS (
            SELECT d.*
              FROM deals d
              JOIN qp ON TRUE
             WHERE d.close_d IS NOT NULL
               AND d.close_d >= qp.period_start
               AND d.close_d <= qp.period_end
          )
          SELECT
            COALESCE(d.rep_id::text, '') AS rep_id,
            COALESCE(
              NULLIF(btrim(r.display_name), ''),
              NULLIF(btrim(r.rep_name), ''),
              NULLIF(btrim(r.crm_owner_name), ''),
              NULLIF(btrim(d.rep_name), ''),
              '(Unknown rep)'
            ) AS rep_name,
            COALESCE(SUM(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %')
                OR ((' ' || d.fs || ' ') LIKE '% lost %')
                OR ((' ' || d.fs || ' ') LIKE '% closed %')
              THEN 0
              WHEN d.fs LIKE '%commit%' THEN d.amount
              ELSE 0
            END), 0)::float8 AS commit_amount,
            COALESCE(SUM(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %')
                OR ((' ' || d.fs || ' ') LIKE '% lost %')
                OR ((' ' || d.fs || ' ') LIKE '% closed %')
              THEN 0
              WHEN d.fs LIKE '%best%' THEN d.amount
              ELSE 0
            END), 0)::float8 AS best_case_amount,
            COALESCE(SUM(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %')
                OR ((' ' || d.fs || ' ') LIKE '% lost %')
                OR ((' ' || d.fs || ' ') LIKE '% closed %')
              THEN 0
              WHEN d.fs LIKE '%commit%' THEN 0
              WHEN d.fs LIKE '%best%' THEN 0
              ELSE d.amount
            END), 0)::float8 AS pipeline_amount,
            COALESCE(SUM(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %') THEN d.amount
              ELSE 0
            END), 0)::float8 AS won_amount
            ,
            COALESCE(SUM(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %') THEN 1
              ELSE 0
            END), 0)::int AS won_count
          FROM deals_in_qtr d
          LEFT JOIN reps r
            ON r.id = d.rep_id
           AND COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
          GROUP BY
            COALESCE(d.rep_id::text, ''),
            COALESCE(
              NULLIF(btrim(r.display_name), ''),
              NULLIF(btrim(r.rep_name), ''),
              NULLIF(btrim(r.crm_owner_name), ''),
              NULLIF(btrim(d.rep_name), ''),
              '(Unknown rep)'
            )
          ORDER BY rep_name ASC, rep_id ASC
          `,
          [args.orgId, qpId, repIdsToUse, visibleRepNameKeys]
        )
        .then((r) => (r.rows || []) as any[])
        .catch(() => [])
    : [];

  type ProductWonRow = {
    product: string;
    won_amount: number;
    won_count: number;
    avg_order_value: number;
    avg_health_score: number | null;
  };

  const productsClosedWon: ProductWonRow[] = canCompute
    ? await pool
        .query<ProductWonRow>(
          `
          WITH qp AS (
            SELECT period_start::date AS period_start, period_end::date AS period_end
              FROM quota_periods
             WHERE org_id = $1::bigint
               AND id = $2::bigint
             LIMIT 1
          ),
          deals AS (
            SELECT
              COALESCE(NULLIF(btrim(o.product), ''), '(Unspecified)') AS product,
              COALESCE(o.amount, 0) AS amount,
              o.health_score,
              lower(
                regexp_replace(
                  COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
                  '[^a-zA-Z]+',
                  ' ',
                  'g'
                )
              ) AS fs,
              CASE
                WHEN o.close_date IS NULL THEN NULL
                WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
                WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
                  to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'MM/DD/YYYY')
                ELSE NULL
              END AS close_d
            FROM opportunities o
            WHERE o.org_id = $1
              AND (
                (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
                OR (
                  COALESCE(array_length($4::text[], 1), 0) > 0
                  AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
                )
              )
          ),
          deals_in_qtr AS (
            SELECT d.*
              FROM deals d
              JOIN qp ON TRUE
             WHERE d.close_d IS NOT NULL
               AND d.close_d >= qp.period_start
               AND d.close_d <= qp.period_end
          ),
          won_deals AS (
            SELECT *
              FROM deals_in_qtr
             WHERE ((' ' || fs || ' ') LIKE '% won %')
          )
          SELECT
            product,
            COALESCE(SUM(amount), 0)::float8 AS won_amount,
            COUNT(*)::int AS won_count,
            CASE WHEN COUNT(*) > 0 THEN (COALESCE(SUM(amount), 0)::float8 / COUNT(*)::float8) ELSE 0 END AS avg_order_value,
            AVG(NULLIF(health_score, 0))::float8 AS avg_health_score
          FROM won_deals
          GROUP BY product
          ORDER BY won_amount DESC, product ASC
          LIMIT 30
          `,
          [args.orgId, qpId, repIdsToUse, visibleRepNameKeys]
        )
        .then((r) => (r.rows || []) as any[])
        .catch(() => [])
    : [];

  type ProductWonByRepRow = {
    rep_name: string;
    product: string;
    won_amount: number;
    won_count: number;
    avg_order_value: number;
    avg_health_score: number | null;
  };

  const productsClosedWonByRep: ProductWonByRepRow[] = canCompute
    ? await pool
        .query<ProductWonByRepRow>(
          `
          WITH qp AS (
            SELECT period_start::date AS period_start, period_end::date AS period_end
              FROM quota_periods
             WHERE org_id = $1::bigint
               AND id = $2::bigint
             LIMIT 1
          ),
          deals AS (
            SELECT
              COALESCE(NULLIF(btrim(o.product), ''), '(Unspecified)') AS product,
              COALESCE(o.amount, 0) AS amount,
              o.health_score,
              o.rep_id,
              o.rep_name,
              lower(
                regexp_replace(
                  COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
                  '[^a-zA-Z]+',
                  ' ',
                  'g'
                )
              ) AS fs,
              CASE
                WHEN o.close_date IS NULL THEN NULL
                WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
                WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
                  to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'MM/DD/YYYY')
                ELSE NULL
              END AS close_d
            FROM opportunities o
            WHERE o.org_id = $1
              AND (
                (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
                OR (
                  COALESCE(array_length($4::text[], 1), 0) > 0
                  AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
                )
              )
          ),
          deals_in_qtr AS (
            SELECT d.*
              FROM deals d
              JOIN qp ON TRUE
             WHERE d.close_d IS NOT NULL
               AND d.close_d >= qp.period_start
               AND d.close_d <= qp.period_end
          ),
          won_deals AS (
            SELECT *
              FROM deals_in_qtr
             WHERE ((' ' || fs || ' ') LIKE '% won %')
          )
          SELECT
            COALESCE(
              NULLIF(btrim(r.display_name), ''),
              NULLIF(btrim(r.rep_name), ''),
              NULLIF(btrim(r.crm_owner_name), ''),
              NULLIF(btrim(d.rep_name), ''),
              '(Unknown rep)'
            ) AS rep_name,
            d.product,
            COALESCE(SUM(d.amount), 0)::float8 AS won_amount,
            COUNT(*)::int AS won_count,
            CASE WHEN COUNT(*) > 0 THEN (COALESCE(SUM(d.amount), 0)::float8 / COUNT(*)::float8) ELSE 0 END AS avg_order_value,
            AVG(NULLIF(d.health_score, 0))::float8 AS avg_health_score
          FROM won_deals d
          LEFT JOIN reps r
            ON r.id = d.rep_id
           AND COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
          GROUP BY
            COALESCE(
              NULLIF(btrim(r.display_name), ''),
              NULLIF(btrim(r.rep_name), ''),
              NULLIF(btrim(r.crm_owner_name), ''),
              NULLIF(btrim(d.rep_name), ''),
              '(Unknown rep)'
            ),
            d.product
          ORDER BY won_amount DESC, rep_name ASC, product ASC
          LIMIT 200
          `,
          [args.orgId, qpId, repIdsToUse, visibleRepNameKeys]
        )
        .then((r) => (r.rows || []) as any[])
        .catch(() => [])
    : [];

  const stageProbabilities = await getForecastStageProbabilities({ orgId: args.orgId }).catch(() => ({
    commit: 0.8,
    best_case: 0.325,
    pipeline: 0.1,
  }));

  // --- Health modifiers derived from AI vs CRM bucket sums (quarter scoped) ---
  type VerdictAggRow = {
    commit_crm: number;
    commit_verdict: number;
    best_case_crm: number;
    best_case_verdict: number;
    pipeline_crm: number;
    pipeline_verdict: number;
  };

  const verdictAgg: VerdictAggRow =
    qpId && (repIdsToUse.length || visibleRepNameKeys.length)
      ? await (async () => {
          const empty: VerdictAggRow = {
            commit_crm: 0,
            commit_verdict: 0,
            best_case_crm: 0,
            best_case_verdict: 0,
            pipeline_crm: 0,
            pipeline_verdict: 0,
          };
          try {
            const row = await pool
              .query<VerdictAggRow>(
                `
                WITH qp AS (
                  SELECT period_start::date AS period_start, period_end::date AS period_end
                    FROM quota_periods
                   WHERE org_id = $1::bigint
                     AND id = $2::bigint
                   LIMIT 1
                ),
                deals AS (
                  SELECT
                    COALESCE(o.amount, 0)::float8 AS amount,
                    o.health_score,
                    lower(
                      regexp_replace(
                        COALESCE(NULLIF(btrim(o.forecast_stage), ''), ''),
                        '[^a-zA-Z]+',
                        ' ',
                        'g'
                      )
                    ) AS fs,
                    CASE
                      WHEN o.close_date IS NULL THEN NULL
                      WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
                      WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
                        to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'MM/DD/YYYY')
                      ELSE NULL
                    END AS close_d
                  FROM opportunities o
                  WHERE o.org_id = $1
                    AND (
                      (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
                      OR (
                        COALESCE(array_length($4::text[], 1), 0) > 0
                        AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
                      )
                    )
                ),
                deals_in_qtr AS (
                  SELECT d.*
                    FROM deals d
                    JOIN qp ON TRUE
                   WHERE d.close_d IS NOT NULL
                     AND d.close_d >= qp.period_start
                     AND d.close_d <= qp.period_end
                ),
                open_deals AS (
                  SELECT *
                    FROM deals_in_qtr d
                   WHERE NOT ((' ' || d.fs || ' ') LIKE '% won %')
                     AND NOT ((' ' || d.fs || ' ') LIKE '% lost %')
                     AND NOT ((' ' || d.fs || ' ') LIKE '% closed %')
                ),
                classified AS (
                  SELECT
                    *,
                    CASE
                      WHEN fs LIKE '%commit%' THEN 'commit'
                      WHEN fs LIKE '%best%' THEN 'best_case'
                      ELSE 'pipeline'
                    END AS crm_bucket
                  FROM open_deals
                ),
                with_rules AS (
                  SELECT
                    c.*,
                    COALESCE(hr.suppression, FALSE) AS suppression,
                    COALESCE(hr.probability_modifier, 1.0)::float8 AS probability_modifier
                  FROM classified c
                  LEFT JOIN LATERAL (
                    SELECT suppression, probability_modifier
                      FROM health_score_rules
                     WHERE org_id = $1::int
                       AND c.crm_bucket IS NOT NULL
                       AND mapped_category = CASE
                         WHEN c.crm_bucket = 'commit' THEN 'Commit'
                         WHEN c.crm_bucket = 'best_case' THEN 'Best Case'
                         WHEN c.crm_bucket = 'pipeline' THEN 'Pipeline'
                         ELSE mapped_category
                       END
                       AND c.health_score IS NOT NULL
                       AND c.health_score >= min_score
                       AND c.health_score <= max_score
                     ORDER BY min_score DESC
                     LIMIT 1
                  ) hr ON TRUE
                ),
                with_modifier AS (
                  SELECT
                    *,
                    CASE WHEN suppression THEN 0.0::float8 ELSE COALESCE(probability_modifier, 1.0)::float8 END AS health_modifier
                  FROM with_rules
                )
                SELECT
                  COALESCE(SUM(CASE WHEN crm_bucket = 'commit' THEN amount ELSE 0 END), 0)::float8 AS commit_crm,
                  COALESCE(SUM(CASE WHEN crm_bucket = 'commit' THEN amount * health_modifier ELSE 0 END), 0)::float8 AS commit_verdict,
                  COALESCE(SUM(CASE WHEN crm_bucket = 'best_case' THEN amount ELSE 0 END), 0)::float8 AS best_case_crm,
                  COALESCE(SUM(CASE WHEN crm_bucket = 'best_case' THEN amount * health_modifier ELSE 0 END), 0)::float8 AS best_case_verdict,
                  COALESCE(SUM(CASE WHEN crm_bucket = 'pipeline' THEN amount ELSE 0 END), 0)::float8 AS pipeline_crm,
                  COALESCE(SUM(CASE WHEN crm_bucket = 'pipeline' THEN amount * health_modifier ELSE 0 END), 0)::float8 AS pipeline_verdict
                FROM with_modifier
                `,
                [args.orgId, qpId, repIdsToUse, visibleRepNameKeys]
              )
              .then((r) => r.rows?.[0] || empty);
            return row;
          } catch (e: any) {
            const code = String(e?.code || "");
            if (code === "42P01") return empty;
            throw e;
          }
        })()
      : {
          commit_crm: 0,
          commit_verdict: 0,
          best_case_crm: 0,
          best_case_verdict: 0,
          pipeline_crm: 0,
          pipeline_verdict: 0,
        };

  const healthModifiers = {
    commit_modifier: verdictAgg.commit_crm > 0 ? verdictAgg.commit_verdict / verdictAgg.commit_crm : 1,
    best_case_modifier: verdictAgg.best_case_crm > 0 ? verdictAgg.best_case_verdict / verdictAgg.best_case_crm : 1,
    pipeline_modifier: verdictAgg.pipeline_crm > 0 ? verdictAgg.pipeline_verdict / verdictAgg.pipeline_crm : 1,
  };

  const quota = qpId
    ? await (async () => {
        const repFilter = scope.allowedRepIds;
        const useFilter = Array.isArray(repFilter) && repFilter.length > 0;
        return pool
          .query<{ quota_amount: number }>(
            `
            SELECT COALESCE(SUM(quota_amount), 0)::float8 AS quota_amount
              FROM quotas
             WHERE org_id = $1::bigint
               AND role_level = 3
               AND quota_period_id = $2::bigint
               AND (NOT $4::boolean OR rep_id = ANY($3::bigint[]))
            `,
            [args.orgId, qpId, repFilter || [], useFilter]
          )
          .then((r) => Number(r.rows?.[0]?.quota_amount || 0) || 0)
          .catch(() => 0);
      })()
    : 0;

  const summary = computeSalesVsVerdictForecastSummary({
    crm_totals: {
      commit: Number(totals.commit_amount || 0) || 0,
      best_case: Number(totals.best_case_amount || 0) || 0,
      pipeline: Number(totals.pipeline_amount || 0) || 0,
      won: Number(totals.won_amount || 0) || 0,
      quota,
    },
    org_probabilities: {
      commit_pct: stageProbabilities.commit,
      best_case_pct: stageProbabilities.best_case,
      pipeline_pct: stageProbabilities.pipeline,
    },
    health_modifiers: healthModifiers,
  });

  const weightedCrm = summary.weighted.crm.forecast;
  const weightedAi = summary.weighted.verdict.forecast;
  const forecastGap = summary.forecast_gap;
  const pctToGoal = quota > 0 ? weightedAi / quota : null;
  const leftToGo = quota - weightedAi;

  const commitDelta = summary.weighted.verdict.commit_weighted - summary.weighted.crm.commit_weighted;
  const bestDelta = summary.weighted.verdict.best_case_weighted - summary.weighted.crm.best_case_weighted;
  const pipeDelta = summary.weighted.verdict.pipeline_weighted - summary.weighted.crm.pipeline_weighted;

  const quarterKpis = qpId
    ? await getQuarterKpisSnapshot({
        orgId: args.orgId,
        quotaPeriodId: qpId,
        repIds: scope.allowedRepIds === null ? null : scope.allowedRepIds ?? [],
      }).catch(() => null)
    : null;

  const periodIdx = periods.findIndex((p) => String(p.id) === String(qpId));
  const prevPeriod = periodIdx >= 0 ? periods[periodIdx + 1] || null : null;
  const prevQpId = String(prevPeriod?.id || "").trim();
  const useRepFilterForMomentum = scope.allowedRepIds !== null;

  const curSnap = qpId
    ? await getOpenPipelineSnapshot({
        orgId: args.orgId,
        quotaPeriodId: qpId,
        useRepFilter: useRepFilterForMomentum,
        repIds: repIdsToUse,
        repNameKeys: visibleRepNameKeys,
      }).catch(() => null)
    : null;
  const prevSnap = prevQpId
    ? await getOpenPipelineSnapshot({
        orgId: args.orgId,
        quotaPeriodId: prevQpId,
        useRepFilter: useRepFilterForMomentum,
        repIds: repIdsToUse,
        repNameKeys: visibleRepNameKeys,
      }).catch(() => null)
    : null;

  const qoqPct = (cur: number, prev: number) => {
    if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
    return ((cur - prev) / prev) * 100;
  };

  const pipelineMomentum: PipelineMomentumData | null =
    curSnap && Number.isFinite(Number(curSnap.total_amount))
      ? {
          quota_target: quota,
          current_quarter: {
            total_pipeline: Number(curSnap.total_amount || 0) || 0,
            total_opps: Number(curSnap.total_count || 0) || 0,
            mix: {
              commit: {
                value: Number(curSnap.commit_amount || 0) || 0,
                opps: Number(curSnap.commit_count || 0) || 0,
                qoq_change_pct: prevSnap ? qoqPct(Number(curSnap.commit_amount || 0) || 0, Number(prevSnap.commit_amount || 0) || 0) : null,
              },
              best_case: {
                value: Number(curSnap.best_case_amount || 0) || 0,
                opps: Number(curSnap.best_case_count || 0) || 0,
                qoq_change_pct: prevSnap ? qoqPct(Number(curSnap.best_case_amount || 0) || 0, Number(prevSnap.best_case_amount || 0) || 0) : null,
              },
              pipeline: {
                value: Number(curSnap.pipeline_amount || 0) || 0,
                opps: Number(curSnap.pipeline_count || 0) || 0,
                qoq_change_pct: prevSnap ? qoqPct(Number(curSnap.pipeline_amount || 0) || 0, Number(prevSnap.pipeline_amount || 0) || 0) : null,
              },
            },
          },
          previous_quarter: {
            total_pipeline: prevSnap ? (Number(prevSnap.total_amount || 0) || 0) : null,
          },
        }
      : null;

  return {
    periods,
    fiscalYearsSorted,
    selectedFiscalYear,
    selectedQuotaPeriodId: qpId,
    selectedPeriod,
    reps: reps,
    scopeLabel,
    repDirectory: scope.repDirectory || [],
    myRepId: scope.myRepId ?? null,
    stageProbabilities,
    healthModifiers,
    repRollups,
    productsClosedWon,
    productsClosedWonByRep,
    quarterKpis,
    pipelineMomentum,
    quota,
    crmForecast: {
      commit_amount: Number(totals.commit_amount || 0) || 0,
      best_case_amount: Number(totals.best_case_amount || 0) || 0,
      pipeline_amount: Number(totals.pipeline_amount || 0) || 0,
      won_amount: Number(totals.won_amount || 0) || 0,
      weighted_forecast: weightedCrm,
    },
    aiForecast: {
      commit_amount: Number(totals.commit_amount || 0) * (healthModifiers.commit_modifier || 1),
      best_case_amount: Number(totals.best_case_amount || 0) * (healthModifiers.best_case_modifier || 1),
      pipeline_amount: Number(totals.pipeline_amount || 0) * (healthModifiers.pipeline_modifier || 1),
      weighted_forecast: weightedAi,
    },
    forecastGap,
    pctToGoal,
    leftToGo,
    bucketDeltas: {
      commit: commitDelta,
      best_case: bestDelta,
      pipeline: pipeDelta,
      total: forecastGap,
    },
  };
}

