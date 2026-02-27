"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { classifyByMs, overallStatus, type SloBand } from "../../../lib/slo";

const WORKFLOWS = ["voice_review", "full_voice_review", "text_review", "ingestion", "paste_note"];

type Summary = {
  windowHours: number;
  since: string;
  per_workflow: { workflow: string; count: number; error_rate: number; p50_ms: number; p90_ms: number; p95_ms: number; p99_ms: number }[];
  stage_breakdown_p95: Record<string, Record<string, number>>;
  voice_rtf: { workflow: string; p50_rtf: number | null; p95_rtf: number | null }[];
};

type Regressions = {
  baselineDays: number;
  currentHours: number;
  by_workflow: {
    workflow: string;
    baseline_p95_ms: number;
    current_p95_ms: number;
    delta_ms: number;
    stages: { stage: string; baseline_p95_ms: number; current_p95_ms: number; delta_ms: number }[];
  }[];
};

type Orgs = {
  workflow: string;
  windowHours: number;
  top_orgs: { org_id: number; count: number; error_count: number; error_rate: number; p95_ms: number }[];
};

type Worst = {
  workflow: string;
  windowHours: number;
  limit: number;
  worst_runs: {
    run_id: string | null;
    call_id: string | null;
    workflow: string;
    org_id: number;
    ts: string;
    duration_ms: number;
    status: string;
    stages: { stage: string; duration_ms: number; status: string }[];
  }[];
};

export function HealthDashboard() {
  const [windowHours, setWindowHours] = useState(24);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [regressions, setRegressions] = useState<Regressions | null>(null);
  const [orgs, setOrgs] = useState<Orgs | null>(null);
  const [worst, setWorst] = useState<Worst | null>(null);
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ windowHours: String(windowHours) });
    if (workflowFilter) params.set("workflow", workflowFilter);
    Promise.all([
      fetch(`/api/admin/health/summary?${new URLSearchParams({ windowHours: String(windowHours) })}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/admin/health/regressions?baselineDays=7&currentHours=${windowHours}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/admin/health/orgs?${params}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/admin/health/worst?${params}&limit=50`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([s, r, o, w]) => {
        setSummary(s || null);
        setRegressions(r || null);
        setOrgs(o || null);
        setWorst(w || null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [windowHours, workflowFilter]);

  if (loading && !summary) {
    return <div className="text-[color:var(--sf-text-secondary)]">Loading…</div>;
  }
  if (error) {
    return <div className="rounded border border-red-200 bg-red-50 p-3 text-red-800">{error}</div>;
  }

  const bands: SloBand[] = (summary?.per_workflow || []).map((w) => classifyByMs(w.workflow, w.p95_ms ?? 0));
  const status = overallStatus(bands);
  const statusColor =
    status === "Healthy" ? "bg-green-100 text-green-800" : status === "Degraded" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <span className={`rounded px-2 py-1 text-sm font-medium ${statusColor}`}>{status}</span>
        <label className="text-sm text-[color:var(--sf-text-secondary)]">
          Window:
          <select
            className="ml-1 rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-2 py-1 text-sm"
            value={windowHours}
            onChange={(e) => setWindowHours(Number(e.target.value))}
          >
            <option value={6}>6h</option>
            <option value={24}>24h</option>
            <option value={72}>72h</option>
            <option value={168}>7d</option>
          </select>
        </label>
        <label className="text-sm text-[color:var(--sf-text-secondary)]">
          Workflow:
          <select
            className="ml-1 rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-2 py-1 text-sm"
            value={workflowFilter}
            onChange={(e) => setWorkflowFilter(e.target.value)}
          >
            <option value="">All</option>
            {WORKFLOWS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-[color:var(--sf-text-primary)]">KPI (p95 total ms + error rate)</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(summary?.per_workflow || []).map((w) => {
            const band = classifyByMs(w.workflow, w.p95_ms ?? 0);
            const bandCl =
              band === "Fast" ? "border-green-300" : band === "Normal" ? "border-[color:var(--sf-border)]" : band === "Slow" ? "border-amber-400" : "border-red-400";
            return (
              <div
                key={w.workflow}
                className={`rounded-lg border-2 bg-[color:var(--sf-surface)] p-3 ${bandCl}`}
              >
                <div className="font-medium text-[color:var(--sf-text-primary)]">{w.workflow}</div>
                <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                  p95: {w.p95_ms ?? "—"} ms · err: {((w.error_rate ?? 0) * 100).toFixed(2)}% · n={w.count}
                </div>
                <div className="text-xs text-[color:var(--sf-text-secondary)]">{band}</div>
              </div>
            );
          })}
        </div>
      </section>

      {(summary?.voice_rtf?.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-[color:var(--sf-text-primary)]">Voice RTF (p50 / p95)</h2>
          <div className="rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
            <ul className="space-y-1 text-sm">
              {summary!.voice_rtf.map((v) => (
                <li key={v.workflow}>
                  {v.workflow}: {v.p50_rtf ?? "—"} / {v.p95_rtf ?? "—"}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {summary?.stage_breakdown_p95 && Object.keys(summary.stage_breakdown_p95).length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-[color:var(--sf-text-primary)]">Stage breakdown (p95 ms)</h2>
          <div className="overflow-x-auto rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--sf-border)] text-left">
                  <th className="py-1 pr-4">Workflow</th>
                  <th className="py-1 pr-4">Stage</th>
                  <th className="py-1">p95 ms</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.stage_breakdown_p95).flatMap(([wf, stages]) =>
                  Object.entries(stages).map(([stage, p95]) => (
                    <tr key={`${wf}:${stage}`} className="border-b border-[color:var(--sf-border)] last:border-0">
                      <td className="py-1 pr-4">{wf}</td>
                      <td className="py-1 pr-4">{stage}</td>
                      <td className="py-1">{p95}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {regressions && regressions.by_workflow.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-[color:var(--sf-text-primary)]">Regressions (baseline 7d vs current)</h2>
          <div className="overflow-x-auto rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--sf-border)] text-left">
                  <th className="py-1 pr-4">Workflow</th>
                  <th className="py-1 pr-4">Baseline p95</th>
                  <th className="py-1 pr-4">Current p95</th>
                  <th className="py-1">Delta (ms)</th>
                </tr>
              </thead>
              <tbody>
                {regressions.by_workflow.map((r) => (
                  <tr key={r.workflow} className="border-b border-[color:var(--sf-border)] last:border-0">
                    <td className="py-1 pr-4">{r.workflow}</td>
                    <td className="py-1 pr-4">{r.baseline_p95_ms}</td>
                    <td className="py-1 pr-4">{r.current_p95_ms}</td>
                    <td className={`py-1 ${r.delta_ms > 0 ? "text-amber-600" : "text-green-600"}`}>{r.delta_ms > 0 ? "+" : ""}{r.delta_ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {orgs && orgs.top_orgs.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-[color:var(--sf-text-primary)]">Top 10 slowest orgs (p95)</h2>
          <div className="overflow-x-auto rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--sf-border)] text-left">
                  <th className="py-1 pr-4">Org ID</th>
                  <th className="py-1 pr-4">Count</th>
                  <th className="py-1 pr-4">Error rate</th>
                  <th className="py-1">p95 ms</th>
                </tr>
              </thead>
              <tbody>
                {orgs.top_orgs.map((o) => (
                  <tr key={o.org_id} className="border-b border-[color:var(--sf-border)] last:border-0">
                    <td className="py-1 pr-4">{o.org_id}</td>
                    <td className="py-1 pr-4">{o.count}</td>
                    <td className="py-1 pr-4">{(o.error_rate * 100).toFixed(2)}%</td>
                    <td className="py-1">{o.p95_ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {worst && worst.worst_runs.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-[color:var(--sf-text-primary)]">Worst runs</h2>
          <div className="overflow-x-auto rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--sf-border)] text-left">
                  <th className="py-1 pr-4">Run / Call</th>
                  <th className="py-1 pr-4">Workflow</th>
                  <th className="py-1 pr-4">Duration (ms)</th>
                  <th className="py-1">Trace</th>
                </tr>
              </thead>
              <tbody>
                {worst.worst_runs.slice(0, 20).map((run, i) => (
                  <tr key={i} className="border-b border-[color:var(--sf-border)] last:border-0">
                    <td className="py-1 pr-4 font-mono text-xs">{run.run_id || run.call_id || "—"}</td>
                    <td className="py-1 pr-4">{run.workflow}</td>
                    <td className="py-1 pr-4">{run.duration_ms}</td>
                    <td className="py-1">
                      <Link
                        href={`/admin/health/trace?${run.run_id ? `run_id=${encodeURIComponent(run.run_id)}` : `call_id=${encodeURIComponent(run.call_id || "")}`}`}
                        className="text-[color:var(--sf-accent)] hover:underline"
                      >
                        View trace
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!summary?.per_workflow?.length && !loading && (
        <p className="text-sm text-[color:var(--sf-text-secondary)]">No perf data in the selected window. Instrumentation may not be active yet.</p>
      )}
    </div>
  );
}
