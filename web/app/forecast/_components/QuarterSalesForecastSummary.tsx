import Link from "next/link";
import { pool } from "../../../lib/pool";
import type { AuthUser } from "../../../lib/auth";
import { getVisibleUsers } from "../../../lib/db";

type QuotaPeriodOption = {
  id: string; // bigint as text
  period_name: string;
  period_start: string; // date text
  period_end: string; // date text
  fiscal_year: string;
  fiscal_quarter: string; // text
};

type ProductWonRow = {
  product: string;
  won_amount: number;
  won_count: number;
  avg_order_value: number;
  avg_health_score: number | null;
};

function ordinalQuarterLabel(q: number) {
  if (q === 1) return "1st Quarter";
  if (q === 2) return "2nd Quarter";
  if (q === 3) return "3rd Quarter";
  if (q === 4) return "4th Quarter";
  return `Q${q}`;
}

function periodLabel(p: QuotaPeriodOption) {
  const q = Number.parseInt(String(p.fiscal_quarter || "").trim(), 10);
  const y = String(p.fiscal_year || "").trim();
  if (Number.isFinite(q) && q > 0 && y) return `${ordinalQuarterLabel(q)} ${y}`;
  return String(p.period_name || "").trim() || `${p.period_start} → ${p.period_end}`;
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

function healthPctFrom30(score: any) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  const pct = Math.round((n / 30) * 100);
  return Math.max(0, Math.min(100, pct));
}

function healthColorClass(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-disabled)]";
  if (pct >= 80) return "text-[#2ECC71]";
  if (pct >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
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

export async function QuarterSalesForecastSummary(props: {
  orgId: number;
  user: AuthUser;
  currentPath: string;
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const selectedQuotaPeriodId = String(sp(props.searchParams?.quota_period_id) || "").trim();
  const selectedFiscalYear = String(sp(props.searchParams?.fiscal_year) || "").trim();
  const debug = String(sp(props.searchParams?.debug) || "").trim() === "1";

  const { rows: periodsRaw } = await pool.query<QuotaPeriodOption>(
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
    [props.orgId]
  );
  const periods = (periodsRaw || []) as QuotaPeriodOption[];
  // Some orgs have quota periods with blank fiscal_year strings; fall back to calendar year from period_start.
  const fiscalYearKey = (p: QuotaPeriodOption) => {
    const fy = String(p.fiscal_year || "").trim();
    if (fy) return fy;
    return String(p.period_start || "").slice(0, 4);
  };
  const fiscalYears = Array.from(new Set(periods.map((p) => fiscalYearKey(p)).filter(Boolean)));
  const fiscalYearsSorted = fiscalYears.slice().sort((a, b) => b.localeCompare(a));
  const selectedPeriodFromParam = selectedQuotaPeriodId
    ? periods.find((p) => String(p.id) === selectedQuotaPeriodId) || null
    : null;

  const currentId = await pool
    .query<{ id: string }>(
      `
      SELECT id::text AS id
        FROM quota_periods
       WHERE org_id = $1::bigint
         AND period_start <= CURRENT_DATE
         AND period_end >= CURRENT_DATE
       ORDER BY period_start DESC, id DESC
       LIMIT 1
      `,
      [props.orgId]
    )
    .then((r) => String(r.rows?.[0]?.id || "").trim())
    .catch(() => "");

  const current = (currentId && periods.find((p) => String(p.id) === currentId)) || periods[0] || null;
  const currentYear = current ? String(current.fiscal_year || "").trim() : "";
  // IMPORTANT: if quota_period_id is provided without fiscal_year (e.g. other page selector),
  // infer fiscal year from the chosen period so the selection is honored deterministically.
  const yearToUse =
    selectedFiscalYear ||
    (selectedPeriodFromParam ? String(selectedPeriodFromParam.fiscal_year || "").trim() : "") ||
    currentYear ||
    fiscalYearsSorted[0] ||
    "";
  const periodsForYear = yearToUse ? periods.filter((p) => fiscalYearKey(p) === yearToUse) : periods;

  const selected =
    (selectedQuotaPeriodId && periodsForYear.find((p) => String(p.id) === selectedQuotaPeriodId)) ||
    (current && periodsForYear.find((p) => String(p.id) === String(current.id))) ||
    periodsForYear[0] ||
    null;

  const userRepName = String(props.user.account_owner_name || "").trim();

  const qpId = selected ? String(selected.id) : "";

  const role = props.user.role;
  const visibleUsers = await getVisibleUsers({
    currentUserId: props.user.id,
    orgId: props.orgId,
    role,
    hierarchy_level: props.user.hierarchy_level,
    see_all_visibility: props.user.see_all_visibility,
  }).catch(() => []);

  const visibleRepUsers = (visibleUsers || []).filter((u) => u && u.role === "REP" && u.active);
  const visibleRepUserIds = Array.from(new Set(visibleRepUsers.map((u) => Number(u.id)).filter((n) => Number.isFinite(n) && n > 0)));
  const visibleRepNameKeys = Array.from(
    new Set(visibleRepUsers.map((u) => normalizeNameKey(u.account_owner_name || "")).filter(Boolean))
  );

  // Map visible REP users -> rep ids when possible (opportunities.rep_id is reps.id).
  const { rows: repRows } = visibleRepUserIds.length
    ? await pool
        .query<{ id: number; rep_name: string | null; crm_owner_name: string | null; display_name: string | null; user_id: number | null }>(
          `
          SELECT r.id, r.rep_name, r.crm_owner_name, r.display_name, r.user_id
            FROM reps r
           WHERE COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
             AND (
               r.user_id = ANY($2::int[])
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
          [props.orgId, visibleRepUserIds, visibleRepNameKeys]
        )
        .then((r) => ({ rows: (r.rows || []) as any[] }))
        .catch(() => ({ rows: [] as any[] }))
    : { rows: [] as any[] };

  const repIdsToUse = Array.from(new Set((repRows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0)));

  // For REP users, keep a friendly headline; for managers/admins, show a team headline.
  const repNameForHeadline =
    role === "REP"
      ? (userRepName || String(props.user.display_name || "").trim())
      : String(props.user.display_name || "").trim();

  const canCompute = !!qpId && (repIdsToUse.length > 0 || visibleRepNameKeys.length > 0);

  type RepQuarterRollupRow = {
    rep_id: string; // may be '' when unknown
    rep_name: string;
    commit_amount: number;
    commit_count: number;
    commit_health_score: number | null;
    best_case_amount: number;
    best_case_count: number;
    best_case_health_score: number | null;
    pipeline_amount: number;
    pipeline_count: number;
    pipeline_health_score: number | null;
    total_pipeline_health_score: number | null;
    won_amount: number;
    won_count: number;
    won_health_score: number | null;
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
              o.health_score,
              -- Use forecast_stage when present; fall back to sales_stage (many CRMs mark Won/Lost there).
              lower(
                regexp_replace(
                  COALESCE(NULLIF(btrim(o.forecast_stage), ''), NULLIF(btrim(o.sales_stage), ''), ''),
                  '[^a-zA-Z]+',
                  ' ',
                  'g'
                )
              ) AS fs,
              CASE
                WHEN o.close_date IS NULL THEN NULL
                -- ISO date or timestamp starting with YYYY-MM-DD
                WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
                -- US-style M/D/YYYY (common in Excel uploads)
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
              NULLIF(btrim(r.rep_name), ''),
              NULLIF(btrim(r.crm_owner_name), ''),
              NULLIF(btrim(r.display_name), ''),
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
              WHEN d.fs LIKE '%commit%' THEN 1
              ELSE 0
            END), 0)::int AS commit_count,
            AVG(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %')
                OR ((' ' || d.fs || ' ') LIKE '% lost %')
                OR ((' ' || d.fs || ' ') LIKE '% closed %')
              THEN NULL
              WHEN d.fs LIKE '%commit%' THEN NULLIF(d.health_score, 0)
              ELSE NULL
            END)::float8 AS commit_health_score,
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
              WHEN d.fs LIKE '%best%' THEN 1
              ELSE 0
            END), 0)::int AS best_case_count,
            AVG(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %')
                OR ((' ' || d.fs || ' ') LIKE '% lost %')
                OR ((' ' || d.fs || ' ') LIKE '% closed %')
              THEN NULL
              WHEN d.fs LIKE '%best%' THEN NULLIF(d.health_score, 0)
              ELSE NULL
            END)::float8 AS best_case_health_score,
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
              WHEN ((' ' || d.fs || ' ') LIKE '% won %')
                OR ((' ' || d.fs || ' ') LIKE '% lost %')
                OR ((' ' || d.fs || ' ') LIKE '% closed %')
              THEN 0
              WHEN d.fs LIKE '%commit%' THEN 0
              WHEN d.fs LIKE '%best%' THEN 0
              ELSE 1
            END), 0)::int AS pipeline_count,
            AVG(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %')
                OR ((' ' || d.fs || ' ') LIKE '% lost %')
                OR ((' ' || d.fs || ' ') LIKE '% closed %')
              THEN NULL
              WHEN d.fs LIKE '%commit%' THEN NULL
              WHEN d.fs LIKE '%best%' THEN NULL
              ELSE NULLIF(d.health_score, 0)
            END)::float8 AS pipeline_health_score,
            AVG(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %')
                OR ((' ' || d.fs || ' ') LIKE '% lost %')
                OR ((' ' || d.fs || ' ') LIKE '% closed %')
              THEN NULL
              ELSE NULLIF(d.health_score, 0)
            END)::float8 AS total_pipeline_health_score,
            COALESCE(SUM(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %') THEN d.amount
              ELSE 0
            END), 0)::float8 AS won_amount,
            COALESCE(SUM(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %') THEN 1
              ELSE 0
            END), 0)::int AS won_count,
            AVG(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %') THEN NULLIF(d.health_score, 0)
              ELSE NULL
            END)::float8 AS won_health_score
          FROM deals_in_qtr d
          LEFT JOIN reps r
            ON r.id = d.rep_id
           AND COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
          GROUP BY
            COALESCE(d.rep_id::text, ''),
            COALESCE(
              NULLIF(btrim(r.rep_name), ''),
              NULLIF(btrim(r.crm_owner_name), ''),
              NULLIF(btrim(r.display_name), ''),
              NULLIF(btrim(d.rep_name), ''),
              '(Unknown rep)'
            )
          ORDER BY rep_name ASC, rep_id ASC
          `,
          [props.orgId, qpId, repIdsToUse, visibleRepNameKeys]
        )
        .then((r) => (r.rows || []) as any[])
        .catch(() => [])
    : [];

  const products: ProductWonRow[] = canCompute
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
                  COALESCE(NULLIF(btrim(o.forecast_stage), ''), NULLIF(btrim(o.sales_stage), ''), ''),
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
          [props.orgId, qpId, repIdsToUse, visibleRepNameKeys]
        )
        .then((r) => (r.rows || []) as any[])
        .catch(() => [])
    : [];

  const bucketHealth = canCompute
    ? await pool
        .query<{
          commit_health_score: number | null;
          best_case_health_score: number | null;
          pipeline_health_score: number | null;
          won_health_score: number | null;
        }>(
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
              o.health_score,
              lower(
                regexp_replace(
                  COALESCE(NULLIF(btrim(o.forecast_stage), ''), NULLIF(btrim(o.sales_stage), ''), ''),
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
            AVG(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %')
                OR ((' ' || d.fs || ' ') LIKE '% lost %')
                OR ((' ' || d.fs || ' ') LIKE '% closed %')
              THEN NULL
              WHEN d.fs LIKE '%commit%' THEN NULLIF(d.health_score, 0)
              ELSE NULL
            END)::float8 AS commit_health_score,
            AVG(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %')
                OR ((' ' || d.fs || ' ') LIKE '% lost %')
                OR ((' ' || d.fs || ' ') LIKE '% closed %')
              THEN NULL
              WHEN d.fs LIKE '%best%' THEN NULLIF(d.health_score, 0)
              ELSE NULL
            END)::float8 AS best_case_health_score,
            AVG(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %')
                OR ((' ' || d.fs || ' ') LIKE '% lost %')
                OR ((' ' || d.fs || ' ') LIKE '% closed %')
              THEN NULL
              WHEN d.fs LIKE '%commit%' THEN NULL
              WHEN d.fs LIKE '%best%' THEN NULL
              ELSE NULLIF(d.health_score, 0)
            END)::float8 AS pipeline_health_score,
            AVG(CASE
              WHEN ((' ' || d.fs || ' ') LIKE '% won %') THEN NULLIF(d.health_score, 0)
              ELSE NULL
            END)::float8 AS won_health_score
          FROM deals_in_qtr d
          `,
          [props.orgId, qpId, repIdsToUse, visibleRepNameKeys]
        )
        .then((r) =>
          r.rows?.[0] || { commit_health_score: null, best_case_health_score: null, pipeline_health_score: null, won_health_score: null }
        )
        .catch(() => ({ commit_health_score: null, best_case_health_score: null, pipeline_health_score: null, won_health_score: null }))
    : { commit_health_score: null, best_case_health_score: null, pipeline_health_score: null, won_health_score: null };

  const commitHealthPct = healthPctFrom30(bucketHealth.commit_health_score);
  const bestHealthPct = healthPctFrom30(bucketHealth.best_case_health_score);
  const pipelineHealthPct = healthPctFrom30(bucketHealth.pipeline_health_score);
  const wonHealthPct = healthPctFrom30(bucketHealth.won_health_score);

  const commitAmt = repRollups.reduce((acc, r) => acc + (Number(r.commit_amount || 0) || 0), 0);
  const commitCount = repRollups.reduce((acc, r) => acc + (Number(r.commit_count || 0) || 0), 0);
  const bestCaseAmt = repRollups.reduce((acc, r) => acc + (Number(r.best_case_amount || 0) || 0), 0);
  const bestCaseCount = repRollups.reduce((acc, r) => acc + (Number(r.best_case_count || 0) || 0), 0);
  const pipelineAmt = repRollups.reduce((acc, r) => acc + (Number(r.pipeline_amount || 0) || 0), 0);
  const pipelineCount = repRollups.reduce((acc, r) => acc + (Number(r.pipeline_count || 0) || 0), 0);
  const totalAmt = commitAmt + bestCaseAmt + pipelineAmt;
  const wonAmt = repRollups.reduce((acc, r) => acc + (Number(r.won_amount || 0) || 0), 0);
  const wonCount = repRollups.reduce((acc, r) => acc + (Number(r.won_count || 0) || 0), 0);
  const totalPipelineCount = commitCount + bestCaseCount + pipelineCount;

  const debugInfo =
    debug && canCompute
      ? await pool
          .query<{
            qp_period_start: string;
            qp_period_end: string;
            match_kind: string;
            deals_in_qtr: number;
            min_close_d: string | null;
            max_close_d: string | null;
          }>(
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
                o.public_id::text AS public_id,
                o.id AS id,
                o.rep_id,
                o.rep_name,
                o.amount,
                o.close_date::text AS close_date_raw,
                o.forecast_stage,
                o.sales_stage,
                lower(
                  regexp_replace(
                    COALESCE(NULLIF(btrim(o.forecast_stage), ''), NULLIF(btrim(o.sales_stage), ''), ''),
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
                END AS close_d,
                CASE
                  WHEN (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[])) THEN 'rep_id'
                  WHEN (
                    COALESCE(array_length($4::text[], 1), 0) > 0
                    AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
                  ) THEN 'rep_name'
                  ELSE 'none'
                END AS match_kind
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
              (SELECT qp.period_start::text FROM qp) AS qp_period_start,
              (SELECT qp.period_end::text FROM qp) AS qp_period_end,
              diq.match_kind,
              COUNT(*)::int AS deals_in_qtr,
              MIN(diq.close_d)::text AS min_close_d,
              MAX(diq.close_d)::text AS max_close_d
            FROM deals_in_qtr diq
            GROUP BY diq.match_kind
            ORDER BY diq.match_kind ASC
            `,
            [props.orgId, qpId, repIdsToUse, visibleRepNameKeys]
          )
          .then((r) => r.rows || [])
          .catch(() => [])
      : null;

  const debugSampleRows =
    debug && canCompute
      ? await pool
          .query<{
            id: number;
            public_id: string;
            rep_id: number | null;
            rep_name: string | null;
            amount: number | null;
            close_date_raw: string | null;
            close_d: string | null;
            forecast_stage: string | null;
            sales_stage: string | null;
            fs: string;
            match_kind: string;
          }>(
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
                o.id AS id,
                o.public_id::text AS public_id,
                o.rep_id,
                o.rep_name,
                o.amount,
                o.close_date::text AS close_date_raw,
                o.forecast_stage,
                o.sales_stage,
                lower(
                  regexp_replace(
                    COALESCE(NULLIF(btrim(o.forecast_stage), ''), NULLIF(btrim(o.sales_stage), ''), ''),
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
                END AS close_d,
                CASE
                  WHEN (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[])) THEN 'rep_id'
                  WHEN (
                    COALESCE(array_length($4::text[], 1), 0) > 0
                    AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
                  ) THEN 'rep_name'
                  ELSE 'none'
                END AS match_kind
              FROM opportunities o
              WHERE o.org_id = $1
                AND (
                  (COALESCE(array_length($3::bigint[], 1), 0) > 0 AND o.rep_id = ANY($3::bigint[]))
                  OR (
                    COALESCE(array_length($4::text[], 1), 0) > 0
                    AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = ANY($4::text[])
                  )
                )
            )
            SELECT d.*
              FROM deals d
              JOIN qp ON TRUE
             WHERE d.close_d IS NOT NULL
               AND d.close_d >= qp.period_start
               AND d.close_d <= qp.period_end
             ORDER BY d.close_d ASC, d.amount DESC NULLS LAST, d.id ASC
             LIMIT 25
            `,
            [props.orgId, qpId, repIdsToUse, visibleRepNameKeys]
          )
          .then((r) => r.rows || [])
          .catch(() => [])
      : null;

  const quotaAmt =
    repIdsToUse.length && qpId
      ? await pool
          .query<{ quota_amount: number }>(
            `
            SELECT COALESCE(SUM(quota_amount), 0)::float8 AS quota_amount
              FROM quotas
             WHERE org_id = $1::bigint
               AND role_level = 3
               AND quota_period_id = $2::bigint
               AND rep_id = ANY($3::bigint[])
            `,
            [props.orgId, qpId, repIdsToUse]
          )
          .then((r) => Number(r.rows?.[0]?.quota_amount || 0) || 0)
          .catch(() => 0)
      : 0;

  const pctToGoal = quotaAmt > 0 ? wonAmt / quotaAmt : null;
  const pctToGoalValueClass = pctToGoal != null && pctToGoal >= 1 ? "text-[#16A34A]" : "";
  const boxClass = "rounded-lg border border-[#93C5FD] bg-[#DBEAFE] px-3 py-2 text-black";
  const headline =
    role === "REP"
      ? repNameForHeadline
        ? `${repNameForHeadline}'s Quarterly Sales Forecast`
        : "Quarterly Sales Forecast"
      : repNameForHeadline
        ? `${repNameForHeadline}'s Team Quarterly Sales Forecast`
        : "Quarterly Sales Forecast";

  return (
    <section className="mx-auto mb-4 w-full max-w-5xl rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
      <div className="grid gap-4">
        <div>
          <div className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">{headline}</div>
          <form method="GET" action={props.currentPath} className="mt-2 flex items-center gap-2">
            <select
              name="fiscal_year"
              defaultValue={yearToUse}
              className="w-[160px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              {fiscalYearsSorted.map((fy) => (
                <option key={fy} value={fy}>
                  {fy}
                </option>
              ))}
            </select>
            <select
              name="quota_period_id"
              defaultValue={qpId}
              className="w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              {periodsForYear.map((p) => (
                <option key={p.id} value={p.id}>
                  {String(p.period_name || "").trim() || periodLabel(p)}
                </option>
              ))}
            </select>
            <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
              Apply
            </button>
          </form>
          {role === "REP" && !userRepName ? (
            <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
              Rep visibility is restricted to your own records, but your account is missing `account_owner_name`.
            </div>
          ) : null}
          {!periods.length ? (
            <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
              No quota periods found. Create them in{" "}
              <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/admin/analytics/quota-periods">
                quota periods
              </Link>
              .
            </div>
          ) : null}
        </div>

        <div className="grid w-full justify-items-stretch gap-3 text-sm sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
          {[
            { key: "commit", label: "Commit", amount: commitAmt, count: commitCount, healthPct: commitHealthPct },
            { key: "best", label: "Best Case", amount: bestCaseAmt, count: bestCaseCount, healthPct: bestHealthPct },
            { key: "pipe", label: "Pipeline", amount: pipelineAmt, count: pipelineCount, healthPct: pipelineHealthPct },
            { key: "total", label: "Total Pipeline", amount: totalAmt, count: totalPipelineCount, healthPct: null },
            { key: "won", label: "Closed Won", amount: wonAmt, count: wonCount, healthPct: wonHealthPct },
          ]
            .filter((c) => !(Number(c.amount || 0) === 0 && Number(c.count || 0) === 0))
            .map((c) => (
              <div key={c.key} className={`${boxClass} w-full`}>
                <div className="text-sm text-black/70">{c.label}</div>
                <div className="font-mono text-sm font-semibold">{fmtMoney(c.amount)}</div>
                <div className="mt-1 text-sm text-black/70"># Opps: {c.count}</div>
                {"healthPct" in c && c.healthPct != null ? (
                  <div className="mt-1 text-sm text-black/70">
                    Avg Health:{" "}
                    <span className={healthColorClass(c.healthPct)}>{c.healthPct == null ? "—" : `${c.healthPct}%`}</span>
                  </div>
                ) : null}
              </div>
            ))}

          <div className={`${boxClass} w-full`}>
            <div className="text-sm text-black/70">Quarterly Quota</div>
            <div className="font-mono text-sm font-semibold">{fmtMoney(quotaAmt)}</div>
            <div className="mt-1 text-sm text-black/70">&nbsp;</div>
          </div>
          <div className={`${boxClass} w-full`}>
            <div className="text-sm text-black/70">% To Goal</div>
            <div className={`font-mono text-sm font-semibold ${pctToGoalValueClass}`}>{fmtPct(pctToGoal)}</div>
            <div className="mt-1 text-sm text-black/70">&nbsp;</div>
          </div>
        </div>
      </div>

      {role !== "REP" && repRollups.length ? (
        <details className="mt-4 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
          <summary className="cursor-pointer text-sm font-semibold text-[color:var(--sf-text-primary)]">
            Rep breakdown ({repRollups.length})
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[760px] table-auto border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-[color:var(--sf-text-secondary)]">
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2">Rep</th>
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2">Commit</th>
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2">Avg Health</th>
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2">Best Case</th>
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2">Avg Health</th>
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2">Pipeline</th>
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2">Avg Health</th>
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2">Total Pipeline</th>
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2">Avg Health</th>
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2">Closed Won</th>
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2">Avg Health</th>
                </tr>
              </thead>
              <tbody>
                {repRollups.map((r) => {
                  const cAmt = Number(r.commit_amount || 0) || 0;
                  const bcAmt = Number(r.best_case_amount || 0) || 0;
                  const pAmt = Number(r.pipeline_amount || 0) || 0;
                  const tAmt = cAmt + bcAmt + pAmt;
                  const cHealthPct = healthPctFrom30((r as any).commit_health_score);
                  const bHealthPct = healthPctFrom30((r as any).best_case_health_score);
                  const pHealthPct = healthPctFrom30((r as any).pipeline_health_score);
                  const tHealthPct = healthPctFrom30((r as any).total_pipeline_health_score);
                  const wHealthPct = healthPctFrom30((r as any).won_health_score);
                  const key = `${r.rep_id || "name"}:${r.rep_name}`;
                  return (
                    <tr key={key} className="text-[color:var(--sf-text-primary)]">
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2">{r.rep_name}</td>
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2">
                        <div className="font-mono text-sm font-semibold">{fmtMoney(cAmt)}</div>
                        <div className="text-sm text-[color:var(--sf-text-secondary)]"># {Number(r.commit_count || 0) || 0}</div>
                      </td>
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2">
                        <span className={healthColorClass(cHealthPct)}>{cHealthPct == null ? "—" : `${cHealthPct}%`}</span>
                      </td>
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2">
                        <div className="font-mono text-sm font-semibold">{fmtMoney(bcAmt)}</div>
                        <div className="text-sm text-[color:var(--sf-text-secondary)]"># {Number(r.best_case_count || 0) || 0}</div>
                      </td>
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2">
                        <span className={healthColorClass(bHealthPct)}>{bHealthPct == null ? "—" : `${bHealthPct}%`}</span>
                      </td>
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2">
                        <div className="font-mono text-sm font-semibold">{fmtMoney(pAmt)}</div>
                        <div className="text-sm text-[color:var(--sf-text-secondary)]"># {Number(r.pipeline_count || 0) || 0}</div>
                      </td>
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2">
                        <span className={healthColorClass(pHealthPct)}>{pHealthPct == null ? "—" : `${pHealthPct}%`}</span>
                      </td>
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2">
                        <div className="font-mono text-sm font-semibold">{fmtMoney(tAmt)}</div>
                      </td>
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2">
                        <span className={healthColorClass(tHealthPct)}>{tHealthPct == null ? "—" : `${tHealthPct}%`}</span>
                      </td>
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2">
                        <div className="font-mono text-sm font-semibold">{fmtMoney(Number(r.won_amount || 0) || 0)}</div>
                        <div className="text-sm text-[color:var(--sf-text-secondary)]"># {Number(r.won_count || 0) || 0}</div>
                      </td>
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2">
                        <span className={healthColorClass(wHealthPct)}>{wHealthPct == null ? "—" : `${wHealthPct}%`}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {products.length ? (
        <section className="mt-4 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
            {role === "REP" ? "Revenue by product (Closed Won)" : "Team revenue by product (Closed Won)"}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[760px] table-auto border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-[color:var(--sf-text-secondary)]">
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2">Product</th>
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right">Closed Won</th>
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right"># Orders</th>
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right">Avg / Order</th>
                  <th className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right">Avg Health</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const hp = healthPctFrom30(p.avg_health_score);
                  return (
                    <tr key={p.product} className="text-[color:var(--sf-text-primary)]">
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2">{p.product}</td>
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right font-mono text-xs">{fmtMoney(p.won_amount)}</td>
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right">{Number(p.won_count || 0) || 0}</td>
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right font-mono text-xs">
                        {fmtMoney(p.avg_order_value)}
                      </td>
                      <td className="border-b border-[color:var(--sf-border)] px-2 py-2 text-right font-mono text-xs">
                        <span className={healthColorClass(hp)}>{hp == null ? "—" : `${hp}%`}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {debug ? (
        <details className="mt-4 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
          <summary className="cursor-pointer text-sm font-semibold text-[color:var(--sf-text-primary)]">
            Sales Forecast debug (determination)
          </summary>
          <div className="mt-3 grid gap-3 text-xs text-[color:var(--sf-text-secondary)]">
            <div>
              <div className="font-semibold text-[color:var(--sf-text-primary)]">Inputs</div>
              <pre className="mt-1 overflow-auto rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-2 text-[11px] text-[color:var(--sf-text-secondary)]">
                {JSON.stringify(
                  {
                    orgId: props.orgId,
                    qpId,
                    yearToUse,
                    selectedFiscalYearParam: selectedFiscalYear || null,
                    selectedQuotaPeriodIdParam: selectedQuotaPeriodId || null,
                    role,
                    hierarchy_level: props.user.hierarchy_level,
                    see_all_visibility: props.user.see_all_visibility,
                    userRepName,
                    visibleRepUserIds,
                    visibleRepNameKeys,
                    repIdsToUse,
                    repNameForHeadline,
                    totals: {
                      commitAmt,
                      bestCaseAmt,
                      pipelineAmt,
                      totalPipelineAmt: totalAmt,
                      wonAmt,
                      commitCount,
                      bestCaseCount,
                      pipelineCount,
                      totalPipelineCount,
                      wonCount,
                    },
                  },
                  null,
                  2
                )}
              </pre>
            </div>

            <div>
              <div className="font-semibold text-[color:var(--sf-text-primary)]">Match breakdown (rows in quarter)</div>
              <pre className="mt-1 overflow-auto rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-2 text-[11px] text-[color:var(--sf-text-secondary)]">
                {JSON.stringify(debugInfo || [], null, 2)}
              </pre>
            </div>

            <div>
              <div className="font-semibold text-[color:var(--sf-text-primary)]">Sample rows in quarter</div>
              <pre className="mt-1 max-h-[360px] overflow-auto rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-2 text-[11px] text-[color:var(--sf-text-secondary)]">
                {JSON.stringify(debugSampleRows || [], null, 2)}
              </pre>
            </div>
          </div>
        </details>
      ) : null}
    </section>
  );
}

