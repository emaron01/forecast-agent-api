"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type ComponentProps } from "react";
import { ExecutiveGapInsightsClient } from "../../../../components/dashboard/executive/ExecutiveGapInsightsClient";
import {
  RepManagerComparisonPanel,
  type RepManagerManagerRow,
  type RepManagerRepRow,
} from "./RepManagerComparisonPanel";

type ExecTabKey = "forecast" | "pipeline" | "team" | "revenue" | "reports";

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
  { key: "team", label: "Team" },
  { key: "revenue", label: "Revenue" },
  { key: "reports", label: "Reports" },
];

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
    router.push(`${pathname}?${params.toString()}`);
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
        {activeTab === "team" && (
          <div className="space-y-8">
            <section>
              <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Coaching Insights</h2>
              <div className="mt-3">
                <ExecutiveGapInsightsClient {...props.teamTabProps} teamTabOnly={true} />
              </div>
            </section>

            <hr className="border-[color:var(--sf-border)]" aria-hidden="true" />

            <section>
              <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Rep & Manager Performance</h2>
              <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                Quarter-scoped rep comparison and manager rollup by attainment.
              </p>
              <div className="mt-3">
                <RepManagerComparisonPanel
                  repRows={props.teamRepManagerPayload.repRows}
                  managerRows={props.teamRepManagerPayload.managerRows}
                  periodName={props.teamRepManagerPayload.periodName}
                />
              </div>
            </section>
          </div>
        )}
        {activeTab === "revenue" && <div>Tab content coming soon</div>}
        {activeTab === "reports" && <div>Tab content coming soon</div>}
      </div>
    </section>
  );
}

