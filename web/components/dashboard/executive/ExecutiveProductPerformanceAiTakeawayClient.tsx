"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function stripJsonFence(s: string) {
  const t = String(s || "").trim();
  if (!t) return "";
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return String(m?.[1] ?? t).trim();
}

function unwrapIfJsonEnvelope(summary: string, extended: string) {
  const tryParse = (raw: string) => {
    const t = stripJsonFence(raw);
    if (!t) return null;
    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    const candidates = [t, first >= 0 && last > first ? t.slice(first, last + 1) : ""].filter(Boolean);
    for (const c of candidates) {
      try {
        return JSON.parse(c);
      } catch {
        // ignore
      }
    }
    return null;
  };

  const sObj = tryParse(summary);
  if (sObj && typeof sObj === "object" && ("summary" in sObj || "extended" in sObj)) {
    return {
      summary: String((sObj as any).summary || "").trim(),
      extended: String((sObj as any).extended || extended || "").trim(),
    };
  }
  const eObj = tryParse(extended);
  if (eObj && typeof eObj === "object" && ("summary" in eObj || "extended" in eObj)) {
    return {
      summary: String((eObj as any).summary || summary || "").trim(),
      extended: String((eObj as any).extended || "").trim(),
    };
  }
  return { summary: String(summary || "").trim(), extended: String(extended || "").trim() };
}

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
              <span className="text-[color:var(--sf-accent-secondary)]">•</span>
              <span className="min-w-0">
                <span className="font-semibold">{label}:</span> {rest}
              </span>
            </div>
          );
        }

        return (
          <div key={idx} className="flex gap-2">
            <span className="text-[color:var(--sf-accent-secondary)]">•</span>
            <span className="min-w-0 whitespace-pre-wrap">{bullet}</span>
          </div>
        );
      })}
    </div>
  );
}

type Props = {
  quotaPeriodId: string;
  payload: any;
};

export function ExecutiveProductPerformanceAiTakeawayClient(props: Props) {
  const quotaPeriodId = String(props.quotaPeriodId || "").trim();
  const [summary, setSummary] = useState("");
  const [extended, setExtended] = useState("");
  const [payloadSha, setPayloadSha] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [toast, setToast] = useState("");

  const lastKey = useRef<string>("");

  const payload = useMemo(() => {
    return { quota_period_id: quotaPeriodId, ...(props.payload ?? {}) };
  }, [quotaPeriodId, props.payload]);

  async function run(args: { force: boolean; showNoChangeToast: boolean }) {
    if (!quotaPeriodId) return;
    setLoading(true);
    try {
      const r = await fetch("/api/forecast/ai-strategic-takeaway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surface: "product_performance",
          payload,
          force: args.force,
          previous_payload_sha256: payloadSha || undefined,
          previous_summary: summary || undefined,
          previous_extended: extended || undefined,
        }),
      });
      const j = await r.json();
      const noChange = !!j?.no_change;
      const nextSummaryRaw = String(j?.summary || "").trim();
      const nextExtendedRaw = String(j?.extended || "").trim();
      const nextSha = String(j?.payload_sha256 || "").trim();
      const unwrapped = unwrapIfJsonEnvelope(nextSummaryRaw, nextExtendedRaw);
      const nextSummary = unwrapped.summary;
      const nextExtended = unwrapped.extended;

      const persistSummary = noChange ? (summary || nextSummary) : (nextSummary || summary);
      const persistExtended = noChange ? (extended || nextExtended) : (nextExtended || extended);

      if (nextSha) setPayloadSha(nextSha);
      if (!noChange) {
        if (nextSummary) setSummary(nextSummary);
        if (nextExtended) setExtended(nextExtended);
      } else if (args.showNoChangeToast) {
        setToast("No material change in the underlying data.");
        window.setTimeout(() => setToast(""), 2500);
      }

      try {
        sessionStorage.setItem(
          `sf_ai:product_performance:${quotaPeriodId}`,
          JSON.stringify({
            summary: persistSummary,
            extended: persistExtended,
            payload_sha256: nextSha || payloadSha,
            updatedAt: Date.now(),
          })
        );
      } catch {
        // ignore
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!quotaPeriodId) return;
    const key = [quotaPeriodId, payload?.summary?.total_revenue, payload?.summary?.total_orders].join("|");
    if (key === lastKey.current) return;
    lastKey.current = key;
    void run({ force: false, showNoChangeToast: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotaPeriodId, JSON.stringify(payload || {})]);

  return (
    <div className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">✨ AI Strategic Takeaway</div>
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
        <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">AI agent is generating product mix takeaways…</div>
      ) : summary || extended ? (
        <div className="mt-3 grid gap-3 text-sm text-[color:var(--sf-text-primary)]">
          {summary ? <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">{renderCategorizedText(summary) || summary}</div> : null}
          {expanded && extended ? (
            <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3 text-left leading-relaxed whitespace-pre-wrap">{extended}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

