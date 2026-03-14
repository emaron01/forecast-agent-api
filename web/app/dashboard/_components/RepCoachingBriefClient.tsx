"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export type RepCoachingBriefProps = {
  repName: string;
  weakestDeals: {
    name: string;
    health_pct: number;
    stage: string;
    weakest_category: string;
  }[];
  categoryAverages: {
    pain: number | null;
    metrics: number | null;
    champion: number | null;
    eb: number | null;
    criteria: number | null;
    process: number | null;
    competition: number | null;
    paper: number | null;
    timing: number | null;
    budget: number | null;
  };
  fiscalYear: string;
  quotaPeriodId: string;
};

export function RepCoachingBriefClient(props: RepCoachingBriefProps) {
  const { repName, weakestDeals, categoryAverages, fiscalYear, quotaPeriodId } = props;
  const [briefText, setBriefText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [dataKey, setDataKey] = useState<string>("");
  const [stale, setStale] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const nextKey = `${fiscalYear}-${quotaPeriodId}`;
    if (briefText && nextKey !== dataKey) setStale(true);
  }, [fiscalYear, quotaPeriodId, briefText, dataKey]);

  async function generateBrief() {
    setLoading(true);
    setStale(false);

    const payload = {
      rep: repName,
      weakest_deals: weakestDeals.map((d) => ({
        name: d.name,
        health: `${Math.round(d.health_pct)}%`,
        stage: d.stage,
        gap: d.weakest_category,
      })),
      category_averages: Object.entries(categoryAverages)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => ({ category: k, avg_score: v })),
    };

    try {
      const response = await fetch("/api/rep-coaching-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      const data = await response.json();
      setBriefText(data.text || "Unable to generate brief.");
      setGeneratedAt(new Date().toLocaleTimeString());
      setDataKey(`${fiscalYear}-${quotaPeriodId}`);
    } catch {
      setBriefText("Unable to generate brief.");
    } finally {
      setLoading(false);
    }
  }

  async function copyToClipboard() {
    if (!briefText) return;
    try {
      await navigator.clipboard.writeText(briefText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">
          <Image
            src="/brand/salesforecast-logo-white.png"
            alt="SalesForecast.io"
            width={258}
            height={47}
            className="h-[1.95rem] w-auto opacity-90"
          />
          <span>✨ COACHING BRIEF</span>
        </div>
        <div className="flex items-center gap-2">
          {!briefText ? (
            <button
              type="button"
              onClick={() => void generateBrief()}
              disabled={loading}
              className="rounded-md border border-[color:var(--sf-accent-primary)] bg-[color:var(--sf-accent-primary)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              Get Coaching Brief
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void generateBrief()}
              disabled={loading}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)]/70 disabled:opacity-60"
            >
              Refresh
            </button>
          )}
          {briefText ? (
            <button
              type="button"
              onClick={() => void copyToClipboard()}
              className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)]/70"
              title="Copy brief"
            >
              <span aria-hidden="true">⧉</span>
              Copy
            </button>
          ) : null}
        </div>
      </div>

      {stale ? (
        <div className="mt-3 rounded-md border border-[#F1C40F]/50 bg-[#F1C40F]/12 px-3 py-2 text-xs font-semibold text-[#F1C40F]">
          Quarter changed — refresh for updated coaching
        </div>
      ) : null}

      {copied ? (
        <div className="mt-3 text-xs font-semibold text-[color:var(--sf-text-secondary)]">Copied.</div>
      ) : null}

      {loading ? (
        <div className="mt-3 text-sm text-[color:var(--sf-text-secondary)]">Matthew is reviewing your deals…</div>
      ) : briefText ? (
        <div className="mt-3 rounded-lg border border-[color:var(--sf-border)] bg-white p-3 text-sm leading-relaxed text-black">
          {briefText}
        </div>
      ) : (
        <p className="mt-3 text-sm text-[color:var(--sf-text-secondary)]">
          Get a personalized coaching brief from Matthew based on your current deals.
        </p>
      )}

      {generatedAt && briefText ? (
        <div className="mt-3 text-xs text-[color:var(--sf-text-secondary)]">Generated at {generatedAt}</div>
      ) : null}
    </section>
  );
}
