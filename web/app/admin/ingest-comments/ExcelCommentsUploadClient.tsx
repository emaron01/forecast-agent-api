"use client";

import { useState } from "react";

type Result = { row: number; opportunityId: number | null; ok: boolean; error?: string };
type ApiResponse = { ok: boolean; results?: Result[]; counts?: { total: number; ok: number; error: number }; error?: string };

export function ExcelCommentsUploadClient() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<ApiResponse | null>(null);

  const upload = async () => {
    if (!file) {
      setError("Select a file first.");
      return;
    }
    setBusy(true);
    setError("");
    setResponse(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
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
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResponse(null);
          }}
          className="text-sm"
        />
        <button
          onClick={upload}
          disabled={busy || !file}
          className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-60"
        >
          {busy ? "Uploading…" : "Upload & Ingest"}
        </button>
      </div>

      <p className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
        Expected columns: crm_opp_id (or opportunity id) and comments/notes. Max 50 rows.
      </p>

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
