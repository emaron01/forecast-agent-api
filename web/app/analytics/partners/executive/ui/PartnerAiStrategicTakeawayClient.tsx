"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export function PartnerAiStrategicTakeawayClient(props: { payload: any }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const lastKey = useRef<string>("");

  const key = useMemo(() => {
    try {
      return JSON.stringify(props.payload || {});
    } catch {
      return String(Date.now());
    }
  }, [props.payload]);

  useEffect(() => {
    if (!key || key === lastKey.current) return;
    lastKey.current = key;

    let cancelled = false;
    setLoading(true);
    fetch("/api/forecast/ai-strategic-takeaway", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surface: "partners_executive", payload: props.payload }),
    })
      .then((r) => r.json())
      .then((j) => {
        const t = String(j?.text || "").trim();
        if (!cancelled) setText(t);
      })
      .catch(() => {
        if (!cancelled) setText("");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [key, props.payload]);

  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">✨ AI Strategic Takeaways</div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
            CRO-grade interpretation of Direct vs Partner performance, with recommendations for coverage and channel investment.
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-3 text-sm text-[color:var(--sf-text-secondary)]">Generating strategic takeaways…</div>
      ) : text ? (
        <div className="mt-3 whitespace-pre-wrap rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3 text-sm text-[color:var(--sf-text-primary)]">
          {text}
        </div>
      ) : (
        <div className="mt-3 text-sm text-[color:var(--sf-text-secondary)]">No AI takeaway available.</div>
      )}
    </section>
  );
}

