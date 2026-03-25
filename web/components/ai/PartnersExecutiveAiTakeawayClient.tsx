"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useExecutiveBriefing } from "../dashboard/executive/ExecutiveBriefingContext";
import { useAiTakeaway } from "../../app/components/ai/useAiTakeaway";

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

export function PartnersExecutiveAiTakeawayClient(props: { orgId: number; quotaPeriodId: string; payload: any }) {
  const quotaPeriodId = String(props.quotaPeriodId || "").trim();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const briefing = useExecutiveBriefing();

  const takeaway = useAiTakeaway({
    orgId: props.orgId,
    surface: "partners_executive",
    payload: props.payload,
    enabled: !!quotaPeriodId,
  });

  const summary = takeaway.summary || "";
  const extended = takeaway.extended || "";

  useEffect(() => {
    const text = [summary ? `Summary:\n${summary}` : "", extended ? `Extended analysis:\n${extended}` : ""].filter(Boolean).join("\n\n").trim();
    briefing.setDirectVsPartner(text);
  }, [summary, extended, briefing.setDirectVsPartner]);

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
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--sf-text-primary)]">
            <Image
              src="/brand/salesforecast-logo-white.png"
              alt="SalesForecast.io"
              width={258}
              height={47}
              className="h-[1.95rem] w-auto opacity-90"
            />
            <span>✨ AI Strategic Takeaways</span>
          </div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
            CRO-grade interpretation of Direct vs Partner performance, with recommendations for coverage and channel investment.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {summary || extended ? (
            <button
              type="button"
              onClick={() => void takeaway.generate(true)}
              disabled={takeaway.loading}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]/70 disabled:opacity-60"
            >
              Reanalyze
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
                className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]/70"
                disabled={!summary && !extended}
                title={summary || extended ? "Copy summary + extended" : "No summary to copy yet"}
              >
                <span aria-hidden="true">⧉</span>
                Copy
              </button>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]"
              >
                {expanded ? "Hide extended analysis" : "Extended analysis"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {takeaway.toast ? <div className="mt-3 text-xs font-semibold text-[color:var(--sf-text-secondary)]">{takeaway.toast}</div> : null}
      {copied ? <div className="mt-3 text-xs font-semibold text-[color:var(--sf-text-secondary)]">Copied.</div> : null}
      {takeaway.stale ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Quarter data has changed — regenerate for updated insights.
        </div>
      ) : null}
      {takeaway.loading ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-[color:var(--sf-text-secondary)]">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[color:var(--sf-border)] border-t-transparent" />
          Generating…
        </div>
      ) : null}
      {summary || extended ? (
        <div className="mt-3 grid gap-3">
          {summary ? (
            <div className="rounded-lg border border-[color:var(--sf-border)] bg-white p-3 text-sm text-black">
              {renderCategorizedText(summary) || <div className="whitespace-pre-wrap">{summary}</div>}
            </div>
          ) : null}
          {expanded && extended ? (
            <div className="whitespace-pre-wrap rounded-lg border border-[color:var(--sf-border)] bg-white p-3 text-left text-sm leading-relaxed text-black">
              {renderCategorizedText(extended) || <div className="whitespace-pre-wrap">{extended}</div>}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 text-sm text-[color:var(--sf-text-secondary)]">Click Generate for strategic takeaways.</div>
      )}
    </section>
  );
}
