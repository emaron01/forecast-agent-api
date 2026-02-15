"use client";

import { useMemo, useState } from "react";

type RepRow = {
  rep_id: string;
  rep_name: string;
  manager_id: string;
  manager_name: string;
  quota: number;
  total_count: number;
  won_amount: number;
  won_count: number;
  lost_count: number;
  active_amount: number;
  commit_amount: number;
  best_amount: number;
  pipeline_amount: number;
  created_amount: number;
  created_count: number;
  win_rate: number | null;
  opp_to_win: number | null;
  aov: number | null;
  attainment: number | null;
  commit_coverage: number | null;
  best_coverage: number | null;
  partner_contribution: number | null;
  partner_win_rate: number | null;
  avg_days_won: number | null;
  avg_days_lost: number | null;
  avg_days_active: number | null;
  mix_pipeline: number | null;
  mix_best: number | null;
  mix_commit: number | null;
  mix_won: number | null;
};

type MetricKey =
  | "quota"
  | "won_amount"
  | "won_count"
  | "attainment"
  | "active_amount"
  | "pipeline_amount"
  | "commit_amount"
  | "best_amount"
  | "commit_coverage"
  | "best_coverage"
  | "win_rate"
  | "opp_to_win"
  | "aov"
  | "partner_contribution"
  | "partner_win_rate"
  | "created_amount"
  | "created_count"
  | "avg_days_won"
  | "avg_days_lost"
  | "avg_days_active"
  | "mix_pipeline"
  | "mix_best"
  | "mix_commit"
  | "mix_won";

const METRICS: Array<{ key: MetricKey; label: string }> = [
  { key: "won_amount", label: "Closed Won ($)" },
  { key: "won_count", label: "# Won" },
  { key: "quota", label: "Quota ($)" },
  { key: "attainment", label: "Quota Attainment (%)" },
  { key: "active_amount", label: "Pipeline Value ($)" },
  { key: "commit_amount", label: "Commit ($)" },
  { key: "best_amount", label: "Best Case ($)" },
  { key: "commit_coverage", label: "Commit Coverage (%)" },
  { key: "best_coverage", label: "Best Case Coverage (%)" },
  { key: "win_rate", label: "Win Rate (%)" },
  { key: "opp_to_win", label: "Opp→Win Conversion (%)" },
  { key: "aov", label: "AOV ($)" },
  { key: "partner_contribution", label: "Partner Contribution (%)" },
  { key: "partner_win_rate", label: "Partner Win Rate (%)" },
  { key: "created_amount", label: "New Pipeline Created ($)" },
  { key: "created_count", label: "New Opps Created (#)" },
  { key: "avg_days_won", label: "Sales Cycle (Won, days)" },
  { key: "avg_days_lost", label: "Sales Cycle (Lost, days)" },
  { key: "avg_days_active", label: "Active Age (days)" },
  { key: "mix_pipeline", label: "Mix: Pipeline (%)" },
  { key: "mix_best", label: "Mix: Best (%)" },
  { key: "mix_commit", label: "Mix: Commit (%)" },
  { key: "mix_won", label: "Mix: Won (%)" },
];

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function fmtNum(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString();
}

function renderMetricValue(key: MetricKey, r: RepRow) {
  const v: any = (r as any)[key];
  if (key.endsWith("_coverage") || key === "attainment" || key === "win_rate" || key === "opp_to_win" || key.startsWith("mix_") || key.startsWith("partner_")) {
    return fmtPct(v == null ? null : Number(v));
  }
  if (key.includes("amount") || key === "quota" || key === "aov") return fmtMoney(v);
  if (key.startsWith("avg_days_")) return v == null ? "—" : `${Math.round(Number(v))}d`;
  return fmtNum(v);
}

export function CustomReportBuilder(props: { repRows: RepRow[] }) {
  const reps = props.repRows || [];

  const [selectedRepIds, setSelectedRepIds] = useState<Set<string>>(() => new Set());
  const [selectedMetrics, setSelectedMetrics] = useState<Set<MetricKey>>(() => new Set(["won_amount", "attainment", "active_amount", "win_rate"]));

  const selectedReps = useMemo(() => {
    const ids = selectedRepIds;
    const base = ids.size ? reps.filter((r) => ids.has(String(r.rep_id))) : reps.slice(0, 10);
    return base.slice().sort((a, b) => (b.won_amount - a.won_amount) || a.rep_name.localeCompare(b.rep_name));
  }, [reps, selectedRepIds]);

  const metricList = useMemo(() => Array.from(selectedMetrics.values()), [selectedMetrics]);

  function toggleRep(id: string) {
    setSelectedRepIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleMetric(k: MetricKey) {
    setSelectedMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function selectTop10ByWon() {
    const top = reps
      .slice()
      .sort((a, b) => (b.won_amount - a.won_amount) || a.rep_name.localeCompare(b.rep_name))
      .slice(0, 10);
    setSelectedRepIds(new Set(top.map((r) => String(r.rep_id))));
  }

  function clearSelection() {
    setSelectedRepIds(new Set());
  }

  return (
    <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Build a custom rep comparison</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Select the reps and KPI fields you want, then use the preview table below.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={selectTop10ByWon}
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface)]"
          >
            Select top 10 (Won)
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface)]"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Reps</div>
          <div className="mt-2 max-h-[320px] overflow-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
            <ul className="divide-y divide-[color:var(--sf-border)]">
              {reps
                .slice()
                .sort((a, b) => a.manager_name.localeCompare(b.manager_name) || b.won_amount - a.won_amount || a.rep_name.localeCompare(b.rep_name))
                .map((r) => {
                  const checked = selectedRepIds.has(String(r.rep_id));
                  return (
                    <li key={r.rep_id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <label className="flex min-w-0 items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
                        <input type="checkbox" checked={checked} onChange={() => toggleRep(String(r.rep_id))} />
                        <span className="truncate">
                          {r.rep_name} <span className="text-xs text-[color:var(--sf-text-secondary)]">({r.manager_name})</span>
                        </span>
                      </label>
                      <span className="shrink-0 font-mono text-xs text-[color:var(--sf-text-secondary)]">{fmtMoney(r.won_amount)}</span>
                    </li>
                  );
                })}
            </ul>
          </div>
          <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
            If you don’t select any reps, the preview shows the top 10 by Closed Won.
          </div>
        </div>

        <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Report fields</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {METRICS.map((m) => {
              const checked = selectedMetrics.has(m.key);
              return (
                <label key={m.key} className="flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
                  <input type="checkbox" checked={checked} onChange={() => toggleMetric(m.key)} />
                  <span>{m.label}</span>
                </label>
              );
            })}
          </div>
          <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
            Tip: keep it to ~4–8 fields for readability.
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">rep</th>
              <th className="px-4 py-3">manager</th>
              {metricList.map((k) => (
                <th key={k} className="px-4 py-3 text-right">
                  {METRICS.find((m) => m.key === k)?.label || k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {selectedReps.map((r) => (
              <tr key={r.rep_id} className="border-t border-[color:var(--sf-border)]">
                <td className="px-4 py-3 font-medium text-[color:var(--sf-text-primary)]">{r.rep_name}</td>
                <td className="px-4 py-3 text-[color:var(--sf-text-secondary)]">{r.manager_name}</td>
                {metricList.map((k) => (
                  <td key={k} className="px-4 py-3 text-right font-mono text-xs text-[color:var(--sf-text-primary)]">
                    {renderMetricValue(k, r)}
                  </td>
                ))}
              </tr>
            ))}
            {!selectedReps.length ? (
              <tr>
                <td colSpan={2 + metricList.length} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                  No reps selected.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

