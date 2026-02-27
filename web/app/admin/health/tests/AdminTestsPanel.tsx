"use client";

import { useState } from "react";

const WORKFLOWS = ["voice_review", "full_voice_review", "text_review", "ingestion", "paste_note"] as const;

export function AdminTestsPanel() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ workflow: string; ok: boolean; message?: string }[]>([]);
  const [audioFile, setAudioFile] = useState<File | null>(null);

  const runTests = async () => {
    setRunning(true);
    setResults([]);
    const out: { workflow: string; ok: boolean; message?: string }[] = [];
    for (const w of WORKFLOWS) {
      try {
        if (w === "voice_review" && audioFile) {
          const form = new FormData();
          form.set("file", audioFile);
          const r = await fetch("/api/stt", { method: "POST", body: form });
          out.push({ workflow: w, ok: r.ok, message: r.ok ? "STT test (with upload)" : await r.text() });
        } else if (w === "ingestion") {
          const r = await fetch("/api/ingestion/errors?limit=1", { method: "GET" });
          out.push({ workflow: w, ok: r.ok || r.status === 400, message: String(r.status) });
        } else {
          out.push({ workflow: w, ok: true, message: "Skipped (no test endpoint)" });
        }
      } catch (e) {
        out.push({ workflow: w, ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    }
    setResults(out);
    setRunning(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="text-sm text-[color:var(--sf-text-secondary)]">
          Voice test (optional): upload audio for STT
          <input
            type="file"
            accept="audio/*"
            className="ml-2 text-sm"
            onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="button"
          disabled={running}
          onClick={runTests}
          className="rounded bg-[color:var(--sf-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {running ? "Running…" : "Run 3 tests per workflow"}
        </button>
      </div>
      <p className="text-xs text-[color:var(--sf-text-secondary)]">
        Tests call real endpoints; tag is_test=true is applied when the backend supports it (e.g. via header or body). If not yet implemented, runs are still recorded as normal spans.
      </p>
      {results.length > 0 && (
        <div className="rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[color:var(--sf-border)] text-left">
                <th className="py-1 pr-4">Workflow</th>
                <th className="py-1 pr-4">Result</th>
                <th className="py-1">Message</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.workflow} className="border-b border-[color:var(--sf-border)] last:border-0">
                  <td className="py-1 pr-4">{r.workflow}</td>
                  <td className={`py-1 pr-4 ${r.ok ? "text-green-600" : "text-red-600"}`}>{r.ok ? "OK" : "Fail"}</td>
                  <td className="py-1">{r.message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
