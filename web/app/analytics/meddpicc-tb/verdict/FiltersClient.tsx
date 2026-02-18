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

type SavedReportRow = {
  id: string;
  report_type: string;
  name: string;
  description: string | null;
  config: any;
  created_at?: string;
  updated_at?: string;
};

function normalizeConfig(cfg: any): { quotaPeriodId: string } {
  const quotaPeriodId = String(cfg?.quotaPeriodId || "").trim();
  return { quotaPeriodId };
}

export function VerdictFiltersClient(props: {
  basePath: string;
  periodLabel: string;
  periods: PeriodLite[];
  savedReports: SavedReportRow[];
  initialQuotaPeriodId: string;
  initialSavedReportId: string;
}) {
  const periods = props.periods || [];
  const saved = props.savedReports || [];

  const [quotaPeriodId, setQuotaPeriodId] = useState<string>(() => String(props.initialQuotaPeriodId || ""));

  const [reportId, setReportId] = useState<string>(() => String(props.initialSavedReportId || ""));
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [savedPickId, setSavedPickId] = useState<string>(() => String(props.initialSavedReportId || ""));
  const [showReportMeta, setShowReportMeta] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");

  const loadedSavedConfig = useMemo(() => {
    const r = savedPickId ? saved.find((x) => String(x.id) === String(savedPickId)) || null : null;
    return r ? normalizeConfig(r.config) : null;
  }, [saved, savedPickId]);

  const isDirty = useMemo(() => {
    if (!loadedSavedConfig) return Boolean(quotaPeriodId);
    return String(loadedSavedConfig.quotaPeriodId || "") !== String(quotaPeriodId || "");
  }, [loadedSavedConfig, quotaPeriodId]);

  function clearSelection() {
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
          version: 2,
          quotaPeriodId: quotaPeriodId || "",
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
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Filters</h2>
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
            onClick={startNewSavedReport}
            className="h-[40px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface)]"
          >
            New saved
          </button>
          <button
            type="button"
            disabled={!savedPickId || busy}
            onClick={() => void deleteReport(String(savedPickId))}
            className="h-[40px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)] disabled:opacity-50"
          >
            Delete saved
          </button>
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
                placeholder="e.g. FY26 Q3"
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

      <div className="mt-4 grid gap-4">
        <section>
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
      </div>
    </section>
  );
}

