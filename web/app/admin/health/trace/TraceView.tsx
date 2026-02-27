"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type Span = {
  id: number;
  ts: string;
  workflow: string;
  stage: string;
  duration_ms: number;
  status: string;
  http_status: number | null;
  error_code: string | null;
  org_id: number;
  run_id: string | null;
  call_id: string | null;
  audio_ms: number | null;
  text_chars: number | null;
  payload_bytes: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  model: string | null;
  provider: string | null;
};

type Trace = {
  run_id: string | null;
  call_id: string | null;
  spans: Span[];
};

export function TraceView() {
  const searchParams = useSearchParams();
  const runId = searchParams.get("run_id");
  const callId = searchParams.get("call_id");
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId && !callId) {
      setError("Provide run_id or call_id in the URL.");
      return;
    }
    const params = new URLSearchParams();
    if (runId) params.set("run_id", runId);
    if (callId) params.set("call_id", callId);
    fetch(`/api/admin/health/trace?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then(setTrace)
      .catch((e) => setError(e.message));
  }, [runId, callId]);

  if (error) return <div className="rounded border border-red-200 bg-red-50 p-3 text-red-800">{error}</div>;
  if (!trace) return <div className="text-[color:var(--sf-text-secondary)]">Loading trace…</div>;
  if (!trace.spans.length) return <div className="text-[color:var(--sf-text-secondary)]">No spans found.</div>;

  const maxMs = Math.max(...trace.spans.map((s) => s.duration_ms), 1);
  const minTs = new Date(Math.min(...trace.spans.map((s) => new Date(s.ts).getTime()))).getTime();

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-[color:var(--sf-text-primary)]">
        Trace {trace.run_id || trace.call_id || ""}
      </h1>
      <div className="rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
        <div className="space-y-2">
          {trace.spans.map((s) => {
            const start = (new Date(s.ts).getTime() - minTs) / 1000;
            const width = Math.max(2, (s.duration_ms / maxMs) * 100);
            return (
              <div key={s.id} className="flex items-center gap-4 text-sm">
                <div className="w-32 shrink-0 text-[color:var(--sf-text-secondary)]">{s.stage}</div>
                <div className="flex-1">
                  <div className="h-6 rounded bg-[color:var(--sf-surface-alt)]">
                    <div
                      className={`h-full rounded ${s.status === "error" ? "bg-red-400" : "bg-[color:var(--sf-accent)]"}`}
                      style={{ width: `${width}%`, minWidth: 4 }}
                      title={`${s.duration_ms} ms`}
                    />
                  </div>
                </div>
                <div className="w-20 shrink-0 text-right">{s.duration_ms} ms</div>
                {s.status === "error" && <span className="text-red-600">{s.error_code || s.http_status}</span>}
              </div>
            );
          })}
        </div>
      </div>
      <details className="rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
        <summary className="cursor-pointer text-sm font-medium text-[color:var(--sf-text-primary)]">Raw spans</summary>
        <pre className="mt-2 overflow-x-auto text-xs text-[color:var(--sf-text-secondary)]">
          {JSON.stringify(trace.spans, null, 2)}
        </pre>
      </details>
    </div>
  );
}
