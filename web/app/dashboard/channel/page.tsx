import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { pool } from "../../../lib/pool";
import { getScopedRepDirectory } from "../../../lib/repScope";
import { UserTopNav } from "../../_components/UserTopNav";
import { ForecastPeriodFiltersClient } from "../../forecast/_components/ForecastPeriodFiltersClient";
import { getExecutiveForecastDashboardSummary } from "../../../lib/executiveForecastDashboard";
import { ExecutiveGapInsightsClient } from "../../../components/dashboard/executive/ExecutiveGapInsightsClient";
import { isChannelRepOnly } from "../../../lib/userRoles";
import { loadChannelLedFedRows, loadChannelPartnerHeroProps } from "../../../lib/channelPartnerHeroData";

export const runtime = "nodejs";

type TopPartnerDealRow = {
  opportunity_public_id: string;
  partner_name: string;
  account_name: string | null;
  opportunity_name: string | null;
  product: string | null;
  amount: number;
  create_date: string | null;
  close_date: string | null;
  baseline_health_score: number | null;
  health_score: number | null;
};

async function listTopPartnerDealsChannel(args: {
  orgId: number;
  quotaPeriodId: string;
  outcome: "won" | "lost";
  limit: number;
  dateStart?: string | null;
  dateEnd?: string | null;
  repIds: number[] | null;
}): Promise<TopPartnerDealRow[]> {
  const wantWon = args.outcome === "won";
  const useRepFilter = !!(args.repIds && args.repIds.length);
  const { rows } = await pool.query<TopPartnerDealRow>(
    `
    WITH qp AS (
      SELECT
        period_start::date AS period_start,
        period_end::date AS period_end,
        GREATEST(period_start::date, COALESCE($5::date, period_start::date)) AS range_start,
        LEAST(period_end::date, COALESCE($6::date, period_end::date)) AS range_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = $2::bigint
      LIMIT 1
    )
    SELECT
      o.public_id::text AS opportunity_public_id,
      btrim(o.partner_name) AS partner_name,
      o.account_name,
      o.opportunity_name,
      o.product,
      COALESCE(o.amount, 0)::float8 AS amount,
      o.create_date::timestamptz::text AS create_date,
      o.close_date::date::text AS close_date,
      o.baseline_health_score::float8 AS baseline_health_score,
      o.health_score::float8 AS health_score
    FROM opportunities o
    JOIN qp ON TRUE
    WHERE o.org_id = $1
      AND (NOT $8::boolean OR o.rep_id = ANY($7::bigint[]))
      AND o.partner_name IS NOT NULL
      AND btrim(o.partner_name) <> ''
      AND o.close_date IS NOT NULL
      AND o.close_date >= qp.range_start
      AND o.close_date <= qp.range_end
      AND (
        CASE
          WHEN $3::boolean THEN ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% won %')
          ELSE (
            ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% lost %')
            OR ((' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ') LIKE '% loss %')
          )
        END
      )
    ORDER BY amount DESC NULLS LAST, o.id DESC
    LIMIT $4
    `,
    [
      args.orgId,
      args.quotaPeriodId,
      wantWon,
      args.limit,
      args.dateStart || null,
      args.dateEnd || null,
      args.repIds || [],
      useRepFilter,
    ]
  );
  return rows || [];
}

export default async function ChannelDashboardPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (
    ctx.user.role !== "CHANNEL_EXECUTIVE" &&
    ctx.user.role !== "CHANNEL_DIRECTOR" &&
    ctx.user.role !== "CHANNEL_REP"
  ) {
    redirect("/dashboard");
  }

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const summary = await getExecutiveForecastDashboardSummary({
    orgId: ctx.user.org_id,
    user: ctx.user,
    searchParams,
  });

  const orgId = ctx.user.org_id;
  const selectedPeriod = summary.selectedPeriod;
  const selectedPeriodId = summary.selectedQuotaPeriodId
    ? String(summary.selectedQuotaPeriodId)
    : "";

  const scope = await getScopedRepDirectory({
    orgId,
    userId: ctx.user.id,
    role: ctx.user.role,
  }).catch(() => ({
    repDirectory: [],
    allowedRepIds: null as number[] | null,
    myRepId: null as number | null,
  }));

  const visibleRepIds: number[] =
    scope.allowedRepIds !== null && scope.allowedRepIds.length > 0
      ? scope.allowedRepIds
      : scope.repDirectory
          .map((r) => r.id)
          .filter((n) => Number.isFinite(n) && n > 0);

  const periodIdx = summary.periods.findIndex((p) => String(p.id) === String(selectedPeriodId));
  const prevPeriod = periodIdx >= 0 ? summary.periods[periodIdx + 1] : null;
  const prevQpId = prevPeriod ? String(prevPeriod.id) : "";

  let topPartnerWon: TopPartnerDealRow[] = [];
  let topPartnerLost: TopPartnerDealRow[] = [];
  let partnerHero: Awaited<ReturnType<typeof loadChannelPartnerHeroProps>> = null;
  let ledFedRows: Awaited<ReturnType<typeof loadChannelLedFedRows>> = [];
  try {
    if (selectedPeriod && visibleRepIds.length > 0 && selectedPeriodId) {
      const [won, lost, ph, lf] = await Promise.all([
        listTopPartnerDealsChannel({
          orgId: ctx.user.org_id,
          quotaPeriodId: selectedPeriodId,
          outcome: "won",
          limit: 10,
          dateStart: selectedPeriod.period_start,
          dateEnd: selectedPeriod.period_end,
          repIds: visibleRepIds,
        }),
        listTopPartnerDealsChannel({
          orgId: ctx.user.org_id,
          quotaPeriodId: selectedPeriodId,
          outcome: "lost",
          limit: 10,
          dateStart: selectedPeriod.period_start,
          dateEnd: selectedPeriod.period_end,
          repIds: visibleRepIds,
        }),
        loadChannelPartnerHeroProps({
          orgId: ctx.user.org_id,
          quotaPeriodId: selectedPeriodId,
          prevQuotaPeriodId: prevQpId,
          repIds: visibleRepIds,
        }),
        loadChannelLedFedRows({
          orgId: ctx.user.org_id,
          quotaPeriodId: selectedPeriodId,
          repIds: visibleRepIds,
        }),
      ]);
      topPartnerWon = won ?? [];
      topPartnerLost = lost ?? [];
      partnerHero = ph;
      ledFedRows = lf ?? [];
    }
  } catch {
    topPartnerWon = [];
    topPartnerLost = [];
    partnerHero = null;
    ledFedRows = [];
  }

  const fiscalYear =
    String(summary.selectedPeriod?.fiscal_year ?? summary.selectedFiscalYear ?? "")
      .trim() || "—";
  const fiscalQuarter =
    String(summary.selectedPeriod?.fiscal_quarter || "").trim() || "—";

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex items-end justify-between gap-4 mb-4">
          <h1 className="text-pageTitle text-[color:var(--sf-text-primary)]">
            {ctx.user.display_name} Dashboard
          </h1>
        </div>
        <ForecastPeriodFiltersClient
          basePath="/dashboard/channel"
          fiscalYears={summary.fiscalYearsSorted}
          periods={summary.periods}
          selectedFiscalYear={summary.selectedFiscalYear}
          selectedPeriodId={summary.selectedQuotaPeriodId}
        />
        {partnerHero ? (
          <div className="mt-4">
            <ExecutiveGapInsightsClient
              heroOnly
              basePath="/dashboard/channel"
              channelTabOnly={isChannelRepOnly(ctx.user.role)}
              periods={summary.periods}
              quotaPeriodId={summary.selectedQuotaPeriodId}
              reps={summary.reps}
              fiscalYear={fiscalYear}
              fiscalQuarter={fiscalQuarter}
              stageProbabilities={summary.stageProbabilities}
              healthModifiers={partnerHero.healthModifiers}
              repDirectory={summary.repDirectory}
              myRepId={summary.myRepId}
              repRollups={summary.repRollups}
              productsClosedWon={partnerHero.productsClosedWon}
              productsClosedWonPrevSummary={partnerHero.productsClosedWonPrevSummary}
              productsClosedWonByRep={summary.productsClosedWonByRep}
              quarterKpis={partnerHero.quarterKpis}
              pipelineMomentum={partnerHero.pipelineMomentum}
              crmTotals={{
                commit_amount: partnerHero.crmForecast.commit_amount,
                best_case_amount: partnerHero.crmForecast.best_case_amount,
                pipeline_amount: partnerHero.crmForecast.pipeline_amount,
                won_amount: partnerHero.crmForecast.won_amount,
              }}
              partnersExecutive={summary.partnersExecutive}
              quota={partnerHero.quota}
              aiForecast={partnerHero.aiForecast}
              crmForecast={partnerHero.crmForecastWeighted}
              gap={partnerHero.forecastGap}
              bucketDeltas={{
                commit: partnerHero.bucketDeltas.commit,
                best_case: partnerHero.bucketDeltas.best_case,
                pipeline: partnerHero.bucketDeltas.pipeline,
              }}
              aiPctToGoal={partnerHero.pctToGoal}
              leftToGo={partnerHero.leftToGo}
              commitAdmission={partnerHero.commitAdmission}
              commitDealPanels={partnerHero.commitDealPanels}
              defaultTopN={5}
            />
          </div>
        ) : null}
        {ledFedRows.length > 0 ? (
          <div className="mt-4 w-full overflow-x-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="bg-[color:var(--sf-surface-alt)] text-left text-cardLabel font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
                  <th className="border-b border-[color:var(--sf-border)] px-4 py-3">Metric</th>
                  <th className="border-b border-[color:var(--sf-border)] px-4 py-3 text-right">Channel Led (Deal Reg)</th>
                  <th className="border-b border-[color:var(--sf-border)] px-4 py-3 text-right">Channel Fed (No Deal Reg)</th>
                  <th className="border-b border-[color:var(--sf-border)] px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="text-[color:var(--sf-text-primary)]">
                {ledFedRows.map((row) => (
                  <tr key={row.metric} className="border-b border-[color:var(--sf-border)] last:border-b-0">
                    <td className="px-4 py-3 font-medium">{row.metric}</td>
                    <td className="px-4 py-3 text-right font-[tabular-nums]">
                      {row.isCurrency
                        ? row.channelLed.toLocaleString("en-US", {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 0,
                          })
                        : row.channelLed.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3 text-right font-[tabular-nums]">
                      {row.isCurrency
                        ? row.channelFed.toLocaleString("en-US", {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 0,
                          })
                        : row.channelFed.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3 text-right font-[tabular-nums] font-semibold">
                      {row.isCurrency
                        ? row.total.toLocaleString("en-US", {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 0,
                          })
                        : row.total.toLocaleString("en-US")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="mt-4">
          <ExecutiveGapInsightsClient
            basePath="/dashboard/channel"
            channelTabOnly={isChannelRepOnly(ctx.user.role)}
            periods={summary.periods}
            quotaPeriodId={summary.selectedQuotaPeriodId}
            reps={summary.reps}
            fiscalYear={fiscalYear}
            fiscalQuarter={fiscalQuarter}
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
            topPartnerWon={topPartnerWon}
            topPartnerLost={topPartnerLost}
          />
        </div>
      </main>
    </div>
  );
}

