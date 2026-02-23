"use client";

import { useState } from "react";

type Extracted = {
  summary?: string;
  risk_flags?: Array<{ type: string; severity: string; why: string }>;
  next_steps?: string[];
  follow_up_questions?: Array<{ category: string; question: string; priority: string }>;
};

export function PasteNotesPanel(props: { opportunityId: string }) {
  const [rawText, setRawText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [extracted, setExtracted] = useState<Extracted | null>(null);

  const analyze = async () => {
    const text = String(rawText || "").trim();
    if (!text) {
      setError("Paste some notes first.");
      return;
    }
    setBusy(true);
    setError("");
    setExtracted(null);
    try {
      const res = await fetch(`/api/opportunities/${encodeURIComponent(props.opportunityId)}/ingest-comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType: "manual", rawText: text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setError(json?.error || "Analysis failed");
        return;
      }
      setExtracted(json.extracted || null);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const topQuestions = (extracted?.follow_up_questions || [])
    .filter((q) => q.priority === "high")
    .slice(0, 5);

  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
      <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Paste Notes</h3>
      <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
        Paste CRM notes or comments and click Analyze to extract MEDDPICC signals.
      </p>
      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder="Paste notes here…"
        className="mt-3 w-full min-h-[120px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] placeholder:text-[color:var(--sf-text-disabled)]"
        disabled={busy}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={analyze}
          disabled={busy || !rawText.trim()}
          className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-60"
        >
          {busy ? "Analyzing…" : "Analyze Notes"}
        </button>
      </div>
      {error ? (
        <div className="mt-3 rounded-md border border-[#E74C3C] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[#E74C3C]">
          {error}
        </div>
      ) : null}
      {extracted ? (
        <div className="mt-4 space-y-3 text-sm">
          {extracted.summary ? (
            <div>
              <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Summary</div>
              <div className="mt-1 text-[color:var(--sf-text-primary)]">{extracted.summary}</div>
            </div>
          ) : null}
          {(extracted.risk_flags || []).length > 0 ? (
            <div>
              <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Risk flags</div>
              <ul className="mt-1 list-disc pl-4 space-y-1 text-[color:var(--sf-text-primary)]">
                {extracted.risk_flags!.map((r, i) => (
                  <li key={i}>
                    <span className="font-medium">{r.type}</span> ({r.severity}): {r.why}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {(extracted.next_steps || []).length > 0 ? (
            <div>
              <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Next steps</div>
              <ul className="mt-1 list-disc pl-4 space-y-1 text-[color:var(--sf-text-primary)]">
                {extracted.next_steps!.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {topQuestions.length > 0 ? (
            <div>
              <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Top follow-up questions</div>
              <ul className="mt-1 list-disc pl-4 space-y-1 text-[color:var(--sf-text-primary)]">
                {topQuestions.map((q, i) => (
                  <li key={i}>
                    <span className="text-[color:var(--sf-text-disabled)]">[{q.category}]</span> {q.question}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
