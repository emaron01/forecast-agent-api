import { redirect } from "next/navigation";
import { requireAuth } from "../../lib/auth";
import { getOrganization } from "../../lib/db";
import { UserTopNav } from "../_components/UserTopNav";
import Link from "next/link";
import { pool } from "../../lib/pool";
import { QuarterSalesForecastSummary } from "../forecast/_components/QuarterSalesForecastSummary";

export const runtime = "nodejs";

function Card({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm hover:border-[color:var(--sf-accent-secondary)]"
    >
      <div className="text-base font-semibold text-[color:var(--sf-text-primary)]">{title}</div>
      <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">{desc}</div>
    </Link>
  );
}

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

type QuotaPeriodOption = {
  id: string; // bigint as text
  period_name: string;
  period_start: string; // date text
  period_end: string; // date text
  fiscal_year: string;
  fiscal_quarter: string; // text
};

export default async function AnalyticsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  // ----------------------------
  // REP-only Analytics page (single page)
  // ----------------------------
  if (ctx.user.role === "REP") {
    const selectedQuotaPeriodId = String(sp(searchParams?.quota_period_id) || "").trim();
    const selectedFiscalYear = String(sp(searchParams?.fiscal_year) || "").trim();

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
      [ctx.user.org_id]
    );
    const periods = (periodsRaw || []) as QuotaPeriodOption[];
    const fiscalYears = Array.from(new Set(periods.map((p) => String(p.fiscal_year || "").trim()).filter(Boolean)));
    const fiscalYearsSorted = fiscalYears.slice().sort((a, b) => b.localeCompare(a));
    const selectedPeriodFromParam = selectedQuotaPeriodId ? periods.find((p) => String(p.id) === selectedQuotaPeriodId) || null : null;

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
        [ctx.user.org_id]
      )
      .then((r) => String(r.rows?.[0]?.id || "").trim())
      .catch(() => "");

    const current = (currentId && periods.find((p) => String(p.id) === currentId)) || periods[0] || null;
    const currentYear = current ? String(current.fiscal_year || "").trim() : "";
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
    const qpId = selected ? String(selected.id) : "";

    const repNameKey = normalizeNameKey(ctx.user.account_owner_name || "");
    const repRow = await pool
      .query<{ id: number }>(
        `
        SELECT r.id
          FROM reps r
         WHERE COALESCE(r.organization_id, r.org_id::bigint) = $1::bigint
           AND r.user_id = $2::int
         ORDER BY r.id ASC
         LIMIT 1
        `,
        [ctx.user.org_id, ctx.user.id]
      )
      .then((r) => (r.rows?.[0] ? (r.rows[0] as any) : null))
      .catch(() => null);
    const repId = repRow && Number.isFinite((repRow as any).id) ? Number((repRow as any).id) : null;

    const canCompute = !!qpId && (repId != null || !!repNameKey);

    const wonStats = canCompute
      ? await pool
          .query<{ won_revenue: number; won_count: number }>(
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
              COALESCE(SUM(CASE WHEN ((' ' || d.fs || ' ') LIKE '% won %') THEN d.amount ELSE 0 END), 0)::float8 AS won_revenue,
              COALESCE(SUM(CASE WHEN ((' ' || d.fs || ' ') LIKE '% won %') THEN 1 ELSE 0 END), 0)::int AS won_count
            FROM deals_in_qtr d
            `,
            [ctx.user.org_id, qpId, repId, repNameKey]
          )
          .then((r) => r.rows?.[0] || null)
          .catch(() => null)
      : null;

    const wonRevenue = Number(wonStats?.won_revenue || 0) || 0;
    const wonCount = Number(wonStats?.won_count || 0) || 0;
    const aov = wonCount > 0 ? wonRevenue / wonCount : null;

    const revenueByProduct = canCompute
      ? await pool
          .query<{ product: string; total_revenue: number; avg_revenue: number; order_count: number }>(
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
                COALESCE(NULLIF(btrim(o.product), ''), '(Unspecified)') AS product,
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
            ),
            won AS (
              SELECT *
                FROM deals_in_qtr d
               WHERE ((' ' || d.fs || ' ') LIKE '% won %')
            )
            SELECT
              product,
              COALESCE(SUM(amount), 0)::float8 AS total_revenue,
              COALESCE(AVG(amount), 0)::float8 AS avg_revenue,
              COUNT(*)::int AS order_count
            FROM won
            GROUP BY product
            ORDER BY total_revenue DESC, product ASC
            `,
            [ctx.user.org_id, qpId, repId, repNameKey]
          )
          .then((r) => r.rows || [])
          .catch(() => [])
      : [];

    return (
      <div className="min-h-screen bg-[color:var(--sf-background)]">
        <UserTopNav orgName={orgName} user={ctx.user} />
        <main className="mx-auto max-w-6xl p-6">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Analytics</h1>
              <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Quarterly reports for your book of business.</p>
            </div>
          </header>

          <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Quarter selector</h2>
                <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Defaults to the current quarter.</p>
              </div>
              <form method="GET" action="/analytics" className="flex flex-wrap items-center gap-2">
                <select
                  name="fiscal_year"
                  defaultValue={yearToUse}
                  className="w-[140px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
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
                  className="w-[260px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                >
                  {periodsForYear.map((p) => (
                    <option key={p.id} value={p.id}>
                      {String(p.period_name || "").trim() || `${p.period_start} → ${p.period_end}`}
                    </option>
                  ))}
                </select>
                <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                  Apply
                </button>
              </form>
            </div>
          </section>

          <div className="mt-4">
            <QuarterSalesForecastSummary orgId={ctx.user.org_id} user={ctx.user} currentPath="/analytics" searchParams={searchParams} showBreakdown={false} />
          </div>

          <section className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Closed Won revenue</div>
              <div className="mt-1 font-mono text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(wonRevenue)}</div>
            </div>
            <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Closed Won deals</div>
              <div className="mt-1 font-mono text-lg font-semibold text-[color:var(--sf-text-primary)]">{wonCount}</div>
            </div>
            <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Average Order Value</div>
              <div className="mt-1 font-mono text-lg font-semibold text-[color:var(--sf-text-primary)]">{aov == null ? "—" : fmtMoney(aov)}</div>
              <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">(Closed Won revenue / # Closed Won deals)</div>
            </div>
          </section>

          <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Revenue by product (Closed Won)</h2>
            <div className="mt-3 overflow-auto rounded-md border border-[color:var(--sf-border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="px-4 py-3">product</th>
                    <th className="px-4 py-3 text-right">total revenue</th>
                    <th className="px-4 py-3 text-right">avg revenue / order</th>
                    <th className="px-4 py-3 text-right"># orders</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueByProduct.length ? (
                    revenueByProduct.map((r) => (
                      <tr key={r.product} className="border-t border-[color:var(--sf-border)]">
                        <td className="px-4 py-3">{r.product}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(r.total_revenue)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(r.avg_revenue)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{r.order_count}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]" colSpan={4}>
                        No Closed Won deals found for this quarter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Analytics</h1>
        <p className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">
          Quota attainment dashboards and stage comparisons.
        </p>

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <Card href="/analytics/attainment" title="Attainment dashboards" desc="Rep → Manager → VP → CRO roll-ups for a quota period." />
          <Card href="/analytics/comparisons" title="Comparisons" desc="CRM Forecast Stage vs AI Forecast Stage + quota attainment." />
          {ctx.user.role === "ADMIN" ? (
            <Card href="/analytics/quotas/admin" title="Quotas (Admin)" desc="Admin quota management." />
          ) : null}
          {ctx.user.role === "MANAGER" ? (
            <Card href="/analytics/quotas/manager" title="Team Quotas" desc="Assign quotas to direct reports + team rollups." />
          ) : null}
          {ctx.user.role === "EXEC_MANAGER" ? (
            <Card href="/analytics/quotas/executive" title="Company Quotas" desc="Company-wide quota rollup + pacing." />
          ) : null}
        </section>
      </main>
    </div>
  );
}

