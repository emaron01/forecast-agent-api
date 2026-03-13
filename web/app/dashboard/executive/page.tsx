import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { UserTopNav } from "../../_components/UserTopNav";
import { ForecastPeriodFiltersClient } from "../../forecast/_components/ForecastPeriodFiltersClient";
import { getExecutiveForecastDashboardSummary } from "../../../lib/executiveForecastDashboard";
import { ExecutiveGapInsightsClient } from "../../../components/dashboard/executive/ExecutiveGapInsightsClient";
import { ExecutiveTabsShellClient } from "../../components/dashboard/executive/ExecutiveTabsShellClient";
import { EXEC_TABS, setExecDefaultTabAction, type ExecTabKey } from "../../actions/execTabPreferences";

export const runtime = "nodejs";

function normalizeExecTab(raw: string | null | undefined): ExecTabKey | null {
  const v = String(raw || "").trim().toLowerCase();
  return EXEC_TABS.includes(v as ExecTabKey) ? (v as ExecTabKey) : null;
}

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

  // Determine active tab: URL param > user preference > forecast
  const search = searchParams || {};
  const tabRaw = Array.isArray(search.tab) ? search.tab[0] : search.tab;
  const tabParam = normalizeExecTab(tabRaw);
  let prefTab: ExecTabKey | null = null;
  try {
    const prefRows = await pool.query<{ user_preferences: any }>(
      `SELECT user_preferences FROM users WHERE id = $1::bigint`,
      [ctx.user.id]
    );
    const prefs = (prefRows.rows?.[0]?.user_preferences as any) || {};
    prefTab = normalizeExecTab(prefs.exec_default_tab);
  } catch {
    prefTab = null;
  }
  const activeTab: ExecTabKey = tabParam || prefTab || "forecast";

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6 num-tabular">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-pageTitle text-[color:var(--sf-text-primary)]">Executive Dashboard</h1>
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
          />
        </div>

        <ExecutiveTabsShellClient
          basePath="/dashboard/executive"
          initialTab={activeTab}
          setDefaultTab={setExecDefaultTabAction}
        />
      </main>
    </div>
  );
}

