import Link from "next/link";
import { pool } from "../../../lib/pool";
import type { AuthUser } from "../../../lib/auth";

type QuotaPeriodOption = {
  id: string; // bigint as text
  period_name: string;
  period_start: string; // date text
  period_end: string; // date text
  fiscal_year: string;
  fiscal_quarter: string; // text
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

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
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
  const fiscalYears = Array.from(new Set(periods.map((p) => String(p.fiscal_year || "").trim()).filter(Boolean)));
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
  const periodsForYear = yearToUse ? periods.filter((p) => String(p.fiscal_year || "").trim() === yearToUse) : periods;

  const selected =
    (selectedQuotaPeriodId && periodsForYear.find((p) => String(p.id) === selectedQuotaPeriodId)) ||
    (current && periodsForYear.find((p) => String(p.id) === String(current.id))) ||
    periodsForYear[0] ||
    null;

  const userRepName = String(props.user.account_owner_name || "").trim();

  const qpId = selected ? String(selected.id) : "";

  const repMatch = await pool
    .query<{ id: number; crm_owner_name: string | null; rep_name: string | null; display_name: string | null }>(
      `
      SELECT r.id, r.crm_owner_name, r.rep_name, r.display_name
        FROM reps r
       WHERE COALESCE(r.organization_id, r.org_id::bigint) = $1
         AND (
           r.user_id = $2
           OR (
             $3 <> ''
             AND (
               lower(regexp_replace(btrim(COALESCE(r.crm_owner_name, '')), '\\s+', ' ', 'g')) = lower(regexp_replace(btrim($3), '\\s+', ' ', 'g'))
               OR lower(regexp_replace(btrim(COALESCE(r.rep_name, '')), '\\s+', ' ', 'g')) = lower(regexp_replace(btrim($3), '\\s+', ' ', 'g'))
               OR lower(regexp_replace(btrim(COALESCE(r.display_name, '')), '\\s+', ' ', 'g')) = lower(regexp_replace(btrim($3), '\\s+', ' ', 'g'))
             )
           )
         )
       ORDER BY
         CASE
           WHEN r.user_id = $2 THEN 0
           WHEN lower(regexp_replace(btrim(COALESCE(r.crm_owner_name, '')), '\\s+', ' ', 'g')) = lower(regexp_replace(btrim($3), '\\s+', ' ', 'g')) THEN 1
           WHEN lower(regexp_replace(btrim(COALESCE(r.rep_name, '')), '\\s+', ' ', 'g')) = lower(regexp_replace(btrim($3), '\\s+', ' ', 'g')) THEN 2
           WHEN lower(regexp_replace(btrim(COALESCE(r.display_name, '')), '\\s+', ' ', 'g')) = lower(regexp_replace(btrim($3), '\\s+', ' ', 'g')) THEN 3
           ELSE 9
         END,
         r.id ASC
       LIMIT 1
      `,
      [props.orgId, props.user.id, userRepName]
    )
    .then((r) => (r.rows?.[0] ? (r.rows[0] as any) : null))
    .catch(() => null);

  const repId = repMatch && Number.isFinite((repMatch as any).id) ? Number((repMatch as any).id) : null;
  const repName =
    String(repMatch?.crm_owner_name || "").trim() ||
    String(repMatch?.rep_name || "").trim() ||
    String(repMatch?.display_name || "").trim() ||
    userRepName;

  const canCompute = !!qpId && (repId != null || !!repName);

  const sums = canCompute
    ? await pool
        .query<{
          commit_amount: number;
          commit_count: number;
          best_case_amount: number;
          best_case_count: number;
          pipeline_amount: number;
          pipeline_count: number;
          won_amount: number;
          won_count: number;
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
              COALESCE(o.amount, 0) AS amount,
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
            JOIN qp ON TRUE
            WHERE o.org_id = $1
              AND (
                ($3::bigint IS NOT NULL AND o.rep_id = $3::bigint)
                OR (
                  $4 <> ''
                  AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) =
                    lower(regexp_replace(btrim($4), '\\s+', ' ', 'g'))
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
            COALESCE(SUM(CASE
              WHEN (d.fs ~ '\\\\bwon\\\\b')
                OR (d.fs ~ '\\\\blost\\\\b')
                OR (d.fs ~ '\\\\bclosed\\\\b')
              THEN 0
              WHEN d.fs LIKE '%commit%' THEN d.amount
              ELSE 0
            END), 0)::float8 AS commit_amount,
            COALESCE(SUM(CASE
              WHEN (d.fs ~ '\\\\bwon\\\\b')
                OR (d.fs ~ '\\\\blost\\\\b')
                OR (d.fs ~ '\\\\bclosed\\\\b')
              THEN 0
              WHEN d.fs LIKE '%commit%' THEN 1
              ELSE 0
            END), 0)::int AS commit_count,
            COALESCE(SUM(CASE
              WHEN (d.fs ~ '\\\\bwon\\\\b')
                OR (d.fs ~ '\\\\blost\\\\b')
                OR (d.fs ~ '\\\\bclosed\\\\b')
              THEN 0
              WHEN d.fs LIKE '%best%' THEN d.amount
              ELSE 0
            END), 0)::float8 AS best_case_amount,
            COALESCE(SUM(CASE
              WHEN (d.fs ~ '\\\\bwon\\\\b')
                OR (d.fs ~ '\\\\blost\\\\b')
                OR (d.fs ~ '\\\\bclosed\\\\b')
              THEN 0
              WHEN d.fs LIKE '%best%' THEN 1
              ELSE 0
            END), 0)::int AS best_case_count,
            COALESCE(SUM(CASE
              WHEN (d.fs ~ '\\\\bwon\\\\b')
                OR (d.fs ~ '\\\\blost\\\\b')
                OR (d.fs ~ '\\\\bclosed\\\\b')
              THEN 0
              WHEN d.fs LIKE '%commit%' THEN 0
              WHEN d.fs LIKE '%best%' THEN 0
              ELSE d.amount
            END), 0)::float8 AS pipeline_amount,
            COALESCE(SUM(CASE
              WHEN (d.fs ~ '\\\\bwon\\\\b')
                OR (d.fs ~ '\\\\blost\\\\b')
                OR (d.fs ~ '\\\\bclosed\\\\b')
              THEN 0
              WHEN d.fs LIKE '%commit%' THEN 0
              WHEN d.fs LIKE '%best%' THEN 0
              ELSE 1
            END), 0)::int AS pipeline_count,
            COALESCE(SUM(CASE
              WHEN d.fs ~ '\\\\bwon\\\\b' THEN d.amount
              ELSE 0
            END), 0)::float8 AS won_amount
            ,
            COALESCE(SUM(CASE
              WHEN d.fs ~ '\\\\bwon\\\\b' THEN 1
              ELSE 0
            END), 0)::int AS won_count
          FROM deals_in_qtr d
          `,
          [props.orgId, qpId, repId, repName]
        )
        .then((r) => r.rows?.[0] || null)
        .catch(() => null)
    : null;

  const commitAmt = Number(sums?.commit_amount || 0) || 0;
  const commitCount = Number(sums?.commit_count || 0) || 0;
  const bestCaseAmt = Number(sums?.best_case_amount || 0) || 0;
  const bestCaseCount = Number(sums?.best_case_count || 0) || 0;
  const pipelineAmt = Number(sums?.pipeline_amount || 0) || 0;
  const pipelineCount = Number(sums?.pipeline_count || 0) || 0;
  const totalAmt = commitAmt + bestCaseAmt + pipelineAmt;
  const wonAmt = Number(sums?.won_amount || 0) || 0;
  const wonCount = Number(sums?.won_count || 0) || 0;
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
                  WHEN ($3::bigint IS NOT NULL AND o.rep_id = $3::bigint) THEN 'rep_id'
                  WHEN ($4 <> '' AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) =
                                  lower(regexp_replace(btrim($4), '\\s+', ' ', 'g'))) THEN 'rep_name'
                  ELSE 'none'
                END AS match_kind
              FROM opportunities o
              WHERE o.org_id = $1
                AND (
                  ($3::bigint IS NOT NULL AND o.rep_id = $3::bigint)
                  OR (
                    $4 <> ''
                    AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) =
                      lower(regexp_replace(btrim($4), '\\s+', ' ', 'g'))
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
            [props.orgId, qpId, repId, repName]
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
                  WHEN ($3::bigint IS NOT NULL AND o.rep_id = $3::bigint) THEN 'rep_id'
                  WHEN ($4 <> '' AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) =
                                  lower(regexp_replace(btrim($4), '\\s+', ' ', 'g'))) THEN 'rep_name'
                  ELSE 'none'
                END AS match_kind
              FROM opportunities o
              WHERE o.org_id = $1
                AND (
                  ($3::bigint IS NOT NULL AND o.rep_id = $3::bigint)
                  OR (
                    $4 <> ''
                    AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) =
                      lower(regexp_replace(btrim($4), '\\s+', ' ', 'g'))
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
            [props.orgId, qpId, repId, repName]
          )
          .then((r) => r.rows || [])
          .catch(() => [])
      : null;

  const quotaAmt =
    repId && qpId
      ? await pool
          .query<{ quota_amount: number }>(
            `
            SELECT COALESCE(SUM(quota_amount), 0)::float8 AS quota_amount
              FROM quotas
             WHERE org_id = $1::bigint
               AND role_level = 3
               AND rep_id = $2::bigint
               AND quota_period_id = $3::bigint
            `,
            [props.orgId, repId, qpId]
          )
          .then((r) => Number(r.rows?.[0]?.quota_amount || 0) || 0)
          .catch(() => 0)
      : 0;

  const pctToGoal = quotaAmt > 0 ? wonAmt / quotaAmt : null;
  const pctToGoalClass = pctToGoal != null && pctToGoal >= 1 ? "text-[#16A34A]" : "text-black";
  const boxClass = "rounded-lg border border-[#93C5FD] bg-[#DBEAFE] px-3 py-2 text-black";
  const headline = repName ? `${repName}'s Quarterly Sales Forecast` : "Quarterly Sales Forecast";

  return (
    <section className="mb-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[260px]">
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
          {!repName ? (
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

        <div className="grid w-full gap-3 text-sm sm:grid-cols-2 md:w-auto md:grid-cols-4 lg:grid-cols-7">
          <div className={boxClass}>
            <div className="text-[11px] text-black/70">Commit</div>
            <div className="font-mono text-xs font-semibold">{fmtMoney(commitAmt)}</div>
            <div className="mt-1 text-[11px] text-black/70"># Opps: {commitCount}</div>
          </div>
          <div className={boxClass}>
            <div className="text-[11px] text-black/70">Best Case</div>
            <div className="font-mono text-xs font-semibold">{fmtMoney(bestCaseAmt)}</div>
            <div className="mt-1 text-[11px] text-black/70"># Opps: {bestCaseCount}</div>
          </div>
          <div className={boxClass}>
            <div className="text-[11px] text-black/70">Pipeline</div>
            <div className="font-mono text-xs font-semibold">{fmtMoney(pipelineAmt)}</div>
            <div className="mt-1 text-[11px] text-black/70"># Opps: {pipelineCount}</div>
          </div>
          <div className={boxClass}>
            <div className="text-[11px] text-black/70">Total Pipeline</div>
            <div className="font-mono text-xs font-semibold">{fmtMoney(totalAmt)}</div>
            <div className="mt-1 text-[11px] text-black/70"># Opps: {totalPipelineCount}</div>
          </div>
          <div className={boxClass}>
            <div className="text-[11px] text-black/70">Quarterly Quota</div>
            <div className="font-mono text-xs font-semibold">{fmtMoney(quotaAmt)}</div>
          </div>
          <div className={boxClass}>
            <div className="text-[11px] text-black/70">Closed Won</div>
            <div className="font-mono text-xs font-semibold">{fmtMoney(wonAmt)}</div>
            <div className="mt-1 text-[11px] text-black/70"># Opps: {wonCount}</div>
          </div>
          <div className={boxClass}>
            <div className="text-[11px] text-black/70">% To Goal</div>
            <div className={`font-mono text-xs font-semibold ${pctToGoalClass}`}>{fmtPct(pctToGoal)}</div>
          </div>
        </div>
      </div>

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
                    repId,
                    repName,
                    userRepName,
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

