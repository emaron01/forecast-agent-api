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
  { key: "avg_days_active", label: "Aging (avg days)" },
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
  if (key.startsWith("avg_days_")) return v == null ? "—" : String(Math.round(Number(v)));
  return fmtNum(v);
}

function safeNum(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function wavg(pairs: Array<{ v: number | null; w: number }>) {
  let num = 0;
  let den = 0;
  for (const p of pairs) {
    if (p.v == null) continue;
    const w = safeNum(p.w);
    if (w <= 0) continue;
    num += safeNum(p.v) * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

function rollupRepRows(args: { label: string; execName: string; managerName: string; rows: RepRow[] }): RepRow {
  const rows = args.rows || [];
  const sum = <K extends keyof RepRow>(key: K) => rows.reduce((acc, r) => acc + safeNum((r as any)[key]), 0);

  const quota = sum("quota");
  const total_count = sum("total_count");
  const won_amount = sum("won_amount");
  const won_count = sum("won_count");
  const lost_count = sum("lost_count");
  const active_amount = sum("active_amount");
  const commit_amount = sum("commit_amount");
  const best_amount = sum("best_amount");
  const pipeline_amount = sum("pipeline_amount");
  const created_amount = sum("created_amount");
  const created_count = sum("created_count");

  const active_count = Math.max(0, total_count - won_count - lost_count);
  const closed_count = won_count + lost_count;

  const win_rate = won_count + lost_count > 0 ? won_count / (won_count + lost_count) : null;
  const opp_to_win = total_count > 0 ? won_count / total_count : null;
  const aov = won_count > 0 ? won_amount / won_count : null;
  const attainment = quota > 0 ? won_amount / quota : null;
  const commit_coverage = quota > 0 ? commit_amount / quota : null;
  const best_coverage = quota > 0 ? best_amount / quota : null;

  const partner_contribution = wavg(rows.map((r) => ({ v: r.partner_contribution, w: safeNum(r.won_amount) })));
  const partner_win_rate = wavg(rows.map((r) => ({ v: r.partner_win_rate, w: safeNum(r.won_count) + safeNum(r.lost_count) })));

  const avg_days_won = wavg(rows.map((r) => ({ v: r.avg_days_won, w: safeNum(r.won_count) })));
  const avg_days_lost = wavg(rows.map((r) => ({ v: r.avg_days_lost, w: safeNum(r.lost_count) })));
  const avg_days_active = wavg(
    rows.map((r) => {
      const tc = safeNum(r.total_count);
      const wc = safeNum(r.won_count);
      const lc = safeNum(r.lost_count);
      const ac = Math.max(0, tc - wc - lc);
      return { v: r.avg_days_active, w: ac };
    })
  );

  const avg_health_all = wavg(rows.map((r) => ({ v: r.avg_health_all, w: safeNum(r.total_count) })));
  const avg_health_won = wavg(rows.map((r) => ({ v: r.avg_health_won, w: safeNum(r.won_count) })));
  const avg_health_closed = wavg(rows.map((r) => ({ v: r.avg_health_closed, w: safeNum(r.won_count) + safeNum(r.lost_count) })));
  const avg_health_pipeline = wavg(
    rows.map((r) => {
      const tc = safeNum(r.total_count);
      const wc = safeNum(r.won_count);
      const lc = safeNum(r.lost_count);
      const ac = Math.max(0, tc - wc - lc);
      return { v: r.avg_health_pipeline, w: ac };
    })
  );
  const avg_health_commit = wavg(
    rows.map((r) => {
      const tc = safeNum(r.total_count);
      const wc = safeNum(r.won_count);
      const lc = safeNum(r.lost_count);
      const ac = Math.max(0, tc - wc - lc);
      return { v: r.avg_health_commit, w: ac };
    })
  );
  const avg_health_best = wavg(
    rows.map((r) => {
      const tc = safeNum(r.total_count);
      const wc = safeNum(r.won_count);
      const lc = safeNum(r.lost_count);
      const ac = Math.max(0, tc - wc - lc);
      return { v: r.avg_health_best, w: ac };
    })
  );

  const mixDen = pipeline_amount + best_amount + commit_amount + won_amount;
  const mix_pipeline = mixDen > 0 ? pipeline_amount / mixDen : null;
  const mix_best = mixDen > 0 ? best_amount / mixDen : null;
  const mix_commit = mixDen > 0 ? commit_amount / mixDen : null;
  const mix_won = mixDen > 0 ? won_amount / mixDen : null;

  return {
    rep_id: "",
    rep_name: args.label,
    manager_id: "",
    manager_name: args.managerName,
    avg_health_all,
    avg_health_commit,
    avg_health_best,
    avg_health_pipeline,
    avg_health_won,
    avg_health_closed,
    quota,
    total_count,
    won_amount,
    won_count,
    lost_count,
    active_amount,
    commit_amount,
    best_amount,
    pipeline_amount,
    created_amount,
    created_count,
    win_rate,
    opp_to_win,
    aov,
    attainment,
    commit_coverage,
    best_coverage,
    partner_contribution,
    partner_win_rate,
    avg_days_won,
    avg_days_lost,
    avg_days_active,
    mix_pipeline,
    mix_best,
    mix_commit,
    mix_won,
  };
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

  const [selectedRepIds, setSelectedRepIds] = useState<Set<string>>(() => new Set());
  const [selectedMetrics, setSelectedMetrics] = useState<Set<MetricKey>>(
    () => new Set(["won_amount", "attainment", "active_amount", "avg_health_all", "win_rate", "avg_days_active"])
  );

  const [reportId, setReportId] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [savedPickId, setSavedPickId] = useState<string>("");
  const [showReportMeta, setShowReportMeta] = useState<boolean>(false);
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

  function setRepIdsChecked(ids: string[], checked: boolean) {
    const deduped = Array.from(new Set(ids.filter(Boolean).map(String)));
    if (!deduped.length) return;
    setSelectedRepIds((prev) => {
      const next = new Set(prev);
      for (const id of deduped) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function areAllRepIdsChecked(ids: string[]) {
    const deduped = Array.from(new Set(ids.filter(Boolean).map(String)));
    if (!deduped.length) return false;
    for (const id of deduped) if (!selectedRepIds.has(id)) return false;
    return true;
  }

  function toggleMetric(k: MetricKey) {
    setSelectedMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function clearSelection() {
    setSelectedRepIds(new Set());
    setSelectedMetrics(new Set(["won_amount", "attainment", "active_amount", "avg_health_all", "win_rate", "avg_days_active"]));
    setReportId("");
    setName("");
    setDescription("");
    setSavedPickId("");
    setStatus("");
  }

  async function save() {
    if (!name.trim()) {
      setStatus("Name is required.");
      setShowReportMeta(true);
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
    setSavedPickId(String(r.id || ""));
    setStatus(`Loaded "${r.name}".`);
  }

  function startNewSavedReport() {
    setReportId("");
    setName("");
    setDescription("");
    setSavedPickId("");
    setStatus("");
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

  const rollupsByExecId = useMemo(() => {
    const m = new Map<string, RepRow>();
    const byExec = new Map<string, RepRow[]>();
    for (const g of groupedSelected) {
      const arr = byExec.get(g.execId) || [];
      arr.push(...g.reps);
      byExec.set(g.execId, arr);
    }
    for (const [execId, rows] of byExec.entries()) {
      const execName = execId ? repNameById.get(execId) || `Executive ${execId}` : "(Unassigned)";
      m.set(execId, rollupRepRows({ label: `Executive Total: ${execName}`, execName, managerName: "", rows }));
    }
    return m;
  }, [groupedSelected, repNameById]);

  const rollupsByExecMgrKey = useMemo(() => {
    const m = new Map<string, RepRow>();
    for (const g of groupedSelected) {
      const key = `${g.execId}|${g.mgrId}`;
      m.set(key, rollupRepRows({ label: `Manager Total: ${g.mgrName}`, execName: g.execName, managerName: g.mgrName, rows: g.reps }));
    }
    return m;
  }, [groupedSelected]);

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

  type PickerManagerGroup = {
    managerId: string;
    managerName: string;
    managerRow: RepRow | null;
    members: RepRow[];
  };

  type PickerExecGroup = {
    execId: string;
    execName: string;
    execRow: RepRow | null;
    managers: PickerManagerGroup[];
  };

  const repGroupsForPicker = useMemo<PickerExecGroup[]>(() => {
    const execGroups: PickerExecGroup[] = [];

    for (const eid of execOptions) {
      const execName = repNameById.get(eid) || `Executive ${eid}`;
      const execRow = reps.find((r) => String(r.rep_id) === String(eid)) || null;

      // Managers that directly report to this exec.
      const managersForExec = managerCandidateIds
        .filter((mid) => (managerIdById.get(String(mid)) || "") === eid)
        .slice()
        .sort((a, b) => (repNameById.get(a) || a).localeCompare(repNameById.get(b) || b));

      const managers: PickerManagerGroup[] = managersForExec
        .map((mid) => {
          const managerName = repNameById.get(String(mid)) || `Manager ${mid}`;
          const managerRow = reps.find((r) => String(r.rep_id) === String(mid)) || null;
          const members = reps
            .filter((r) => managerIdForRep(String(r.rep_id)) === String(mid))
            .slice()
            .sort((a, b) => a.rep_name.localeCompare(b.rep_name));
          return { managerId: String(mid), managerName, managerRow, members };
        })
        .filter((g) => g.managerRow || g.members.length);

      // If no manager rows found (IC exec or incomplete hierarchy), still show any reps that roll up to this exec.
      if (!managers.length) {
        const members = reps
          .filter((r) => execIdForRep(String(r.rep_id)) === eid)
          .slice()
          .sort((a, b) => a.rep_name.localeCompare(b.rep_name));
        if (members.length) {
          managers.push({ managerId: "", managerName: "(Unassigned)", managerRow: null, members });
        }
      }

      execGroups.push({ execId: eid, execName, execRow, managers });
    }

    execGroups.sort((a, b) => a.execName.localeCompare(b.execName));
    return execGroups;
  }, [execOptions, managerCandidateIds, managerIdById, repNameById, reps]);

  return (
    <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Designer</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Period: {props.periodLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={savedPickId}
            onChange={(e) => {
              const id = String(e.target.value || "");
              setSavedPickId(id);
              if (!id) {
                startNewSavedReport();
                return;
              }
              const r = saved.find((x) => String(x.id) === id) || null;
              if (r) loadReport(r);
            }}
            className="h-[40px] min-w-[220px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
          >
            <option value="">Select saved report…</option>
            {saved.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowReportMeta((v) => !v)}
            className="h-[40px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface)]"
          >
            Title/Description {showReportMeta ? "▲" : "▼"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-60"
          >
            {reportId ? "Save changes" : "Save report"}
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

      {showReportMeta ? (
        <div className="mt-3 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-1">
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Report title</label>
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
                className="min-h-[42px] w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                placeholder="What is this report for?"
              />
            </div>
          </div>
          {status ? <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">{status}</div> : null}
        </div>
      ) : status ? (
        <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">{status}</div>
      ) : null}

      <div className="mt-4 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Reps</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={startNewSavedReport}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface)]"
            >
              New saved
            </button>
            <button
              type="button"
              disabled={!savedPickId}
              onClick={() => deleteReport(String(savedPickId))}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)] disabled:opacity-50"
            >
              Delete saved
            </button>
          </div>
        </div>
        <div className="mt-2 max-h-[420px] overflow-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
          <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2 lg:grid-cols-3">
            {repGroupsForPicker.map((eg) => {
              const execTeamIds = reps
                .filter((r) => execIdForRep(String(r.rep_id)) === String(eg.execId))
                .map((r) => String(r.rep_id));
              const execChecked = areAllRepIdsChecked(execTeamIds);

              return (
                <div key={`exec:${eg.execId}`} className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
                  <div className="flex items-center gap-3 border-b border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                    <label className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--sf-text-primary)]">
                      <input
                        type="checkbox"
                        checked={execChecked}
                        onChange={() => setRepIdsChecked(execTeamIds, !execChecked)}
                        disabled={!execTeamIds.length}
                      />
                      <span className="truncate">Executive: {eg.execName}</span>
                    </label>
                  </div>

                  <div className="grid gap-2 p-2">
                    {eg.managers.map((mg) => {
                      const managerTeamIds = Array.from(
                        new Set([String(mg.managerId || ""), ...mg.members.map((r) => String(r.rep_id))].filter(Boolean))
                      );
                      const managerChecked = areAllRepIdsChecked(managerTeamIds);

                      return (
                        <div
                          key={`mgr:${eg.execId}:${mg.managerId || "unassigned"}`}
                          className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]"
                        >
                          <div className="flex items-center gap-3 border-b border-[color:var(--sf-border)] px-3 py-2">
                            <label className="flex min-w-0 items-center gap-2 text-sm font-medium text-[color:var(--sf-text-primary)]">
                              <input
                                type="checkbox"
                                checked={managerChecked}
                                onChange={() => setRepIdsChecked(managerTeamIds, !managerChecked)}
                                disabled={!managerTeamIds.length}
                              />
                              <span className="truncate">{mg.managerId ? `Manager: ${mg.managerName}` : `Team: ${mg.managerName}`}</span>
                            </label>
                          </div>

                          <div className="divide-y divide-[color:var(--sf-border)]">
                            {mg.members.map((r) => (
                              <div key={`rep:${eg.execId}:${mg.managerId || "unassigned"}:${r.rep_id}`} className="flex items-center gap-3 px-3 py-2">
                                <label className="flex min-w-0 items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
                                  <input type="checkbox" checked={selectedRepIds.has(String(r.rep_id))} onChange={() => toggleRep(String(r.rep_id))} />
                                  <span className="truncate">{r.rep_name}</span>
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {!repGroupsForPicker.length ? (
              <div className="px-3 py-6 text-center text-sm text-[color:var(--sf-text-disabled)]">No reps found.</div>
            ) : null}
          </div>
        </div>
          <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
            If you don’t select any reps, the preview defaults to the top 10 by Closed Won.
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

      <div className="mt-4 grid grid-cols-3 items-end gap-2">
        <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Preview</div>
        <div className="text-sm font-semibold text-center text-[color:var(--sf-text-secondary)]">{props.periodLabel}</div>
        <div className="text-sm font-semibold text-right text-[color:var(--sf-text-secondary)]">
          Executive: <span className="font-mono">{selectedTeamsLabel.execLabel}</span> · Manager: <span className="font-mono">{selectedTeamsLabel.mgrLabel}</span>
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
            {groupedSelected.map((g, idx) => {
              const prevExecId = idx > 0 ? groupedSelected[idx - 1]?.execId : null;
              const showExecSubtotal = idx === 0 || String(prevExecId) !== String(g.execId);
              const execSubtotal = rollupsByExecId.get(g.execId) || null;
              const mgrSubtotal = rollupsByExecMgrKey.get(`${g.execId}|${g.mgrId}`) || null;
              return (
                <Fragment key={`grp:${g.execId}:${g.mgrId}`}>
                  {showExecSubtotal && execSubtotal ? (
                    <tr className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                      <td className="px-4 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)]">{execSubtotal.rep_name}</td>
                      {metricList.map((k) => (
                        <td key={k} className="px-4 py-2 text-right font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">
                          {renderMetricValue(k, execSubtotal)}
                        </td>
                      ))}
                    </tr>
                  ) : null}

                  {mgrSubtotal ? (
                    <tr className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
                      <td className="px-4 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)]">
                        Executive: {g.execName} · {mgrSubtotal.rep_name}
                      </td>
                      {metricList.map((k) => (
                        <td key={k} className="px-4 py-2 text-right font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">
                          {renderMetricValue(k, mgrSubtotal)}
                        </td>
                      ))}
                    </tr>
                  ) : null}

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
              );
            })}
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

      <div className="mt-3 flex items-center justify-end">
        <ExportToExcelButton fileName={`Custom Report - ${props.periodLabel}`} sheets={[{ name: "Report", rows: exportRows }]} />
      </div>
    </section>
  );
}

