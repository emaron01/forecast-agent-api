"use client";

import Image from "next/image";
import { type PartnerMotionDecisionEngine } from "../executive/PartnerMotionPerformanceSection";
import type { ChannelPartnerHeroProps } from "../../../lib/channelPartnerHeroData";
import { confidenceFromPct } from "../../../lib/confidenceUi";
import {
  ExecutiveRemainingQuarterlyForecastBlock,
  type CrmHeroBucketAmounts,
} from "../executive/ExecutiveQuarterKpisModule";

function fmtMoney(n: number | null | undefined) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(p01: number | null) {
  if (p01 == null || !Number.isFinite(p01)) return "—";
  return `${Math.round(p01 * 100)}%`;
}

function clamp01(v: number) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return { r, g, b };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function rgbToCss(c: { r: number; g: number; b: number }) {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}

function gradientColorAt(p: number) {
  const stops = [
    { p: 0.0, c: hexToRgb("#E74C3C") },
    { p: 0.5, c: hexToRgb("#F1C40F") },
    { p: 0.8, c: hexToRgb("#2ECC71") },
    { p: 0.95, c: hexToRgb("#16A34A") },
    { p: 1.0, c: hexToRgb("#16A34A") },
  ];
  const x = clamp01(p);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (x >= a.p && x <= b.p) {
      const t = b.p === a.p ? 0 : (x - a.p) / (b.p - a.p);
      return rgbToCss({ r: lerp(a.c.r, b.c.r, t), g: lerp(a.c.g, b.c.g, t), b: lerp(a.c.b, b.c.b, t) });
    }
  }
  return rgbToCss(stops[stops.length - 1].c);
}

function heroColor(value: number, quota: number, thresholds: [number, number] = [1.0, 0.8]): string {
  if (!Number.isFinite(value) || quota <= 0 || !Number.isFinite(quota)) return "text-[color:var(--sf-text-primary)]";
  const pct = value / quota;
  if (pct >= thresholds[0]) return "text-green-400";
  if (pct >= thresholds[1]) return "text-yellow-400";
  return "text-red-400";
}

function healthColorClass(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-disabled)]";
  if (pct >= 80) return "text-[#2ECC71]";
  if (pct >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

function healthLostHeroColorClass(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-disabled)]";
  if (pct >= 70) return "text-[#2ECC71]";
  if (pct >= 40) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

function healthPctFrom30(score: number | null | undefined) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((n / 30) * 100)));
}

function productDelta(cur: number, prev: number) {
  const d = cur - prev;
  const up = d > 0;
  const down = d < 0;
  const tone = up ? "text-[#16A34A]" : down ? "text-[#E74C3C]" : "text-[color:var(--sf-text-secondary)]";
  const arrow = up ? "↑" : down ? "↓" : "→";
  return { d, tone, arrow };
}

function fmtSignedInt(n: number) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(Math.trunc(v));
  return `${v > 0 ? "+" : "-"}${abs.toLocaleString("en-US")}`;
}

function gapMoneyColorClass(v: number) {
  if (!Number.isFinite(v) || v === 0) return "text-[color:var(--sf-text-secondary)]";
  return v > 0 ? "text-[#2ECC71]" : "text-[#E74C3C]";
}

/**
 * Partner-scoped metrics block for the **Channel tab / Channel Partners** panel (`ChannelTabPanelClient`).
 * Not the primary page hero: that is `ExecutiveGapInsightsClient` `heroOnly` on `/dashboard/channel` or `/dashboard/executive`.
 * Data: {@link loadChannelPartnerHeroProps}. Executive Channel tab uses a stripped layout for sales roles (0–3).
 */
export function ChannelPartnersTabHeroPanel(props: {
  hero: ChannelPartnerHeroProps;
  basePath: string;
  viewerRole?: string | null;
  motionEngine?: PartnerMotionDecisionEngine | null;
}) {
  const { hero, basePath, viewerRole, motionEngine } = props;
  const kpis = hero.quarterKpis;
  const wonAmount =
    kpis != null
      ? Number(kpis.directVsPartner.directWonAmount || 0) + Number(kpis.directVsPartner.partnerWonAmount || 0)
      : Number(hero.crmForecast.won_amount || 0);
  const quotaNum = Number(hero.quota || 0) || 0;
  const channelGapDelta = wonAmount - quotaNum;
  const gapToQuota = Math.abs(channelGapDelta);
  const gapColor =
    channelGapDelta >= 0 ? "text-green-400" : channelGapDelta < 0 ? "text-red-400" : "text-[color:var(--sf-text-primary)]";
  const gapSubtitle =
    channelGapDelta > 0 ? "Exceeded quota by" : channelGapDelta < 0 ? "Remaining to quota" : "Quota met";

  /** Same as `/dashboard/channel` hero: partner-scoped channel closed-won ÷ all territory reps’ closed-won (server). */
  const contributionPctRaw = hero.channelVsTeamContributionPct;
  const contributionPct =
    contributionPctRaw != null && Number.isFinite(Number(contributionPctRaw)) ? Number(contributionPctRaw) : null;
  /** Full layout: always show Contribution card (mirrors page hero card row). */
  const showContributionCard = true;
  const contributionColor =
    contributionPct == null ? "text-[color:var(--sf-text-primary)]" : heroColor(contributionPct, 100, [0.8, 0.5]);

  const aiPctToGoal = hero.pctToGoal;
  const c = confidenceFromPct(aiPctToGoal);

  const commitAmount = Number(hero.crmForecast.commit_amount || 0) || 0;
  const bestCaseAmount = Number(hero.crmForecast.best_case_amount || 0) || 0;
  const pipelineAmount = Number(hero.crmForecast.pipeline_amount || 0) || 0;
  const totalPipeline = commitAmount + bestCaseAmount + pipelineAmount;
  const heroBucketAmounts: CrmHeroBucketAmounts = {
    commitAmount,
    bestCaseAmount,
    pipelineAmount,
    totalPipeline,
    wonAmount: String(basePath || "").trim() === "/dashboard/channel" ? 0 : wonAmount,
  };

  const productRows = Array.isArray(hero.productsClosedWon) ? hero.productsClosedWon : [];
  const curRevenue = productRows.reduce((acc, r) => acc + (Number(r.won_amount || 0) || 0), 0);
  const curOrders = productRows.reduce((acc, r) => acc + (Number(r.won_count || 0) || 0), 0);
  const curAcv = curOrders > 0 ? curRevenue / curOrders : 0;
  const prevProd = hero.productsClosedWonPrevSummary;
  const prevOrders = prevProd ? Number(prevProd.total_orders || 0) || 0 : 0;
  const prevAcv = prevProd ? Number(prevProd.blended_acv || 0) || 0 : 0;
  const crmLostCnt = Number(hero.crmForecast.lost_count ?? 0) || 0;
  const crmLostAmt = Number(hero.crmForecast.lost_amount ?? 0) || 0;
  const prevLostCntKpi = prevProd ? Number(prevProd.lost_count ?? 0) || 0 : 0;
  const prevLostAmtKpi = prevProd ? Number(prevProd.lost_amount ?? 0) || 0 : 0;
  const curAcvLost = crmLostCnt > 0 ? crmLostAmt / crmLostCnt : 0;
  const prevAcvLost = prevLostCntKpi > 0 ? prevLostAmtKpi / prevLostCntKpi : 0;

  const ord = productDelta(curOrders, prevOrders);
  const acv = productDelta(curAcv, prevAcv);
  const lostOpps = productDelta(crmLostCnt, prevLostCntKpi);
  const acvLostD = productDelta(curAcvLost, prevAcvLost);
  const lostHealthRaw = hero.crmForecast.lost_avg_health_score ?? null;
  const lostHealthPct =
    healthPctFrom30(lostHealthRaw) ?? (kpis?.avgHealthLostPct != null && Number.isFinite(Number(kpis.avgHealthLostPct)) ? kpis.avgHealthLostPct : null);
  const avgHealthWon = kpis?.avgHealthWonPct ?? null;
  const oppToWin = kpis?.oppToWin ?? null;

  const bd = hero.bucketDeltas;
  const gapCommit = Number(bd.commit) || 0;
  const gapBest = Number(bd.best_case) || 0;
  const gapPipe = Number(bd.pipeline) || 0;
  const totalGapSum = gapCommit + gapBest + gapPipe;
  const absC = Math.abs(gapCommit);
  const absB = Math.abs(gapBest);
  const absP = Math.abs(gapPipe);
  const sumAbsGap = absC + absB + absP;
  const segC = sumAbsGap <= 0 ? 100 / 3 : (absC / sumAbsGap) * 100;
  const segB = sumAbsGap <= 0 ? 100 / 3 : (absB / sumAbsGap) * 100;
  const segP = sumAbsGap <= 0 ? 100 / 3 : (absP / sumAbsGap) * 100;
  const pctOfTotal = (abs: number) =>
    sumAbsGap <= 0 || !Number.isFinite(abs) ? null : Math.round((abs / sumAbsGap) * 100);
  const pctCommitOfTotal = pctOfTotal(absC);
  const pctBestOfTotal = pctOfTotal(absB);
  const pctPipeOfTotal = pctOfTotal(absP);

  const heroCard = "h-full rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm";
  const heroVal = "mt-2 text-kpiValue text-[color:var(--sf-text-primary)]";
  const forecastStyleCard =
    "h-full min-h-[124px] min-w-0 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm";
  const forecastStyleValue = "mt-2 break-all text-kpiValue font-[tabular-nums]";

  const pill =
    c.tone === "good"
      ? "border-[#2ECC71]/40 bg-[#2ECC71]/12 text-[#2ECC71]"
      : c.tone === "warn"
        ? "border-[#F1C40F]/50 bg-[#F1C40F]/12 text-[#F1C40F]"
        : c.tone === "bad"
          ? "border-[#E74C3C]/45 bg-[#E74C3C]/12 text-[#E74C3C]"
          : "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]";

  const channelHeroMode = String(basePath || "").trim() === "/dashboard/channel";
  const heroQuotaNum = quotaNum;
  const heroWonAmount = wonAmount;
  const heroRemainingQuota = Math.max(0, heroQuotaNum - heroWonAmount);
  const channelHeroCoverageValue =
    channelHeroMode && heroRemainingQuota > 0 ? heroBucketAmounts.totalPipeline / heroRemainingQuota : null;
  const channelHeroCoverageColor =
    channelHeroCoverageValue == null || !Number.isFinite(channelHeroCoverageValue)
      ? "text-[color:var(--sf-text-primary)]"
      : channelHeroCoverageValue >= 3
        ? "text-green-400"
        : channelHeroCoverageValue >= 1.5
          ? "text-yellow-400"
          : "text-red-400";

  /** Executive Dashboard → Channel tab only: strip Outlook column + Quota / Gap / Landing Zone cards (not the main page hero). */
  const isChannelViewerRole = ["CHANNEL_EXECUTIVE", "CHANNEL_DIRECTOR", "CHANNEL_REP"].includes(String(viewerRole || "").trim());
  const isExecChannelTabHero = String(basePath || "").trim() === "/dashboard/executive" && !isChannelViewerRole;

  const forecastBlockInner = (
    <>
      <ExecutiveRemainingQuarterlyForecastBlock
        crmTotals={hero.crmForecast}
        quota={hero.quota}
        pipelineMomentum={hero.pipelineMomentum}
        heroBucketAmounts={heroBucketAmounts}
      />
      {channelHeroMode ? (
        <style
          dangerouslySetInnerHTML={{
            __html: `
                          [data-channel-hero-coverage-tone="text-green-400"] .mt-2.grid > div:last-child .text-kpiValue { color: rgb(74 222 128); }
                          [data-channel-hero-coverage-tone="text-yellow-400"] .mt-2.grid > div:last-child .text-kpiValue { color: rgb(250 204 21); }
                          [data-channel-hero-coverage-tone="text-red-400"] .mt-2.grid > div:last-child .text-kpiValue { color: rgb(248 113 113); }
                        `,
          }}
        />
      ) : null}
    </>
  );

  return (
    <>
      <section className="w-full rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        {isExecChannelTabHero ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-primary)]">Closed Won</div>
                <div className="mt-1 break-all text-xl font-bold font-[tabular-nums] text-green-400 sm:text-2xl">{fmtMoney(wonAmount)}</div>
              </div>
              {showContributionCard ? (
                <div className="min-w-0 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Contribution</div>
                  <div className={`mt-1 break-all text-xl font-bold font-[tabular-nums] sm:text-2xl ${contributionColor}`}>
                    {contributionPct == null ? "—" : `${contributionPct.toFixed(1)}%`}
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Channel closed won vs sales team closed won (viewer scope)</div>
                </div>
              ) : null}
            </div>
            <div className="mt-4" data-channel-hero-coverage-tone={channelHeroMode ? channelHeroCoverageColor : undefined}>
              {forecastBlockInner}
            </div>
          </>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr] lg:items-start">
            <div className="min-w-0">
              <div className="flex items-center justify-center">
                <div className="relative w-[280px] max-w-[85vw] shrink-0 aspect-[1024/272] sm:w-[320px]">
                  <Image
                    src="/brand/logooutlook.png"
                    alt="SalesForecast.io Outlook"
                    fill
                    sizes="(min-width: 640px) 420px, 320px"
                    className="origin-center scale-90 object-contain"
                    priority={true}
                  />
                </div>
              </div>

              <div className="mt-4">
                <div className="text-left">
                  <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Quarter End Outlook</div>
                  <div className="mt-1 text-kpiHero text-[color:var(--sf-text-primary)]">
                    {aiPctToGoal == null || !Number.isFinite(aiPctToGoal) ? "—" : `${Math.round(aiPctToGoal * 100)}%`}
                  </div>
                </div>

                <div className="mt-2 flex items-end gap-[2px]">
                  {(() => {
                    const segments = 52;
                    const pct = aiPctToGoal == null ? 0 : clamp01(aiPctToGoal);
                    const filled = Math.round(pct * segments);
                    const minH = 10;
                    const maxH = 34;
                    const exp = 3.6;
                    return Array.from({ length: segments }).map((_, i) => {
                      const t = segments <= 1 ? 1 : i / (segments - 1);
                      const fillColor = gradientColorAt(t);
                      const bg = i < filled ? fillColor : "var(--sf-surface-alt)";
                      const h = minH + (maxH - minH) * Math.pow(t, exp);
                      return (
                        <div
                          key={i}
                          className="w-[12px] rounded-[3px] border border-[color:var(--sf-border)]"
                          style={{ background: bg, height: `${Math.round(h)}px` }}
                          aria-hidden="true"
                        />
                      );
                    });
                  })()}
                </div>

                <div className="mt-5">
                  <span className={`inline-flex rounded-full border px-3 py-1 text-meta font-[500] ${pill}`}>{c.label}</span>
                </div>
              </div>
            </div>

            <div className="min-w-0 lg:pt-1">
              <div className={`mt-4 grid grid-cols-2 gap-4 sm:grid-cols-2 ${showContributionCard ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
                <div className="min-w-0 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-primary)]">Closed Won</div>
                  <div className="mt-1 break-all text-xl font-bold font-[tabular-nums] text-green-400 sm:text-2xl">{fmtMoney(wonAmount)}</div>
                </div>
                <div className="min-w-0 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Quota</div>
                  <div className="mt-1 break-all text-xl font-bold font-[tabular-nums] text-[color:var(--sf-text-primary)] sm:text-2xl">
                    {fmtMoney(quotaNum)}
                  </div>
                </div>
                {showContributionCard ? (
                  <div className="min-w-0 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Contribution</div>
                    <div className={`mt-1 break-all text-xl font-bold font-[tabular-nums] sm:text-2xl ${contributionColor}`}>
                      {contributionPct == null ? "—" : `${contributionPct.toFixed(1)}%`}
                    </div>
                    <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Channel closed won vs sales team closed won (viewer scope)</div>
                  </div>
                ) : null}
                <div className="min-w-0 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Gap to Quota</div>
                  <div className={`mt-1 break-all text-xl font-bold font-[tabular-nums] sm:text-2xl ${gapColor}`}>{fmtMoney(gapToQuota)}</div>
                  <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">{gapSubtitle}</div>
                </div>
                <div className="min-w-0 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Landing Zone</div>
                  <div
                    className={`mt-1 break-all text-xl font-bold font-[tabular-nums] sm:text-2xl ${
                      Number(hero.aiForecast) > quotaNum
                        ? "text-[#2ECC71]"
                        : Number(hero.aiForecast) >= quotaNum * 0.8
                          ? "text-[#F1C40F]"
                          : "text-[#E74C3C]"
                    }`}
                  >
                    {fmtMoney(hero.aiForecast)}
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">AI weighted forecast</div>
                </div>
              </div>

              <div data-channel-hero-coverage-tone={channelHeroMode ? channelHeroCoverageColor : undefined}>
                {forecastBlockInner}
              </div>
            </div>
          </div>
        )}
      </section>
      {!isExecChannelTabHero ? (
      <div className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <div className={heroCard}>
            <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Total Orders</div>
            <div className={heroVal}>{curOrders.toLocaleString("en-US")}</div>
            <div className="mt-2 grid grid-cols-[auto_1fr] items-start gap-3">
              <div className={["flex items-center gap-2 text-meta font-[500] leading-none num-tabular", ord.tone].join(" ")}>
                <div>{prevProd ? fmtSignedInt(ord.d) : "—"}</div>
                <div aria-hidden="true" className="text-base leading-none">
                  {ord.arrow}
                </div>
              </div>
              <div className="min-w-0 truncate text-right text-meta">
                Last Quarter{" "}
                <span className="num-tabular font-[500] text-[color:var(--sf-text-primary)]">
                  {prevProd ? prevOrders.toLocaleString("en-US") : "—"}
                </span>
              </div>
            </div>
          </div>
          <div className={heroCard}>
            <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Lost Opps</div>
            <div className={heroVal}>{crmLostCnt.toLocaleString("en-US")}</div>
            <div className="mt-2 grid grid-cols-[auto_1fr] items-start gap-3">
              <div className={["flex items-center gap-2 text-meta font-[500] leading-none num-tabular", lostOpps.tone].join(" ")}>
                <div>{prevProd ? fmtSignedInt(lostOpps.d) : "—"}</div>
                <div aria-hidden="true" className="text-base leading-none">
                  {lostOpps.arrow}
                </div>
              </div>
              <div className="min-w-0 truncate text-right text-meta">
                Last Quarter{" "}
                <span className="num-tabular font-[500] text-[color:var(--sf-text-primary)]">
                  {prevProd ? prevLostCntKpi.toLocaleString("en-US") : "—"}
                </span>
              </div>
            </div>
          </div>
          <div className={heroCard}>
            <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">ACV Won</div>
            <div className={heroVal}>{fmtMoney(curAcv)}</div>
            <div className="mt-2 grid grid-cols-[auto_1fr] items-start gap-3">
              <div className={["flex items-center gap-2 text-meta font-[500] leading-none num-tabular", acv.tone].join(" ")}>
                <div>{prevProd ? fmtMoney(acv.d) : "—"}</div>
                <div aria-hidden="true" className="text-base leading-none">
                  {acv.arrow}
                </div>
              </div>
              <div className="min-w-0 truncate text-right text-meta">
                Last Quarter <span className="num-tabular font-[500] text-[color:var(--sf-text-primary)]">{prevProd ? fmtMoney(prevAcv) : "—"}</span>
              </div>
            </div>
          </div>
          <div className={heroCard}>
            <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">ACV Lost</div>
            <div className={heroVal}>{crmLostCnt > 0 ? fmtMoney(curAcvLost) : "—"}</div>
            <div className="mt-2 grid grid-cols-[auto_1fr] items-start gap-3">
              <div className={["flex items-center gap-2 text-meta font-[500] leading-none num-tabular", acvLostD.tone].join(" ")}>
                <div>{prevProd ? fmtMoney(acvLostD.d) : "—"}</div>
                <div aria-hidden="true" className="text-base leading-none">
                  {acvLostD.arrow}
                </div>
              </div>
              <div className="min-w-0 truncate text-right text-meta">
                Last Quarter{" "}
                <span className="num-tabular font-[500] text-[color:var(--sf-text-primary)]">
                  {prevProd ? (prevLostCntKpi > 0 ? fmtMoney(prevAcvLost) : "—") : "—"}
                </span>
              </div>
            </div>
          </div>
          <div className={[heroCard, "h-auto"].join(" ")}>
            <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Avg Health Closed Won</div>
            <div className={heroVal}>
              <span className={["num-tabular", healthColorClass(avgHealthWon)].join(" ")}>
                {avgHealthWon == null ? "—" : `${avgHealthWon}%`}
              </span>
            </div>
          </div>
          <div className={[heroCard, "h-auto"].join(" ")}>
            <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Avg Health Lost</div>
            <div className={heroVal}>
              <span className={["num-tabular", healthLostHeroColorClass(lostHealthPct)].join(" ")}>
                {lostHealthPct == null ? "—" : `${lostHealthPct}%`}
              </span>
            </div>
          </div>
          <div className={heroCard}>
            <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Opp→Win Conversion</div>
            <div className={heroVal}>{fmtPct(oppToWin)}</div>
          </div>
        </div>

        <div className="w-full">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sectionTitle text-[color:var(--sf-text-primary)]">GAP ATTRIBUTION</div>
            <div className={`text-sm font-semibold font-[tabular-nums] ${gapMoneyColorClass(totalGapSum)}`}>{fmtMoney(totalGapSum)}</div>
          </div>
          <div
            className="mt-2 flex h-[10px] w-full min-w-0 overflow-hidden rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]"
            role="img"
            aria-label={`Gap attribution mix: Commit ${fmtMoney(gapCommit)}, Best Case ${fmtMoney(gapBest)}, Pipeline ${fmtMoney(gapPipe)}`}
          >
            <div className="h-full shrink-0 bg-[#2ECC71]" style={{ width: `${segC}%` }} aria-hidden />
            <div className="h-full shrink-0 bg-[#F1C40F]" style={{ width: `${segB}%` }} aria-hidden />
            <div className="h-full shrink-0 bg-[#E74C3C]" style={{ width: `${segP}%` }} aria-hidden />
          </div>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className={forecastStyleCard}>
              <div className="min-w-0 overflow-hidden text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">
                <span className="inline-flex min-w-0 items-center gap-2 truncate">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[#2ECC71]" aria-hidden />
                  <span className="min-w-0 truncate">COMMIT GAP</span>
                </span>
              </div>
              <div className={`${forecastStyleValue} ${gapMoneyColorClass(gapCommit)}`}>{fmtMoney(gapCommit)}</div>
              <div className="mt-2 min-w-0 truncate text-meta text-[color:var(--sf-text-secondary)]">
                {pctCommitOfTotal == null ? "—" : `${pctCommitOfTotal}% of total gap`}
              </div>
            </div>
            <div className={forecastStyleCard}>
              <div className="min-w-0 overflow-hidden text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">
                <span className="inline-flex min-w-0 items-center gap-2 truncate">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[#F1C40F]" aria-hidden />
                  <span className="min-w-0 truncate">BEST CASE GAP</span>
                </span>
              </div>
              <div className={`${forecastStyleValue} ${gapMoneyColorClass(gapBest)}`}>{fmtMoney(gapBest)}</div>
              <div className="mt-2 min-w-0 truncate text-meta text-[color:var(--sf-text-secondary)]">
                {pctBestOfTotal == null ? "—" : `${pctBestOfTotal}% of total gap`}
              </div>
            </div>
            <div className={forecastStyleCard}>
              <div className="min-w-0 overflow-hidden text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">
                <span className="inline-flex min-w-0 items-center gap-2 truncate">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[#E74C3C]" aria-hidden />
                  <span className="min-w-0 truncate">PIPELINE GAP</span>
                </span>
              </div>
              <div className={`${forecastStyleValue} ${gapMoneyColorClass(gapPipe)}`}>{fmtMoney(gapPipe)}</div>
              <div className="mt-2 min-w-0 truncate text-meta text-[color:var(--sf-text-secondary)]">
                {pctPipeOfTotal == null ? "—" : `${pctPipeOfTotal}% of total gap`}
              </div>
            </div>
          </div>
        </div>
      </div>
      ) : null}
    </>
  );
}
