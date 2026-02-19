import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { UserTopNav } from "../../_components/UserTopNav";
import { ForecastPeriodFiltersClient } from "../../forecast/_components/ForecastPeriodFiltersClient";
import { getExecutiveForecastDashboardSummary } from "../../../lib/executiveForecastDashboard";
import { ExecutiveGapInsightsClient } from "../../../components/dashboard/executive/ExecutiveGapInsightsClient";

export const runtime = "nodejs";

export default async function ExecutiveDashboardPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "ADMIN") redirect("/admin");
  if (ctx.user.role === "REP") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const summary = await getExecutiveForecastDashboardSummary({
    orgId: ctx.user.org_id,
    user: ctx.user,
    searchParams,
  });

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Executive Dashboard</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Fast, high-signal quarter view (scope: {summary.scopeLabel}).{" "}
              <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/dashboard">
                View detail dashboard
              </Link>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/analytics/meddpicc-tb/gap-driving-deals" className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
              Data details
            </Link>
          </div>
        </div>

        <div className="mt-4">
          <ForecastPeriodFiltersClient
            basePath="/dashboard/executive"
            fiscalYears={summary.fiscalYearsSorted}
            periods={summary.periods}
            selectedFiscalYear={summary.selectedFiscalYear}
            selectedPeriodId={summary.selectedQuotaPeriodId}
          />
        </div>

        <div className="mt-4 grid gap-4">
          <ExecutiveGapInsightsClient
            basePath="/dashboard/executive"
            quotaPeriodId={summary.selectedQuotaPeriodId}
            reps={summary.reps}
            fiscalYear={String(summary.selectedPeriod?.fiscal_year || summary.selectedFiscalYear || "").trim() || "—"}
            fiscalQuarter={String(summary.selectedPeriod?.fiscal_quarter || "").trim() || "—"}
            quota={summary.quota}
            aiForecast={summary.aiForecast.weighted_forecast}
            crmForecast={summary.crmForecast.weighted_forecast}
            gap={summary.forecastGap}
            bucketDeltas={{
              commit: summary.bucketDeltas.commit,
              best_case: summary.bucketDeltas.best_case,
              pipeline: summary.bucketDeltas.pipeline,
            }}
            aiPctToGoal={summary.pctToGoal}
            leftToGo={summary.leftToGo}
            defaultTopN={5}
          />
        </div>
      </main>
    </div>
  );
}

