import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { pool } from "../../../lib/pool";
import { getScopedRepDirectory } from "../../../lib/repScope";
import { UserTopNav } from "../../_components/UserTopNav";
import { ForecastPeriodFiltersClient } from "../../forecast/_components/ForecastPeriodFiltersClient";
import { getExecutiveForecastDashboardSummary } from "../../../lib/executiveForecastDashboard";
import { ExecutiveGapInsightsClient } from "../../../components/dashboard/executive/ExecutiveGapInsightsClient";
import { HIERARCHY, isChannelRep, isChannelRole } from "../../../lib/roleHelpers";
import { loadChannelLedFedRows, loadChannelPartnerHeroProps } from "../../../lib/channelPartnerHeroData";
import { ChannelTopPartnerDealsTablesClient, type TopPartnerDealRow } from "./ChannelTopPartnerDealsTablesClient";

export const runtime = "nodejs";

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

type ChannelDashboardHeroMetrics = {
  channelQuota: number | null;
  channelClosedWon: number;
  salesTeamClosedWon: number;
};

async function getCurrentChannelRepId(args: {
  orgId: number;
  userId: number;
  fallbackRepId?: number | null;
}): Promise<number | null> {
  const fallbackRepId = Number(args.fallbackRepId);
  if (Number.isFinite(fallbackRepId) && fallbackRepId > 0) return fallbackRepId;
  const { rows } = await pool.query<{ id: number }>(
    `
    SELECT r.id
    FROM reps r
    LEFT JOIN users u
      ON u.org_id = $1::bigint
     AND u.id = r.user_id
    WHERE r.organization_id = $1::bigint
      AND r.user_id = $2::bigint
      AND COALESCE(u.hierarchy_level, 99) BETWEEN $3::int AND $4::int
    ORDER BY r.id DESC
    LIMIT 1
    `,
    [args.orgId, args.userId, HIERARCHY.CHANNEL_EXEC, HIERARCHY.CHANNEL_REP]
  );
  const id = Number(rows?.[0]?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function getChannelDashboardHeroMetrics(args: {
  orgId: number;
  quotaPeriodId: string;
  territoryRepIds: number[];
  viewerQuotaRoleLevel: number;
  viewerChannelRepId: number;
}): Promise<ChannelDashboardHeroMetrics> {
  const useTerritoryFilter = args.territoryRepIds.length > 0;
  const { rows } = await pool.query<{
    channel_quota: number | null;
    channel_closed_won: number | null;
    sales_team_closed_won: number | null;
  }>(
    `
    WITH qp AS (
      SELECT
        id::bigint AS quota_period_id,
        period_start::date AS period_start,
        period_end::date AS period_end
      FROM quota_periods
      WHERE org_id = $1::bigint
        AND id = $2::bigint
      LIMIT 1
    ),
    channel_quota AS (
      SELECT q.quota_amount::float8 AS channel_quota
      FROM quotas q
      JOIN qp ON qp.quota_period_id = q.quota_period_id
      WHERE q.org_id = $1::bigint
        AND q.role_level = $6::int
        AND (
          ($6::int = 8 AND q.rep_id = $7::bigint)
          OR ($6::int IN (6, 7) AND q.manager_id = $7::bigint)
        )
      ORDER BY q.updated_at DESC NULLS LAST, q.id DESC
      LIMIT 1
    ),
    channel_closed_won AS (
      SELECT COALESCE(SUM(COALESCE(o.amount, 0)), 0)::float8 AS channel_closed_won
      FROM (
        SELECT
          o.amount,
          o.partner_name,
          o.forecast_stage,
          o.sales_stage,
          CASE
            WHEN o.close_date IS NULL THEN NULL
            WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
            WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
              to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
            ELSE NULL
          END AS close_d
        FROM opportunities o
        WHERE o.org_id = $1::bigint
          AND $5::boolean
          AND o.rep_id = ANY($3::bigint[])
      ) o
      JOIN qp ON TRUE
      WHERE o.close_d IS NOT NULL
        AND o.close_d >= qp.period_start
        AND o.close_d <= qp.period_end
        AND o.partner_name IS NOT NULL
        AND btrim(o.partner_name) <> ''
        AND (
          (' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ')
          LIKE '% won %'
        )
    ),
    sales_team_closed_won AS (
      SELECT COALESCE(SUM(COALESCE(o.amount, 0)), 0)::float8 AS sales_team_closed_won
      FROM (
        SELECT
          o.amount,
          o.forecast_stage,
          o.sales_stage,
          CASE
            WHEN o.close_date IS NULL THEN NULL
            WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
            WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
              to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'FMMM/FMDD/YYYY')
            ELSE NULL
          END AS close_d
        FROM opportunities o
        WHERE o.org_id = $1::bigint
          AND $5::boolean
          AND o.rep_id = ANY($3::bigint[])
      ) o
      JOIN qp ON TRUE
      WHERE o.close_d IS NOT NULL
        AND o.close_d >= qp.period_start
        AND o.close_d <= qp.period_end
        AND (
          (' ' || lower(regexp_replace(COALESCE(NULLIF(btrim(o.forecast_stage), ''), '') || ' ' || COALESCE(NULLIF(btrim(o.sales_stage), ''), ''), '[^a-zA-Z]+', ' ', 'g')) || ' ')
          LIKE '% won %'
        )
    )
    SELECT
      cq.channel_quota::float8 AS channel_quota,
      COALESCE(ccw.channel_closed_won, 0)::float8 AS channel_closed_won,
      COALESCE(stcw.sales_team_closed_won, 0)::float8 AS sales_team_closed_won
    FROM qp
    LEFT JOIN channel_quota cq ON TRUE
    LEFT JOIN channel_closed_won ccw ON TRUE
    LEFT JOIN sales_team_closed_won stcw ON TRUE
    LIMIT 1
    `,
    [
      args.orgId,
      args.quotaPeriodId,
      args.territoryRepIds,
      args.territoryRepIds,
      useTerritoryFilter,
      args.viewerQuotaRoleLevel,
      args.viewerChannelRepId,
    ]
  );

  const row = rows[0];
  return {
    channelQuota: row?.channel_quota == null ? null : Number(row.channel_quota) || 0,
    channelClosedWon: Number(row?.channel_closed_won || 0) || 0,
    salesTeamClosedWon: Number(row?.sales_team_closed_won || 0) || 0,
  };
}

export default async function ChannelDashboardPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (!isChannelRole(ctx.user)) {
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
    user: ctx.user,
  }).catch(() => ({
    repDirectory: [],
    allowedRepIds: null as number[] | null,
    myRepId: null as number | null,
  }));

  const territoryRepIds: number[] =
    scope.allowedRepIds !== null && scope.allowedRepIds.length > 0
      ? scope.allowedRepIds
      : scope.repDirectory
          .map((r) => r.id)
          .filter((n) => Number.isFinite(n) && n > 0);

  const visibleRepIds: number[] = territoryRepIds;

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
  const fallbackScopedRepId = scope.myRepId ?? summary.myRepId ?? null;
  const currentChannelRepId =
    selectedPeriodId && ctx.kind === "user"
      ? await getCurrentChannelRepId({
          orgId: ctx.user.org_id,
          userId: ctx.user.id,
          fallbackRepId: fallbackScopedRepId,
        }).catch(() => null)
      : null;
  const viewerQuotaRoleLevel = Number(ctx.user.hierarchy_level);

  let channelHeroMetrics: ChannelDashboardHeroMetrics | null = null;
  if (selectedPeriodId && territoryRepIds.length > 0 && currentChannelRepId && Number.isFinite(viewerQuotaRoleLevel)) {
    channelHeroMetrics = await getChannelDashboardHeroMetrics({
      orgId: ctx.user.org_id,
      quotaPeriodId: selectedPeriodId,
      territoryRepIds,
      viewerQuotaRoleLevel,
      viewerChannelRepId: currentChannelRepId,
    }).catch(() => null);
  }

  const channelQuota = channelHeroMetrics?.channelQuota ?? null;
  const channelClosedWon = channelHeroMetrics?.channelClosedWon ?? 0;
  const salesTeamClosedWon = channelHeroMetrics?.salesTeamClosedWon ?? 0;
  const contributionPct =
    salesTeamClosedWon > 0 ? (channelClosedWon / salesTeamClosedWon) * 100 : null;
  const gapToQuota = channelQuota == null ? null : Math.max(0, channelQuota - channelClosedWon);
  const gapToQuotaRaw = channelQuota == null ? null : channelQuota - channelClosedWon;
  const landingZone =
    summary.aiForecast?.weighted_forecast != null &&
    Number.isFinite(Number(summary.aiForecast.weighted_forecast))
      ? Number(summary.aiForecast.weighted_forecast)
      : null;

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
              channelTabOnly={isChannelRep(ctx.user)}
              viewerRole={ctx.user.role}
              periods={summary.periods}
              quotaPeriodId={summary.selectedQuotaPeriodId}
              orgId={ctx.user.org_id}
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
              heroQuotaOverride={channelQuota}
              heroGapToQuotaOverride={gapToQuotaRaw}
              heroContributionPct={contributionPct}
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
                {ledFedRows.map((row) => {
                  const tone =
                    row.valueTone === "won" ? "text-green-400" : row.valueTone === "lost" ? "text-red-400" : "";
                  return (
                  <tr key={row.metric} className="border-b border-[color:var(--sf-border)] last:border-b-0">
                    <td className="px-4 py-3 font-medium">{row.metric}</td>
                    <td className={["px-4 py-3 text-right font-[tabular-nums]", tone].filter(Boolean).join(" ")}>
                      {row.isCurrency
                        ? row.channelLed.toLocaleString("en-US", {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 0,
                          })
                        : row.channelLed.toLocaleString("en-US")}
                    </td>
                    <td className={["px-4 py-3 text-right font-[tabular-nums]", tone].filter(Boolean).join(" ")}>
                      {row.isCurrency
                        ? row.channelFed.toLocaleString("en-US", {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 0,
                          })
                        : row.channelFed.toLocaleString("en-US")}
                    </td>
                    <td className={["px-4 py-3 text-right font-[tabular-nums] font-semibold", tone].filter(Boolean).join(" ")}>
                      {row.isCurrency
                        ? row.total.toLocaleString("en-US", {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 0,
                          })
                        : row.total.toLocaleString("en-US")}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {selectedPeriod ? (
          <ChannelTopPartnerDealsTablesClient
            won={topPartnerWon}
            lost={topPartnerLost}
            periodStart={selectedPeriod.period_start}
            periodEnd={selectedPeriod.period_end}
          />
        ) : null}
        <div className="mt-4">
          <ExecutiveGapInsightsClient
            basePath="/dashboard/channel"
            salesHeroLayout
            channelTabOnly={isChannelRep(ctx.user)}
            channelTopPartnerDealsOnPage={!!selectedPeriod}
            viewerRole={ctx.user.role}
            periods={summary.periods}
            quotaPeriodId={summary.selectedQuotaPeriodId}
            orgId={ctx.user.org_id}
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

