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

  const selected =
    (selectedQuotaPeriodId && periods.find((p) => String(p.id) === selectedQuotaPeriodId)) ||
    current ||
    null;

  const repName = String(props.user.account_owner_name || "").trim();

  const qpId = selected ? String(selected.id) : "";
  const canCompute = !!qpId && !!repName;

  const sums = canCompute
    ? await pool
        .query<{
          commit_amount: number;
          best_case_amount: number;
          pipeline_amount: number;
          won_amount: number;
        }>(
          `
          WITH qp AS (
            SELECT period_start, period_end
              FROM quota_periods
             WHERE org_id = $1::bigint
               AND id = $2::bigint
             LIMIT 1
          )
          SELECT
            COALESCE(SUM(CASE
              WHEN (lower(COALESCE(o.sales_stage, o.forecast_stage, '')) ~ '\\\\bwon\\\\b')
                OR (lower(COALESCE(o.sales_stage, o.forecast_stage, '')) ~ '\\\\blost\\\\b')
              THEN 0
              WHEN lower(COALESCE(o.forecast_stage, '')) LIKE '%commit%' THEN COALESCE(o.amount, 0)
              ELSE 0
            END), 0)::float8 AS commit_amount,
            COALESCE(SUM(CASE
              WHEN (lower(COALESCE(o.sales_stage, o.forecast_stage, '')) ~ '\\\\bwon\\\\b')
                OR (lower(COALESCE(o.sales_stage, o.forecast_stage, '')) ~ '\\\\blost\\\\b')
              THEN 0
              WHEN lower(COALESCE(o.forecast_stage, '')) LIKE '%best%' THEN COALESCE(o.amount, 0)
              ELSE 0
            END), 0)::float8 AS best_case_amount,
            COALESCE(SUM(CASE
              WHEN (lower(COALESCE(o.sales_stage, o.forecast_stage, '')) ~ '\\\\bwon\\\\b')
                OR (lower(COALESCE(o.sales_stage, o.forecast_stage, '')) ~ '\\\\blost\\\\b')
              THEN 0
              WHEN lower(COALESCE(o.forecast_stage, '')) LIKE '%commit%' THEN 0
              WHEN lower(COALESCE(o.forecast_stage, '')) LIKE '%best%' THEN 0
              ELSE COALESCE(o.amount, 0)
            END), 0)::float8 AS pipeline_amount,
            COALESCE(SUM(CASE
              WHEN lower(COALESCE(o.sales_stage, o.forecast_stage, '')) ~ '\\\\bwon\\\\b' THEN COALESCE(o.amount, 0)
              ELSE 0
            END), 0)::float8 AS won_amount
          FROM opportunities o
          JOIN qp ON TRUE
          WHERE o.org_id = $1
            AND o.close_date IS NOT NULL
            AND o.close_date >= qp.period_start
            AND o.close_date <= qp.period_end
            AND btrim(COALESCE(o.rep_name, '')) = btrim($3)
          `,
          [props.orgId, qpId, repName]
        )
        .then((r) => r.rows?.[0] || null)
        .catch(() => null)
    : null;

  const commitAmt = Number(sums?.commit_amount || 0) || 0;
  const bestCaseAmt = Number(sums?.best_case_amount || 0) || 0;
  const pipelineAmt = Number(sums?.pipeline_amount || 0) || 0;
  const totalAmt = commitAmt + bestCaseAmt + pipelineAmt;
  const wonAmt = Number(sums?.won_amount || 0) || 0;

  const repId = await pool
    .query<{ id: number }>(
      `
      SELECT r.id
        FROM reps r
       WHERE COALESCE(r.organization_id, r.org_id::bigint) = $1
         AND r.user_id = $2
       LIMIT 1
      `,
      [props.orgId, props.user.id]
    )
    .then((r) => (Number.isFinite(r.rows?.[0]?.id) ? Number(r.rows[0].id) : null))
    .catch(() => null);

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
  const pctToGoalClass = pctToGoal != null && pctToGoal >= 0 ? "text-[#16A34A]" : "text-black";
  const boxClass = "rounded-lg border border-[#93C5FD] bg-[#DBEAFE] px-3 py-2 text-black";
  const headline = repName ? `${repName}'s Quarterly Sales Forecast` : "Quarterly Sales Forecast";

  return (
    <section className="mb-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[260px]">
          <div className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">{headline}</div>
          <form method="GET" action={props.currentPath} className="mt-2 flex items-center gap-2">
            <select
              name="quota_period_id"
              defaultValue={qpId}
              className="w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {periodLabel(p)}
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
          </div>
          <div className={boxClass}>
            <div className="text-[11px] text-black/70">Best Case</div>
            <div className="font-mono text-xs font-semibold">{fmtMoney(bestCaseAmt)}</div>
          </div>
          <div className={boxClass}>
            <div className="text-[11px] text-black/70">Pipeline</div>
            <div className="font-mono text-xs font-semibold">{fmtMoney(pipelineAmt)}</div>
          </div>
          <div className={boxClass}>
            <div className="text-[11px] text-black/70">Total Pipeline</div>
            <div className="font-mono text-xs font-semibold">{fmtMoney(totalAmt)}</div>
          </div>
          <div className={boxClass}>
            <div className="text-[11px] text-black/70">Quarterly Quota</div>
            <div className="font-mono text-xs font-semibold">{fmtMoney(quotaAmt)}</div>
          </div>
          <div className={boxClass}>
            <div className="text-[11px] text-black/70">Closed Won</div>
            <div className="font-mono text-xs font-semibold">{fmtMoney(wonAmt)}</div>
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

