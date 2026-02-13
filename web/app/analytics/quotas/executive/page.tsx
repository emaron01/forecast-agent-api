import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization } from "../../../../lib/db";
import type { QuotaPeriodRow } from "../../../../lib/quotaModels";
import { UserTopNav } from "../../../_components/UserTopNav";
import { FiscalYearSelector } from "../../../../components/quotas/FiscalYearSelector";
import { QuotaPeriodSelector } from "../../../../components/quotas/QuotaPeriodSelector";
import { QuotaRollupChart } from "../../../../components/quotas/QuotaRollupChart";
import { QuotaRollupTable, type QuotaRollupRow } from "../../../../components/quotas/QuotaRollupTable";
import { listStageComparisonsForPeriod } from "../../../../lib/quotaComparisons";
import { getDistinctFiscalYears, getQuotaPeriods, getQuotaRollupCompany } from "../actions";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export const runtime = "nodejs";

export default async function AnalyticsQuotasExecutivePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role !== "EXEC_MANAGER") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const quotaPeriodId = String(sp(searchParams.quota_period_id) || "").trim();
  const fiscal_year = String(sp(searchParams.fiscal_year) || "").trim();

  const fyRes = await getDistinctFiscalYears().catch(() => ({ ok: true as const, data: [] as Array<{ fiscal_year: string }> }));
  const fiscalYears = fyRes.ok ? fyRes.data : [];

  const periodsRes = await getQuotaPeriods().catch(() => ({ ok: true as const, data: [] as QuotaPeriodRow[] }));
  const allPeriods = periodsRes.ok ? periodsRes.data : [];
  const periods = fiscal_year ? allPeriods.filter((p) => String(p.fiscal_year) === fiscal_year) : allPeriods;
  const selected = quotaPeriodId ? periods.find((p) => String(p.id) === quotaPeriodId) || null : null;

  const rollupRes = selected ? await getQuotaRollupCompany({ quota_period_id: quotaPeriodId }).catch(() => null) : null;
  const rollup = rollupRes && rollupRes.ok ? rollupRes.data : null;

  const companyAtt = rollup?.company_attainment || null;
  const companyQuota = rollup?.company_quota_row || null;

  const chartRows: QuotaRollupRow[] = companyAtt
    ? [
        {
          id: String(selected?.id || ""),
          name: `${companyAtt.fiscal_year} ${selected?.fiscal_quarter || ""}`.trim(),
          quota_amount: Number(companyAtt.quarterly_company_quota_amount) || 0,
          actual_amount: Number(companyAtt.quarterly_actual_amount) || 0,
          attainment: companyAtt.quarterly_attainment == null ? null : Number(companyAtt.quarterly_attainment),
        },
      ]
    : [];

  const stageComparisons = selected
    ? await listStageComparisonsForPeriod({ orgId: ctx.user.org_id, quotaPeriodId, limit: 200, onlyMismatches: false }).catch(() => [])
    : [];
  const mismatches = stageComparisons.filter((d) => !d.stage_match);

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Company Quotas</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Executive quota overview and company rollups.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/analytics" className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
              Analytics home
            </Link>
          </div>
        </div>

        <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Filters</h2>
          <form method="GET" action="/analytics/quotas/executive" className="mt-3 grid gap-3 md:grid-cols-3">
            <FiscalYearSelector name="fiscal_year" fiscalYears={fiscalYears} defaultValue={fiscal_year} required={false} label="fiscal_year" />
            <QuotaPeriodSelector name="quota_period_id" periods={periods} defaultValue={quotaPeriodId} required label="quota_period_id" />
            <div className="flex items-end justify-end gap-2">
              <Link
                href="/analytics/quotas/executive"
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
            <p className="text-sm text-[color:var(--sf-text-secondary)]">Select a `quota_period_id` to view company rollups.</p>
          </section>
        ) : null}

        {selected ? (
          <section className="mt-5 grid gap-5 md:grid-cols-2">
            <QuotaRollupChart title="Company quota vs attainment" rows={chartRows} />
            <QuotaRollupTable
              title="Company rollup (quota vs attainment)"
              subtitle="Uses public.cro_attainment + quota comparisons"
              rows={
                companyQuota
                  ? [
                      {
                        id: String(companyQuota.quota_id),
                        name: "Company",
                        quota_amount: Number(companyQuota.quota_amount) || 0,
                        actual_amount: Number(companyQuota.actual_amount) || 0,
                        attainment: companyQuota.attainment == null ? null : Number(companyQuota.attainment),
                      },
                    ]
                  : []
              }
            />
          </section>
        ) : null}

        {selected && companyAtt ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Year-to-date pacing</h2>
            <div className="mt-3 overflow-auto rounded-md border border-[color:var(--sf-border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="px-4 py-3">metric</th>
                    <th className="px-4 py-3 text-right">value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-[color:var(--sf-border)]">
                    <td className="px-4 py-3">fiscal_year</td>
                    <td className="px-4 py-3 text-right">{companyAtt.fiscal_year}</td>
                  </tr>
                  <tr className="border-t border-[color:var(--sf-border)]">
                    <td className="px-4 py-3">annual_actual_amount</td>
                    <td className="px-4 py-3 text-right">{companyAtt.annual_actual_amount}</td>
                  </tr>
                  <tr className="border-t border-[color:var(--sf-border)]">
                    <td className="px-4 py-3">annual_company_quota_amount</td>
                    <td className="px-4 py-3 text-right">{companyAtt.annual_company_quota_amount}</td>
                  </tr>
                  <tr className="border-t border-[color:var(--sf-border)]">
                    <td className="px-4 py-3">annual_attainment</td>
                    <td className="px-4 py-3 text-right">{companyAtt.annual_attainment == null ? "" : companyAtt.annual_attainment}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {selected ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Forecast vs quota comparison</h2>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">CRM Forecast Stage vs AI Forecast Stage for closed deals in the quota period.</p>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">deals</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">{stageComparisons.length}</div>
              </div>
              <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">mismatches</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">{mismatches.length}</div>
              </div>
              <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">match rate</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">
                  {stageComparisons.length ? Math.round(((stageComparisons.length - mismatches.length) / stageComparisons.length) * 100) : 0}%
                </div>
              </div>
            </div>

            <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="px-4 py-3">opportunity_public_id</th>
                    <th className="px-4 py-3">rep_name</th>
                    <th className="px-4 py-3">account</th>
                    <th className="px-4 py-3">opportunity</th>
                    <th className="px-4 py-3">crm_forecast_stage</th>
                    <th className="px-4 py-3">ai_forecast_stage</th>
                    <th className="px-4 py-3">stage_match</th>
                  </tr>
                </thead>
                <tbody>
                  {stageComparisons.length ? (
                    stageComparisons.map((d) => (
                      <tr key={d.opportunity_public_id} className="border-t border-[color:var(--sf-border)]">
                        <td className="px-4 py-3 font-mono text-xs">{d.opportunity_public_id}</td>
                        <td className="px-4 py-3">{d.rep_name || ""}</td>
                        <td className="px-4 py-3">{d.account_name || ""}</td>
                        <td className="px-4 py-3">{d.opportunity_name || ""}</td>
                        <td className="px-4 py-3">{d.crm_forecast_stage || ""}</td>
                        <td className="px-4 py-3">{d.ai_forecast_stage || ""}</td>
                        <td className="px-4 py-3">{d.stage_match ? "true" : "false"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                        No deals found for this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

