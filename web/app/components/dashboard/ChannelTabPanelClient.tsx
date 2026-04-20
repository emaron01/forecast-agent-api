"use client";

import { type ComponentProps } from "react";
import { ExecutiveGapInsightsClient } from "../../../components/dashboard/executive/ExecutiveGapInsightsClient";
import { ChannelPartnersTabHeroPanel } from "../../../components/dashboard/channel/ChannelPartnersTabHeroPanel";
import type { ChannelLedFedRow, ChannelPartnerHeroProps } from "../../../lib/channelPartnerHeroData";

type ExecutiveGapProps = ComponentProps<typeof ExecutiveGapInsightsClient>;

/** Same Channel tab body as ExecutiveTabsShellClient `activeTab === "channel"` — scoped hero + partner intelligence. */
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

  const isChannelViewerRole = ["CHANNEL_EXECUTIVE", "CHANNEL_DIRECTOR", "CHANNEL_REP"].includes(String(viewerRole || "").trim());
  const isChannelDashboard = String(revenueTabProps.basePath || "").trim() === "/dashboard/channel";
  // Channel dashboard already renders a full HERO above tabs; avoid redundant hero panel inside Channel tab for channel roles.
  const showEmbeddedChannelHeroPanel = !(isChannelDashboard && isChannelViewerRole);

  return (
    <div className="-mx-4 -mt-4 space-y-5">
      {showEmbeddedChannelHeroPanel && showChannelContribution && channelContributionHero ? (
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <ChannelPartnersTabHeroPanel hero={channelContributionHero} basePath={revenueTabProps.basePath ?? ""} viewerRole={viewerRole} />
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
        channelDashboardMode={true}
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
