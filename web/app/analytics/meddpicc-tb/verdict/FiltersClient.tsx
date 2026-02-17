"use client";

import { useMemo, useState } from "react";

type PeriodLite = {
  id: string;
  fiscal_year: string;
  fiscal_quarter: string;
  period_name: string;
  period_start: string;
  period_end: string;
};

type RepDirectoryRow = {
  id: number;
  name: string;
  role: string | null;
  manager_rep_id: number | null;
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

function normalizeConfig(cfg: any): { quotaPeriodId: string; teamIds: string[]; repIds: string[] } {
  const quotaPeriodId = String(cfg?.quotaPeriodId || "").trim();
  const teamIds = Array.isArray(cfg?.teamIds) ? cfg.teamIds.map((x: any) => String(x)).filter(Boolean) : [];
  const repIds = Array.isArray(cfg?.repIds) ? cfg.repIds.map((x: any) => String(x)).filter(Boolean) : [];
  return { quotaPeriodId, teamIds, repIds };
}

function dedupeStr(ids: string[]) {
  return Array.from(new Set((ids || []).map((x) => String(x || "").trim()).filter(Boolean)));
}

export function VerdictFiltersClient(props: {
  basePath: string;
  periodLabel: string;
  periods: PeriodLite[];
  repDirectory: RepDirectoryRow[];
  savedReports: SavedReportRow[];
  initialQuotaPeriodId: string;
  initialTeamIds: string[];
  initialRepIds: string[];
  initialSavedReportId: string;
}) {
  const periods = props.periods || [];
  const reps = props.repDirectory || [];
  const saved = props.savedReports || [];

  const [quotaPeriodId, setQuotaPeriodId] = useState<string>(() => String(props.initialQuotaPeriodId || ""));
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(() => new Set(dedupeStr(props.initialTeamIds)));
  const [selectedRepIds, setSelectedRepIds] = useState<Set<string>>(() => new Set(dedupeStr(props.initialRepIds)));

  const [reportId, setReportId] = useState<string>(() => String(props.initialSavedReportId || ""));
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [savedPickId, setSavedPickId] = useState<string>(() => String(props.initialSavedReportId || ""));
  const [showReportMeta, setShowReportMeta] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");

  const execOptions = useMemo(() => reps.filter((r) => String(r.role || "").toUpperCase() === "EXEC_MANAGER"), [reps]);
  const managerOptions = useMemo(() => reps.filter((r) => String(r.role || "").toUpperCase() === "MANAGER"), [reps]);
  const repOptions = useMemo(() => reps.filter((r) => String(r.role || "").toUpperCase() === "REP"), [reps]);

  const managersByExec = useMemo(() => {
    const m = new Map<string, RepDirectoryRow[]>();
    for (const mgr of managerOptions) {
      const eid = mgr.manager_rep_id == null ? "" : String(mgr.manager_rep_id);
      const list = m.get(eid) || [];
      list.push(mgr);
      m.set(eid, list);
    }
    for (const [k, v] of m.entries()) {
      v.sort((a, b) => a.name.localeCompare(b.name));
      m.set(k, v);
    }
    return m;
  }, [managerOptions]);

  const repsByManager = useMemo(() => {
    const m = new Map<string, RepDirectoryRow[]>();
    for (const rep of repOptions) {
      const mid = rep.manager_rep_id == null ? "" : String(rep.manager_rep_id);
      const list = m.get(mid) || [];
      list.push(rep);
      m.set(mid, list);
    }
    for (const [k, v] of m.entries()) {
      v.sort((a, b) => a.name.localeCompare(b.name));
      m.set(k, v);
    }
    return m;
  }, [repOptions]);

  const loadedSavedConfig = useMemo(() => {
    const r = savedPickId ? saved.find((x) => String(x.id) === String(savedPickId)) || null : null;
    return r ? normalizeConfig(r.config) : null;
  }, [saved, savedPickId]);

  const isDirty = useMemo(() => {
    if (!loadedSavedConfig) return selectedTeamIds.size > 0 || selectedRepIds.size > 0 || Boolean(quotaPeriodId);
    const curTeam = dedupeStr(Array.from(selectedTeamIds.values())).sort();
    const curRep = dedupeStr(Array.from(selectedRepIds.values())).sort();
    const savedTeam = dedupeStr(loadedSavedConfig.teamIds).sort();
    const savedRep = dedupeStr(loadedSavedConfig.repIds).sort();
    const qpMatch = String(loadedSavedConfig.quotaPeriodId || "") === String(quotaPeriodId || "");
    return !qpMatch || curTeam.join(",") !== savedTeam.join(",") || curRep.join(",") !== savedRep.join(",");
  }, [loadedSavedConfig, quotaPeriodId, selectedTeamIds, selectedRepIds]);

  function toggleTeam(id: string) {
    const key = String(id || "").trim();
    if (!key) return;
    setSelectedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleRep(id: string) {
    const key = String(id || "").trim();
    if (!key) return;
    setSelectedRepIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function clearSelection() {
    setSelectedTeamIds(new Set());
    setSelectedRepIds(new Set());
    setReportId("");
    setName("");
    setDescription("");
    setSavedPickId("");
    setStatus("");
  }

  function buildUrl(useSavedIdOnly: boolean) {
    const sp = new URLSearchParams();
    if (quotaPeriodId) sp.set("quota_period_id", quotaPeriodId);

    if (useSavedIdOnly && savedPickId) {
      sp.set("saved_report_id", savedPickId);
      return `${props.basePath}?${sp.toString()}`;
    }

    for (const id of Array.from(selectedTeamIds.values())) sp.append("team_id", id);
    for (const id of Array.from(selectedRepIds.values())) sp.append("rep_id", id);
    return sp.toString() ? `${props.basePath}?${sp.toString()}` : props.basePath;
  }

  function apply() {
    const url = savedPickId && !isDirty ? buildUrl(true) : buildUrl(false);
    window.location.href = url;
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
        report_type: "verdict_filters_v1",
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        config: {
          version: 1,
          quotaPeriodId: quotaPeriodId || "",
          teamIds: Array.from(selectedTeamIds.values()),
          repIds: Array.from(selectedRepIds.values()),
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
    setQuotaPeriodId(cfg.quotaPeriodId || quotaPeriodId);
    setSelectedTeamIds(new Set(dedupeStr(cfg.teamIds)));
    setSelectedRepIds(new Set(dedupeStr(cfg.repIds)));
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

  const periodLabel = props.periodLabel || "—";

  return (
    <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Designer</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Period: {periodLabel}</p>
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
          <button
            type="button"
            onClick={apply}
            className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
          >
            Apply
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
                placeholder="e.g. FY26 Q3 focus team"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[42px] w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                placeholder="What is this selection for?"
              />
            </div>
          </div>
          {status ? <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">{status}</div> : null}
        </div>
      ) : status ? (
        <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">{status}</div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <section className="lg:col-span-4">
          <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
            <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Quarter</div>
            <div className="mt-2 grid gap-1">
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Quota period</label>
              <select
                value={quotaPeriodId}
                onChange={(e) => setQuotaPeriodId(String(e.target.value || ""))}
                className="h-[40px] w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                {periods.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {(String(p.period_name || "").trim() || `${p.period_start} → ${p.period_end}`) + ` (FY${p.fiscal_year} Q${p.fiscal_quarter})`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="lg:col-span-8">
          <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
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
                  onClick={() => void deleteReport(String(savedPickId))}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)] disabled:opacity-50"
                >
                  Delete saved
                </button>
              </div>
            </div>

            <div className="mt-2 max-h-[520px] overflow-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
              <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2">
                {(execOptions.length ? execOptions : [{ id: 0, name: "(Unassigned)", role: "EXEC_MANAGER", manager_rep_id: null }]).map((ex) => {
                  const exId = String(ex.id || "");
                  const execChecked = selectedTeamIds.has(exId);
                  const mgrs = managersByExec.get(exId) || [];
                  return (
                    <div key={`exec:${exId || "unassigned"}`} className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
                      <div className="flex items-center gap-3 border-b border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
                        <label className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--sf-text-primary)]">
                          <input
                            type="checkbox"
                            checked={execChecked}
                            onChange={() => toggleTeam(exId)}
                            disabled={!exId || exId === "0"}
                          />
                          <span className="truncate">Executive: {ex.name}</span>
                        </label>
                      </div>

                      <div className="grid gap-2 p-2">
                        {(mgrs.length ? mgrs : [{ id: 0, name: "(Unassigned)", role: "MANAGER", manager_rep_id: Number(ex.id) || null }]).map((m) => {
                          const mid = String(m.id || "");
                          const mgrChecked = selectedTeamIds.has(mid);
                          const repsForMgr = repsByManager.get(mid) || [];
                          return (
                            <div
                              key={`mgr:${exId}:${mid || "unassigned"}`}
                              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]"
                            >
                              <div className="flex items-center gap-3 border-b border-[color:var(--sf-border)] px-3 py-2">
                                <label className="flex min-w-0 items-center gap-2 text-sm font-medium text-[color:var(--sf-text-primary)]">
                                  <input
                                    type="checkbox"
                                    checked={mgrChecked}
                                    onChange={() => toggleTeam(mid)}
                                    disabled={!mid || mid === "0"}
                                  />
                                  <span className="truncate">Manager: {m.name}</span>
                                </label>
                              </div>

                              <div className="divide-y divide-[color:var(--sf-border)]">
                                {(repsForMgr.length ? repsForMgr : [{ id: 0, name: "(No reps)", role: "REP", manager_rep_id: Number(m.id) || null }]).map((r) => {
                                  const rid = String(r.id || "");
                                  const repChecked = selectedRepIds.has(rid);
                                  return (
                                    <div key={`rep:${exId}:${mid}:${rid || "0"}`} className="flex items-center gap-3 px-3 py-2">
                                      <label className="flex min-w-0 items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
                                        <input
                                          type="checkbox"
                                          checked={repChecked}
                                          onChange={() => toggleRep(rid)}
                                          disabled={!rid || rid === "0"}
                                        />
                                        <span className="truncate">{r.name}</span>
                                      </label>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {!reps.length ? <div className="px-3 py-6 text-center text-sm text-[color:var(--sf-text-disabled)]">No reps found.</div> : null}
              </div>
            </div>
            <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
              Tip: check an Executive or Manager to include their whole team; optionally pick individual reps too.
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

