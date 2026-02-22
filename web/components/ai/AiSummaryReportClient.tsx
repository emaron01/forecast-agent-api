"use client";

import { useEffect, useMemo, useState } from "react";

type Entry = { label: string; surface: string; quotaPeriodId: string };

function storageKey(surface: string, quotaPeriodId: string) {
  return `sf_ai:${surface}:${quotaPeriodId}`;
}

function firstNSentences(text: string, n: number) {
  const nn = Math.max(1, Math.min(6, Math.trunc(n || 1)));
  const t = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";

  const matches = t.match(/[^.!?]+[.!?]+/g);
  if (matches?.length) return matches.slice(0, nn).join("").trim();

  // Fallback for content without punctuation: return a short snippet.
  const words = t.split(" ").filter(Boolean);
  const take = Math.min(words.length, 28);
  const snippet = words.slice(0, take).join(" ").trim();
  return words.length > take ? `${snippet}…` : snippet;
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

function renderCategorizedText(text: string) {
  const t = String(text || "").trim();
  if (!t) return null;
  const lines = t.split("\n").map((l) => l.trimEnd());
  return (
    <div className="grid gap-2">
      {lines.map((line, idx) => {
        const raw = String(line || "").trim();
        if (!raw) return <div key={idx} className="h-2" />;
        const bullet = raw.replace(/^\s*[-•]\s+/, "");
        const m = bullet.match(/^\*\*(.+?)\*\*:\s*(.+)$/) || bullet.match(/^([A-Za-z][A-Za-z0-9 /&+\-]{2,32}):\s*(.+)$/);
        if (m) {
          const label = String(m[1]).trim();
          const rest = String(m[2]).trim();
          return (
            <div key={idx} className="flex gap-2">
              <span className="text-[color:var(--sf-accent-primary)]">•</span>
              <span className="min-w-0">
                <span className="font-semibold">{label}:</span> {rest}
              </span>
            </div>
          );
        }
        return (
          <div key={idx} className="flex gap-2">
            <span className="text-[color:var(--sf-accent-primary)]">•</span>
            <span className="min-w-0 whitespace-pre-wrap">{bullet}</span>
          </div>
        );
      })}
    </div>
  );
}

export function AiSummaryReportClient(props: { entries: Entry[] }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Re-read periodically (AI blocks can update later).
  useEffect(() => {
    const t = window.setInterval(() => setNonce((n) => n + 1), 1500);
    return () => window.clearInterval(t);
  }, []);

  const { reportPreview, collapsedPreview, reportForCopy } = useMemo(() => {
    const previewParts: string[] = [];
    const narrativeParts: string[] = [];
    const copyParts: string[] = [];
    for (const e of props.entries || []) {
      const v = readEntry(e);
      if (!v) continue;
      const summary = String(v.summary || "").trim();
      const extended = String(v.extended || "").trim();
      const body = summary || extended;
      if (body) previewParts.push(`${e.label}\n${body}`.trim());
      if (body) narrativeParts.push(body);

      if (summary && extended && summary !== extended) {
        copyParts.push(`${e.label}\nSummary:\n${summary}\n\nExtended analysis:\n${extended}`.trim());
      } else if (summary) {
        copyParts.push(`${e.label}\n${summary}`.trim());
      } else if (extended) {
        copyParts.push(`${e.label}\n${extended}`.trim());
      }
    }
    const narrative = narrativeParts.join(" ").trim();
    return {
      reportPreview: previewParts.join("\n\n").trim(),
      collapsedPreview: firstNSentences(narrative, 2),
      reportForCopy: copyParts.join("\n\n").trim(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, JSON.stringify(props.entries || [])]);

  async function copy() {
    const text = reportForCopy || reportPreview;
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
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">SalesForecast.io Executive Snap Shot</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]"
            disabled={!reportPreview && !reportForCopy}
            title={reportPreview || reportForCopy ? (expanded ? "Collapse" : "Expand") : "No summary to expand yet"}
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]/70"
            disabled={!reportPreview && !reportForCopy}
            title={reportPreview || reportForCopy ? "Copy summary + extended" : "No summary to copy yet"}
          >
            <span aria-hidden="true">⧉</span>
            Copy
          </button>
        </div>
      </div>

      {copied ? <div className="mt-2 text-xs font-semibold text-[color:var(--sf-text-secondary)]">Copied.</div> : null}

      {reportPreview ? (
        <div className="mt-3 whitespace-pre-wrap rounded-lg border border-[color:var(--sf-border)] bg-white p-3 text-sm text-black">
          {expanded
            ? (renderCategorizedText(reportForCopy || reportPreview) || (reportForCopy || reportPreview))
            : (collapsedPreview || reportPreview)}
        </div>
      ) : (
        <div className="mt-3 text-sm text-[color:var(--sf-text-secondary)]">No AI summaries available yet for this view.</div>
      )}
    </section>
  );
}

