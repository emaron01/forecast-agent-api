"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sha256HexUtf8 } from "../../../lib/payloadSha256";

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
      summary: String((sObj as { summary?: unknown }).summary || "").trim(),
      extended: String((sObj as { extended?: unknown }).extended || extended || "").trim(),
    };
  }
  const eObj = tryParse(extended);
  if (eObj && typeof eObj === "object" && ("summary" in eObj || "extended" in eObj)) {
    return {
      summary: String((eObj as { summary?: unknown }).summary || summary || "").trim(),
      extended: String((eObj as { extended?: unknown }).extended || "").trim(),
    };
  }
  return { summary: String(summary || "").trim(), extended: String(extended || "").trim() };
}

export function useAiTakeaway(args: {
  orgId: number;
  surface: string;
  payload: unknown;
  enabled?: boolean;
  /** Defaults to `/api/forecast/ai-strategic-takeaway`. */
  apiEndpoint?: string;
}) {
  const enabled = args.enabled !== false;
  const apiEndpoint = args.apiEndpoint || "/api/forecast/ai-strategic-takeaway";
  const payloadJson = useMemo(() => JSON.stringify(args.payload ?? null), [args.payload]);

  const [payloadSha, setPayloadSha] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [extended, setExtended] = useState<string | null>(null);
  const [loadedSha, setLoadedSha] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [isFresh, setIsFresh] = useState(true);
  const [toast, setToast] = useState("");

  const loadedShaRef = useRef<string | null>(null);
  const summaryRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const generatingRef = useRef(false);
  loadedShaRef.current = loadedSha;
  summaryRef.current = summary;
  loadingRef.current = loading;

  useEffect(() => {
    let cancelled = false;
    void sha256HexUtf8(payloadJson).then((h) => {
      if (!cancelled) setPayloadSha(h);
    });
    return () => {
      cancelled = true;
    };
  }, [payloadJson]);

  useEffect(() => {
    if (!enabled || !args.orgId || !payloadSha) return;
    if (loadedShaRef.current === payloadSha) return;

    if (loadedShaRef.current && summaryRef.current && loadedShaRef.current !== payloadSha) {
      setStale(true);
    }

    let cancelled = false;

    /**
     * Cache GET only: apply state on hit. On miss or error, do nothing (summary stays null until user clicks Generate).
     * Must never call generate() or POST ai-strategic-takeaway.
     */
    async function checkCache(): Promise<boolean> {
      try {
        const res = await fetch(
          `/api/ai-takeaway-cache?org_id=${args.orgId}&surface=${encodeURIComponent(args.surface)}&payload_sha=${encodeURIComponent(payloadSha)}`
        );
        const j = await res.json();
        if (cancelled) return false;
        if (j?.ok && j?.summary) {
          const rawS = String(j.summary || "").trim();
          const rawE = String(j.extended || "").trim();
          const unwrapped = unwrapIfJsonEnvelope(rawS, rawE);
          setSummary(unwrapped.summary || null);
          setExtended(unwrapped.extended || null);
          const fresh = Boolean(j?.is_fresh);
          setIsFresh(fresh);
          setLoadedSha(payloadSha);
          setGeneratedAt(fresh ? "cached" : "expired");
          setStale(false);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }

    void checkCache();
    return () => {
      cancelled = true;
    };
  }, [enabled, args.orgId, args.surface, payloadSha]);

  const generate = useCallback(
    async (force = false) => {
      if (!enabled || !args.orgId || !payloadSha) return;
      if (loadingRef.current) return;
      if (generatingRef.current) return;
      generatingRef.current = true;
      setLoading(true);
      setStale(false);
      setToast("");
      try {
        const res = await fetch(apiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            surface: args.surface,
            payload: args.payload,
            force,
            previous_payload_sha256: (summary || extended) && loadedSha ? loadedSha : undefined,
            previous_summary: summary || undefined,
            previous_extended: extended || undefined,
          }),
        });
        const j = await res.json();
        if (!res.ok) return;

        const noChange = !!j?.no_change;
        const rawS = String(j?.summary || "").trim();
        const rawE = String(j?.extended || "").trim();
        const unwrapped = unwrapIfJsonEnvelope(rawS, rawE);
        const newSummary = unwrapped.summary || null;
        const newExtended = unwrapped.extended || null;
        const nextSha = String(j?.payload_sha256 || "").trim();

        if (noChange && force && (newSummary || newExtended)) {
          setToast("No material change in the underlying data.");
          window.setTimeout(() => setToast(""), 2500);
        }

        if (newSummary) {
          setSummary(newSummary);
          setExtended(newExtended);
          setLoadedSha(nextSha || payloadSha);
          setGeneratedAt(new Date().toLocaleTimeString());
          setIsFresh(true);
          setStale(false);

          await fetch("/api/ai-takeaway-cache", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              org_id: args.orgId,
              surface: args.surface,
              payload_sha: nextSha || payloadSha,
              summary: newSummary,
              extended: newExtended,
            }),
          });
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
        generatingRef.current = false;
      }
    },
    [enabled, args.orgId, args.surface, args.payload, apiEndpoint, payloadSha, summary, extended, loadedSha]
  );

  return {
    summary,
    extended,
    loading,
    stale,
    generatedAt,
    isFresh,
    generate,
    toast,
  };
}
