"use client";

import { useState, useEffect } from "react";
import * as XLSX from "xlsx";

type ApiResponse = {
  ok: boolean;
  mode?: "async";
  jobId?: string;
  rowCount?: number;
  commentsDetected?: number;
  counts?: { total: number; ok: number; error: number; skipped_out_of_scope?: number; skipped_baseline_exists?: number };
  error?: string;
};

const ID_CANDIDATES = ["crm_opp_id", "crm opp id", "opportunity id", "opportunity_id", "id"];
const COMMENTS_CANDIDATES = ["comments", "notes", "comment", "note", "raw_text", "activity notes", "description", "deal comments"];

function guessColumn(headers: string[], candidates: string[]): string {
  const lower = (s: string) => String(s || "").toLowerCase().trim();
  for (const c of candidates) {
    const k = headers.find((x) => lower(x) === lower(c) || lower(x).includes(lower(c)));
    if (k) return k;
  }
  return headers[0] ?? "";
}

export function ExcelCommentsUploadClient() {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<any[]>([]);
  const [idColumn, setIdColumn] = useState("");
  const [commentsColumn, setCommentsColumn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [stagedJob, setStagedJob] = useState<{ jobId: string; rowCount: number; commentsDetected: number } | null>(null);
  const [jobProgress, setJobProgress] = useState<{
    state: string;
    progress: number | null;
    counts: { processed: number; ok: number; skipped: number; skipped_out_of_scope: number; skipped_baseline_exists: number; failed: number };
  } | null>(null);

  useEffect(() => {
    if (!stagedJob?.jobId) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/ingest/jobs/${stagedJob.jobId}`);
        const data = await res.json().catch(() => ({}));
        if (!data.ok) return;
        const c = data.counts ?? {};
        setJobProgress({
          state: data.state,
          progress: data.progress,
          counts: {
            processed: c.processed ?? 0,
            ok: c.ok ?? 0,
            skipped: c.skipped ?? 0,
            skipped_out_of_scope: c.skipped_out_of_scope ?? 0,
            skipped_baseline_exists: c.skipped_baseline_exists ?? 0,
            failed: c.failed ?? 0,
          },
        });
        if (data.state === "completed" || data.state === "failed") {
          setStagedJob(null);
          setJobProgress(null);
          if (data.state === "completed") {
            setResponse({
              ok: true,
              counts: {
                total: c.processed ?? 0,
                ok: (c.ok ?? 0) + (c.skipped ?? 0),
                error: c.failed ?? 0,
              },
            });
          } else if (data.state === "failed") {
            setError(data.failedReason ?? "Job failed");
          }
        }
      } catch {
        /* ignore */
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [stagedJob?.jobId]);

  const onFileSelect = (f: File | null) => {
    setFile(f);
    setError("");
    setResponse(null);
    setStagedJob(null);
    setJobProgress(null);
    setHeaders([]);
    setPreview([]);
    setIdColumn("");
    setCommentsColumn("");
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result;
      if (!data) return;
      try {
        const wb = XLSX.read(data, { type: "array" });
        const sheetName = wb.SheetNames?.[0];
        if (!sheetName) return;
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: null }) as any[];
        const keys = rows.length ? Object.keys(rows[0] || {}) : [];
        setHeaders(keys);
        setPreview(rows.slice(0, 50));
        setIdColumn((guessColumn(keys, ID_CANDIDATES) || keys[0]) ?? "");
        setCommentsColumn((guessColumn(keys, COMMENTS_CANDIDATES) || keys[1] || keys[0]) ?? "");
      } catch {
        setHeaders([]);
        setPreview([]);
      }
    };
    reader.readAsArrayBuffer(f);
  };

  const upload = async () => {
    if (!file) {
      setError("Select a file first.");
      return;
    }
    if (!idColumn || !commentsColumn) {
      setError("Map both Opportunity ID and Comments columns.");
      return;
    }
    setBusy(true);
    setError("");
    setResponse(null);
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), 60000);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("idColumn", idColumn);
      formData.append("commentsColumn", commentsColumn);
      const res = await fetch("/api/ingest/excel-comments", { method: "POST", body: formData, signal: ac.signal });
      const json: ApiResponse = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Upload failed");
        return;
      }
      if (json.jobId && json.mode === "async") {
        setStagedJob({
          jobId: json.jobId,
          rowCount: json.rowCount ?? 0,
          commentsDetected: json.commentsDetected ?? 0,
        });
        setResponse({ ok: true, mode: "async", jobId: json.jobId, rowCount: json.rowCount, commentsDetected: json.commentsDetected });
      }
    } catch (e: any) {
      setError(e?.name === "AbortError" ? "Upload timed out" : e?.message || String(e));
    } finally {
      clearTimeout(timeoutId);
      setBusy(false);
    }
  };

  const counts = response?.counts;

  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
      <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Column mapping</h3>
      <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
        Select a file, then map your Excel columns to Opportunity ID and Comments. Max 5000 rows. All uploads are queued; scoring runs in the background.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-4">
        <div className="grid gap-1">
          <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Excel file</label>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => onFileSelect(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </div>
        <div className="grid gap-1">
          <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Opportunity ID column</label>
          <select
            value={idColumn}
            onChange={(e) => setIdColumn(e.target.value)}
            disabled={headers.length === 0}
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm disabled:opacity-60"
          >
            {headers.length === 0 ? (
              <option value="">Select a file first</option>
            ) : (
              headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))
            )}
          </select>
        </div>
        <div className="grid gap-1">
          <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Comments column</label>
          <select
            value={commentsColumn}
            onChange={(e) => setCommentsColumn(e.target.value)}
            disabled={headers.length === 0}
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm disabled:opacity-60"
          >
            {headers.length === 0 ? (
              <option value="">Select a file first</option>
            ) : (
              headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))
            )}
          </select>
        </div>
        <button
          onClick={upload}
          disabled={busy || !file || !idColumn || !commentsColumn}
          className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-60"
        >
          {busy ? "Uploading…" : "Upload & Ingest"}
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-[#E74C3C] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[#E74C3C]">
          {error}
        </div>
      ) : null}

      {stagedJob || jobProgress ? (
        <div className="mt-3 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm">
          <div className="font-medium text-[color:var(--sf-text-primary)]">
            {jobProgress?.state === "completed"
              ? "Completed"
              : stagedJob && !jobProgress
                ? `Upload received: ${stagedJob.rowCount} rows. If comments are present, opportunities have been placed in the Scoring Queue.`
                : "Processing in background…"}
          </div>
          {jobProgress && (
            <div className="mt-1 flex flex-wrap gap-4 text-xs text-[color:var(--sf-text-secondary)]">
              {jobProgress.progress != null && <span>Progress: {jobProgress.progress}%</span>}
              <span>Processed: {jobProgress.counts.processed}</span>
              <span className="text-[color:var(--good)]">OK: {jobProgress.counts.ok}</span>
              <span className="text-[color:var(--sf-text-secondary)]">Skipped: {jobProgress.counts.skipped}</span>
              {jobProgress.counts.skipped_out_of_scope > 0 && (
                <span title="Out of scope (closed before previous quarter)">Out of scope: {jobProgress.counts.skipped_out_of_scope}</span>
              )}
              {jobProgress.counts.skipped_baseline_exists > 0 && (
                <span title="Baseline already set">Baseline exists: {jobProgress.counts.skipped_baseline_exists}</span>
              )}
              <span className="text-[color:var(--bad)]">Failed: {jobProgress.counts.failed}</span>
            </div>
          )}
        </div>
      ) : null}

      {preview.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-xs font-medium text-[color:var(--sf-text-secondary)] mb-2">Preview (first 50 rows)</h4>
          <div className="max-h-[280px] overflow-y-auto overflow-x-auto rounded-md border border-[color:var(--sf-border)]">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                <tr>
                  {headers.map((h) => (
                    <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className="border-t border-[color:var(--sf-border)]">
                    {headers.map((h) => (
                      <td key={h} className="px-3 py-2 whitespace-nowrap max-w-[200px] truncate" title={r?.[h] != null ? String(r[h]) : ""}>
                        {r?.[h] == null ? "" : String(r[h])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {counts ? (
        <div className="mt-4 flex gap-4 text-sm">
          <span>Total: <b>{counts.total}</b></span>
          <span className="text-[color:var(--good)]">OK: <b>{counts.ok}</b></span>
          <span className="text-[color:var(--bad)]">Failed: <b>{counts.error}</b></span>
        </div>
      ) : null}
    </section>
  );
}
