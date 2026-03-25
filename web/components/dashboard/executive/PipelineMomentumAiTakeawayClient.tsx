"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useExecutiveBriefing } from "./ExecutiveBriefingContext";
import { useAiTakeaway } from "../../../app/components/ai/useAiTakeaway";
import { AiTakeawayTimestamp } from "../../../app/components/ai/aiTakeawayUiMeta";

function renderCategorizedText(text: string) {
  const t = String(text || "").trim();
  if (!t) return null;
  const lines = t.split("\n").map((l) => l.trimEnd());
  return (
    <div className="grid gap-2">
      {lines.map((line, idx) => {
        const raw = line.trim();
        if (!raw) return null;
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

export function PipelineMomentumAiTakeawayClient(props: { orgId: number; payload: any }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const briefing = useExecutiveBriefing();

  const takeaway = useAiTakeaway({
    orgId: props.orgId,
    surface: "pipeline_momentum",
    payload: props.payload,
    enabled: true,
  });

  const summary = takeaway.summary || "";
  const extended = takeaway.extended || "";

  useEffect(() => {
    const text = [summary ? `Summary:\n${summary}` : "", extended ? `Extended analysis:\n${extended}` : ""].filter(Boolean).join("\n\n").trim();
    briefing.setPipelineRisk(text);
  }, [summary, extended, briefing.setPipelineRisk]);

  async function copy() {
    const text = [summary ? `Summary:\n${summary}` : "", extended ? `Extended analysis:\n${extended}` : ""].filter(Boolean).join("\n\n").trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <section className="rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
          <Image
            src="/brand/salesforecast-logo-white.png"
            alt="SalesForecast.io"
            width={258}
            height={47}
            className="h-[1.95rem] w-auto opacity-90"
          />
          <span>✨ AI Strategic Takeaway</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {summary || extended ? (
            <button
              type="button"
              onClick={() => void takeaway.generate(true)}
              disabled={takeaway.loading}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)]/70 disabled:opacity-60"
            >
              {takeaway.isFresh ? "Reanalyze" : "Refresh"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void takeaway.generate(false)}
              disabled={takeaway.loading}
              className="rounded-md border border-[color:var(--sf-accent-primary)] bg-[color:var(--sf-accent-primary)] px-3 py-2 text-xs font-semibold text-white hover:bg-[color:var(--sf-accent-secondary)] disabled:opacity-60"
            >
              Generate
            </button>
          )}
          {summary || extended ? (
            <>
              <button
                type="button"
                onClick={() => void copy()}
                className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)]/70"
                disabled={!summary && !extended}
                title={summary || extended ? "Copy summary + extended" : "No summary to copy yet"}
              >
                <span aria-hidden="true">⧉</span>
                Copy
              </button>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)]"
              >
                {expanded ? "Hide extended analysis" : "Extended analysis"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      <AiTakeawayTimestamp
        hasContent={!!(summary || extended)}
        isFresh={takeaway.isFresh}
        generatedAt={takeaway.generatedAt}
        className="mt-2 text-xs text-[color:var(--sf-text-secondary)]"
      />
      {takeaway.toast ? <div className="mt-2 text-xs font-semibold text-[color:var(--sf-text-secondary)]">{takeaway.toast}</div> : null}
      {copied ? <div className="mt-2 text-xs font-semibold text-[color:var(--sf-text-secondary)]">Copied.</div> : null}
      {takeaway.stale ? (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Quarter data has changed — regenerate for updated insights.
        </div>
      ) : null}
      {takeaway.loading ? (
        <div className="mt-2 flex items-center gap-2 text-sm text-[color:var(--sf-text-secondary)]">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[color:var(--sf-border)] border-t-transparent" />
          Generating…
        </div>
      ) : null}
      {summary || extended ? (
        <div className="mt-2 grid gap-3">
          {summary ? (
            <div className="rounded-lg border border-[color:var(--sf-border)] bg-white p-3 text-sm leading-relaxed text-black">
              {renderCategorizedText(summary) || summary}
            </div>
          ) : null}
          {expanded && extended ? (
            <div className="whitespace-pre-wrap rounded-lg border border-[color:var(--sf-border)] bg-white p-3 text-left text-sm leading-relaxed text-black">
              {renderCategorizedText(extended) || extended}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
