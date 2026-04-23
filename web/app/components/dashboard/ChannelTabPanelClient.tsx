"use client";

import { type ComponentProps } from "react";
import { ExecutiveGapInsightsClient } from "../../../components/dashboard/executive/ExecutiveGapInsightsClient";
import type { PartnerMotionDecisionEngine } from "../../../components/dashboard/executive/PartnerMotionPerformanceSection";
import { ChannelPartnersTabHeroPanel } from "../../../components/dashboard/channel/ChannelPartnersTabHeroPanel";
import type { ChannelLedFedRow, ChannelPartnerHeroProps } from "../../../lib/channelPartnerHeroData";

type ExecutiveGapProps = ComponentProps<typeof ExecutiveGapInsightsClient>;

function health01FromScore30(score: unknown) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(0, Math.min(1, n / 30));
}

function clamp01(v: number) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function buildPartnerMotionDecisionEngine(
  partnersExecutive: ExecutiveGapProps["partnersExecutive"]
): PartnerMotionDecisionEngine | null {
  const pe = partnersExecutive;
  if (!pe?.direct) return null;

  const direct = pe.direct as PartnerMotionDecisionEngine["direct"];
  const partner_influenced = pe.partner_influenced as PartnerMotionDecisionEngine["partner_influenced"];
  const partner_sourced = pe.partner_sourced as PartnerMotionDecisionEngine["partner_sourced"];

  const wonD = Number(direct.won_amount || 0) || 0;
  const wonI = Number(partner_influenced.won_amount || 0) || 0;
  const wonS = Number(partner_sourced.won_amount || 0) || 0;
  const denom = wonD + wonI + wonS;

  const ceiRaw = (motion: PartnerMotionDecisionEngine["direct"]) => {
    const avgDays = motion.avg_days == null ? null : Number(motion.avg_days);
    const won = Number(motion.won_amount || 0) || 0;
    const win = motion.win_rate == null ? null : clamp01(Number(motion.win_rate));
    const health = health01FromScore30(motion.avg_health_score);
    const revenueVelocity = avgDays && avgDays > 0 ? won / avgDays : 0;
    const qualityMultiplier = win == null ? 0 : health == null ? win : win * health;
    return revenueVelocity * qualityMultiplier;
  };

  const direct_raw = ceiRaw(direct);
  const sourced_raw = ceiRaw(partner_sourced);

  return {
    direct,
    partner_influenced,
    partner_sourced,
    directMix: denom > 0 ? wonD / denom : null,
    partnerInfluencedMix: denom > 0 ? wonI / denom : null,
    partnerSourcedMix: denom > 0 ? wonS / denom : null,
    cei: {
      direct_raw,
      sourced_raw,
      partner_sourced_index: direct_raw > 0 ? (sourced_raw / direct_raw) * 100 : null,
    },
    cei_prev_partner_sourced_index: pe.cei_prev_partner_sourced_index ?? null,
  };
}

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
  const isSalesRepRole = String(viewerRole || "").trim() === "REP";
  const isRepBookDashboard = String(revenueTabProps.basePath || "").trim() === "/dashboard";
  // Channel dashboard already renders a full HERO above tabs; avoid redundant hero panel inside Channel tab for channel roles.
  // Rep dashboard (/dashboard, hierarchy 3 / role REP) already renders the gap-insights hero above tabs — same pattern.
  const showEmbeddedChannelHeroPanel =
    !(isChannelDashboard && isChannelViewerRole) && !(isRepBookDashboard && isSalesRepRole);
  const motionEngine = buildPartnerMotionDecisionEngine(revenueTabProps.partnersExecutive);
  console.log("[SF_DEBUG] motionEngine", motionEngine, "partnersExecutive", revenueTabProps.partnersExecutive);
  const showLeaderMotionSnapshotInHero = showEmbeddedChannelHeroPanel && !!motionEngine;

  return (
    <div className="-mx-4 -mt-4 space-y-5">
      {showEmbeddedChannelHeroPanel && showChannelContribution && channelContributionHero ? (
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <ChannelPartnersTabHeroPanel
            hero={channelContributionHero}
            basePath={revenueTabProps.basePath ?? ""}
            viewerRole={viewerRole}
            motionEngine={motionEngine}
          />
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
