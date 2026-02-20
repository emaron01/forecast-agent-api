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

export function PartnerAiStrategicTakeawayClient(props: { payload: any }) {
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
          surface: "partners_executive",
          payload: props.payload,
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

      if (nextSha) setPayloadSha(nextSha);
      // Even when `no_change=true`, still apply formatting hardening so we never "stick" on an empty/raw envelope.
      if (nextSummary && nextSummary !== summary) setSummary(nextSummary);
      if (nextExtended && nextExtended !== extended) setExtended(nextExtended);

      const persistSummary = noChange ? (nextSummary || summary) : (nextSummary || summary);
      const persistExtended = noChange ? (nextExtended || extended) : (nextExtended || extended);
      const persistSha = nextSha || payloadSha;
      if (noChange && args.showNoChangeToast && (persistSummary || persistExtended)) {
        setToast("No material change in the underlying data.");
        window.setTimeout(() => setToast(""), 2500);
      }

      // Persist for end-of-page summary.
      const quotaPeriodId = String(props.payload?.quota_period?.id || props.payload?.quota_period_id || "").trim();
      if (quotaPeriodId) {
        try {
          sessionStorage.setItem(
            `sf_ai:partners_executive:${quotaPeriodId}`,
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
      // Keep prior content if fetch fails.
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
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">✨ AI Strategic Takeaways</div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
            CRO-grade interpretation of Direct vs Partner performance, with recommendations for coverage and channel investment.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void run({ force: true, showNoChangeToast: true })}
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]/70"
          >
            Reanalyze
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]"
          >
            {expanded ? "Hide extended analysis" : "Extended analysis"}
          </button>
        </div>
      </div>

      {toast ? <div className="mt-3 text-xs font-semibold text-[color:var(--sf-text-secondary)]">{toast}</div> : null}

      {loading ? (
        <div className="mt-3 text-sm text-[color:var(--sf-text-secondary)]">Generating strategic takeaways…</div>
      ) : summary || extended ? (
        <div className="mt-3 grid gap-3">
          {summary ? (
            <div className="whitespace-pre-wrap rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3 text-sm text-[color:var(--sf-text-primary)]">
              {renderCategorizedText(summary) || summary}
            </div>
          ) : null}
          {expanded && extended ? (
            <div className="whitespace-pre-wrap rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3 text-left text-sm leading-relaxed text-[color:var(--sf-text-primary)]">
              {extended}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 text-sm text-[color:var(--sf-text-secondary)]">No AI takeaway available.</div>
      )}
    </section>
  );
}

