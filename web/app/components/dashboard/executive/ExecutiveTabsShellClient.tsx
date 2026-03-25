"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition, type ComponentProps } from "react";
import { ExecutiveGapInsightsClient } from "../../../../components/dashboard/executive/ExecutiveGapInsightsClient";
import type { ExecTabKey } from "../../../actions/execTabConstants";
import {
  RepManagerComparisonPanel,
  type RepManagerManagerRow,
  type RepManagerRepRow,
} from "./RepManagerComparisonPanel";
import { ManagerReviewQueueClient, type ManagerReviewQueueProps } from "./ManagerReviewQueueClient";
import type { ChannelLedFedRow, ChannelPartnerHeroProps } from "../../../../lib/channelPartnerHeroData";

type ExecutiveGapInsightsClientProps = ComponentProps<typeof ExecutiveGapInsightsClient>;

type CoverageRow = {
  rep_id: number;
  rep_name: string;
  total_opps: number;
  reviewed_opps: number;
  coverage_pct: number | null;
};

type AssessmentRowClient = {
  rep_id: number;
  rep_name: string;
  pain: number | null;
  metrics: number | null;
  champion: number | null;
  eb: number | null;
  criteria: number | null;
  process: number | null;
  competition: number | null;
  paper: number | null;
  timing: number | null;
  budget: number | null;
  avg_total: number | null;
};

type VelocityRepSummary = {
  repName: string;
  avgBaseline: number;
  avgCurrent: number;
  avgDelta: number;
  dealsMoving: number;
  dealsFlat: number;
};

type ProgressionRepSummary = {
  repName: string;
  progressing: number;
  stalled: number;
  flat: number;
  total: number;
};

type PipelineHygienePayload = {
  coverageRows: CoverageRow[];
  assessmentRows: AssessmentRowClient[];
  velocitySummaries: VelocityRepSummary[];
  progressionSummaries: ProgressionRepSummary[];
};

function coveragePctTextClass(pct: number | null): string {
  if (pct == null) return "text-[color:var(--sf-text-primary)]";
  if (pct === 0) return "text-red-600";
  if (pct === 100) return "text-green-600";
  return "text-[color:var(--sf-text-primary)]";
}

function assessmentScoreTextClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return "text-gray-400";
  if (score <= 1) return "text-red-600";
  if (score === 2) return "text-yellow-600";
  return "text-green-600";
}

function deltaTextClass(delta: number): string {
  if (delta > 0) return "text-green-600";
  if (delta < 0) return "text-red-600";
  return "text-gray-500";
}

const TABS: { key: ExecTabKey; label: string }[] = [
  { key: "forecast", label: "Forecast" },
  { key: "pipeline", label: "Pipeline" },
  { key: "coaching", label: "Coaching" },
  { key: "team", label: "Team" },
  { key: "channel", label: "Channel" },
  { key: "revenue_mix", label: "Revenue Mix" },
  { key: "top_deals", label: "Top Deals" },
  { key: "report_builder", label: "Report Builder" },
  { key: "reports", label: "Reports" },
];

const REPORT_LINKS = [
  {
    title: "KPIs by Quarter",
    href: "/analytics/kpis",
    description: "Quarter-by-quarter KPI breakdown with manager and rep detail",
  },
  {
    title: "Top Deals",
    href: "/analytics/quotas/executive",
    description: "Top 10 won and closed loss deals for the selected quarter, across all motions",
  },
  {
    title: "Top Partners",
    href: "/dashboard/executive?tab=channel",
    description: "Partner performance, CEI scoring, and channel investment guidance",
  },
  {
    title: "Custom Reports",
    href: "/analytics/custom-reports",
    description: "Build and save custom rep comparison reports",
  },
  {
    title: "Forecast Hygiene (full page)",
    href: "/analytics/forecast-hygiene",
    description: "Detailed rep engagement and score velocity report",
  },
] as const;

function ReportsTabContent(props: {
  fiscalYear: string;
  fiscalQuarter: string;
  orgName: string;
  forecastTabProps: ExecutiveGapInsightsClientProps;
  pipelineHygiene: PipelineHygienePayload;
}) {
  const [briefingText, setBriefingText] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingGeneratedAt, setBriefingGeneratedAt] = useState<string | null>(null);
  const [briefingDataKey, setBriefingDataKey] = useState<string>("");
  const [briefingStale, setBriefingStale] = useState(false);

  const quarter = `${props.forecastTabProps.fiscalYear} Q${props.forecastTabProps.fiscalQuarter}`;

  useEffect(() => {
    const fy = props.forecastTabProps.fiscalYear;
    const qp = props.forecastTabProps.quotaPeriodId;
    const nextKey = `${fy}-${qp}`;
    if (briefingText && nextKey !== briefingDataKey) {
      setBriefingStale(true);
    }
  }, [props.forecastTabProps.fiscalYear, props.forecastTabProps.quotaPeriodId]);

  const generateBriefing = useCallback(async () => {
    setBriefingLoading(true);
    setBriefingStale(false);

    const payload = {
      quarter,
      quota: props.forecastTabProps.quota,
      ai_forecast: props.forecastTabProps.aiForecast,
      crm_forecast: props.forecastTabProps.crmForecast,
      gap: props.forecastTabProps.gap,
      unsupported_commit: props.forecastTabProps.commitAdmission?.unsupportedCommitAmount,
      needs_review: props.forecastTabProps.commitAdmission?.commitNeedsReviewAmount,
      evidence_coverage_pct: props.forecastTabProps.commitAdmission?.commitEvidenceCoveragePct,
      top_risks: props.forecastTabProps.commitDealPanels?.topPainDeals
        ?.slice(0, 3)
        .map((d: any) => ({ name: d.title, amount: d.amount })),
      direct_won: props.forecastTabProps.partnersExecutive?.direct?.won_amount,
      partner_won:
        Number(props.forecastTabProps.partnersExecutive?.partner_influenced?.won_amount || 0) +
        Number(props.forecastTabProps.partnersExecutive?.partner_sourced?.won_amount || 0),
      partner_cei: (props.forecastTabProps.partnersExecutive as any)?.cei?.partner_sourced_index,
      coverage: props.pipelineHygiene.coverageRows.map((r) => ({
        rep: r.rep_name,
        pct: r.coverage_pct,
      })),
    };

    try {
      const response = await fetch("/api/executive-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_tokens: 600,
          system:
            "You are Matthew, a skeptical CRO advisor. Brief the executive on their quarter. Be direct. Lead with verdict, support with data. Plain paragraphs only, no bullets. Four sections with bold headings: Quarter Outlook, Commit Integrity, Pipeline Risk, Channel Performance. Max 350 words.",
          messages: [{ role: "user", content: JSON.stringify(payload) }],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setBriefingText(data?.error ? `Error: ${data.error}` : "Unable to generate briefing.");
        return;
      }
      const text =
        data.content
          ?.filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n") || "Unable to generate briefing.";

      setBriefingText(text);
      setBriefingGeneratedAt(new Date().toLocaleTimeString());
      setBriefingDataKey(`${props.forecastTabProps.fiscalYear}-${props.forecastTabProps.quotaPeriodId}`);
    } catch {
      setBriefingText("Unable to generate briefing.");
    } finally {
      setBriefingLoading(false);
    }
  }, [props.forecastTabProps, props.pipelineHygiene, quarter]);

  const copyBriefing = useCallback(async () => {
    if (!briefingText) return;
    try {
      await navigator.clipboard.writeText(briefingText);
    } catch {
      // ignore
    }
  }, [briefingText]);

  const quarterLabel = [props.fiscalYear, props.fiscalQuarter].filter(Boolean).join(" · ") || "—";
  const subheading = `${props.orgName} · ${quarterLabel}`;

  const paragraphs = (briefingText || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const renderParagraph = (p: string, idx: number) => {
    const m = p.match(/^(Quarter Outlook|Commit Integrity|Pipeline Risk|Channel Performance)[:\-]?\s*(.*)$/i);
    if (m) {
      const heading = m[1];
      const rest = m[2];
      return (
        <p key={idx} className="text-sm text-[color:var(--sf-text-primary)]">
          <strong>{heading}</strong>
          {rest ? `: ${rest}` : ""}
        </p>
      );
    }
    return (
      <p key={idx} className="text-sm text-[color:var(--sf-text-primary)]">
        {p}
      </p>
    );
  };

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
            <Image
              src="/brand/salesforecast-logo-white.png"
              alt="SalesForecast.io"
              width={258}
              height={47}
              className="h-[1.95rem] w-auto opacity-90"
            />
            <span>✨ EXECUTIVE BRIEFING</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copyBriefing}
              disabled={!briefingText}
              className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]/70 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">⧉</span>
              Copy
            </button>
            <button
              type="button"
              onClick={() => void generateBriefing()}
              disabled={briefingLoading}
              className="rounded-md border border-[color:var(--sf-accent-primary)] bg-[color:var(--sf-accent-primary)] px-3 py-2 text-xs font-semibold text-white hover:bg-[color:var(--sf-accent-secondary)] disabled:opacity-60"
            >
              {briefingText ? "Regenerate" : "Generate"}
            </button>
          </div>
        </div>

        <p className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">{subheading}</p>

        {briefingStale ? (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Quarter data has changed — regenerate for updated insights.
          </div>
        ) : null}

        <div className="mt-4 min-h-[120px] rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
          {briefingLoading ? (
            <div className="flex items-center gap-2 text-sm text-[color:var(--sf-text-secondary)]">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-[color:var(--sf-border)] border-t-transparent" />
              <span>Matthew is preparing your briefing...</span>
            </div>
          ) : briefingText ? (
            <div className="space-y-2">{paragraphs.map(renderParagraph)}</div>
          ) : (
            <p className="text-sm text-[color:var(--sf-text-secondary)]">
              Generate a CRO-grade briefing for this quarter.
            </p>
          )}
        </div>

        {briefingText ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--sf-text-secondary)]">
            <span>Generated at {briefingGeneratedAt}</span>
            <button
              type="button"
              disabled
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-[10px] font-medium text-[color:var(--sf-text-secondary)] cursor-not-allowed"
              title="Coming soon"
            >
              Export to PDF (coming soon)
            </button>
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Report Links</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {REPORT_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-start justify-between gap-3 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm hover:bg-[color:var(--sf-surface-alt)]"
            >
              <div className="min-w-0">
                <div className="font-semibold text-[color:var(--sf-text-primary)]">{link.title}</div>
                <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">{link.description}</div>
              </div>
              <span className="shrink-0 text-[color:var(--sf-accent-primary)]" aria-hidden>
                →
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

export type TeamRepManagerPayload = {
  repRows: RepManagerRepRow[];
  managerRows: RepManagerManagerRow[];
  periodName?: string;
};

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

export function ExecutiveTabsShellClient(props: {
  basePath: string;
  initialTab: ExecTabKey;
  setDefaultTab: (tab: ExecTabKey) => Promise<void>;
  forecastTabProps: ExecutiveGapInsightsClientProps;
  pipelineTabProps: ExecutiveGapInsightsClientProps;
  pipelineHygiene: PipelineHygienePayload;
  teamTabProps: ExecutiveGapInsightsClientProps;
  teamRepManagerPayload: TeamRepManagerPayload;
  reviewQueueDeals: ManagerReviewQueueProps["deals"];
  currentUserId: number;
  showManagerReviewQueue: boolean;
  revenueTabProps: ExecutiveGapInsightsClientProps;
  topPartnerWon: any[];
  topPartnerLost: any[];
  topDealsWon?: any[];
  topDealsLost?: any[];
  /** Channel tab: Led/Fed table for hierarchy levels 0–2 only */
  showChannelContribution?: boolean;
  channelContributionHero?: ChannelPartnerHeroProps | null;
  channelContributionRows?: ChannelLedFedRow[];
  orgName?: string;
  viewerRole?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<ExecTabKey>(props.initialTab);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setActiveTab(props.initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialTab]);

  const updateUrl = (tab: ExecTabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleTabClick = (tab: ExecTabKey) => {
    setActiveTab(tab);
    updateUrl(tab);
  };

  const handleSetDefault = () => {
    startTransition(() => {
      void props.setDefaultTab(activeTab);
    });
  };

  const tabClasses = (tab: ExecTabKey) =>
    [
      "px-3 py-2 text-sm font-medium border-b-2",
      tab === activeTab
        ? "border-[color:var(--sf-accent-primary)] text-[color:var(--sf-text-primary)]"
        : "border-transparent text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)] hover:border-[color:var(--sf-border)]",
    ].join(" ");

  return (
    <section className="mt-6 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => handleTabClick(t.key)}
              className={tabClasses(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleSetDefault}
          disabled={isPending}
          className="text-xs text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] disabled:opacity-60"
        >
          Set as my default view
        </button>
      </div>

      <div className="mt-4 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-6 text-sm text-[color:var(--sf-text-secondary)]">
        {activeTab === "forecast" && (
          <div className="-mx-4 -mt-4">
            <ExecutiveGapInsightsClient {...props.forecastTabProps} forecastTabOnly={true} viewerRole={props.viewerRole} />
          </div>
        )}
        {activeTab === "pipeline" && (
          <div className="space-y-6">
            <div className="-mx-4 -mt-4">
              <ExecutiveGapInsightsClient {...props.pipelineTabProps} pipelineTabOnly={true} viewerRole={props.viewerRole} />
            </div>

            <section className="mt-4 space-y-4">
              <header>
                <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Team Forecast Hygiene</h2>
                <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                  Quarter-scoped hygiene metrics for the visible team, aligned with the selected forecast period.
                </p>
              </header>

              <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Coverage</h3>
                <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                  Share of in-quarter opportunities that have been reviewed by Matthew for each rep.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full border-collapse text-xs">
                    <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                      <tr>
                        <th className="px-3 py-2 text-left">Rep</th>
                        <th className="px-3 py-2 text-right">Total Opps</th>
                        <th className="px-3 py-2 text-right">Reviewed</th>
                        <th className="px-3 py-2 text-right">Coverage %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {props.pipelineHygiene.coverageRows.map((row) => (
                        <tr key={row.rep_id} className="border-t border-[color:var(--sf-border)]">
                          <td className="px-3 py-2 text-[color:var(--sf-text-primary)]">{row.rep_name}</td>
                          <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.total_opps}</td>
                          <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.reviewed_opps}</td>
                          <td className={`px-3 py-2 text-right font-medium ${coveragePctTextClass(row.coverage_pct)}`}>
                            {row.coverage_pct != null ? `${row.coverage_pct}%` : "—"}
                          </td>
                        </tr>
                      ))}
                      {!props.pipelineHygiene.coverageRows.length && (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-3 py-4 text-center text-xs text-[color:var(--sf-text-secondary)]"
                          >
                            No opportunities found for this quarter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
                  Matthew&apos;s Assessment (MEDDPICC+TB)
                </h3>
                <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                  Average category scores for reviewed deals this quarter.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full border-collapse text-[11px]">
                    <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                      <tr>
                        <th className="px-2 py-2 text-left">Rep</th>
                        {["Pain","Metrics","Champion","EB","Criteria","Process","Competition","Paper","Timing","Budget","Avg"].map((h) => (
                          <th key={h} className="px-2 py-2 text-center">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {props.pipelineHygiene.assessmentRows.map((row) => (
                        <tr key={row.rep_id} className="border-t border-[color:var(--sf-border)]">
                          <td className="px-2 py-2 whitespace-nowrap text-[color:var(--sf-text-primary)]">
                            {row.rep_name}
                          </td>
                          {[
                            row.pain,
                            row.metrics,
                            row.champion,
                            row.eb,
                            row.criteria,
                            row.process,
                            row.competition,
                            row.paper,
                            row.timing,
                            row.budget,
                            row.avg_total,
                          ].map((v, idx) => (
                            <td
                              key={idx}
                              className={`px-2 py-1 text-center font-mono ${assessmentScoreTextClass(v)}`}
                            >
                              {v != null ? v : "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {!props.pipelineHygiene.assessmentRows.length && (
                        <tr>
                          <td
                            colSpan={12}
                            className="px-3 py-4 text-center text-xs text-[color:var(--sf-text-secondary)]"
                          >
                            No reviewed deals found for this quarter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Score Velocity</h3>
                <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                  Change from baseline total score to current score, summarized by rep.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full border-collapse text-xs">
                    <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                      <tr>
                        <th className="px-3 py-2 text-left">Rep</th>
                        <th className="px-3 py-2 text-right">Avg Baseline</th>
                        <th className="px-3 py-2 text-right">Avg Current</th>
                        <th className="px-3 py-2 text-right">Avg Delta</th>
                        <th className="px-3 py-2 text-right">Deals Moving</th>
                        <th className="px-3 py-2 text-right">Deals Flat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {props.pipelineHygiene.velocitySummaries.map((row, idx) => (
                        <tr key={`${row.repName}:${idx}`} className="border-t border-[color:var(--sf-border)]">
                          <td className="px-3 py-2 whitespace-nowrap text-[color:var(--sf-text-primary)]">
                            {row.repName}
                          </td>
                          <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                            {Number.isFinite(row.avgBaseline) ? row.avgBaseline.toFixed(1) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                            {Number.isFinite(row.avgCurrent) ? row.avgCurrent.toFixed(1) : "—"}
                          </td>
                          <td className={`px-3 py-2 text-right font-mono ${deltaTextClass(row.avgDelta)}`}>
                            {Number.isFinite(row.avgDelta) ? row.avgDelta.toFixed(1) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                            {row.dealsMoving}
                          </td>
                          <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                            {row.dealsFlat}
                          </td>
                        </tr>
                      ))}
                      {!props.pipelineHygiene.velocitySummaries.length && (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-3 py-4 text-center text-xs text-[color:var(--sf-text-secondary)]"
                          >
                            No score changes found for this quarter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Deal Progression</h3>
                <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                  Progression summary by rep. Deals with flat scores for 3+ events over 14+ days are flagged as stalled.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full border-collapse text-xs">
                    <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                      <tr>
                        <th className="px-3 py-2 text-left">Rep</th>
                        <th className="px-3 py-2 text-right">Progressing</th>
                        <th className="px-3 py-2 text-right">Stalled</th>
                        <th className="px-3 py-2 text-right">Flat</th>
                        <th className="px-3 py-2 text-right">Total Reviewed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {props.pipelineHygiene.progressionSummaries.map((row, idx) => (
                        <tr key={`${row.repName}:${idx}`} className="border-t border-[color:var(--sf-border)]">
                          <td className="px-3 py-2 whitespace-nowrap text-[color:var(--sf-text-primary)]">
                            {row.repName}
                          </td>
                          <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                            {row.progressing}
                          </td>
                          <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                            {row.stalled}
                          </td>
                          <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                            {row.flat}
                          </td>
                          <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                            {row.total}
                          </td>
                        </tr>
                      ))}
                      {!props.pipelineHygiene.progressionSummaries.length && (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-3 py-4 text-center text-xs text-[color:var(--sf-text-secondary)]"
                          >
                            No progression data found for this quarter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </section>
          </div>
        )}
        {activeTab === "coaching" && (
          <div className="space-y-6">
            {/* Part 1: Coaching Insights from teamTabOnly */}
            <ExecutiveGapInsightsClient
              {...props.teamTabProps}
              teamTabOnly={true}
              viewerRole={props.viewerRole}
            />
            {/* Part 2: Manager Review Queue — only for MANAGER, EXEC_MANAGER, ADMIN */}
            {props.showManagerReviewQueue ? (
              <ManagerReviewQueueClient
                deals={props.reviewQueueDeals}
                currentUserId={props.currentUserId}
              />
            ) : null}
          </div>
        )}
        {activeTab === "team" && (
          <div className="space-y-6">
            <div>
              <p className="text-sm text-[color:var(--sf-text-secondary)] mb-4">
                Quarter-scoped rep comparison and manager rollup by attainment.
              </p>
              <RepManagerComparisonPanel
                repRows={props.teamRepManagerPayload.repRows}
                managerRows={props.teamRepManagerPayload.managerRows}
                periodName={props.teamRepManagerPayload.periodName}
              />
            </div>
          </div>
        )}
        {"channel" === activeTab && (
          <div className="-mx-4 -mt-4 space-y-5">
            {props.showChannelContribution && props.channelContributionHero ? (
              <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
                <h3 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Channel Contribution</h3>
                {(() => {
                  const hero = props.channelContributionHero!;
                  const kpis = hero.quarterKpis;
                  const closedWonRevenue =
                    kpis != null
                      ? Number(kpis.directVsPartner.directWonAmount || 0) + Number(kpis.directVsPartner.partnerWonAmount || 0)
                      : Number(hero.crmForecast.won_amount || 0);
                  const quota = Number(hero.quota || 0);
                  const gapToQuota = quota - closedWonRevenue;
                  const gapColor = gapToQuota > 0 ? "text-[#E74C3C]" : "text-[#16A34A]";

                  const productRows = Array.isArray(hero.productsClosedWon) ? hero.productsClosedWon : [];
                  const curRevenue = productRows.reduce((acc, r: any) => acc + (Number(r.won_amount || 0) || 0), 0);
                  const curOrders = productRows.reduce((acc, r: any) => acc + (Number(r.won_count || 0) || 0), 0);
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
                  const totalCnt = pm?.current_quarter?.total_opps ?? (commitCnt != null && bestCnt != null && pipeCnt != null ? commitCnt + bestCnt + pipeCnt : null);
                  const commitH = pm?.current_quarter?.mix?.commit?.health_pct ?? null;
                  const bestH = pm?.current_quarter?.mix?.best_case?.health_pct ?? null;
                  const pipeH = pm?.current_quarter?.mix?.pipeline?.health_pct ?? null;
                  const totalH = pm?.current_quarter?.avg_health_pct ?? null;
                  const remainingQuota = quota > 0 ? Math.max(0, quota - closedWonRevenue) : null;
                  const coverage = remainingQuota != null && remainingQuota > 0 && totalAmt > 0 ? totalAmt / remainingQuota : null;
                  const cov = coverageStatus(coverage);

                  const avgHealthWon = kpis?.avgHealthWonPct ?? null;
                  const oppToWin = kpis?.oppToWin ?? null;
                  const bd = hero.bucketDeltas;
                  const absMax = Math.max(Math.abs(bd.commit), Math.abs(bd.best_case), Math.abs(bd.pipeline), 1);
                  const bar = (v: number) => `${Math.round(Math.max(0, Math.min(100, (Math.abs(v) / absMax) * 100)))}%`;
                  const deltaTextClass = (v: number) =>
                    !Number.isFinite(v) || v === 0 ? "text-[color:var(--sf-text-secondary)]" : v > 0 ? "text-[#2ECC71]" : "text-[#E74C3C]";

                  const card = "rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm";
                  const value = "mt-1 break-all text-xl font-bold font-[tabular-nums] text-[color:var(--sf-text-primary)] sm:text-2xl";

                  return (
                    <div className="mt-4 space-y-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className={card}>
                          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Channel Closed Won</div>
                          <div className={value}>{fmtMoney(closedWonRevenue)}</div>
                        </div>
                        <div className={card}>
                          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Quota</div>
                          <div className={value}>{fmtMoney(quota)}</div>
                        </div>
                        <div className={card}>
                          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Gap to Quota</div>
                          <div className={`${value} ${gapColor}`}>{fmtMoney(gapToQuota)}</div>
                          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Remaining to quota</div>
                        </div>
                        <div className={card}>
                          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Landing Zone</div>
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
                            <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]"># Opps: <span className="font-[tabular-nums] text-[color:var(--sf-text-primary)]">{x.count == null ? "—" : x.count.toLocaleString("en-US")}</span></div>
                            <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Avg Health: <span className={healthClass(x.health)}>{x.health == null ? "—" : `${Math.round(Number(x.health) || 0)}%`}</span></div>
                          </div>
                        ))}
                        <div className={card}>
                          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Pipeline Coverage</div>
                          <div className={value}>{coverage == null || !Number.isFinite(coverage) ? "—" : `${coverage.toFixed(1)}x`}</div>
                          <div className="mt-2">
                            <span className={["inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold", cov.cls].join(" ")}>{cov.label}</span>
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
                          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Avg Health Closed Won</div>
                          <div className={value}>
                            <span className={healthClass(avgHealthWon)}>{avgHealthWon == null ? "—" : `${avgHealthWon}%`}</span>
                          </div>
                        </div>
                        <div className={card}>
                          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Opp→Win Conversion</div>
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
                {(props.channelContributionRows?.length ?? 0) > 0 ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="bg-[color:var(--sf-surface-alt)] text-left text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
                        <th className="border-b border-[color:var(--sf-border)] px-4 py-3">Metric</th>
                        <th className="border-b border-[color:var(--sf-border)] px-4 py-3 text-right">
                          Channel Led (Deal Reg)
                        </th>
                        <th className="border-b border-[color:var(--sf-border)] px-4 py-3 text-right">
                          Channel Fed (No Deal Reg)
                        </th>
                        <th className="border-b border-[color:var(--sf-border)] px-4 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="text-[color:var(--sf-text-primary)]">
                      {(props.channelContributionRows ?? []).map((row) => {
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
              </section>
            ) : null}
            <ExecutiveGapInsightsClient
              {...props.revenueTabProps}
              channelTabOnly={true}
              viewerRole={props.viewerRole}
              topPartnerWon={props.topPartnerWon}
              topPartnerLost={props.topPartnerLost}
            />
          </div>
        )}
        {activeTab === "revenue_mix" && (
          <div className="-mx-4 -mt-4">
            <ExecutiveGapInsightsClient {...props.revenueTabProps} revenueTabOnly={true} viewerRole={props.viewerRole} />
          </div>
        )}
        {activeTab === "top_deals" && <div>Top Deals coming soon</div>}
        {activeTab === "report_builder" && <div>Report Builder coming soon</div>}
        {activeTab === "reports" && (
          <ReportsTabContent
            fiscalYear={props.forecastTabProps.fiscalYear}
            fiscalQuarter={props.forecastTabProps.fiscalQuarter}
            orgName={props.orgName ?? "SalesForecast.io"}
            forecastTabProps={props.forecastTabProps}
            pipelineHygiene={props.pipelineHygiene}
          />
        )}
      </div>
    </section>
  );
}

