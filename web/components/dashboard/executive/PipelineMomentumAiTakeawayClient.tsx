"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export function PipelineMomentumAiTakeawayClient(props: { payload: any }) {
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
      body: JSON.stringify({ surface: "pipeline_momentum", payload: props.payload }),
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
    <section className="rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-5 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">✨ AI Strategic Takeaway</div>
      {loading ? (
        <div className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">Generating CRO-grade pipeline takeaways…</div>
      ) : text ? (
        <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--sf-text-primary)]">{text}</div>
      ) : (
        <div className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">No AI takeaway available.</div>
      )}
    </section>
  );
}

