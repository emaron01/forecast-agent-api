"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export function PipelineMomentumAiTakeawayClient(props: { payload: any }) {
  const [summary, setSummary] = useState("");
  const [extended, setExtended] = useState("");
  const [payloadSha, setPayloadSha] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [toast, setToast] = useState<string>("");
  const lastKey = useRef<string>("");

  const key = useMemo(() => {
    try {
      return JSON.stringify(props.payload || {});
    } catch {
      return String(Date.now());
    }
  }, [props.payload]);

  async function run(args: { force: boolean; showNoChangeToast: boolean }) {
    setLoading(true);
    try {
      const r = await fetch("/api/forecast/ai-strategic-takeaway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surface: "pipeline_momentum",
          payload: props.payload,
          force: args.force,
          previous_payload_sha256: payloadSha || undefined,
          previous_summary: summary || undefined,
          previous_extended: extended || undefined,
        }),
      });
      const j = await r.json();
      const noChange = !!j?.no_change;
      const nextSummary = String(j?.summary || "").trim();
      const nextExtended = String(j?.extended || "").trim();
      const nextSha = String(j?.payload_sha256 || "").trim();

      if (nextSha) setPayloadSha(nextSha);
      const persistSummary = noChange ? (summary || nextSummary) : (nextSummary || summary);
      const persistExtended = noChange ? (extended || nextExtended) : (nextExtended || extended);
      const persistSha = nextSha || payloadSha;
      if (!noChange) {
        if (nextSummary) setSummary(nextSummary);
        if (nextExtended) setExtended(nextExtended);
      } else if (args.showNoChangeToast) {
        setToast("No material change in the underlying data.");
        window.setTimeout(() => setToast(""), 2500);
      }

      // Persist for end-of-page summary.
      const quotaPeriodId = String(props.payload?.quota_period_id || "").trim();
      if (quotaPeriodId) {
        try {
          sessionStorage.setItem(
            `sf_ai:pipeline_momentum:${quotaPeriodId}`,
            JSON.stringify({
              summary: persistSummary,
              extended: persistExtended,
              payload_sha256: persistSha,
              updatedAt: Date.now(),
            })
          );
        } catch {
          // ignore
        }
      }
    } catch {
      if (!args.force && !summary && !extended) {
        setSummary("");
        setExtended("");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!key || key === lastKey.current) return;
    lastKey.current = key;
    void run({ force: false, showNoChangeToast: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <section className="rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">✨ AI Strategic Takeaway</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void run({ force: true, showNoChangeToast: true })}
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)]/70"
          >
            Reanalyze
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)]"
          >
            {expanded ? "Hide extended analysis" : "Extended analysis"}
          </button>
        </div>
      </div>

      {toast ? <div className="mt-2 text-xs font-semibold text-[color:var(--sf-text-secondary)]">{toast}</div> : null}
      {loading ? (
        <div className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">Generating CRO-grade pipeline takeaways…</div>
      ) : summary || extended ? (
        <div className="mt-2 grid gap-3">
          {summary ? <div className="whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--sf-text-primary)]">{summary}</div> : null}
          {expanded && extended ? (
            <div className="whitespace-pre-wrap rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3 text-sm text-[color:var(--sf-text-primary)]">
              {extended}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">No AI takeaway available.</div>
      )}
    </section>
  );
}

