"use client";

import { useState } from "react";
import * as XLSX from "xlsx";

type Result = { row: number; opportunityId: number | null; ok: boolean; error?: string };
type ApiResponse = { ok: boolean; results?: Result[]; counts?: { total: number; ok: number; error: number }; error?: string };

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
  const [idColumn, setIdColumn] = useState("");
  const [commentsColumn, setCommentsColumn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<ApiResponse | null>(null);

  const onFileSelect = (f: File | null) => {
    setFile(f);
    setResponse(null);
    setHeaders([]);
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
        setIdColumn((guessColumn(keys, ID_CANDIDATES) || keys[0]) ?? "");
        setCommentsColumn((guessColumn(keys, COMMENTS_CANDIDATES) || keys[1] || keys[0]) ?? "");
      } catch {
        setHeaders([]);
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
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("idColumn", idColumn);
      formData.append("commentsColumn", commentsColumn);
      const res = await fetch("/api/ingest/excel-comments", {
        method: "POST",
        body: formData,
      });
      const json: ApiResponse = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Upload failed");
        return;
      }
      setResponse(json);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const results = response?.results ?? [];
  const counts = response?.counts;

  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
      <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Column mapping</h3>
      <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
        Select a file, then map your Excel columns to Opportunity ID and Comments. Max 50 rows.
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

      {counts ? (
        <div className="mt-4 space-y-3">
          <div className="flex gap-4 text-sm">
            <span>Total: <b>{counts.total}</b></span>
            <span className="text-[color:var(--good)]">OK: <b>{counts.ok}</b></span>
            <span className="text-[color:var(--bad)]">Errors: <b>{counts.error}</b></span>
          </div>
          {results.length > 0 ? (
            <div className="max-h-[300px] overflow-auto rounded-md border border-[color:var(--sf-border)]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[color:var(--sf-surface-alt)]">
                  <tr>
                    <th className="px-3 py-2 text-left">Row</th>
                    <th className="px-3 py-2 text-left">Opportunity ID</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-3 py-2">{r.row}</td>
                      <td className="px-3 py-2 font-mono">{r.opportunityId ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className={r.ok ? "text-[color:var(--good)]" : "text-[color:var(--bad)]"}>
                          {r.ok ? "OK" : "Error"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[color:var(--sf-text-secondary)]">{r.error ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
