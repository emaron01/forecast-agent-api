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
  const yearToUse = selectedFiscalYear || currentYear || fiscalYearsSorted[0] || "";
  const periodsForYear = yearToUse ? periods.filter((p) => String(p.fiscal_year || "").trim() === yearToUse) : periods;

  const selected =
    (selectedQuotaPeriodId && periodsForYear.find((p) => String(p.id) === selectedQuotaPeriodId)) ||
    (current && periodsForYear.find((p) => String(p.id) === String(current.id))) ||
    periodsForYear[0] ||
    null;

  const repName = String(props.user.account_owner_name || "").trim();

  const qpId = selected ? String(selected.id) : "";

  const repId = await pool
    .query<{ id: number }>(
      `
      SELECT r.id
        FROM reps r
       WHERE COALESCE(r.organization_id, r.org_id::bigint) = $1
         AND (
           r.user_id = $2
           OR (
             $3 <> ''
             AND (
               lower(btrim(COALESCE(r.crm_owner_name, ''))) = lower(btrim($3))
               OR lower(btrim(COALESCE(r.rep_name, ''))) = lower(btrim($3))
               OR lower(btrim(COALESCE(r.display_name, ''))) = lower(btrim($3))
             )
           )
         )
       ORDER BY
         CASE
           WHEN r.user_id = $2 THEN 0
           WHEN lower(btrim(COALESCE(r.crm_owner_name, ''))) = lower(btrim($3)) THEN 1
           WHEN lower(btrim(COALESCE(r.rep_name, ''))) = lower(btrim($3)) THEN 2
           WHEN lower(btrim(COALESCE(r.display_name, ''))) = lower(btrim($3)) THEN 3
           ELSE 9
         END,
         r.id ASC
       LIMIT 1
      `,
      [props.orgId, props.user.id, repName]
    )
    .then((r) => (Number.isFinite(r.rows?.[0]?.id) ? Number(r.rows[0].id) : null))
    .catch(() => null);

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
            SELECT period_start, period_end
              FROM quota_periods
             WHERE org_id = $1::bigint
               AND id = $2::bigint
             LIMIT 1
          ),
          deals AS (
            SELECT
              COALESCE(o.amount, 0) AS amount,
              lower(regexp_replace(COALESCE(o.forecast_stage, ''), '[^a-zA-Z]+', ' ', 'g')) AS fs,
              CASE
                WHEN o.close_date IS NULL THEN NULL
                WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}$') THEN (o.close_date::text)::date
                WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$') THEN to_date(o.close_date::text, 'MM/DD/YYYY')
                ELSE NULL
              END AS close_d
            FROM opportunities o
            JOIN qp ON TRUE
            WHERE o.org_id = $1
              AND (
                ($3::bigint IS NOT NULL AND o.rep_id = $3::bigint)
                OR ($4 <> '' AND lower(btrim(COALESCE(o.rep_name, ''))) = lower(btrim($4)))
              )
          ),
          deals_in_qtr AS (
            SELECT d.amount, d.fs
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
    </section>
  );
}

