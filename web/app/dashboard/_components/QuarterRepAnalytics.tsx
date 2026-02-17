import "server-only";

import { pool } from "../../../lib/pool";
import type { AuthUser } from "../../../lib/auth";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function normalizeNameKey(s: any) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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

type QuotaPeriodLite = {
  id: string;
  period_name: string | null;
  period_start: string;
  period_end: string;
  fiscal_year: string | null;
  fiscal_quarter: string | null;
};

async function getSelectedQuotaPeriod(args: { orgId: number; selectedQuotaPeriodId: string }) {
  const selectedQuotaPeriodId = String(args.selectedQuotaPeriodId || "").trim();
  if (selectedQuotaPeriodId) {
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
        AND id = $2::bigint
      LIMIT 1
      `,
      [args.orgId, selectedQuotaPeriodId]
    );
    return (rows?.[0] as any) || null;
  }

  // Default to current quarter; fallback to most recent period.
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
      [args.orgId]
    )
    .then((r) => String(r.rows?.[0]?.id || "").trim())
    .catch(() => "");

  const fallbackId = await pool
    .query<{ id: string }>(
      `
      SELECT id::text AS id
        FROM quota_periods
       WHERE org_id = $1::bigint
       ORDER BY period_start DESC, id DESC
       LIMIT 1
      `,
      [args.orgId]
    )
    .then((r) => String(r.rows?.[0]?.id || "").trim())
    .catch(() => "");

  const id = currentId || fallbackId;
  if (!id) return null;
  return await getSelectedQuotaPeriod({ orgId: args.orgId, selectedQuotaPeriodId: id }).catch(() => null);
}

export async function QuarterRepAnalytics(props: {
  orgId: number;
  user: AuthUser; // rep user (role REP)
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const selectedQuotaPeriodId = String(sp(props.searchParams?.quota_period_id) || "").trim();
  const qp = await getSelectedQuotaPeriod({ orgId: props.orgId, selectedQuotaPeriodId }).catch(() => null);

  const repNameKey = normalizeNameKey(props.user.account_owner_name || "");
  const repId = await pool
    .query<{ id: number }>(
      `
      SELECT r.id
        FROM reps r
       WHERE COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
         AND r.user_id = $2
       LIMIT 1
      `,
      [props.orgId, props.user.id]
    )
    .then((r) => (Number.isFinite(r.rows?.[0]?.id) ? Number(r.rows?.[0]?.id) : null))
    .catch(() => null);

  const canCompute = !!qp?.id && (repId != null || !!repNameKey);

  const wonStats = canCompute
    ? await pool
        .query<{ won_amount: number; won_count: number }>(
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
              lower(
                regexp_replace(
                  COALESCE(NULLIF(btrim(o.sales_stage), ''), NULLIF(btrim(o.forecast_stage), ''), ''),
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
                ($3::bigint IS NOT NULL AND o.rep_id = $3::bigint)
                OR (
                  $4 <> ''
                  AND lower(regexp_replace(btrim(COALESCE(o.rep_name, '')), '\\s+', ' ', 'g')) = $4
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
            COALESCE(SUM(CASE WHEN ((' ' || fs || ' ') LIKE '% won %') THEN amount ELSE 0 END), 0)::float8 AS won_amount,
            COALESCE(SUM(CASE WHEN ((' ' || fs || ' ') LIKE '% won %') THEN 1 ELSE 0 END), 0)::int AS won_count
          FROM deals_in_qtr
          `,
          [props.orgId, qp.id, repId, repNameKey]
        )
        .then((r) => r.rows?.[0] || null)
        .catch(() => null)
    : null;

  const wonAmount = Number(wonStats?.won_amount || 0) || 0;
  const wonCount = Number(wonStats?.won_count || 0) || 0;
  const aov = wonCount > 0 ? wonAmount / wonCount : null;

  return (
    <section className="mt-6 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Quarter analytics</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            {qp ? (
              <>
                Period:{" "}
                <span className="font-mono text-xs">
                  {qp.period_name || ""} ({qp.fiscal_year || ""} {qp.fiscal_quarter || ""}) {qp.period_start} → {qp.period_end}
                </span>
              </>
            ) : (
              "No quota periods found."
            )}
          </p>
        </div>
      </div>

      {!canCompute ? (
        <div className="mt-4 text-sm text-[color:var(--sf-text-secondary)]">
          Unable to compute analytics for this rep (missing rep mapping). Ensure the rep has `account_owner_name` and/or a `reps` row tied to their user.
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
              <div className="text-[11px] text-[color:var(--sf-text-secondary)]">Closed Won Revenue</div>
              <div className="font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(wonAmount)}</div>
            </div>
            <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
              <div className="text-[11px] text-[color:var(--sf-text-secondary)]"># Closed Won</div>
              <div className="font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{wonCount}</div>
            </div>
            <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
              <div className="text-[11px] text-[color:var(--sf-text-secondary)]">Average Order Value</div>
              <div className="font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{aov == null ? "—" : fmtMoney(aov)}</div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

