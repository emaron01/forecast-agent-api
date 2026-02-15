"use client";

import { Fragment, useMemo, useState } from "react";
import { ExportToExcelButton } from "../../_components/ExportToExcelButton";

type RepRow = {
  rep_id: string;
  rep_name: string;
  manager_id: string;
  manager_name: string;
  avg_health_all: number | null;
  avg_health_commit: number | null;
  avg_health_best: number | null;
  avg_health_pipeline: number | null;
  avg_health_won: number | null;
  avg_health_closed: number | null;
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

type SavedReportRow = {
  id: string;
  report_type: string;
  name: string;
  description: string | null;
  config: any;
  created_at?: string;
  updated_at?: string;
};

type MetricKey =
  | "avg_health_all"
  | "avg_health_commit"
  | "avg_health_best"
  | "avg_health_pipeline"
  | "avg_health_won"
  | "avg_health_closed"
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
  { key: "avg_health_all", label: "Avg Health (Overall)" },
  { key: "avg_health_best", label: "Avg Health (Best Case)" },
  { key: "avg_health_closed", label: "Avg Health (Closed)" },
  { key: "avg_health_commit", label: "Avg Health (Commit)" },
  { key: "avg_health_pipeline", label: "Avg Health (Pipeline)" },
  { key: "avg_health_won", label: "Avg Health (Won)" },
  { key: "aov", label: "AOV ($)" },
  { key: "avg_days_active", label: "Aging (Avg deal age, days)" },
  { key: "best_amount", label: "Best Case ($)" },
  { key: "best_coverage", label: "Best Case Coverage (%)" },
  { key: "commit_amount", label: "Commit ($)" },
  { key: "commit_coverage", label: "Commit Coverage (%)" },
  { key: "created_amount", label: "New Pipeline Created ($)" },
  { key: "created_count", label: "New Opps Created (#)" },
  { key: "active_amount", label: "Pipeline Value ($)" },
  { key: "mix_best", label: "Mix: Best (%)" },
  { key: "mix_commit", label: "Mix: Commit (%)" },
  { key: "mix_pipeline", label: "Mix: Pipeline (%)" },
  { key: "mix_won", label: "Mix: Won (%)" },
  { key: "opp_to_win", label: "Opp→Win Conversion (%)" },
  { key: "partner_contribution", label: "Partner Contribution (%)" },
  { key: "partner_win_rate", label: "Partner Win Rate (%)" },
  { key: "quota", label: "Quota ($)" },
  { key: "attainment", label: "Quota Attainment (%)" },
  { key: "avg_days_lost", label: "Sales Cycle (Lost, days)" },
  { key: "avg_days_won", label: "Sales Cycle (Won, days)" },
  { key: "win_rate", label: "Win Rate (%)" },
  { key: "won_amount", label: "Closed Won ($)" },
  { key: "won_count", label: "# Won" },
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

function healthFracFrom30(score: any) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(0, Math.min(1, n / 30));
}

function fmtNum(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString();
}

function renderMetricValue(key: MetricKey, r: RepRow) {
  const v: any = (r as any)[key];
  if (key.startsWith("avg_health_")) return fmtPct(healthFracFrom30(v));
  if (
    key.endsWith("_coverage") ||
    key === "attainment" ||
    key === "win_rate" ||
    key === "opp_to_win" ||
    key.startsWith("mix_") ||
    key.startsWith("partner_")
  ) {
    return fmtPct(v == null ? null : Number(v));
  }
  if (key.includes("amount") || key === "quota" || key === "aov") return fmtMoney(v);
  if (key.startsWith("avg_days_")) return v == null ? "—" : `${Math.round(Number(v))}d`;
  return fmtNum(v);
}

function normalizeConfig(cfg: any): { repIds: string[]; metrics: MetricKey[] } {
  const repIds = Array.isArray(cfg?.repIds) ? cfg.repIds.map((x: any) => String(x)).filter(Boolean) : [];
  const metricsRaw = Array.isArray(cfg?.metrics) ? cfg.metrics.map((x: any) => String(x)).filter(Boolean) : [];
  const metrics = metricsRaw.filter((k) => METRICS.some((m) => m.key === (k as any))) as MetricKey[];
  return { repIds, metrics };
}

export function CustomReportDesignerClient(props: {
  reportType: string;
  repRows: RepRow[];
  repDirectory: Array<{ id: number; name: string; manager_rep_id: number | null }>;
  savedReports: SavedReportRow[];
  periodLabel: string;
}) {
  const reps = props.repRows || [];
  const repDirectory = props.repDirectory || [];
  const saved = props.savedReports || [];

  const repNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of repDirectory) {
      const id = String(r.id);
      const nm = String((r as any).name || "").trim() || `Rep ${id}`;
      m.set(id, nm);
    }
    return m;
  }, [repDirectory]);

  const managerIdById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of repDirectory) m.set(String(r.id), r.manager_rep_id == null ? "" : String(r.manager_rep_id));
    return m;
  }, [repDirectory]);

  const directReportCount = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of repDirectory) {
      const mid = r.manager_rep_id == null ? "" : String(r.manager_rep_id);
      if (!mid) continue;
      c.set(mid, (c.get(mid) || 0) + 1);
    }
    return c;
  }, [repDirectory]);

  const managerCandidateIds = useMemo(() => {
    const out: string[] = [];
    for (const [id, n] of directReportCount.entries()) if (n > 0) out.push(String(id));
    return out;
  }, [directReportCount]);

  const executiveIds = useMemo(() => {
    // Exec = manager candidate with no manager_rep_id.
    return managerCandidateIds
      .filter((id) => !(managerIdById.get(String(id)) || ""))
      .sort((a, b) => (repNameById.get(a) || a).localeCompare(repNameById.get(b) || b));
  }, [managerCandidateIds, managerIdById, repNameById]);

  const [selectedExecutiveId, setSelectedExecutiveId] = useState<string>("__all__");
  const [selectedManagerId, setSelectedManagerId] = useState<string>("__all__");

  const [selectedRepIds, setSelectedRepIds] = useState<Set<string>>(() => new Set());
  const [selectedMetrics, setSelectedMetrics] = useState<Set<MetricKey>>(
    () => new Set(["won_amount", "attainment", "active_amount", "avg_health_all", "win_rate", "avg_days_active"])
  );

  const [reportId, setReportId] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");

  function execIdForRep(repId: string) {
    let cur = String(repId || "");
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const mid = managerIdById.get(cur) || "";
      if (!mid) {
        // cur is top-most ancestor
        return cur;
      }
      cur = mid;
    }
    return "";
  }

  function managerIdForRep(repId: string) {
    return managerIdById.get(String(repId)) || "";
  }

  const selectedReps = useMemo(() => {
    const ids = selectedRepIds;
    const base = ids.size ? reps.filter((r) => ids.has(String(r.rep_id))) : reps.slice(0, 10);
    return base.slice().sort((a, b) => (b.won_amount - a.won_amount) || a.rep_name.localeCompare(b.rep_name));
  }, [reps, selectedRepIds]);

  const selectedTeamsLabel = useMemo(() => {
    const execSet = new Set<string>();
    const mgrSet = new Set<string>();
    for (const r of selectedReps) {
      const eid = execIdForRep(String(r.rep_id));
      const mid = managerIdForRep(String(r.rep_id));
      if (eid) execSet.add(eid);
      if (mid) mgrSet.add(mid);
    }
    const execNames = Array.from(execSet.values()).map((id) => repNameById.get(id) || id);
    const mgrNames = Array.from(mgrSet.values()).map((id) => repNameById.get(id) || id);
    const execLabel = execNames.length === 1 ? execNames[0] : execNames.length ? "Multiple" : "—";
    const mgrLabel = mgrNames.length === 1 ? mgrNames[0] : mgrNames.length ? "Multiple" : "—";
    return { execLabel, mgrLabel };
  }, [selectedReps, repNameById, executiveIds, managerIdById]);

  const metricsAlpha = useMemo(() => METRICS.slice().sort((a, b) => a.label.localeCompare(b.label)), []);
  const labelForMetric = useMemo(() => {
    const m = new Map<MetricKey, string>();
    for (const x of METRICS) m.set(x.key, x.label);
    return m;
  }, []);
  const metricList = useMemo(
    () => Array.from(selectedMetrics.values()).sort((a, b) => (labelForMetric.get(a) || String(a)).localeCompare(labelForMetric.get(b) || String(b))),
    [selectedMetrics, labelForMetric]
  );

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
    setSelectedMetrics(new Set(["won_amount", "attainment", "active_amount", "avg_health_all", "win_rate", "avg_days_active"]));
    setReportId("");
    setName("");
    setDescription("");
    setStatus("");
  }

  async function save() {
    if (!name.trim()) {
      setStatus("Name is required.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const payload = {
        report_type: props.reportType,
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        config: {
          version: 1,
          repIds: Array.from(selectedRepIds.values()),
          metrics: Array.from(selectedMetrics.values()),
        },
      };
      const res = await fetch("/api/analytics/saved-reports", {
        method: reportId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reportId ? { ...payload, id: reportId } : payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Save failed (${res.status})`);
      setStatus(reportId ? "Saved changes." : "Saved.");
      if (!reportId && json?.id) setReportId(String(json.id));
      // easiest refresh: reload page list
      window.location.reload();
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteReport(id: string) {
    if (!id) return;
    if (!window.confirm("Delete this saved report?")) return;
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch(`/api/analytics/saved-reports?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Delete failed (${res.status})`);
      setStatus("Deleted.");
      window.location.reload();
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  function loadReport(r: SavedReportRow) {
    const cfg = normalizeConfig(r.config);
    setSelectedRepIds(new Set(cfg.repIds));
    setSelectedMetrics(
      new Set(cfg.metrics.length ? cfg.metrics : ["won_amount", "attainment", "active_amount", "avg_health_all", "win_rate", "avg_days_active"])
    );
    setReportId(String(r.id || ""));
    setName(String(r.name || ""));
    setDescription(String(r.description || ""));
    setStatus(`Loaded "${r.name}".`);
  }

  const exportRows = useMemo(() => {
    return selectedReps.map((r) => {
      const out: Record<string, any> = {
        rep: r.rep_name,
        team: `Executive: ${selectedTeamsLabel.execLabel} | Manager: ${selectedTeamsLabel.mgrLabel}`,
      };
      for (const k of metricList) {
        out[METRICS.find((m) => m.key === k)?.label || k] = renderMetricValue(k, r);
      }
      return out;
    });
  }, [metricList, selectedReps, selectedTeamsLabel]);

  const groupedSelected = useMemo(() => {
    const byKey = new Map<string, { execId: string; execName: string; mgrId: string; mgrName: string; reps: RepRow[] }>();
    for (const r of selectedReps) {
      const eid = execIdForRep(String(r.rep_id)) || "";
      const mid = managerIdForRep(String(r.rep_id)) || "";
      const execName = eid ? repNameById.get(eid) || `Executive ${eid}` : "(Unassigned)";
      const mgrName = mid ? repNameById.get(mid) || r.manager_name || `Manager ${mid}` : "(Unassigned)";
      const key = `${eid}|${mid}`;
      if (!byKey.has(key)) byKey.set(key, { execId: eid, execName, mgrId: mid, mgrName, reps: [] });
      byKey.get(key)!.reps.push(r);
    }
    const groups = Array.from(byKey.values());
    groups.sort((a, b) => a.execName.localeCompare(b.execName) || a.mgrName.localeCompare(b.mgrName));
    for (const g of groups) g.reps.sort((a, b) => b.won_amount - a.won_amount || a.rep_name.localeCompare(b.rep_name));
    return groups;
  }, [selectedReps, repNameById, managerIdById]);

  const execOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const r of repDirectory) {
      const top = execIdForRep(String(r.id));
      if (top) ids.add(top);
    }
    const arr = Array.from(ids.values());
    arr.sort((a, b) => (repNameById.get(a) || a).localeCompare(repNameById.get(b) || b));
    return arr;
  }, [repDirectory, repNameById, managerIdById]);

  const managerOptions = useMemo(() => {
    const allManagers = managerCandidateIds.filter((id) => !!(managerIdById.get(String(id)) || "")); // exclude execs
    const filtered =
      selectedExecutiveId === "__all__"
        ? allManagers
        : allManagers.filter((mid) => {
            const parent = managerIdById.get(String(mid)) || "";
            return parent === selectedExecutiveId;
          });
    filtered.sort((a, b) => (repNameById.get(a) || a).localeCompare(repNameById.get(b) || b));
    return filtered;
  }, [managerCandidateIds, managerIdById, repNameById, selectedExecutiveId]);

  const repGroupsForPicker = useMemo(() => {
    const execIdsToShow = selectedExecutiveId === "__all__" ? execOptions : [selectedExecutiveId];
    const execGroups: Array<{
      execId: string;
      execName: string;
      execRow: RepRow | null;
      managers: Array<{ managerId: string; managerName: string; members: RepRow[] }>;
    }> = [];

    for (const eid of execIdsToShow) {
      const execName = repNameById.get(eid) || `Executive ${eid}`;
      const execRow = reps.find((r) => String(r.rep_id) === String(eid)) || null;

      const managersForExec = managerCandidateIds
        .filter((mid) => (managerIdById.get(String(mid)) || "") === eid)
        .filter((mid) => selectedManagerId === "__all__" || String(mid) === String(selectedManagerId));

      const managers = managersForExec
        .map((mid) => {
          const managerName = repNameById.get(String(mid)) || `Manager ${mid}`;
          const members = reps
            .filter((r) => {
              const rid = String(r.rep_id);
              return rid === String(mid) || managerIdForRep(rid) === String(mid);
            })
            .slice()
            .sort((a, b) => a.rep_name.localeCompare(b.rep_name));
          return { managerId: String(mid), managerName, members };
        })
        .filter((g) => g.members.length);

      // If no managers found (IC exec or incomplete hierarchy), still show any reps that roll up to this exec.
      if (!managers.length) {
        const members = reps
          .filter((r) => execIdForRep(String(r.rep_id)) === eid)
          .slice()
          .sort((a, b) => a.rep_name.localeCompare(b.rep_name));
        if (members.length) managers.push({ managerId: "", managerName: "(Unassigned)", members });
      }

      execGroups.push({ execId: eid, execName, execRow, managers });
    }

    execGroups.sort((a, b) => a.execName.localeCompare(b.execName));
    return execGroups;
  }, [execOptions, managerCandidateIds, managerIdById, repNameById, reps, selectedExecutiveId, selectedManagerId]);

  return (
    <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Designer</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Period: {props.periodLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportToExcelButton fileName={`Custom Report - ${props.periodLabel}`} sheets={[{ name: "Report", rows: exportRows }]} />
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
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Saved reports</div>
            <div className="text-xs text-[color:var(--sf-text-secondary)]">{saved.length} saved</div>
          </div>
          <div className="mt-2 max-h-[240px] overflow-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
            <ul className="divide-y divide-[color:var(--sf-border)]">
              {saved.length ? (
                saved.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[color:var(--sf-text-primary)]">{r.name}</div>
                      <div className="truncate text-xs text-[color:var(--sf-text-secondary)]">{r.description || ""}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => loadReport(r)}
                        className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteReport(String(r.id))}
                        className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs text-red-700 hover:bg-[color:var(--sf-surface-alt)]"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))
              ) : (
                <li className="px-3 py-6 text-center text-sm text-[color:var(--sf-text-disabled)]">No saved reports yet.</li>
              )}
            </ul>
          </div>

          <div className="mt-3 grid gap-2">
            <div className="grid gap-1">
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Report name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                placeholder="e.g. QBR rep comparison"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[72px] w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                placeholder="What is this report for?"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void save()}
                className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-60"
              >
                {reportId ? "Save changes" : "Save report"}
              </button>
              {reportId ? (
                <span className="text-xs text-[color:var(--sf-text-secondary)]">
                  Editing saved report id <span className="font-mono">{reportId.slice(0, 8)}…</span>
                </span>
              ) : null}
              {status ? <span className="text-xs text-[color:var(--sf-text-secondary)]">{status}</span> : null}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Reps</div>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Executive</label>
              <select
                value={selectedExecutiveId}
                onChange={(e) => {
                  setSelectedExecutiveId(e.target.value);
                  setSelectedManagerId("__all__");
                }}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                <option value="__all__">(all)</option>
                {execOptions.map((id) => (
                  <option key={id} value={id}>
                    {repNameById.get(id) || `Executive ${id}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Manager</label>
              <select
                value={selectedManagerId}
                onChange={(e) => setSelectedManagerId(e.target.value)}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                <option value="__all__">(all)</option>
                {managerOptions.map((id) => (
                  <option key={id} value={id}>
                    {repNameById.get(id) || `Manager ${id}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-2 max-h-[420px] overflow-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
            <ul className="divide-y divide-[color:var(--sf-border)]">
              {repGroupsForPicker.map((eg) => (
                <li key={`exec:${eg.execId}`} className="p-0">
                  <div className="bg-[color:var(--sf-surface-alt)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)]">
                    Executive: {eg.execName}
                  </div>
                  {eg.execRow ? (
                    <div className="flex items-center justify-between gap-3 px-3 py-2">
                      <label className="flex min-w-0 items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
                        <input
                          type="checkbox"
                          checked={selectedRepIds.has(String(eg.execRow.rep_id))}
                          onChange={() => toggleRep(String(eg.execRow!.rep_id))}
                        />
                        <span className="truncate">
                          {eg.execRow.rep_name} <span className="text-xs text-[color:var(--sf-text-secondary)]">(Executive)</span>
                        </span>
                      </label>
                      <span className="shrink-0 font-mono text-xs text-[color:var(--sf-text-secondary)]">{fmtMoney(eg.execRow.won_amount)}</span>
                    </div>
                  ) : null}
                  {eg.managers.map((mg) => (
                    <div key={`mgr:${eg.execId}:${mg.managerId || "unassigned"}`}>
                      <div className="bg-[color:var(--sf-surface)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)]">
                        Manager: {mg.managerName}
                      </div>
                      {mg.members.map((r) => (
                        <div key={`rep:${eg.execId}:${mg.managerId || "unassigned"}:${r.rep_id}`} className="flex items-center justify-between gap-3 px-3 py-2">
                          <label className="flex min-w-0 items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
                            <input type="checkbox" checked={selectedRepIds.has(String(r.rep_id))} onChange={() => toggleRep(String(r.rep_id))} />
                            <span className="truncate">{r.rep_name}</span>
                          </label>
                          <span className="shrink-0 font-mono text-xs text-[color:var(--sf-text-secondary)]">{fmtMoney(r.won_amount)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </li>
              ))}
              {!repGroupsForPicker.length ? (
                <li className="px-3 py-6 text-center text-sm text-[color:var(--sf-text-disabled)]">No reps found.</li>
              ) : null}
            </ul>
          </div>
          <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
            If you don’t select any reps, the preview defaults to the top 10 by Closed Won.
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
        <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Report fields</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {metricsAlpha.map((m) => {
            const checked = selectedMetrics.has(m.key);
            return (
              <label key={m.key} className="flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
                <input type="checkbox" checked={checked} onChange={() => toggleMetric(m.key)} />
                <span>{m.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
        <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Preview</div>
        <div className="text-xs text-[color:var(--sf-text-secondary)]">
          Executive: <span className="font-mono">{selectedTeamsLabel.execLabel}</span> · Manager:{" "}
          <span className="font-mono">{selectedTeamsLabel.mgrLabel}</span>
        </div>
      </div>
      <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">rep</th>
              {metricList.map((k) => (
                <th key={k} className="px-4 py-3 text-right">
                  {METRICS.find((m) => m.key === k)?.label || k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupedSelected.map((g) => (
              <Fragment key={`grp:${g.execId}:${g.mgrId}`}>
                <tr className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                  <td colSpan={1 + metricList.length} className="px-4 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)]">
                    Executive: {g.execName} · Manager: {g.mgrName}
                  </td>
                </tr>
                {g.reps.map((r) => (
                  <tr key={`rep:${g.execId}:${g.mgrId}:${r.rep_id}`} className="border-t border-[color:var(--sf-border)]">
                    <td className="px-4 py-3 font-medium text-[color:var(--sf-text-primary)]">{r.rep_name}</td>
                    {metricList.map((k) => (
                      <td key={k} className="px-4 py-3 text-right font-mono text-xs text-[color:var(--sf-text-primary)]">
                        {renderMetricValue(k, r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
            {!selectedReps.length ? (
              <tr>
                <td colSpan={1 + metricList.length} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
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

