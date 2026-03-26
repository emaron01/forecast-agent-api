"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { sha256HexUtf8 } from "../../../lib/payloadSha256";

export type RepCoachingBriefProps = {
  orgId: number;
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
  const { orgId, repName, weakestDeals, categoryAverages, fiscalYear, quotaPeriodId } = props;
  const [briefText, setBriefText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [briefPayloadSha, setBriefPayloadSha] = useState<string>("");
  const [dataKey, setDataKey] = useState<string>("");
  const [stale, setStale] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Footer line: cache fresh / expired / live generation time */
  const [statusFooter, setStatusFooter] = useState<string | null>(null);

  const payloadKey = useMemo(
    () =>
      JSON.stringify({
        quotaPeriodId: props.quotaPeriodId,
        fiscalYear: props.fiscalYear,
        repName: props.repName,
      }),
    [props.quotaPeriodId, props.fiscalYear, props.repName]
  );

  const checkCache = useCallback(async () => {
    try {
      const sha = await sha256HexUtf8(payloadKey);
      setBriefPayloadSha(sha);
      const res = await fetch(
        `/api/ai-takeaway-cache?org_id=${orgId}&surface=${encodeURIComponent("rep_coaching_brief")}&payload_sha=${encodeURIComponent(sha)}`
      );
      const j = await res.json();
      if (j?.ok && j?.summary) {
        setBriefText(String(j.summary));
        setStatusFooter(j.is_fresh ? "Cached" : "Last generated over 24 hours ago");
        setDataKey(`${fiscalYear}-${quotaPeriodId}`);
      }
    } catch {
      // ignore
    }
  }, [payloadKey, orgId, fiscalYear, quotaPeriodId]);

  useEffect(() => {
    if (briefText) return;
    if (!quotaPeriodId) return;
    void checkCache();
  }, [payloadKey, briefText, quotaPeriodId, checkCache]);

  useEffect(() => {
    const nextKey = `${fiscalYear}-${quotaPeriodId}`;
    if (briefText && dataKey && nextKey !== dataKey) {
      setStale(true);
    }
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
      const text = data.text || "Unable to generate brief.";
      setBriefText(text);
      if (
        response.ok &&
        orgId &&
        text &&
        !String(text).startsWith("Unable to generate") &&
        !String(text).startsWith("Error:")
      ) {
        setStatusFooter(`Generated at ${new Date().toLocaleTimeString()}`);
        setDataKey(`${fiscalYear}-${quotaPeriodId}`);
        const sha = await sha256HexUtf8(payloadKey);
        setBriefPayloadSha(sha);
        await fetch("/api/ai-takeaway-cache", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            org_id: orgId,
            surface: "rep_coaching_brief",
            payload_sha: sha,
            summary: text,
            extended: null,
          }),
        });
      } else {
        setStatusFooter(null);
      }
    } catch {
      setBriefText("Unable to generate brief.");
      setStatusFooter(null);
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

      {stale && briefText ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
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

      {statusFooter && briefText ? (
        <div className="mt-3 text-xs text-[color:var(--sf-text-secondary)]">{statusFooter}</div>
      ) : null}
    </section>
  );
}
