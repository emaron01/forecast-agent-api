"use client";

import { type ComponentProps } from "react";
import { ExecutiveGapInsightsClient } from "../../../components/dashboard/executive/ExecutiveGapInsightsClient";
import type { ChannelLedFedRow, ChannelPartnerHeroProps } from "../../../lib/channelPartnerHeroData";

type ExecutiveGapProps = ComponentProps<typeof ExecutiveGapInsightsClient>;

function fmtMoney(v: number | null | undefined) {
  const n = Number(v || 0);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct01(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

function healthClass(pct: number | null | undefined) {
  if (pct == null || !Number.isFinite(pct)) return "text-[color:var(--sf-text-secondary)]";
  if (pct >= 70) return "text-[#16A34A]";
  if (pct >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

function coverageStatus(r: number | null) {
  if (r == null || !Number.isFinite(r)) {
    return { label: "—", cls: "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]" };
  }
  if (r < 3.31) return { label: "HIGH RISK", cls: "border-[#E74C3C]/50 bg-[#E74C3C]/10 text-[#E74C3C]" };
  if (r < 3.5) return { label: "MEDIUM RISK", cls: "border-[#F1C40F]/50 bg-[#F1C40F]/10 text-[#F1C40F]" };
  return { label: "PIPELINE COVERED", cls: "border-[#2ECC71]/40 bg-[#2ECC71]/10 text-[#2ECC71]" };
}

/** Same Channel tab body as ExecutiveTabsShellClient `activeTab === "channel"` — contribution strip + partner intelligence. */
export function ChannelTabPanelClient(props: {
  revenueTabProps: ExecutiveGapProps;
  viewerRole?: string | null;
  showChannelContribution?: boolean;
  channelContributionHero?: ChannelPartnerHeroProps | null;
  channelContributionRows?: ChannelLedFedRow[];
  topPartnerWon?: unknown[];
  topPartnerLost?: unknown[];
  /** When false, hides WIC & PQS in the channel tab (e.g. sales rep level 3). Default true for channel exec/director/rep. */
  showWicPqs?: boolean;
  /** When false, hides CEI cards in the channel tab (e.g. sales rep level 3). Default true. */
  showCei?: boolean;
}) {
  const {
    revenueTabProps,
    viewerRole,
    showChannelContribution,
    channelContributionHero,
    channelContributionRows,
    topPartnerWon,
    topPartnerLost,
    showWicPqs = true,
    showCei = true,
  } = props;

  return (
    <div className="-mx-4 -mt-4 space-y-5">
      {!revenueTabProps.channelDashboardMode && showChannelContribution && channelContributionHero ? (
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h3 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Channel Contribution</h3>
          {(() => {
            const hero = channelContributionHero;
            const kpis = hero.quarterKpis;
            const closedWonRevenue =
              kpis != null
                ? Number(kpis.directVsPartner.directWonAmount || 0) + Number(kpis.directVsPartner.partnerWonAmount || 0)
                : Number(hero.crmForecast.won_amount || 0);
            const quota = Number(hero.quota || 0);
            const gapToQuota = quota - closedWonRevenue;
            const gapColor = gapToQuota > 0 ? "text-[#E74C3C]" : "text-[#16A34A]";

            const productRows = Array.isArray(hero.productsClosedWon) ? hero.productsClosedWon : [];
            const curRevenue = productRows.reduce((acc, r: { won_amount?: number }) => acc + (Number(r.won_amount || 0) || 0), 0);
            const curOrders = productRows.reduce((acc, r: { won_count?: number }) => acc + (Number(r.won_count || 0) || 0), 0);
            const curAcv = curOrders > 0 ? curRevenue / curOrders : 0;
            const prevProd = hero.productsClosedWonPrevSummary;
            const prevOrders = prevProd ? Number(prevProd.total_orders || 0) || 0 : 0;
            const prevAcv = prevProd ? Number(prevProd.blended_acv || 0) || 0 : 0;
            const ordDelta = curOrders - prevOrders;
            const acvDelta = curAcv - prevAcv;
            const ordTone = ordDelta > 0 ? "text-[#16A34A]" : ordDelta < 0 ? "text-[#E74C3C]" : "text-[color:var(--sf-text-secondary)]";
            const acvTone = acvDelta > 0 ? "text-[#16A34A]" : acvDelta < 0 ? "text-[#E74C3C]" : "text-[color:var(--sf-text-secondary)]";

            const pm = hero.pipelineMomentum;
            const commitAmt = Number(hero.crmForecast.commit_amount || 0) || 0;
            const bestAmt = Number(hero.crmForecast.best_case_amount || 0) || 0;
            const pipeAmt = Number(hero.crmForecast.pipeline_amount || 0) || 0;
            const totalAmt = commitAmt + bestAmt + pipeAmt;
            const commitCnt = pm?.current_quarter?.mix?.commit?.opps ?? null;
            const bestCnt = pm?.current_quarter?.mix?.best_case?.opps ?? null;
            const pipeCnt = pm?.current_quarter?.mix?.pipeline?.opps ?? null;
            const totalCnt =
              pm?.current_quarter?.total_opps ??
              (commitCnt != null && bestCnt != null && pipeCnt != null ? commitCnt + bestCnt + pipeCnt : null);
            const commitH = pm?.current_quarter?.mix?.commit?.health_pct ?? null;
            const bestH = pm?.current_quarter?.mix?.best_case?.health_pct ?? null;
            const pipeH = pm?.current_quarter?.mix?.pipeline?.health_pct ?? null;
            const totalH = pm?.current_quarter?.avg_health_pct ?? null;
            const remainingQuota = quota > 0 ? Math.max(0, quota - closedWonRevenue) : null;
            const coverage = remainingQuota != null && remainingQuota > 0 && totalAmt > 0 ? totalAmt / remainingQuota : null;
            const pipelineCovExceeded = coverage == null && quota > 0 && remainingQuota != null && remainingQuota === 0;
            const cov = coverageStatus(coverage);

            const avgHealthWon = kpis?.avgHealthWonPct ?? null;
            const oppToWin = kpis?.oppToWin ?? null;
            const bd = hero.bucketDeltas;
            const absMax = Math.max(Math.abs(bd.commit), Math.abs(bd.best_case), Math.abs(bd.pipeline), 1);
            const bar = (v: number) => `${Math.round(Math.max(0, Math.min(100, (Math.abs(v) / absMax) * 100)))}%`;
            const deltaTextClass = (v: number) =>
              !Number.isFinite(v) || v === 0 ? "text-[color:var(--sf-text-secondary)]" : v > 0 ? "text-[#2ECC71]" : "text-[#E74C3C]";

            const card = "rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm";
            const value =
              "mt-1 break-all text-xl font-bold font-[tabular-nums] text-[color:var(--sf-text-primary)] sm:text-2xl";

            return (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className={card}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
                      Channel Closed Won
                    </div>
                    <div className={value}>{fmtMoney(closedWonRevenue)}</div>
                  </div>
                  <div className={card}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Quota</div>
                    <div className={value}>{fmtMoney(quota)}</div>
                  </div>
                  <div className={card}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
                      Gap to Quota
                    </div>
                    <div className={`${value} ${gapColor}`}>{fmtMoney(gapToQuota)}</div>
                    <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Remaining to quota</div>
                  </div>
                  <div className={card}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
                      Landing Zone
                    </div>
                    <div className={value}>{fmtMoney(hero.aiForecast)}</div>
                    <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">AI weighted forecast</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {[
                    { label: "Commit", amount: commitAmt, count: commitCnt, health: commitH },
                    { label: "Best Case", amount: bestAmt, count: bestCnt, health: bestH },
                    { label: "Pipeline", amount: pipeAmt, count: pipeCnt, health: pipeH },
                    { label: "Total Pipeline", amount: totalAmt, count: totalCnt, health: totalH },
                  ].map((x) => (
                    <div key={x.label} className={card}>
                      <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">{x.label}</div>
                      <div className={value}>{fmtMoney(x.amount)}</div>
                      <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
                        # Opps:{" "}
                        <span className="font-[tabular-nums] text-[color:var(--sf-text-primary)]">
                          {x.count == null ? "—" : x.count.toLocaleString("en-US")}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                        Avg Health:{" "}
                        <span className={healthClass(x.health)}>{x.health == null ? "—" : `${Math.round(Number(x.health) || 0)}%`}</span>
                      </div>
                    </div>
                  ))}
                  <div className={card}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
                      Pipeline Coverage
                    </div>
                    <div className={pipelineCovExceeded ? `${value} text-[#2ECC71]` : value}>
                      {coverage != null && Number.isFinite(coverage) ? `${coverage.toFixed(1)}x` : pipelineCovExceeded ? "Exceeded" : "—"}
                    </div>
                    <div className="mt-2">
                      <span className={["inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold", cov.cls].join(" ")}>
                        {cov.label}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className={card}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Total Orders</div>
                    <div className={value}>{curOrders.toLocaleString("en-US")}</div>
                    <div className={`mt-2 text-xs font-[tabular-nums] ${ordTone}`}>
                      {prevProd ? `${ordDelta >= 0 ? "+" : ""}${ordDelta.toLocaleString("en-US")} vs last quarter` : "—"}
                    </div>
                  </div>
                  <div className={card}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">ACV Won</div>
                    <div className={value}>{fmtMoney(curAcv)}</div>
                    <div className={`mt-2 text-xs font-[tabular-nums] ${acvTone}`}>
                      {prevProd ? `${acvDelta >= 0 ? "+" : ""}${fmtMoney(acvDelta)} vs last quarter` : "—"}
                    </div>
                  </div>
                  <div className={card}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
                      Avg Health Closed Won
                    </div>
                    <div className={value}>
                      <span className={healthClass(avgHealthWon)}>{avgHealthWon == null ? "—" : `${avgHealthWon}%`}</span>
                    </div>
                  </div>
                  <div className={card}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
                      Opp→Win Conversion
                    </div>
                    <div className={value}>{fmtPct01(oppToWin)}</div>
                  </div>
                </div>

                <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Gap Attribution</div>
                  <div className="mt-2 grid gap-2 text-sm text-[color:var(--sf-text-primary)]">
                    {[
                      { label: "Commit", v: bd.commit },
                      { label: "Best Case", v: bd.best_case },
                      { label: "Pipeline", v: bd.pipeline },
                    ].map((x) => (
                      <div key={x.label} className="grid grid-cols-[90px_minmax(0,1fr)_90px] items-center gap-2">
                        <div className="text-xs text-[color:var(--sf-text-secondary)]">{x.label}</div>
                        <div className="h-2 rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
                          <div className={`h-full rounded-full ${x.v >= 0 ? "bg-[#2ECC71]" : "bg-[#E74C3C]"}`} style={{ width: bar(x.v) }} />
                        </div>
                        <div className={`text-right font-[tabular-nums] text-xs ${deltaTextClass(x.v)}`}>{fmtMoney(x.v)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
          {(channelContributionRows?.length ?? 0) > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="bg-[color:var(--sf-surface-alt)] text-left text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
                    <th className="border-b border-[color:var(--sf-border)] px-4 py-3">Metric</th>
                    <th className="border-b border-[color:var(--sf-border)] px-4 py-3 text-right">Channel Led (Deal Reg)</th>
                    <th className="border-b border-[color:var(--sf-border)] px-4 py-3 text-right">Channel Fed (No Deal Reg)</th>
                    <th className="border-b border-[color:var(--sf-border)] px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="text-[color:var(--sf-text-primary)]">
                  {(channelContributionRows ?? []).map((row) => {
                    const tone = row.valueTone === "won" ? "text-green-400" : row.valueTone === "lost" ? "text-red-400" : "";
                    return (
                      <tr key={row.metric} className="border-b border-[color:var(--sf-border)] last:border-b-0">
                        <td className="px-4 py-3 font-medium">{row.metric}</td>
                        <td className={["px-4 py-3 text-right font-[tabular-nums]", tone].filter(Boolean).join(" ")}>
                          {row.isCurrency
                            ? row.channelLed.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
                            : row.channelLed.toLocaleString("en-US")}
                        </td>
                        <td className={["px-4 py-3 text-right font-[tabular-nums]", tone].filter(Boolean).join(" ")}>
                          {row.isCurrency
                            ? row.channelFed.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
                            : row.channelFed.toLocaleString("en-US")}
                        </td>
                        <td className={["px-4 py-3 text-right font-[tabular-nums] font-semibold", tone].filter(Boolean).join(" ")}>
                          {row.isCurrency
                            ? row.total.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
                            : row.total.toLocaleString("en-US")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
      <ExecutiveGapInsightsClient
        {...revenueTabProps}
        channelTabOnly={true}
        showWicPqs={showWicPqs}
        showCei={showCei}
        viewerRole={viewerRole}
        topPartnerWon={topPartnerWon as ExecutiveGapProps["topPartnerWon"]}
        topPartnerLost={topPartnerLost as ExecutiveGapProps["topPartnerLost"]}
      />
    </div>
  );
}
