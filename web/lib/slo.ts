/**
 * SLO threshold config for health dashboard (Fast/Normal/Slow/Critical).
 * Used to classify request_total duration_ms and RTF (real-time factor) for voice.
 */

export const runtime = "nodejs";

export type SloBand = "Fast" | "Normal" | "Slow" | "Critical";

export interface WorkflowSlo {
  /** p95 total_ms under this (ms) => Fast */
  fast_ms?: number;
  /** p95 total_ms under this (ms) => Normal */
  normal_ms?: number;
  /** p95 total_ms under this (ms) => Slow; above => Critical */
  slow_ms?: number;
  /** For voice: p95 RTF (duration_ms/audio_ms) under this => Fast */
  fast_rtf?: number;
  normal_rtf?: number;
  slow_rtf?: number;
}

const DEFAULT_MS = {
  fast_ms: 1000,
  normal_ms: 3000,
  slow_ms: 10000,
};

export const SLO_THRESHOLDS: Record<string, WorkflowSlo> = {
  voice_review: {
    fast_ms: 8000,
    normal_ms: 20000,
    slow_ms: 45000,
    fast_rtf: 0.5,
    normal_rtf: 1.2,
    slow_rtf: 2.0,
  },
  full_voice_review: {
    fast_ms: 15000,
    normal_ms: 60000,
    slow_ms: 120000,
    fast_rtf: 0.5,
    normal_rtf: 1.2,
    slow_rtf: 2.0,
  },
  text_review: { ...DEFAULT_MS },
  ingestion: {
    fast_ms: 2000,
    normal_ms: 8000,
    slow_ms: 30000,
  },
  paste_note: {
    fast_ms: 3000,
    normal_ms: 10000,
    slow_ms: 30000,
  },
};

export function classifyByMs(workflow: string, p95Ms: number): SloBand {
  const s = SLO_THRESHOLDS[workflow] || DEFAULT_MS;
  const fast = s.fast_ms ?? DEFAULT_MS.fast_ms;
  const normal = s.normal_ms ?? DEFAULT_MS.normal_ms;
  const slow = s.slow_ms ?? DEFAULT_MS.slow_ms;
  if (p95Ms <= fast) return "Fast";
  if (p95Ms <= normal) return "Normal";
  if (p95Ms <= slow) return "Slow";
  return "Critical";
}

export function classifyByRtf(workflow: string, p95Rtf: number): SloBand {
  const s = SLO_THRESHOLDS[workflow];
  if (!s?.fast_rtf) return "Normal";
  if (p95Rtf <= s.fast_rtf) return "Fast";
  if (p95Rtf <= (s.normal_rtf ?? 1.2)) return "Normal";
  if (p95Rtf <= (s.slow_rtf ?? 2)) return "Slow";
  return "Critical";
}

/** Overall status: Healthy / Degraded / Outage from worst band in window. */
export function overallStatus(bands: SloBand[]): "Healthy" | "Degraded" | "Outage" {
  if (bands.some((b) => b === "Critical")) return "Outage";
  if (bands.some((b) => b === "Slow")) return "Degraded";
  return "Healthy";
}
