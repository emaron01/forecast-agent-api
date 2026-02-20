"use client";

import { useEffect, useMemo, useState } from "react";

type Entry = { label: string; surface: string; quotaPeriodId: string };

function storageKey(surface: string, quotaPeriodId: string) {
  return `sf_ai:${surface}:${quotaPeriodId}`;
}

function readEntry(entry: Entry): { summary: string; extended: string; updatedAt: number | null } | null {
  try {
    const raw = sessionStorage.getItem(storageKey(entry.surface, entry.quotaPeriodId));
    if (!raw) return null;
    const j = JSON.parse(raw);
    const summaryRaw = String(j?.summary || "").trim();
    const extendedRaw = String(j?.extended || "").trim();

    const stripFence = (s: string) => {
      const t = String(s || "").trim();
      if (!t) return "";
      const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      return String(m?.[1] ?? t).trim();
    };

    const tryUnwrap = (s: string) => {
      const t = stripFence(s);
      if (!t) return null;
      const first = t.indexOf("{");
      const last = t.lastIndexOf("}");
      const candidates = [t, first >= 0 && last > first ? t.slice(first, last + 1) : ""].filter(Boolean);
      for (const c of candidates) {
        try {
          const o = JSON.parse(c);
          if (o && typeof o === "object" && ("summary" in o || "extended" in o)) return o;
        } catch {
          // ignore
        }
      }
      return null;
    };

    const u = tryUnwrap(summaryRaw) || tryUnwrap(extendedRaw);
    const summary = String((u as any)?.summary ?? summaryRaw ?? "").trim();
    const extended = String((u as any)?.extended ?? extendedRaw ?? "").trim();
    const updatedAt = j?.updatedAt != null ? Number(j.updatedAt) : null;
    if (!summary && !extended) return null;
    return { summary, extended, updatedAt: Number.isFinite(updatedAt) ? updatedAt : null };
  } catch {
    return null;
  }
}

export function AiSummaryReportClient(props: { entries: Entry[] }) {
  const [copied, setCopied] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Re-read periodically (AI blocks can update later).
  useEffect(() => {
    const t = window.setInterval(() => setNonce((n) => n + 1), 1500);
    return () => window.clearInterval(t);
  }, []);

  const report = useMemo(() => {
    const parts: string[] = [];
    for (const e of props.entries || []) {
      const v = readEntry(e);
      if (!v) continue;
      const body = v.summary || v.extended;
      if (!body) continue;
      parts.push(`${e.label}\n${body}`.trim());
    }
    return parts.join("\n\n").trim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, JSON.stringify(props.entries || [])]);

  async function copy() {
    const text = report;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  if (!props.entries?.length) return null;

  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">AI Summary Report</div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Combined snapshot across AI analytics blocks.</div>
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]/70"
          disabled={!report}
          title={report ? "Copy summary" : "No summary to copy yet"}
        >
          <span aria-hidden="true">⧉</span>
          Copy
        </button>
      </div>

      {copied ? <div className="mt-2 text-xs font-semibold text-[color:var(--sf-text-secondary)]">Copied.</div> : null}

      {report ? (
        <div className="mt-3 whitespace-pre-wrap rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3 text-sm text-[color:var(--sf-text-primary)]">
          {report}
        </div>
      ) : (
        <div className="mt-3 text-sm text-[color:var(--sf-text-secondary)]">No AI summaries available yet for this view.</div>
      )}
    </section>
  );
}

