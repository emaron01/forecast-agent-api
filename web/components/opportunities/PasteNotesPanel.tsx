"use client";

import { useState } from "react";

export function PasteNotesPanel(props: {
  opportunityId: string;
  onApplied?: () => void;
}) {
  const [rawText, setRawText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const analyze = async () => {
    const text = String(rawText || "").trim();
    if (!text) {
      setError("Paste some notes first.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccessMsg("");
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
      setSuccessMsg("Applied to opportunity. Categories scored; Risk Summary and Next Steps updated.");
      props.onApplied?.();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4">
      <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Paste Notes</h3>
      <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
        Paste CRM notes or comments and click Analyze. The agent will score all MEDDPICC-TB categories and update Risk Summary and Next Steps.
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
      {(busy || successMsg) ? (
        <div className="mt-3 rounded-md border border-[color:var(--good)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--good)]">
          {busy ? "Your notes are being analyzed - please wait." : successMsg}
        </div>
      ) : null}
    </section>
  );
}
