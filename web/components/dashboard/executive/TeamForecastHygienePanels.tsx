"use client";

export type CoverageHygieneRow = {
  rep_id: number;
  rep_name: string;
  total_opps: number;
  reviewed_opps: number;
  coverage_pct: number | null;
};

export type AssessmentHygieneRow = {
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

export type VelocityHygieneSummary = {
  /** Positive: rep; negative: leader team rollup (same convention as coverage/assessment `rep_id`). */
  repId: number;
  repName: string;
  avgBaseline: number;
  avgCurrent: number;
  avgDelta: number;
  dealsMoving: number;
  dealsFlat: number;
};

export type ProgressionHygieneSummary = {
  repId: number;
  repName: string;
  progressing: number;
  stalled: number;
  flat: number;
  total: number;
};

export type PipelineHygienePayload = {
  coverageRows: CoverageHygieneRow[];
  assessmentRows: AssessmentHygieneRow[];
  velocitySummaries: VelocityHygieneSummary[];
  progressionSummaries: ProgressionHygieneSummary[];
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

/** Leader rollup rows use negative `rep_id` / `repId`; label one rollup as Team Total, multiple as "{name}'s Team". */
function rollupRowLabel(repName: string, rollupCount: number): string {
  if (rollupCount <= 1) return "Team Total";
  return `${repName}'s Team`;
}

/** Shared Team Forecast Hygiene UI (Coverage, Assessment, Score Velocity, Deal Progression). */
export function TeamForecastHygienePanels(props: {
  pipelineHygiene: PipelineHygienePayload;
  /** Active quota period label (e.g. "3rd Quarter (FY2026 Q3)"). */
  periodName?: string;
  /** e.g. `mt-4 space-y-4` when not first on page; `space-y-4` for forecast tab top */
  sectionClassName?: string;
}) {
  const { pipelineHygiene: h, periodName } = props;
  const sectionClass = props.sectionClassName ?? "mt-4 space-y-4";

  const coverageRepRows = h.coverageRows.filter((r) => r.rep_id > 0);
  const coverageRollupRows = h.coverageRows.filter((r) => r.rep_id < 0);
  const coverageRollupN = coverageRollupRows.length;

  const assessmentRepRows = h.assessmentRows.filter((r) => r.rep_id > 0);
  const assessmentRollupRows = h.assessmentRows.filter((r) => r.rep_id < 0);
  const assessmentRollupN = assessmentRollupRows.length;

  const velocityRepRows = h.velocitySummaries.filter((r) => r.repId > 0);
  const velocityRollupRows = h.velocitySummaries.filter((r) => r.repId < 0);
  const velocityRollupN = velocityRollupRows.length;

  const progressionRepRows = h.progressionSummaries.filter((r) => r.repId > 0);
  const progressionRollupRows = h.progressionSummaries.filter((r) => r.repId < 0);
  const progressionRollupN = progressionRollupRows.length;

  return (
    <section className={sectionClass}>
      <header>
        <div className="px-1">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">
            Team Forecast Hygiene
            {periodName ? ` — ${periodName}` : ""}
          </h2>
        </div>
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
              {coverageRepRows.map((row) => (
                <tr key={row.rep_id} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-3 py-2 text-[color:var(--sf-text-primary)]">{row.rep_name}</td>
                  <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.total_opps}</td>
                  <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.reviewed_opps}</td>
                  <td className={`px-3 py-2 text-right font-medium ${coveragePctTextClass(row.coverage_pct)}`}>
                    {row.coverage_pct != null ? `${row.coverage_pct}%` : "—"}
                  </td>
                </tr>
              ))}
              {coverageRollupRows.map((row) => (
                <tr key={row.rep_id} className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]">
                  <td className="px-3 py-2 font-semibold">{rollupRowLabel(row.rep_name, coverageRollupN)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{row.total_opps}</td>
                  <td className="px-3 py-2 text-right font-semibold">{row.reviewed_opps}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${coveragePctTextClass(row.coverage_pct)}`}>
                    {row.coverage_pct != null ? `${row.coverage_pct}%` : "—"}
                  </td>
                </tr>
              ))}
              {!h.coverageRows.length && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-xs text-[color:var(--sf-text-secondary)]">
                    No opportunities found for this quarter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Matthew&apos;s Assessment (MEDDPICC+TB)</h3>
        <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Average category scores for reviewed deals this quarter.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full border-collapse text-[11px]">
            <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
              <tr>
                <th className="px-2 py-2 text-left">Rep</th>
                {["Pain", "Metrics", "Champion", "EB", "Criteria", "Process", "Competition", "Paper", "Timing", "Budget", "Avg"].map((x) => (
                  <th key={x} className="px-2 py-2 text-center">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assessmentRepRows.map((row) => (
                <tr key={row.rep_id} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-2 py-2 whitespace-nowrap text-[color:var(--sf-text-primary)]">{row.rep_name}</td>
                  {[row.pain, row.metrics, row.champion, row.eb, row.criteria, row.process, row.competition, row.paper, row.timing, row.budget, row.avg_total].map(
                    (v, idx) => (
                      <td key={idx} className={`px-2 py-1 text-center font-mono ${assessmentScoreTextClass(v)}`}>
                        {v != null ? v : "—"}
                      </td>
                    )
                  )}
                </tr>
              ))}
              {assessmentRollupRows.map((row) => (
                <tr key={row.rep_id} className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]">
                  <td className="px-2 py-2 whitespace-nowrap font-semibold">{rollupRowLabel(row.rep_name, assessmentRollupN)}</td>
                  {[row.pain, row.metrics, row.champion, row.eb, row.criteria, row.process, row.competition, row.paper, row.timing, row.budget, row.avg_total].map(
                    (v, idx) => (
                      <td key={idx} className={`px-2 py-1 text-center font-mono font-semibold ${assessmentScoreTextClass(v)}`}>
                        {v != null ? v : "—"}
                      </td>
                    )
                  )}
                </tr>
              ))}
              {!h.assessmentRows.length && (
                <tr>
                  <td colSpan={12} className="px-3 py-4 text-center text-xs text-[color:var(--sf-text-secondary)]">
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
              {velocityRepRows.map((row) => (
                <tr key={row.repId} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-3 py-2 whitespace-nowrap text-[color:var(--sf-text-primary)]">{row.repName}</td>
                  <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                    {Number.isFinite(row.avgBaseline) ? row.avgBaseline.toFixed(1) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">
                    {Number.isFinite(row.avgCurrent) ? row.avgCurrent.toFixed(1) : "—"}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${deltaTextClass(row.avgDelta)}`}>
                    {Number.isFinite(row.avgDelta) ? row.avgDelta.toFixed(1) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.dealsMoving}</td>
                  <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.dealsFlat}</td>
                </tr>
              ))}
              {velocityRollupRows.map((row) => (
                <tr key={row.repId} className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]">
                  <td className="px-3 py-2 whitespace-nowrap font-semibold">{rollupRowLabel(row.repName, velocityRollupN)}</td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {Number.isFinite(row.avgBaseline) ? row.avgBaseline.toFixed(1) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {Number.isFinite(row.avgCurrent) ? row.avgCurrent.toFixed(1) : "—"}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold ${deltaTextClass(row.avgDelta)}`}>
                    {Number.isFinite(row.avgDelta) ? row.avgDelta.toFixed(1) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{row.dealsMoving}</td>
                  <td className="px-3 py-2 text-right font-semibold">{row.dealsFlat}</td>
                </tr>
              ))}
              {!h.velocitySummaries.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-xs text-[color:var(--sf-text-secondary)]">
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
              {progressionRepRows.map((row) => (
                <tr key={row.repId} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-3 py-2 whitespace-nowrap text-[color:var(--sf-text-primary)]">{row.repName}</td>
                  <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.progressing}</td>
                  <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.stalled}</td>
                  <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.flat}</td>
                  <td className="px-3 py-2 text-right text-[color:var(--sf-text-primary)]">{row.total}</td>
                </tr>
              ))}
              {progressionRollupRows.map((row) => (
                <tr key={row.repId} className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]">
                  <td className="px-3 py-2 whitespace-nowrap font-semibold">{rollupRowLabel(row.repName, progressionRollupN)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{row.progressing}</td>
                  <td className="px-3 py-2 text-right font-semibold">{row.stalled}</td>
                  <td className="px-3 py-2 text-right font-semibold">{row.flat}</td>
                  <td className="px-3 py-2 text-right font-semibold">{row.total}</td>
                </tr>
              ))}
              {!h.progressionSummaries.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-xs text-[color:var(--sf-text-secondary)]">
                    No progression data found for this quarter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
