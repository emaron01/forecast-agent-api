export type ConfidenceTone = "good" | "warn" | "bad" | "muted";

export function confidenceFromPct(p: number | null): { label: string; tone: ConfidenceTone } {
  if (p == null || !Number.isFinite(p)) return { label: "Confidence: —", tone: "muted" as const };
  if (p >= 1.0) return { label: "Confidence: High", tone: "good" as const };
  if (p >= 0.9) return { label: "Confidence: Moderate Risk", tone: "warn" as const };
  return { label: "Confidence: High Risk", tone: "bad" as const };
}

export function confidencePillClassFromBand(band: string | null | undefined): "" | "ok" | "warn" | "err" {
  const v = String(band || "").trim().toLowerCase();
  if (v === "high") return "ok";
  if (v === "medium") return "warn";
  if (v === "low") return "err";
  return "";
}

