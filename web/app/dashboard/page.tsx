import { requireAuth } from "../../lib/auth";
import { getOrganization } from "../../lib/db";
import { redirect } from "next/navigation";
import { UserTopNav } from "../_components/UserTopNav";
import { ForecastPeriodFiltersClient } from "../forecast/_components/ForecastPeriodFiltersClient";
import { getExecutiveForecastDashboardSummary } from "../../lib/executiveForecastDashboard";
import { ExecutiveBriefingProvider } from "../../../components/dashboard/executive/ExecutiveBriefingContext";
import { ExecutiveGapInsightsClient } from "../../../components/dashboard/executive/ExecutiveGapInsightsClient";
import { SimpleForecastDashboardClient } from "../forecast/simple/simpleClient";

export const runtime = "nodejs";

function periodToOption(p: { id: string; fiscal_year: string; fiscal_quarter: string; period_name: string; period_start: string; period_end: string }) {
  const q = Number.parseInt(String(p.fiscal_quarter || "").trim(), 10);
  const y = String(p.fiscal_year || "").trim();
  const ord = q === 1 ? "1st Quarter" : q === 2 ? "2nd Quarter" : q === 3 ? "3rd Quarter" : q === 4 ? "4th Quarter" : `Q${q}`;
  const label = Number.isFinite(q) && q > 0 && y ? `${ord} ${y}` : String(p.period_name || "").trim() || `${p.period_start} → ${p.period_end}`;
  return { id: String(p.id), label };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "ADMIN") redirect("/admin");
  // Make the Executive Dashboard the primary dashboard for leadership roles.
  if (ctx.user.role === "MANAGER" || ctx.user.role === "EXEC_MANAGER") redirect("/dashboard/executive");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  // Rep-scoped executive summary (same as executive dashboard but allowedRepIds = [myRepId]).
  const summary = await getExecutiveForecastDashboardSummary({
    orgId: ctx.user.org_id,
    user: ctx.user,
    searchParams,
  });

  const quotaPeriodOptions = summary.periods.map(periodToOption);
  const defaultRepName = String(ctx.user.account_owner_name || "").trim();

  // REP: Executive HERO dashboard (Closed Won, Quota, Gap to Quota, Landing Zone) + Sales Opportunities below (no nav tabs).
  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6 num-tabular">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-pageTitle text-[color:var(--sf-text-primary)]">Sales Rep Dashboard</h1>
        </div>

        <div className="mt-4">
          <ForecastPeriodFiltersClient
            basePath="/dashboard"
            fiscalYears={summary.fiscalYearsSorted}
            periods={summary.periods}
            selectedFiscalYear={summary.selectedFiscalYear}
            selectedPeriodId={summary.selectedQuotaPeriodId}
          />
        </div>

        <ExecutiveBriefingProvider>
          <div className="mt-4 grid gap-4">
            <ExecutiveGapInsightsClient
              basePath="/dashboard"
              periods={summary.periods}
              quotaPeriodId={summary.selectedQuotaPeriodId}
              reps={summary.reps}
              fiscalYear={String(summary.selectedPeriod?.fiscal_year || summary.selectedFiscalYear || "").trim() || "—"}
              fiscalQuarter={String(summary.selectedPeriod?.fiscal_quarter || "").trim() || "—"}
              stageProbabilities={summary.stageProbabilities}
              healthModifiers={summary.healthModifiers}
              repDirectory={summary.repDirectory}
              myRepId={summary.myRepId}
              repRollups={summary.repRollups}
              productsClosedWon={summary.productsClosedWon}
              productsClosedWonPrevSummary={summary.productsClosedWonPrevSummary}
              productsClosedWonByRep={summary.productsClosedWonByRep}
              quarterKpis={summary.quarterKpis}
              pipelineMomentum={summary.pipelineMomentum}
              crmTotals={summary.crmForecast}
              partnersExecutive={summary.partnersExecutive}
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
              commitAdmission={summary.commitAdmission}
              commitDealPanels={summary.commitDealPanels}
              defaultTopN={5}
              heroOnly={true}
            />
          </div>

          <section className="mt-6" aria-label="Sales Opportunities">
            <h2 className="mb-4 text-lg font-semibold text-[color:var(--sf-text-primary)]">Sales Opportunities</h2>
            <SimpleForecastDashboardClient
              defaultRepName={defaultRepName}
              repFilterLocked={true}
              quotaPeriods={quotaPeriodOptions}
              defaultQuotaPeriodId={summary.selectedQuotaPeriodId}
            />
          </section>
        </ExecutiveBriefingProvider>
      </main>
    </div>
  );
}

