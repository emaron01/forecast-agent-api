import Link from "next/link";
import { redirect } from "next/navigation";
import { pool } from "../../../lib/pool";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { UserTopNav } from "../../_components/UserTopNav";
import { getCompanyAttainmentForPeriod, listRepAttainmentForPeriod, listStageComparisonsForPeriod } from "../../../lib/quotaComparisons";
import { dateOnly } from "../../../lib/dateOnly";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

type QuotaPeriodLite = {
  id: string;
  period_name: string;
  period_start: string;
  period_end: string;
  fiscal_year: string;
  fiscal_quarter: string;
};

async function listQuotaPeriodsForOrg(orgId: number): Promise<QuotaPeriodLite[]> {
  const { rows } = await pool.query<QuotaPeriodLite>(
    `
    SELECT
      id::text AS id,
      period_name,
      period_start::text AS period_start,
      period_end::text AS period_end,
      fiscal_year,
      fiscal_quarter
    FROM quota_periods
    WHERE org_id = $1::bigint
    ORDER BY period_start DESC, id DESC
    `,
    [orgId]
  );
  return rows as QuotaPeriodLite[];
}

export const runtime = "nodejs";

export default async function AnalyticsComparisonsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "ADMIN") redirect("/admin/analytics/comparisons");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const periods = await listQuotaPeriodsForOrg(ctx.user.org_id).catch(() => []);
  const quotaPeriodId = String(sp(searchParams.quota_period_id) || "").trim();
  const onlyMismatches = String(sp(searchParams.only_mismatches) || "").trim() === "true";

  const selected = quotaPeriodId ? periods.find((p) => String(p.id) === quotaPeriodId) || null : null;

  const company = selected ? await getCompanyAttainmentForPeriod({ orgId: ctx.user.org_id, quotaPeriodId }).catch(() => null) : null;
  const reps = selected ? await listRepAttainmentForPeriod({ orgId: ctx.user.org_id, quotaPeriodId, limit: 200 }).catch(() => []) : [];
  const deals = selected
    ? await listStageComparisonsForPeriod({ orgId: ctx.user.org_id, quotaPeriodId, limit: 200, onlyMismatches }).catch(() => [])
    : [];

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-6xl p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Comparisons</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">CRM Forecast Stage vs AI Forecast Stage + quota attainment.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/analytics"
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
            >
              Analytics home
            </Link>
          </div>
        </div>

        <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Filters</h2>
          <form method="GET" action="/analytics/comparisons" className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="grid gap-1 md:col-span-2">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">quota_period_id</label>
              <select
                name="quota_period_id"
                defaultValue={quotaPeriodId}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              >
                <option value="">(select)</option>
                {periods.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.period_name} ({p.fiscal_year} {p.fiscal_quarter}) ({dateOnly(p.period_start)} → {dateOnly(p.period_end)}) [id {p.id}]
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">only_mismatches</label>
              <select
                name="only_mismatches"
                defaultValue={onlyMismatches ? "true" : "false"}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </div>
            <div className="flex items-center justify-end gap-2 md:col-span-3">
              <Link
                href="/analytics/comparisons"
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

        {!selected ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <p className="text-sm text-[color:var(--sf-text-secondary)]">Select a `quota_period_id` to view comparisons.</p>
          </section>
        ) : null}

        {selected && company ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Quota attainment (company)</h2>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Period: <span className="font-mono text-xs">{dateOnly(company.period_start)}</span> →{" "}
              <span className="font-mono text-xs">{dateOnly(company.period_end)}</span> | Fiscal year:{" "}
              <span className="font-mono text-xs">{company.fiscal_year}</span>
            </p>

            <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="px-4 py-3">metric</th>
                    <th className="px-4 py-3 text-right">value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-[color:var(--sf-border)]">
                    <td className="px-4 py-3">quarterly_actual_amount</td>
                    <td className="px-4 py-3 text-right">{company.quarterly_actual_amount}</td>
                  </tr>
                  <tr className="border-t border-[color:var(--sf-border)]">
                    <td className="px-4 py-3">quarterly_company_quota_amount</td>
                    <td className="px-4 py-3 text-right">{company.quarterly_company_quota_amount}</td>
                  </tr>
                  <tr className="border-t border-[color:var(--sf-border)]">
                    <td className="px-4 py-3">quarterly_attainment</td>
                    <td className="px-4 py-3 text-right">{company.quarterly_attainment == null ? "" : company.quarterly_attainment}</td>
                  </tr>
                  <tr className="border-t border-[color:var(--sf-border)]">
                    <td className="px-4 py-3">annual_actual_amount</td>
                    <td className="px-4 py-3 text-right">{company.annual_actual_amount}</td>
                  </tr>
                  <tr className="border-t border-[color:var(--sf-border)]">
                    <td className="px-4 py-3">annual_company_quota_amount</td>
                    <td className="px-4 py-3 text-right">{company.annual_company_quota_amount}</td>
                  </tr>
                  <tr className="border-t border-[color:var(--sf-border)]">
                    <td className="px-4 py-3">annual_attainment</td>
                    <td className="px-4 py-3 text-right">{company.annual_attainment == null ? "" : company.annual_attainment}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {selected ? (
          <section className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
            <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Quota attainment (rep)</div>
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Rep quotas are rows in `quotas` with `role_level = 3` and `rep_id` set.</div>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-4 py-3">rep_id</th>
                  <th className="px-4 py-3">rep_name</th>
                  <th className="px-4 py-3 text-right">quota_amount</th>
                  <th className="px-4 py-3 text-right">actual_amount</th>
                  <th className="px-4 py-3 text-right">attainment</th>
                </tr>
              </thead>
              <tbody>
                {reps.length ? (
                  reps.map((r) => (
                    <tr key={String(r.rep_id)} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-4 py-3 font-mono text-xs">{r.rep_id}</td>
                      <td className="px-4 py-3">{r.rep_name || ""}</td>
                      <td className="px-4 py-3 text-right">{r.quota_amount}</td>
                      <td className="px-4 py-3 text-right">{r.actual_amount}</td>
                      <td className="px-4 py-3 text-right">{r.attainment == null ? "" : r.attainment}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                      No rep quotas found for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        ) : null}

        {selected ? (
          <section className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
            <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Deal comparisons</div>
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Rows are limited to 200 deals for this period.</div>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-4 py-3">opportunity_public_id</th>
                  <th className="px-4 py-3">rep_name</th>
                  <th className="px-4 py-3">account_name</th>
                  <th className="px-4 py-3">opportunity_name</th>
                  <th className="px-4 py-3">partner_name</th>
                  <th className="px-4 py-3">deal_registration</th>
                  <th className="px-4 py-3">close_date</th>
                  <th className="px-4 py-3 text-right">amount</th>
                  <th className="px-4 py-3">crm_forecast_stage</th>
                  <th className="px-4 py-3">ai_forecast_stage</th>
                  <th className="px-4 py-3">stage_match</th>
                </tr>
              </thead>
              <tbody>
                {deals.length ? (
                  deals.map((d) => (
                    <tr key={d.opportunity_public_id} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-4 py-3 font-mono text-xs">{d.opportunity_public_id}</td>
                      <td className="px-4 py-3">{d.rep_name || ""}</td>
                      <td className="px-4 py-3">{d.account_name || ""}</td>
                      <td className="px-4 py-3">{d.opportunity_name || ""}</td>
                      <td className="px-4 py-3">{d.partner_name || ""}</td>
                      <td className="px-4 py-3 font-mono text-xs">{d.deal_registration ? "true" : "false"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{dateOnly(d.close_date) || ""}</td>
                      <td className="px-4 py-3 text-right">{d.amount ?? ""}</td>
                      <td className="px-4 py-3">{d.crm_forecast_stage || ""}</td>
                      <td className="px-4 py-3">{d.ai_forecast_stage || ""}</td>
                      <td className="px-4 py-3">
                        <span className={d.stage_match ? "text-[#2ECC71]" : "text-[#E74C3C]"}>{d.stage_match ? "match" : "mismatch"}</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                      No deals found for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        ) : null}
      </main>
    </div>
  );
}

