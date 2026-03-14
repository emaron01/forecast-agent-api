"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition, type ComponentProps } from "react";
import { ExecutiveGapInsightsClient } from "../../../../components/dashboard/executive/ExecutiveGapInsightsClient";
import {
  RepManagerComparisonPanel,
  type RepManagerManagerRow,
  type RepManagerRepRow,
} from "./RepManagerComparisonPanel";

type ExecTabKey = "forecast" | "pipeline" | "coaching" | "team" | "revenue" | "reports";

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
  { key: "revenue", label: "Revenue" },
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
    href: "/analytics/top-deals",
    description: "Top won and closed loss deals for the selected quarter",
  },
  {
    title: "Top Partners",
    href: "/analytics/partners/executive",
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
      partner_won: props.forecastTabProps.partnersExecutive?.partner?.won_amount,
      partner_cei: (props.forecastTabProps.partnersExecutive as any)?.cei?.partner_index,
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

export function ExecutiveTabsShellClient(props: {
  basePath: string;
  initialTab: ExecTabKey;
  setDefaultTab: (tab: ExecTabKey) => Promise<void>;
  forecastTabProps: ExecutiveGapInsightsClientProps;
  pipelineTabProps: ExecutiveGapInsightsClientProps;
  pipelineHygiene: PipelineHygienePayload;
  teamTabProps: ExecutiveGapInsightsClientProps;
  teamRepManagerPayload: TeamRepManagerPayload;
  revenueTabProps: ExecutiveGapInsightsClientProps;
  orgName?: string;
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
          <ExecutiveGapInsightsClient
            {...props.forecastTabProps}
            forecastTabOnly={true}
          />
        )}
        {activeTab === "pipeline" && (
          <div className="space-y-6">
            <ExecutiveGapInsightsClient
              {...props.pipelineTabProps}
              pipelineTabOnly={true}
            />

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
            />
            {/* Part 2: Manager Review Queue — placeholder */}
            <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
              <h2 className="text-cardLabel text-[color:var(--sf-text-primary)] mb-4">Manager Review Queue</h2>
              <p className="text-sm text-[color:var(--sf-text-secondary)]">
                Coming in Part B
              </p>
            </div>
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
        {activeTab === "revenue" && (
          <ExecutiveGapInsightsClient {...props.revenueTabProps} revenueTabOnly={true} />
        )}
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

