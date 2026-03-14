import { requireAuth } from "../../lib/auth";
import { getOrganization } from "../../lib/db";
import { redirect } from "next/navigation";
import { pool } from "../../lib/pool";
import { getMeddpiccAveragesByRepByPeriods } from "../../lib/meddpiccHealth";
import { UserTopNav } from "../_components/UserTopNav";
import { ForecastPeriodFiltersClient } from "../forecast/_components/ForecastPeriodFiltersClient";
import { getExecutiveForecastDashboardSummary } from "../../lib/executiveForecastDashboard";
import { ExecutiveBriefingProvider } from "../../components/dashboard/executive/ExecutiveBriefingContext";
import { ExecutiveGapInsightsClient } from "../../components/dashboard/executive/ExecutiveGapInsightsClient";
import { RepCoachingBriefClient } from "./_components/RepCoachingBriefClient";
import { RepDashboardHeroWrapper } from "./_components/RepDashboardHeroWrapper";
import { ReviewRequestBanner } from "./_components/ReviewRequestBanner";
import { SimpleForecastDashboardClient } from "../forecast/simple/simpleClient";

export const runtime = "nodejs";

type WeakestDealRow = {
  name: string;
  health_score: number | null;
  forecast_stage: string | null;
  weakest_category: string | null;
};

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
  const displayName = String(ctx.user.display_name || ctx.user.email || "").trim() || "Sales Rep";
  const pageTitle = `${displayName} Dashboard`;

  const repId = summary.myRepId;
  const selectedPeriod = summary.selectedPeriod;
  const periodStart = selectedPeriod?.period_start ?? null;
  const periodEnd = selectedPeriod?.period_end ?? null;

  const weakestDealsRows: WeakestDealRow[] =
    repId != null && periodStart && periodEnd
      ? await pool
          .query<WeakestDealRow>(
            `
            SELECT
              COALESCE(NULLIF(btrim(opportunity_name), ''), NULLIF(btrim(account_name), ''), '(Unnamed)') AS name,
              health_score,
              forecast_stage,
              (CASE
                WHEN pain_score = LEAST(pain_score, metrics_score, champion_score, eb_score, criteria_score, process_score, competition_score, paper_score, timing_score, budget_score) THEN 'Pain'
                WHEN metrics_score = LEAST(pain_score, metrics_score, champion_score, eb_score, criteria_score, process_score, competition_score, paper_score, timing_score, budget_score) THEN 'Metrics'
                WHEN champion_score = LEAST(pain_score, metrics_score, champion_score, eb_score, criteria_score, process_score, competition_score, paper_score, timing_score, budget_score) THEN 'Champion'
                WHEN eb_score = LEAST(pain_score, metrics_score, champion_score, eb_score, criteria_score, process_score, competition_score, paper_score, timing_score, budget_score) THEN 'Economic Buyer'
                WHEN criteria_score = LEAST(pain_score, metrics_score, champion_score, eb_score, criteria_score, process_score, competition_score, paper_score, timing_score, budget_score) THEN 'Criteria'
                WHEN process_score = LEAST(pain_score, metrics_score, champion_score, eb_score, criteria_score, process_score, competition_score, paper_score, timing_score, budget_score) THEN 'Process'
                WHEN competition_score = LEAST(pain_score, metrics_score, champion_score, eb_score, criteria_score, process_score, competition_score, paper_score, timing_score, budget_score) THEN 'Competition'
                WHEN paper_score = LEAST(pain_score, metrics_score, champion_score, eb_score, criteria_score, process_score, competition_score, paper_score, timing_score, budget_score) THEN 'Paper'
                WHEN timing_score = LEAST(pain_score, metrics_score, champion_score, eb_score, criteria_score, process_score, competition_score, paper_score, timing_score, budget_score) THEN 'Timing'
                ELSE 'Budget'
              END) AS weakest_category
            FROM opportunities
            WHERE org_id = $1::bigint
              AND rep_id = $2::bigint
              AND close_date IS NOT NULL
              AND close_date::date >= $3::date
              AND close_date::date <= $4::date
              AND COALESCE(TRIM(lower(sales_stage)), '') NOT IN ('closed won', 'closed lost')
              AND (COALESCE(TRIM(lower(forecast_stage)), '') NOT LIKE '%won%' AND COALESCE(TRIM(lower(forecast_stage)), '') NOT LIKE '%lost%')
            ORDER BY health_score ASC NULLS LAST
            LIMIT 3
            `,
            [ctx.user.org_id, repId, periodStart, periodEnd]
          )
          .then((r) => r.rows ?? [])
          .catch(() => [])
      : [];

  const weakestDeals = weakestDealsRows.map((r) => {
    const raw = r.health_score != null ? Number(r.health_score) : NaN;
    const health_pct = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round((raw / 30) * 100))) : 0;
    return {
      name: String(r.name ?? "").trim() || "(Unnamed)",
      health_pct,
      stage: String(r.forecast_stage ?? "").trim() || "—",
      weakest_category: String(r.weakest_category ?? "").trim() || "—",
    };
  });

  const meddpiccRows = await getMeddpiccAveragesByRepByPeriods({
    orgId: ctx.user.org_id,
    periodIds: summary.selectedQuotaPeriodId ? [summary.selectedQuotaPeriodId] : [],
    repIds: repId != null ? [repId] : null,
    dateStart: periodStart ?? undefined,
    dateEnd: periodEnd ?? undefined,
  }).catch(() => []);

  const repAvgRow = repId != null ? meddpiccRows.find((r) => String(r.rep_id) === String(repId)) : null;
  const categoryAverages = {
    pain: repAvgRow?.avg_pain ?? null,
    metrics: repAvgRow?.avg_metrics ?? null,
    champion: repAvgRow?.avg_champion ?? null,
    eb: repAvgRow?.avg_eb ?? null,
    criteria: repAvgRow?.avg_criteria ?? null,
    process: repAvgRow?.avg_process ?? null,
    competition: repAvgRow?.avg_competition ?? null,
    paper: repAvgRow?.avg_paper ?? null,
    timing: repAvgRow?.avg_timing ?? null,
    budget: repAvgRow?.avg_budget ?? null,
  };

  let flaggedDeals: {
    id: string;
    internal_id: string;
    opp_name: string;
    requester_name: string | null;
    review_request_note: string | null;
    review_requested_at: string | null;
  }[] = [];
  try {
    if (repId != null) {
      const { rows } = await pool.query<{
        id: string;
        internal_id: string;
        opp_name: string;
        requester_name: string | null;
        review_request_note: string | null;
        review_requested_at: string | null;
      }>(
        `SELECT
          o.id::text AS internal_id,
          o.public_id::text AS id,
          COALESCE(NULLIF(btrim(o.opportunity_name), ''), NULLIF(btrim(o.account_name), '')) AS opp_name,
          u.display_name AS requester_name,
          o.review_request_note,
          o.review_requested_at::text AS review_requested_at
        FROM opportunities o
        LEFT JOIN users u ON u.id = o.review_requested_by
        WHERE o.org_id = $1::bigint
          AND o.rep_id = $2::bigint
          AND o.review_requested_at IS NOT NULL
          AND (o.sales_stage IS NULL OR o.sales_stage NOT IN ('Closed Won', 'Closed Loss', 'Closed Lost'))
        ORDER BY o.review_requested_at DESC`,
        [ctx.user.org_id, repId]
      );
      flaggedDeals = rows ?? [];
    }
  } catch {
    flaggedDeals = [];
  }

  const fiscalYear = String(summary.selectedPeriod?.fiscal_year ?? summary.selectedFiscalYear ?? "").trim() || "—";
  const quotaPeriodId = String(summary.selectedQuotaPeriodId ?? "").trim();
  const repNameForBrief = defaultRepName || displayName;

  // REP: Executive HERO dashboard (Closed Won, Quota, Gap to Quota, Landing Zone) + Coaching Brief + Sales Opportunities below (no nav tabs).
  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6 num-tabular">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-pageTitle text-[color:var(--sf-text-primary)]">{pageTitle}</h1>
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
            <RepDashboardHeroWrapper>
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
            </RepDashboardHeroWrapper>
          </div>

          {flaggedDeals.length > 0 && (
            <div className="mt-4">
              <ReviewRequestBanner deals={flaggedDeals} />
            </div>
          )}

          <div className="mt-6">
            <RepCoachingBriefClient
              repName={repNameForBrief}
              weakestDeals={weakestDeals}
              categoryAverages={categoryAverages}
              fiscalYear={fiscalYear}
              quotaPeriodId={quotaPeriodId}
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

