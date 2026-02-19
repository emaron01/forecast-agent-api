"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import type { ExecRepOption } from "../../../lib/executiveForecastDashboard";
import type { RepDirectoryRow } from "../../../lib/repScope";
import type { QuarterKpisSnapshot } from "../../../lib/quarterKpisSnapshot";
import { DealsDrivingGapHeatmap, type HeatmapDealRow } from "./DealsDrivingGapHeatmap";
import { KpiCardsRow } from "./KpiCardsRow";
import { RiskRadarPlot, type RadarDeal } from "./RiskRadarPlot";
import { palette } from "../../../lib/palette";
import { GapDrivingDealsClient } from "../../../app/analytics/meddpicc-tb/gap-driving-deals/ui/GapDrivingDealsClient";
import { ExecutiveProductPerformance } from "./ExecutiveProductPerformance";
import type { ExecutiveProductPerformanceData } from "../../../lib/executiveProductInsights";
import { PipelineMomentumEngine } from "./PipelineMomentumEngine";
import type { PipelineMomentumData } from "../../../lib/pipelineMomentum";

type RiskCategoryKey =
  | "pain"
  | "metrics"
  | "champion"
  | "criteria"
  | "competition"
  | "timing"
  | "budget"
  | "economic_buyer"
  | "process"
  | "paper"
  | "suppressed";

type DealOut = {
  id: string;
  rep: { rep_public_id: string | null; rep_name: string | null };
  deal_name: { account_name: string | null; opportunity_name: string | null };
  crm_stage: { bucket: "commit" | "best_case" | "pipeline" | null; label: string };
  amount: number;
  health: { health_pct: number | null; suppression: boolean; health_modifier: number };
  weighted: { gap: number; crm_weighted: number; ai_weighted: number };
  meddpicc_tb: Array<{ key: string; score: number | null }>;
  risk_flags: Array<{ key: RiskCategoryKey; label: string }>;
};

type ApiOk = {
  ok: true;
  totals: { crm_outlook_weighted: number; ai_outlook_weighted: number; gap: number };
  shown_totals?: { crm_outlook_weighted: number; ai_outlook_weighted: number; gap: number };
  groups: {
    commit: { label: string; deals: DealOut[]; totals: { crm_weighted: number; ai_weighted: number; gap: number }; shown_totals?: { crm_weighted: number; ai_weighted: number; gap: number } };
    best_case: { label: string; deals: DealOut[]; totals: { crm_weighted: number; ai_weighted: number; gap: number }; shown_totals?: { crm_weighted: number; ai_weighted: number; gap: number } };
    pipeline: { label: string; deals: DealOut[]; totals: { crm_weighted: number; ai_weighted: number; gap: number }; shown_totals?: { crm_weighted: number; ai_weighted: number; gap: number } };
  };
};

type ApiResponse = { ok: false; error: string } | ApiOk;

function asOk(r: ApiResponse | null): ApiOk | null {
  return r && (r as any).ok === true ? (r as any) : null;
}

function asErr(r: ApiResponse | null): { ok: false; error: string } | null {
  return r && (r as any).ok === false ? (r as any) : null;
}

function setParam(params: URLSearchParams, k: string, v: string) {
  if (!v) params.delete(k);
  else params.set(k, v);
}

function riskLabelForKey(k: RiskCategoryKey) {
  if (k === "economic_buyer") return "Economic Buyer Gaps";
  if (k === "paper") return "Paper Process Risk";
  if (k === "process") return "Decision Process Risk";
  if (k === "champion") return "Internal Sponsor Gaps";
  if (k === "criteria") return "Criteria Risk";
  if (k === "competition") return "Competition Risk";
  if (k === "budget") return "Budget Risk";
  if (k === "timing") return "Timing Risk";
  if (k === "pain") return "Pain Risk";
  if (k === "metrics") return "Metrics Risk";
  return "Suppressed Best Case (low score)";
}

function dealTitle(d: DealOut) {
  const a = String(d.deal_name?.account_name || "").trim();
  const o = String(d.deal_name?.opportunity_name || "").trim();
  const t = [a, o].filter(Boolean).join(" — ");
  return t || "(Untitled deal)";
}

function dealAccountLabel(d: DealOut) {
  return String(d.deal_name?.account_name || "").trim() || "(Unknown account)";
}

function dealRep(d: DealOut) {
  return String(d.rep?.rep_name || "").trim() || "—";
}

function bucketLabel(k: any) {
  const s = String(k || "").trim();
  if (s === "commit") return "Commit";
  if (s === "best_case") return "Best Case";
  if (s === "pipeline") return "Pipeline";
  return "Pipeline";
}

function topRiskKeys(d: DealOut, max: number) {
  const keys = (d.risk_flags || [])
    .map((x) => String(x.key || "").trim())
    .filter(Boolean)
    .filter((k, i, arr) => arr.indexOf(k) === i);
  return keys.slice(0, Math.max(0, max));
}

function fmt2(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

function riskToneForDeal(d: DealOut): HeatmapDealRow["riskTone"] {
  if (d.health?.suppression) return "high";
  const hp = d.health?.health_pct;
  const rf = Array.isArray(d.risk_flags) ? d.risk_flags.length : 0;
  if (hp != null && hp < 50) return "high";
  if (rf >= 3) return "high";
  if (hp != null && hp < 80) return "medium";
  if (rf >= 2) return "medium";
  if (rf >= 1) return "low";
  return "muted";
}

function riskLabelForTone(t: HeatmapDealRow["riskTone"]) {
  if (t === "high") return "High";
  if (t === "medium") return "Medium";
  if (t === "low") return "Low";
  return "—";
}

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtNum(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString();
}

function healthPctFrom30(score: any) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  const pct = Math.round((n / 30) * 100);
  return Math.max(0, Math.min(100, pct));
}

function healthColorClass(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-disabled)]";
  if (pct >= 80) return "text-[#2ECC71]";
  if (pct >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

function Chip(props: { label: string; value: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-1 text-[11px] text-[color:var(--sf-text-secondary)]">
      <span className="font-semibold">{props.label}</span>
      <span className="font-mono text-[11px] font-semibold text-[color:var(--sf-text-primary)]">{props.value}</span>
    </span>
  );
}

function rankRole(r: RepDirectoryRow) {
  const role = String(r.role || "").trim().toUpperCase();
  if (role === "EXEC_MANAGER") return 0;
  if (role === "MANAGER") return 1;
  if (role === "REP") return 2;
  return 9;
}

function managerColorForId(id: number) {
  const base = palette.chartSeries;
  const h = hash01(`mgr|${id}`);
  const idx = Math.floor(h * base.length) % base.length;
  return base[idx] || palette.accentSecondary;
}

function fmtPct01(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function deltaTextClass(v: number) {
  if (!Number.isFinite(v) || v === 0) return "text-[color:var(--sf-text-secondary)]";
  return v > 0 ? "text-[#2ECC71]" : "text-[#E74C3C]";
}

function clamp01(v: number) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function confidenceFromPct(p: number | null) {
  if (p == null || !Number.isFinite(p)) return { label: "Confidence: —", tone: "muted" as const };
  if (p >= 1.0) return { label: "Confidence: High", tone: "good" as const };
  if (p >= 0.9) return { label: "Confidence: Moderate Risk", tone: "warn" as const };
  return { label: "Confidence: High Risk", tone: "bad" as const };
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return { r, g, b };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function rgbToCss(c: { r: number; g: number; b: number }) {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}

function gradientColorAt(p: number) {
  const stops = [
    { p: 0.0, c: hexToRgb("#E74C3C") }, // red
    { p: 0.5, c: hexToRgb("#F1C40F") }, // yellow
    { p: 0.8, c: hexToRgb("#2ECC71") }, // light green
    { p: 0.95, c: hexToRgb("#16A34A") }, // dark green at 95%
    { p: 1.0, c: hexToRgb("#16A34A") },
  ];
  const x = clamp01(p);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (x >= a.p && x <= b.p) {
      const t = b.p === a.p ? 0 : (x - a.p) / (b.p - a.p);
      return rgbToCss({ r: lerp(a.c.r, b.c.r, t), g: lerp(a.c.g, b.c.g, t), b: lerp(a.c.b, b.c.b, t) });
    }
  }
  return rgbToCss(stops[stops.length - 1].c);
}

function hash01(s: string) {
  // Deterministic pseudo-random 0..1 for stable colors/jitter.
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = h >>> 0;
  return (u % 10000) / 9999;
}

function colorForDealId(id: string) {
  const base = palette.chartSeries;
  const h = hash01(id);
  const idx = Math.floor(h * base.length) % base.length;
  const tweak = (hash01(id + "|t") - 0.5) * 0.22;
  // Return a CSS color-mix string so we stay within design tokens.
  const mixPct = Math.round(clamp01(0.68 + tweak) * 100);
  return `color-mix(in srgb, ${base[idx]} ${mixPct}%, white)`;
}

export function ExecutiveGapInsightsClient(props: {
  basePath: string;
  periods: Array<{ id: string; fiscal_year: string; fiscal_quarter: string; period_name: string; period_start: string; period_end: string }>;
  quotaPeriodId: string;
  reps: ExecRepOption[];
  fiscalYear: string;
  fiscalQuarter: string;
  stageProbabilities: { commit: number; best_case: number; pipeline: number };
  healthModifiers: { commit_modifier: number; best_case_modifier: number; pipeline_modifier: number };
  repDirectory: RepDirectoryRow[];
  myRepId: number | null;
  repRollups: Array<{
    rep_id: string;
    rep_name: string;
    commit_amount: number;
    best_case_amount: number;
    pipeline_amount: number;
    won_amount: number;
    won_count: number;
  }>;
  productsClosedWon: Array<{
    product: string;
    won_amount: number;
    won_count: number;
    avg_order_value: number;
    avg_health_score: number | null;
  }>;
  productsClosedWonByRep: Array<{
    rep_name: string;
    product: string;
    won_amount: number;
    won_count: number;
    avg_order_value: number;
    avg_health_score: number | null;
  }>;
  quarterKpis: QuarterKpisSnapshot | null;
  pipelineMomentum: PipelineMomentumData | null;
  quota: number;
  aiForecast: number;
  crmForecast: number;
  gap: number;
  bucketDeltas: { commit: number; best_case: number; pipeline: number };
  aiPctToGoal: number | null;
  leftToGo: number;
  defaultTopN?: number;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [analysisData, setAnalysisData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [heroAiText, setHeroAiText] = useState<string>("");
  const [heroAiLoading, setHeroAiLoading] = useState(false);
  const [radarAiText, setRadarAiText] = useState<string>("");
  const [radarAiLoading, setRadarAiLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [topN, setTopN] = useState(Math.max(1, props.defaultTopN || 15));
  const [stageView, setStageView] = useState<"commit" | "best_case" | "pipeline" | "all">("all");
  const [createdPipelineOpen, setCreatedPipelineOpen] = useState(false);

  const quotaPeriodId = String(sp.get("quota_period_id") || props.quotaPeriodId || "").trim();
  const teamRepIdRaw = String(sp.get("team_rep_id") || "").trim();
  const teamRepId = Number(teamRepIdRaw);
  const teamRepIdValue = Number.isFinite(teamRepId) && teamRepId > 0 ? String(teamRepId) : "";
  const riskCategory = String(sp.get("risk_category") || "").trim();
  const mode = String(sp.get("mode") || "drivers").trim() === "risk" ? "risk" : "drivers";
  const scoreDrivenOnly = String(sp.get("driver_require_score_effect") || sp.get("risk_require_score_effect") || "1").trim() !== "0";
  const gapDrawerOpen = String(sp.get("gap_drawer") || "").trim() === "1";
  const [gapDrawerMounted, setGapDrawerMounted] = useState(false);

  useEffect(() => {
    if (gapDrawerOpen) setGapDrawerMounted(true);
  }, [gapDrawerOpen]);

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams(sp.toString());
    // Ensure quarter selection is always honored.
    setParam(params, "quota_period_id", quotaPeriodId);
    // CRO/VP default: include ALL stages unless user explicitly filters buckets.
    const hasAnyBucket =
      params.has("bucket_commit") || params.has("bucket_best_case") || params.has("bucket_pipeline");
    if (!hasAnyBucket) {
      params.set("bucket_commit", "1");
      params.set("bucket_best_case", "1");
      params.set("bucket_pipeline", "1");
    }
    return `/api/forecast/gap-driving-deals?${params.toString()}`;
  }, [sp, quotaPeriodId]);

  const analysisApiUrl = useMemo(() => {
    const params = new URLSearchParams(sp.toString());
    setParam(params, "quota_period_id", quotaPeriodId);

    const hasAnyBucket =
      params.has("bucket_commit") || params.has("bucket_best_case") || params.has("bucket_pipeline");
    if (!hasAnyBucket) {
      params.set("bucket_commit", "1");
      params.set("bucket_best_case", "1");
      params.set("bucket_pipeline", "1");
    }

    // Force an "at-risk" pull so strategic takeaways reflect the full downside set
    // (not only the driver subset / topN slice).
    params.set("mode", "risk");
    params.set("risk_take_per_bucket", "2000");
    params.set("limit", "2000");

    return `/api/forecast/gap-driving-deals?${params.toString()}`;
  }, [sp, quotaPeriodId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${apiUrl}${apiUrl.includes("?") ? "&" : "?"}_r=${refreshNonce}`, { method: "GET" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setData(j as ApiResponse);
      })
      .catch((e) => {
        if (!cancelled) setData({ ok: false, error: String(e?.message || e) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, refreshNonce]);

  useEffect(() => {
    let cancelled = false;
    setAnalysisLoading(true);
    fetch(`${analysisApiUrl}${analysisApiUrl.includes("?") ? "&" : "?"}_r=${refreshNonce}`, { method: "GET" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setAnalysisData(j as ApiResponse);
      })
      .catch((e) => {
        if (!cancelled) setAnalysisData({ ok: false, error: String(e?.message || e) });
      })
      .finally(() => {
        if (!cancelled) setAnalysisLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analysisApiUrl, refreshNonce]);

  const ok = asOk(data);
  const err = asErr(data);
  const analysisOk = asOk(analysisData);

  const stageDeals = useMemo(() => {
    if (!ok) return [] as DealOut[];
    if (stageView === "commit") return ok.groups.commit.deals || [];
    if (stageView === "best_case") return ok.groups.best_case.deals || [];
    if (stageView === "pipeline") return ok.groups.pipeline.deals || [];
    return [...(ok.groups.commit.deals || []), ...(ok.groups.best_case.deals || []), ...(ok.groups.pipeline.deals || [])];
  }, [ok, stageView]);

  const flattenedDeals = useMemo(() => {
    const d = ok;
    if (!d) return [] as DealOut[];
    return [...(d.groups.commit.deals || []), ...(d.groups.best_case.deals || []), ...(d.groups.pipeline.deals || [])];
  }, [ok]);

  const analysisFlattenedDeals = useMemo(() => {
    const d = analysisOk;
    if (!d) return [] as DealOut[];
    return [...(d.groups.commit.deals || []), ...(d.groups.best_case.deals || []), ...(d.groups.pipeline.deals || [])];
  }, [analysisOk]);

  const heroTakeawayPayload = useMemo(() => {
    const deals = analysisFlattenedDeals.length ? analysisFlattenedDeals : flattenedDeals;
    const overallGap = Number((analysisOk?.totals?.gap ?? ok?.totals?.gap ?? props.gap) || 0) || 0;
    const atRisk = deals.filter((d) => Number(d.weighted?.gap || 0) < 0);
    const gapToClose = overallGap < 0 ? Math.abs(overallGap) : 0;
    const sorted = atRisk
      .slice()
      .map((d) => ({ d, v: Math.abs(Math.min(0, Number(d.weighted?.gap || 0) || 0)) }))
      .sort((a, b) => b.v - a.v);
    let cum = 0;
    let needed = 0;
    for (const x of sorted) {
      if (x.v <= 0) continue;
      needed += 1;
      cum += x.v;
      if (cum >= gapToClose && gapToClose > 0) break;
    }
    const byBucket = atRisk.reduce(
      (acc, d) => {
        const b = String(d.crm_stage?.bucket || "pipeline") as "commit" | "best_case" | "pipeline";
        acc[b] = (acc[b] || 0) + 1;
        return acc;
      },
      { commit: 0, best_case: 0, pipeline: 0 } as Record<"commit" | "best_case" | "pipeline", number>
    );
    const avgAmount =
      atRisk.length > 0 ? atRisk.reduce((acc, d) => acc + (Number(d.amount || 0) || 0), 0) / atRisk.length : null;

    const topDeals = sorted.slice(0, 25).map(({ d, v }) => ({
      id: String(d.id),
      title: dealTitle(d),
      rep: dealRep(d),
      bucket: String(d.crm_stage?.label || "").trim() || "—",
      amount: Number(d.amount || 0) || 0,
      downside_gap_abs: v,
      health_modifier: Number(d.health?.health_modifier ?? 1) || 1,
      top_risks: (d.risk_flags || []).slice(0, 4).map((r) => String(r.label || "")),
    }));

    return {
      fiscal_year: props.fiscalYear,
      fiscal_quarter: props.fiscalQuarter,
      quota_period_id: quotaPeriodId,
      overall_gap: overallGap,
      gap_to_close: gapToClose,
      at_risk_count: atRisk.length,
      at_risk_by_bucket: byBucket,
      at_risk_avg_amount: avgAmount,
      min_deals_to_close_gap: gapToClose > 0 ? needed : 0,
      single_deal_can_close_gap: gapToClose > 0 ? (sorted[0]?.v || 0) >= gapToClose : false,
      top_at_risk_deals: topDeals,
      left_to_go: props.leftToGo,
    };
  }, [analysisFlattenedDeals, flattenedDeals, analysisOk?.totals?.gap, ok?.totals?.gap, props.gap, props.fiscalYear, props.fiscalQuarter, quotaPeriodId, props.leftToGo]);

  const lastHeroAiKey = useRef<string>("");
  const lastRadarAiKey = useRef<string>("");

  useEffect(() => {
    if (!heroTakeawayPayload?.quota_period_id) return;
    // Avoid spam: re-run when the core analysis inputs change.
    const key = [
      heroTakeawayPayload.quota_period_id,
      heroTakeawayPayload.overall_gap,
      heroTakeawayPayload.at_risk_count,
      heroTakeawayPayload.min_deals_to_close_gap,
      refreshNonce,
    ].join("|");
    if (key === lastHeroAiKey.current) return;
    lastHeroAiKey.current = key;

    let cancelled = false;
    setHeroAiLoading(true);
    fetch("/api/forecast/ai-strategic-takeaway", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surface: "hero", payload: heroTakeawayPayload }),
    })
      .then((r) => r.json())
      .then((j) => {
        const t = String(j?.text || "").trim();
        if (!cancelled) setHeroAiText(t);
      })
      .catch(() => {
        if (!cancelled) setHeroAiText("");
      })
      .finally(() => {
        if (!cancelled) setHeroAiLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [heroTakeawayPayload, refreshNonce]);

  const sortedDeals = useMemo(() => {
    const overallGap = ok?.totals?.gap ?? 0;
    const dir = overallGap < 0 ? -1 : overallGap > 0 ? 1 : -1;
    return stageDeals.slice().sort((a, b) => (dir < 0 ? a.weighted.gap - b.weighted.gap : b.weighted.gap - a.weighted.gap));
  }, [stageDeals, ok]);

  const heatmapRows: HeatmapDealRow[] = useMemo(() => {
    return sortedDeals.slice(0, topN).map((d) => {
      const tone = riskToneForDeal(d);
      const id = String(d.id);
      return {
        id,
        riskTone: tone,
        riskLabel: riskLabelForTone(tone),
        dealColor: Number(d.weighted?.gap || 0) < 0 ? colorForDealId(id) : null,
        dealName: dealTitle(d),
        repName: dealRep(d),
        bucketLabel: String(d.crm_stage?.label || "").trim() || "—",
        amount: Number(d.amount || 0) || 0,
        healthPct: d.health?.health_pct ?? null,
        gap: Number(d.weighted?.gap || 0) || 0,
      };
    });
  }, [sortedDeals, topN]);

  const dealRiskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of flattenedDeals) {
      const uniqKeys = new Set<string>((d.risk_flags || []).map((x) => String(x.key)));
      for (const k of uniqKeys) counts.set(k, (counts.get(k) || 0) + 1);
    }
    return counts;
  }, [flattenedDeals]);

  const dealsAtRisk = useMemo(() => {
    return flattenedDeals.filter((d) => Number(d.weighted?.gap || 0) < 0).length;
  }, [flattenedDeals]);

  const radarDeals: RadarDeal[] = useMemo(() => {
    // Tie radar to the exact deals shown in the list (topN).
    const shown = sortedDeals.slice(0, topN).filter((d) => Number(d.weighted?.gap || 0) < 0);
    return shown.map((d) => ({
      id: String(d.id),
      label: dealTitle(d),
      legendLabel: dealAccountLabel(d),
      color: colorForDealId(String(d.id)),
      meddpicc_tb: (d.meddpicc_tb || []).map((c) => ({ key: String(c.key || ""), score: c.score == null ? null : (Number(c.score) as any) })),
    }));
  }, [sortedDeals, topN]);

  const quarterDrivers = useMemo(() => {
    const deals = analysisFlattenedDeals.length ? analysisFlattenedDeals : flattenedDeals;
    const byBucket = new Map<string, number>();
    const byRep = new Map<string, number>();
    const riskCounts = new Map<string, number>();
    const modAgg = new Map<string, { n: number; sum: number; suppressed: number }>();
    let worst: DealOut | null = null;
    let best: DealOut | null = null;

    for (const d of deals) {
      const gap = Number(d.weighted?.gap || 0) || 0;
      const b = String(d.crm_stage?.bucket || "");
      byBucket.set(b, (byBucket.get(b) || 0) + gap);

      const rep = dealRep(d);
      byRep.set(rep, (byRep.get(rep) || 0) + gap);

      const hm = Number(d.health?.health_modifier);
      if (Number.isFinite(hm)) {
        const a = modAgg.get(b) || { n: 0, sum: 0, suppressed: 0 };
        a.n += 1;
        a.sum += hm;
        if (d.health?.suppression) a.suppressed += 1;
        modAgg.set(b, a);
      }

      const uniq = new Set<string>((d.risk_flags || []).map((x) => String(x.key)));
      for (const k of uniq) riskCounts.set(k, (riskCounts.get(k) || 0) + 1);

      if (!worst || gap < (Number(worst.weighted?.gap || 0) || 0)) worst = d;
      if (!best || gap > (Number(best.weighted?.gap || 0) || 0)) best = d;
    }

    const bucketList = Array.from(byBucket.entries())
      .map(([k, v]) => ({ k: k || "pipeline", v }))
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    const topBucket = bucketList[0] || null;
    const topBucketLabel = topBucket?.k === "commit" ? "Commit" : topBucket?.k === "best_case" ? "Best Case" : "Pipeline";

    const repList = Array.from(byRep.entries())
      .map(([rep, v]) => ({ rep, v }))
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    const topRep = repList[0] || null;

    const riskList = Array.from(riskCounts.entries())
      .map(([k, c]) => ({ k, c }))
      .sort((a, b) => b.c - a.c);
    const topRisks = riskList.slice(0, 2);

    const bullets: string[] = [];
    const overallGap = Number((analysisOk?.totals?.gap ?? ok?.totals?.gap ?? props.gap) || 0) || 0;
    const atRiskDeals = deals.filter((d) => Number(d.weighted?.gap || 0) < 0);
    const atRiskCount = atRiskDeals.length;
    const atRiskAvgAmount =
      atRiskCount > 0 ? atRiskDeals.reduce((acc, d) => acc + (Number(d.amount || 0) || 0), 0) / atRiskCount : null;
    const totalDownsideAbs = atRiskDeals.reduce((acc, d) => acc + Math.abs(Math.min(0, Number(d.weighted?.gap || 0) || 0)), 0);

    if (overallGap < 0 && atRiskCount > 0) {
      const gapToClose = Math.abs(overallGap);
      const recapture = atRiskDeals
        .map((d) => ({ d, v: Math.abs(Math.min(0, Number(d.weighted?.gap || 0) || 0)) }))
        .sort((a, b) => b.v - a.v);
      let cum = 0;
      let needed = 0;
      const picks: DealOut[] = [];
      for (const x of recapture) {
        if (x.v <= 0) continue;
        needed += 1;
        cum += x.v;
        picks.push(x.d);
        if (cum >= gapToClose) break;
      }
      const canCloseWithOne = recapture[0]?.v != null && recapture[0].v >= gapToClose;
      const exampleDeal = picks[0] ? dealTitle(picks[0]) : "";
      bullets.push(
        `AI Adjustment vs CRM is ${fmtMoney(overallGap)}. Downside is distributed across ${atRiskCount} at-risk deal(s) (avg amount ${atRiskAvgAmount == null ? "—" : fmtMoney(atRiskAvgAmount)}), with ${fmtMoney(totalDownsideAbs)} total downside capacity if fully de-risked.`
      );
      bullets.push(
        canCloseWithOne
          ? `If leadership helps push just 1 at-risk deal across the finish line (e.g., ${exampleDeal}), the entire ${fmtMoney(Math.abs(overallGap))} GAP is covered and forecast returns to CRM expectation.`
          : needed > 1
            ? `To close the ${fmtMoney(Math.abs(overallGap))} GAP, focus on the top ${needed} at-risk deal(s) by downside impact; together they cover ~${Math.min(100, Math.round((cum / gapToClose) * 100))}%.`
            : `To close the ${fmtMoney(Math.abs(overallGap))} GAP, focus on the largest downside deals first; the top deal alone recaptures ${fmtMoney(recapture[0]?.v || 0)}.`
      );
    } else if (overallGap > 0) {
      bullets.push(`AI Adjustment vs CRM is +${fmtMoney(overallGap)} (AI above CRM expectation). Protect the number by preventing new MEDDPICC gaps from emerging in Commit.`);
    } else {
      bullets.push("AI Adjustment vs CRM is neutral. Maintain forecast discipline by tightening MEDDPICC evidence on late-stage deals.");
    }

    if (topBucket && Math.abs(topBucket.v) >= 1) {
      bullets.push(`${topBucketLabel} is driving the largest AI adjustment vs CRM (${fmtMoney(topBucket.v)}).`);
    }

    if (topBucket) {
      const a = modAgg.get(topBucket.k) || null;
      const avg = a && a.n ? a.sum / a.n : null;
      if (avg != null && Number.isFinite(avg)) {
        const pctDisc = Math.round((1 - avg) * 100);
        const sup = a?.suppressed || 0;
        if (pctDisc > 0) bullets.push(`${topBucketLabel} is discounted ~${pctDisc}% by health-score rules (suppressed: ${sup}).`);
        else if (pctDisc < 0) bullets.push(`${topBucketLabel} is uplifted ~${Math.abs(pctDisc)}% by health-score rules (suppressed: ${sup}).`);
      }
    }

    if (topRisks.length) {
      const a = topRisks[0];
      const b = topRisks[1];
      const aLabel = riskLabelForKey(a.k as any);
      const bLabel = b ? riskLabelForKey(b.k as any) : "";
      bullets.push(b ? `Top MEDDPICC patterns: ${aLabel} (${a.c} deals), ${bLabel} (${b.c} deals).` : `Top MEDDPICC pattern: ${aLabel} (${a.c} deals).`);
    }

    if (topRep && deals.length && topRep.rep !== "—") {
      bullets.push(`${topRep.rep} accounts for ${fmtMoney(topRep.v)} of the AI vs CRM adjustment across the displayed deals.`);
    }

    const drags = deals
      .filter((d) => Number(d.weighted?.gap || 0) < 0)
      .slice()
      .sort((a, b) => (Number(a.weighted?.gap || 0) || 0) - (Number(b.weighted?.gap || 0) || 0))
      .slice(0, 2);

    if (drags.length) {
      for (const d of drags) {
        const hm = Number(d.health?.health_modifier);
        const hmText = Number.isFinite(hm) ? `${fmt2(1)}→${fmt2(hm)}` : "—";
        const stage = bucketLabel(d.crm_stage?.bucket);
        const gap = Number(d.weighted?.gap || 0) || 0;
        const risks = topRiskKeys(d, 3).map((k) => riskLabelForKey(k as any));
        const riskText = risks.length ? `; risks: ${risks.join(", ")}` : "";
        const suppressionNote = d.health?.suppression ? " (suppressed)" : "";
        bullets.push(`Drag deal: ${dealTitle(d)} — ${stage}${suppressionNote}, gap ${fmtMoney(gap)}, modifier ${hmText}${riskText}.`);
      }
    }

    const highlight =
      props.gap < 0
        ? worst && Number(worst.weighted?.gap || 0) < 0
          ? `Largest downside deal: ${dealTitle(worst)} (${fmtMoney(Number(worst.weighted?.gap || 0) || 0)}).`
          : ""
        : best && Number(best.weighted?.gap || 0) > 0
          ? `Largest upside deal: ${dealTitle(best)} (${fmtMoney(Number(best.weighted?.gap || 0) || 0)}).`
          : "";
    if (highlight) bullets.push(highlight);

    if (props.leftToGo > 0) {
      bullets.push(
        "Early-quarter outlooks typically improve as deals progress. Fastest reversal levers: focus on the top drag deals, close their highest-impact MEDDPICC gaps, and lift/unsuppress their health modifiers in the current bucket."
      );
    } else if (props.leftToGo <= 0) {
      bullets.push(
        "As the quarter progresses, outlook typically firms up. Protect the number by watching the top drag deals and preventing new MEDDPICC gaps from emerging in Commit."
      );
    }

    return { bullets: bullets.filter(Boolean).slice(0, 4), usingFullRiskSet: analysisFlattenedDeals.length > 0, loading: analysisLoading };
  }, [analysisFlattenedDeals, flattenedDeals, analysisOk?.totals?.gap, ok?.totals?.gap, props.leftToGo, props.gap, analysisLoading]);

  const radarStrategicTakeaway = useMemo(() => {
    const shown = sortedDeals.slice(0, topN).filter((d) => Number(d.weighted?.gap || 0) < 0);
    const isRiskScore = (score: number | null) => {
      if (score == null) return true;
      if (!Number.isFinite(score)) return true;
      return score <= 1;
    };

    const gapAbs = shown.reduce((acc, d) => acc + Math.abs(Math.min(0, Number(d.weighted?.gap || 0) || 0)), 0);

    const catCounts = new Map<string, { key: string; label: string; count: number; tips: string[] }>();
    const repGap = new Map<string, number>();
    const repCat = new Map<string, Map<string, number>>();
    const dealGapCount = new Map<string, number>();

    for (const d of shown) {
      const rep = dealRep(d);
      repGap.set(rep, (repGap.get(rep) || 0) + Math.abs(Math.min(0, Number(d.weighted?.gap || 0) || 0)));

      const rc = repCat.get(rep) || new Map<string, number>();
      repCat.set(rep, rc);

      let gaps = 0;
      for (const c of d.meddpicc_tb || []) {
        const key = String(c.key || "").trim();
        if (!key) continue;
        const score = c.score == null ? null : Number(c.score);
        if (!isRiskScore(score)) continue;
        gaps += 1;
        const label = key === "economic_buyer" ? "Economic Buyer" : key === "paper" ? "Paper Process" : key === "process" ? "Decision Process" : key[0].toUpperCase() + key.slice(1).replace(/_/g, " ");
        const cur = catCounts.get(key) || { key, label, count: 0, tips: [] as string[] };
        cur.count += 1;
        const tip = String((c as any).tip || "").trim();
        if (tip && !cur.tips.includes(tip)) cur.tips.push(tip);
        catCounts.set(key, cur);
        rc.set(key, (rc.get(key) || 0) + 1);
      }
      dealGapCount.set(String(d.id), gaps);
    }

    const topCats = Array.from(catCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    const topReps = Array.from(repGap.entries())
      .filter(([k]) => k !== "—")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([rep, v]) => ({ rep, v }));

    const repTrends = topReps.map((r) => {
      const m = repCat.get(r.rep) || new Map<string, number>();
      const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0] || null;
      const label = top ? (catCounts.get(top[0])?.label || top[0]) : null;
      return { rep: r.rep, gapAbs: r.v, topGapKey: top?.[0] || null, topGapLabel: label, topGapCount: top?.[1] || 0 };
    });

    const quickWins = shown
      .slice()
      .map((d) => ({
        id: String(d.id),
        title: dealTitle(d),
        amount: Number(d.amount || 0) || 0,
        gapAbs: Math.abs(Math.min(0, Number(d.weighted?.gap || 0) || 0)),
        gapCount: dealGapCount.get(String(d.id)) ?? 0,
      }))
      .filter((x) => x.gapCount > 0)
      .sort((a, b) => a.gapCount - b.gapCount || b.amount - a.amount)
      .slice(0, 3);

    return { shownCount: shown.length, gapAbs, topCats, repTrends, quickWins };
  }, [sortedDeals, topN]);

  const radarTakeawayPayload = useMemo(() => {
    return {
      fiscal_year: props.fiscalYear,
      fiscal_quarter: props.fiscalQuarter,
      quota_period_id: quotaPeriodId,
      radar_slice: {
        shown_at_risk_count: radarStrategicTakeaway.shownCount,
        downside_gap_abs: radarStrategicTakeaway.gapAbs,
        top_meddpicc_gaps: radarStrategicTakeaway.topCats.map((c) => ({ key: c.key, label: c.label, count: c.count, tip: c.tips?.[0] || null })),
        rep_trends: radarStrategicTakeaway.repTrends.map((r) => ({
          rep: r.rep,
          downside_gap_abs: r.gapAbs,
          trend_gap: r.topGapLabel ? { label: r.topGapLabel, count: r.topGapCount } : null,
        })),
        coaching_targets: radarStrategicTakeaway.quickWins.map((d) => ({
          title: d.title,
          amount: d.amount,
          downside_gap_abs: d.gapAbs,
          gap_count: d.gapCount,
        })),
      },
    };
  }, [props.fiscalYear, props.fiscalQuarter, quotaPeriodId, radarStrategicTakeaway]);

  useEffect(() => {
    if (!radarTakeawayPayload?.quota_period_id) return;
    const key = [
      radarTakeawayPayload.quota_period_id,
      radarTakeawayPayload.radar_slice?.shown_at_risk_count || 0,
      radarTakeawayPayload.radar_slice?.downside_gap_abs || 0,
      topN,
      stageView,
      refreshNonce,
    ].join("|");
    if (key === lastRadarAiKey.current) return;
    lastRadarAiKey.current = key;

    let cancelled = false;
    setRadarAiLoading(true);
    fetch("/api/forecast/ai-strategic-takeaway", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surface: "radar", payload: radarTakeawayPayload }),
    })
      .then((r) => r.json())
      .then((j) => {
        const t = String(j?.text || "").trim();
        if (!cancelled) setRadarAiText(t);
      })
      .catch(() => {
        if (!cancelled) setRadarAiText("");
      })
      .finally(() => {
        if (!cancelled) setRadarAiLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [radarTakeawayPayload, topN, stageView, refreshNonce]);

  const viewFullHref = useMemo(() => {
    const params = new URLSearchParams(sp.toString());
    // Ensure we can deep-link the same filters into the existing report.
    setParam(params, "quota_period_id", quotaPeriodId);
    const qs = params.toString();
    return qs ? `/analytics/meddpicc-tb/gap-driving-deals?${qs}` : "/analytics/meddpicc-tb/gap-driving-deals";
  }, [sp, quotaPeriodId]);

  const bucketParamsForStageView = useMemo(() => {
    return stageView === "commit"
      ? { c: "1", b: "0", p: "0" }
      : stageView === "best_case"
        ? { c: "0", b: "1", p: "0" }
        : stageView === "pipeline"
          ? { c: "0", b: "0", p: "1" }
          : { c: "1", b: "1", p: "1" };
  }, [stageView]);

  const quarterAnalytics = useMemo(() => {
    const repRows = Array.isArray(props.repRollups) ? props.repRollups : [];
    const dir = Array.isArray(props.repDirectory) ? props.repDirectory : [];

    const byId = new Map<number, RepDirectoryRow>();
    for (const r of dir) {
      const id = Number(r.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      byId.set(id, r);
    }

    const wonById = new Map<number, { wonAmount: number; wonCount: number }>();
    for (const r of repRows) {
      const id = Number((r as any).rep_id);
      if (!Number.isFinite(id) || id <= 0) continue;
      wonById.set(id, {
        wonAmount: Number((r as any).won_amount || 0) || 0,
        wonCount: Number((r as any).won_count || 0) || 0,
      });
    }

    const children = new Map<number, RepDirectoryRow[]>();
    for (const r of dir) {
      const mid = r.manager_rep_id;
      if (mid == null || !Number.isFinite(mid)) continue;
      const arr = children.get(mid) || [];
      arr.push(r);
      children.set(mid, arr);
    }
    for (const [mid, arr] of children.entries()) {
      arr.sort((a, b) => {
        const dr = rankRole(a) - rankRole(b);
        if (dr !== 0) return dr;
        const dn = String(a.name || "").localeCompare(String(b.name || ""));
        if (dn !== 0) return dn;
        return Number(a.id) - Number(b.id);
      });
      children.set(mid, arr);
    }

    const repIdsInScope = dir
      .filter((r) => String(r.role || "").trim().toUpperCase() === "REP")
      .map((r) => Number(r.id))
      .filter((n) => Number.isFinite(n) && n > 0);

    const uniqueRepIds = Array.from(new Set(repIdsInScope));

    function statsForRepIds(repIds: number[]) {
      let wonAmount = 0;
      let wonCount = 0;
      for (const id of repIds) {
        const v = wonById.get(id);
        if (!v) continue;
        wonAmount += v.wonAmount;
        wonCount += v.wonCount;
      }
      const aov = wonCount > 0 ? wonAmount / wonCount : null;
      return { wonAmount, wonCount, aov };
    }

    function descendantRepIds(rootId: number) {
      const out: number[] = [];
      const stack: number[] = [rootId];
      const seen = new Set<number>();
      while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        const kids = children.get(cur) || [];
        for (const k of kids) stack.push(Number(k.id));
        const node = byId.get(cur) || null;
        if (node && String(node.role || "").trim().toUpperCase() === "REP") out.push(cur);
      }
      return out;
    }

    const directReports =
      props.myRepId != null && Number.isFinite(props.myRepId) ? children.get(Number(props.myRepId)) || [] : [];

    return {
      total: statsForRepIds(uniqueRepIds),
      directReports,
      children,
      byId,
      descendantRepIds,
      statsForRepIds,
    };
  }, [props.repRollups, props.repDirectory, props.myRepId]);

  const createdPipelineTree = useMemo(() => {
    const q = props.quarterKpis;
    const dir = Array.isArray(props.repDirectory) ? props.repDirectory : [];
    const byId = quarterAnalytics.byId as Map<number, RepDirectoryRow>;
    const children = quarterAnalytics.children as Map<number, RepDirectoryRow[]>;

    type RepMetrics = {
      commitAmount: number;
      commitCount: number;
      bestAmount: number;
      bestCount: number;
      pipelineAmount: number;
      pipelineCount: number;
      wonAmount: number;
      wonCount: number;
      lostAmount: number;
      lostCount: number;
    };

    const byRepId = new Map<number, RepMetrics>();
    for (const m of q?.createdPipelineByManager || []) {
      for (const r of (m as any).reps || []) {
        const id = Number((r as any).repId);
        if (!Number.isFinite(id) || id <= 0) continue;
        byRepId.set(id, {
          commitAmount: Number((r as any).commitAmount || 0) || 0,
          commitCount: Number((r as any).commitCount || 0) || 0,
          bestAmount: Number((r as any).bestAmount || 0) || 0,
          bestCount: Number((r as any).bestCount || 0) || 0,
          pipelineAmount: Number((r as any).pipelineAmount || 0) || 0,
          pipelineCount: Number((r as any).pipelineCount || 0) || 0,
          wonAmount: Number((r as any).wonAmount || 0) || 0,
          wonCount: Number((r as any).wonCount || 0) || 0,
          lostAmount: Number((r as any).lostAmount || 0) || 0,
          lostCount: Number((r as any).lostCount || 0) || 0,
        });
      }
    }

    function statsForRepIds(repIds: number[]) {
      const out: RepMetrics = {
        commitAmount: 0,
        commitCount: 0,
        bestAmount: 0,
        bestCount: 0,
        pipelineAmount: 0,
        pipelineCount: 0,
        wonAmount: 0,
        wonCount: 0,
        lostAmount: 0,
        lostCount: 0,
      };
      for (const id of repIds) {
        const v = byRepId.get(id);
        if (!v) continue;
        out.commitAmount += v.commitAmount;
        out.commitCount += v.commitCount;
        out.bestAmount += v.bestAmount;
        out.bestCount += v.bestCount;
        out.pipelineAmount += v.pipelineAmount;
        out.pipelineCount += v.pipelineCount;
        out.wonAmount += v.wonAmount;
        out.wonCount += v.wonCount;
        out.lostAmount += v.lostAmount;
        out.lostCount += v.lostCount;
      }
      return out;
    }

    const myId = props.myRepId != null && Number.isFinite(props.myRepId) ? Number(props.myRepId) : null;
    const myRole = myId != null ? String(byId.get(myId)?.role || "").trim().toUpperCase() : "";

    const roots = dir.filter((r) => {
      const role = String(r.role || "").trim().toUpperCase();
      if (role === "REP") return false;
      const mid = r.manager_rep_id;
      return mid == null || !byId.has(Number(mid));
    });

    const direct = myId != null ? (children.get(myId) || []).filter((r) => String(r.role || "").trim().toUpperCase() !== "REP") : [];

    const leaders = myRole === "EXEC_MANAGER" ? (direct.length ? direct : roots) : myRole === "MANAGER" && myId != null ? (children.get(myId) || []) : roots;

    return { byRepId, statsForRepIds, leaders, myRole, byId, children };
  }, [props.quarterKpis, props.repDirectory, props.myRepId, quarterAnalytics]);

  const productViz = useMemo<ExecutiveProductPerformanceData>(() => {
    const rows = Array.isArray(props.productsClosedWon) ? props.productsClosedWon : [];
    const totalRevenue = rows.reduce((acc, r) => acc + (Number((r as any).won_amount || 0) || 0), 0);
    const totalOrders = rows.reduce((acc, r) => acc + (Number((r as any).won_count || 0) || 0), 0);
    const blendedAcv = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    return {
      summary: { total_revenue: totalRevenue, total_orders: totalOrders, blended_acv: blendedAcv },
      products: rows.map((r) => ({
        name: String((r as any).product || "").trim() || "(Unspecified)",
        revenue: Number((r as any).won_amount || 0) || 0,
        orders: Number((r as any).won_count || 0) || 0,
        health_score: healthPctFrom30((r as any).avg_health_score),
      })),
    };
  }, [props.productsClosedWon]);

  function updateUrl(mut: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(sp.toString());
    mut(params);
    router.replace(`${props.basePath}?${params.toString()}`);
  }

  return (
    <div className="grid gap-4">
      <section className="w-full rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-6 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="flex items-center justify-center">
              <div className="relative w-[320px] max-w-[85vw] shrink-0 aspect-[2048/1365] sm:w-[420px]">
                <Image
                  src="/brand/logooutlook.png"
                  alt="SalesForecast.io Outlook"
                  fill
                  sizes="(min-width: 640px) 420px, 320px"
                  className="object-contain"
                  priority={true}
                />
              </div>
            </div>

            <div className="mt-4">
              <div className="text-left">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Quarter End Outlook</div>
                <div className="mt-1 font-mono text-5xl font-extrabold tracking-tight text-[color:var(--sf-text-primary)] sm:text-6xl">
                  {props.aiPctToGoal == null || !Number.isFinite(props.aiPctToGoal) ? "—" : `${Math.round(props.aiPctToGoal * 100)}%`}
                </div>
              </div>

              <div className="mt-2 flex items-end gap-[2px]">
                {(() => {
                  const segments = 52;
                  const pct = props.aiPctToGoal == null ? 0 : clamp01(props.aiPctToGoal);
                  const filled = Math.round(pct * segments);
                  const minH = 10;
                  const maxH = 34;
                  const exp = 3.6; // "hockey stick" height progression
                  return Array.from({ length: segments }).map((_, i) => {
                    const t = segments <= 1 ? 1 : i / (segments - 1);
                    const fillColor = gradientColorAt(t);
                    const bg = i < filled ? fillColor : "var(--sf-surface-alt)";
                    const h = minH + (maxH - minH) * Math.pow(t, exp);
                    return (
                      <div
                        key={i}
                        className="w-[12px] rounded-[3px] border border-[color:var(--sf-border)]"
                        style={{ background: bg, height: `${Math.round(h)}px` }}
                        aria-hidden="true"
                      />
                    );
                  });
                })()}
              </div>

              {(() => {
                const c = confidenceFromPct(props.aiPctToGoal);
                const pill =
                  c.tone === "good"
                    ? "border-[#2ECC71]/40 bg-[#2ECC71]/12 text-[#2ECC71]"
                    : c.tone === "warn"
                      ? "border-[#F1C40F]/50 bg-[#F1C40F]/12 text-[#F1C40F]"
                      : c.tone === "bad"
                        ? "border-[#E74C3C]/45 bg-[#E74C3C]/12 text-[#E74C3C]"
                        : "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]";
                return (
                  <div className="mt-5">
                    <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${pill}`}>{c.label}</span>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
                This Quarter’s Outlook Driven By: ✨ AI Strategic Takeaway
              </div>
              <ul className="mt-2 grid gap-2 text-sm text-[color:var(--sf-text-primary)]">
                {quarterDrivers.bullets.length ? (
                  quarterDrivers.bullets.map((b, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span className="text-[color:var(--sf-accent-secondary)]">•</span>
                      <span>{b}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-[color:var(--sf-text-secondary)]">Loading quarter drivers…</li>
                )}
              </ul>
              {heroAiLoading ? (
                <div className="mt-3 text-xs text-[color:var(--sf-text-secondary)]">AI agent is generating a CRO-grade takeaway…</div>
              ) : heroAiText ? (
                <div className="mt-3 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3 text-sm text-[color:var(--sf-text-primary)] whitespace-pre-wrap">
                  {heroAiText}
                </div>
              ) : null}
              {quarterDrivers.usingFullRiskSet ? (
                <div className="mt-2 text-[11px] text-[color:var(--sf-text-secondary)]">
                  Strategic takeaway is calculated from the full at-risk deal set (not only the displayed top {topN}).
                  {quarterDrivers.loading ? " Refreshing…" : ""}
                </div>
              ) : null}
              <div className="mt-3 border-t border-[color:var(--sf-border)] pt-3 text-sm text-[color:var(--sf-text-primary)]">
                <span className="text-[color:var(--sf-text-primary)]">AI Adjustment vs CRM </span>
                <span className={`font-mono font-semibold ${deltaTextClass(props.gap)}`}>{fmtMoney(props.gap)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <KpiCardsRow
        quota={props.quota}
        aiForecast={props.aiForecast}
        crmForecast={props.crmForecast}
        gap={props.gap}
        bucketDeltas={props.bucketDeltas}
        dealsAtRisk={dealsAtRisk}
      />

      <div className="grid w-full gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
        <RiskRadarPlot deals={radarDeals} size={920} />

        <section className="self-start rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Accounts</div>
          <div className="mt-3 grid grid-cols-1 gap-x-3 gap-y-2 text-sm text-[color:var(--sf-text-primary)] sm:grid-cols-2 lg:grid-cols-1">
            {radarDeals.length ? (
              radarDeals.map((d) => (
                <div key={d.id} className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full border border-[color:var(--sf-border)]"
                    style={{ background: d.color }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate" title={String(d.legendLabel || d.label)}>
                    {String(d.legendLabel || d.label)}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-[color:var(--sf-text-secondary)]">No at-risk deals in the current view.</div>
            )}
          </div>

          <div className="mt-4 border-t border-[color:var(--sf-border)] pt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">✨ AI Strategic Takeaway</div>
            {radarStrategicTakeaway.shownCount ? (
              <div className="mt-2 grid gap-2 text-sm text-[color:var(--sf-text-primary)]">
                <div>
                  The radar view highlights <span className="font-mono font-semibold">{radarStrategicTakeaway.shownCount}</span> at-risk deal(s) with{" "}
                  <span className="font-mono font-semibold">{fmtMoney(radarStrategicTakeaway.gapAbs)}</span> downside impact in this slice.
                </div>
                {radarAiLoading ? (
                  <div className="text-xs text-[color:var(--sf-text-secondary)]">AI agent is generating MEDDPICC+TB coaching guidance…</div>
                ) : radarAiText ? (
                  <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3 text-sm text-[color:var(--sf-text-primary)] whitespace-pre-wrap">
                    {radarAiText}
                  </div>
                ) : null}

                {radarStrategicTakeaway.topCats.length ? (
                  <div className="grid gap-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">MEDDPICC+TB gaps to coach</div>
                    <ul className="grid gap-1">
                      {radarStrategicTakeaway.topCats.map((c) => (
                        <li key={c.key} className="flex gap-2">
                          <span className="text-[color:var(--sf-accent-secondary)]">•</span>
                          <span className="min-w-0">
                            <span className="font-semibold">{c.label}</span> is a recurring risk in{" "}
                            <span className="font-mono font-semibold">{c.count}</span> deal(s).
                            {c.tips?.length ? (
                              <span className="text-[color:var(--sf-text-secondary)]"> Tip: {c.tips[0]}</span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {radarStrategicTakeaway.repTrends.length ? (
                  <div className="grid gap-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Rep / team trends</div>
                    <ul className="grid gap-1">
                      {radarStrategicTakeaway.repTrends.map((r) => (
                        <li key={r.rep} className="flex gap-2">
                          <span className="text-[color:var(--sf-accent-secondary)]">•</span>
                          <span className="min-w-0">
                            <span className="font-semibold">{r.rep}</span> carries{" "}
                            <span className="font-mono font-semibold">{fmtMoney(r.gapAbs)}</span> downside here
                            {r.topGapLabel ? (
                              <span className="text-[color:var(--sf-text-secondary)]">
                                {" "}
                                — trend: {r.topGapLabel} gaps across {r.topGapCount} deal(s).
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {radarStrategicTakeaway.quickWins.length ? (
                  <div className="grid gap-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">High-leverage coaching targets</div>
                    <ul className="grid gap-1">
                      {radarStrategicTakeaway.quickWins.map((d) => (
                        <li key={d.id} className="flex gap-2">
                          <span className="text-[color:var(--sf-accent-secondary)]">•</span>
                          <span className="min-w-0">
                            <span className="font-semibold">{d.title}</span>{" "}
                            <span className="text-[color:var(--sf-text-secondary)]">
                              ({fmtMoney(d.amount)} · {d.gapCount} gap(s) · downside {fmtMoney(d.gapAbs)})
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">No at-risk deals in this radar slice.</div>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Deals + Risk Filters</div>
            <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">These filters apply to the gap-driving deals section below.</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRefreshNonce((n) => n + 1)}
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
            >
              Refresh
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[color:var(--sf-text-secondary)]">Show</span>
              <select
                value={topN}
                onChange={(e) => setTopN(Math.max(1, Number(e.target.value) || 15))}
                className="h-[40px] w-[92px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                {[5, 10, 15, 20].map((n) => (
                  <option key={n} value={n}>
                    Top {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="grid gap-1">
            <label className="text-xs text-[color:var(--sf-text-secondary)]">Sales Team</label>
            <select
              value={teamRepIdValue}
              onChange={(e) =>
                updateUrl((p) => {
                  const v = String(e.target.value || "").trim();
                  setParam(p, "team_rep_id", v);
                  // Legacy rep filters (rep_public_id / rep_name) are cleared when using the team picker.
                  p.delete("rep_name");
                  p.delete("rep_public_id");
                })
              }
              className="h-[40px] min-w-[220px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              <option value="">All Sales Team</option>
              {(() => {
                const dir = Array.isArray(props.repDirectory) ? props.repDirectory : [];
                const byId = new Map<number, RepDirectoryRow>();
                for (const r of dir) byId.set(Number(r.id), r);

                const children = new Map<number, RepDirectoryRow[]>();
                for (const r of dir) {
                  const mid = r.manager_rep_id;
                  if (mid == null || !Number.isFinite(mid)) continue;
                  const arr = children.get(mid) || [];
                  arr.push(r);
                  children.set(mid, arr);
                }
                for (const [mid, arr] of children.entries()) {
                  arr.sort((a, b) => {
                    const ra = rankRole(a);
                    const rb = rankRole(b);
                    if (ra !== rb) return ra - rb;
                    const dn = String(a.name || "").localeCompare(String(b.name || ""));
                    if (dn !== 0) return dn;
                    return Number(a.id) - Number(b.id);
                  });
                  children.set(mid, arr);
                }

                const rootId = props.myRepId != null && Number.isFinite(props.myRepId) ? Number(props.myRepId) : null;
                const roots: RepDirectoryRow[] =
                  rootId != null
                    ? (children.get(rootId) || []).filter((r) => String(r.role || "").trim().toUpperCase() !== "REP")
                    : dir.filter((r) => r.manager_rep_id == null);

                const out: Array<{ id: number; label: string }> = [];
                const seen = new Set<number>();
                const pushTree = (node: RepDirectoryRow, depth: number) => {
                  const id = Number(node.id);
                  if (!Number.isFinite(id) || id <= 0) return;
                  if (seen.has(id)) return;
                  seen.add(id);
                  const role = String(node.role || "").trim().toUpperCase();
                  const isMgr = role === "MANAGER" || role === "EXEC_MANAGER";
                  const prefix = depth > 0 ? `${" ".repeat(Math.min(8, depth * 2))}↳ ` : "";
                  const tag = isMgr ? "[Manager] " : "";
                  out.push({ id, label: `${prefix}${tag}${node.name}` });
                  for (const c of children.get(id) || []) {
                    pushTree(c, depth + 1);
                  }
                };

                if (rootId != null && byId.has(rootId)) {
                  // Show the manager themself first (so selection rolls up their whole team), then their tree.
                  pushTree(byId.get(rootId)!, 0);
                }
                for (const r of roots) pushTree(r, 0);

                // Fallback: if tree logic produced nothing, list all managers then reps.
                const fallback = out.length
                  ? out
                  : dir
                      .slice()
                      .sort((a, b) => {
                        const ra = rankRole(a) - rankRole(b);
                        if (ra !== 0) return ra;
                        return String(a.name || "").localeCompare(String(b.name || ""));
                      })
                      .map((r) => ({
                        id: Number(r.id),
                        label: `${(String(r.role || "").toUpperCase() === "MANAGER" || String(r.role || "").toUpperCase() === "EXEC_MANAGER") ? "[Manager] " : ""}${r.name}`,
                      }));

                return fallback.map((o) => (
                  <option key={o.id} value={String(o.id)}>
                    {o.label}
                  </option>
                ));
              })()}
            </select>
          </div>

          <div className="grid gap-1">
            <label className="text-xs text-[color:var(--sf-text-secondary)]">MEDDPIC+TB Risk Category</label>
            <select
              value={riskCategory}
              onChange={(e) =>
                updateUrl((p) => {
                  const v = String(e.target.value || "").trim();
                  setParam(p, "risk_category", v);
                  p.delete("riskType");
                })
              }
              className="h-[40px] min-w-[260px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              <option value="">All Categories</option>
              {(
                [
                  "economic_buyer",
                  "paper",
                  "champion",
                  "process",
                  "timing",
                  "criteria",
                  "competition",
                  "budget",
                  "pain",
                  "metrics",
                  "suppressed",
                ] as RiskCategoryKey[]
              ).map((k) => (
                <option key={k} value={k}>
                  {riskLabelForKey(k)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1">
            <label className="text-xs text-[color:var(--sf-text-secondary)]">Mode</label>
            <select
              value={mode}
              onChange={(e) =>
                updateUrl((p) => {
                  const v = String(e.target.value || "").trim();
                  setParam(p, "mode", v === "risk" ? "risk" : "drivers");
                })
              }
              className="h-[40px] w-[160px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              <option value="drivers">AI Top Drivers</option>
              <option value="risk">At-risk deals</option>
            </select>
          </div>

          <div className="grid gap-1">
            <label className="text-xs text-[color:var(--sf-text-secondary)]">Stages</label>
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { k: "commit", label: "Commit" },
                  { k: "best_case", label: "Best Case" },
                  { k: "pipeline", label: "Pipeline" },
                  { k: "all", label: "All" },
                ] as const
              ).map((t) => (
                <button
                  key={t.k}
                  type="button"
                  onClick={() => setStageView(t.k)}
                  className={[
                    "h-[40px] rounded-md border px-3 text-sm",
                    t.k === stageView
                      ? "border-[color:var(--sf-accent-secondary)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]"
                      : "border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface-alt)]",
                  ].join(" ")}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <label className="mt-5 inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]">
            <input
              type="checkbox"
              checked={scoreDrivenOnly}
              onChange={(e) =>
                updateUrl((p) => {
                  const on = e.target.checked;
                  if (mode === "risk") setParam(p, "risk_require_score_effect", on ? "1" : "0");
                  else setParam(p, "driver_require_score_effect", on ? "1" : "0");
                })
              }
            />
            AI Score Drivers Only
          </label>

          <div className="ml-auto" />
        </div>

        {loading ? <div className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">Loading…</div> : null}
        {err ? <div className="mt-2 text-sm text-[#E74C3C]">{err.error}</div> : null}
      </section>

      {(() => {
        const stageLabel = stageView === "commit" ? "Commit deals driving the gap" : stageView === "best_case" ? "Best Case deals driving the gap" : stageView === "pipeline" ? "Pipeline deals driving the gap" : "Deals driving the gap";
        const totals =
          stageView === "commit"
            ? ok?.groups.commit.totals
            : stageView === "best_case"
              ? ok?.groups.best_case.totals
              : stageView === "pipeline"
                ? ok?.groups.pipeline.totals
                : ok?.totals
                  ? { crm_weighted: ok.totals.crm_outlook_weighted, ai_weighted: ok.totals.ai_outlook_weighted, gap: ok.totals.gap }
                  : null;
        const shown =
          stageView === "commit"
            ? ok?.groups.commit.shown_totals
            : stageView === "best_case"
              ? ok?.groups.best_case.shown_totals
              : stageView === "pipeline"
                ? ok?.groups.pipeline.shown_totals
                : ok?.shown_totals
                  ? { crm_weighted: ok.shown_totals.crm_outlook_weighted, ai_weighted: ok.shown_totals.ai_outlook_weighted, gap: ok.shown_totals.gap }
                  : null;
        const dealCount = stageDeals.length;
        const showingNote =
          shown && Number.isFinite(Number(shown.gap))
            ? ` · showing ${fmtMoney(Number(shown.gap || 0) || 0)} gap from displayed`
            : "";
        const listCount = Math.min(topN, dealCount);
        const listNote = dealCount > listCount ? ` · displaying top ${listCount}` : "";

        return (
          <div className="grid gap-3">
            <DealsDrivingGapHeatmap
              rows={heatmapRows}
              viewFullHref={viewFullHref}
              onRowClick={() => {
                updateUrl((p) => {
                  setParam(p, "quota_period_id", quotaPeriodId);
                  p.set("bucket_commit", bucketParamsForStageView.c);
                  p.set("bucket_best_case", bucketParamsForStageView.b);
                  p.set("bucket_pipeline", bucketParamsForStageView.p);
                  p.set("gap_drawer", "1");
                });
              }}
              title={stageLabel}
              subtitle={
                totals
                  ? `CRM ${fmtMoney((totals as any).crm_weighted)} · AI ${fmtMoney((totals as any).ai_weighted)} · Gap ${fmtMoney((totals as any).gap)} · ${dealCount} deal(s)${showingNote}${listNote}`
                  : undefined
              }
            />
          </div>
        );
      })()}

      {props.productsClosedWon.length ? <ExecutiveProductPerformance data={productViz} /> : null}

      {props.productsClosedWonByRep.length ? (
        <details className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-[color:var(--sf-text-primary)]">Rep breakdown (by product)</summary>
          <div className="mt-3 overflow-x-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
            <table className="min-w-[920px] w-full table-auto border-collapse text-sm">
              <thead className="bg-[color:var(--sf-surface)] text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-3 py-2">Rep</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">Closed Won</th>
                  <th className="px-3 py-2 text-right"># Orders</th>
                  <th className="px-3 py-2 text-right">Avg / Order</th>
                  <th className="px-3 py-2 text-right">Avg Health</th>
                </tr>
              </thead>
              <tbody>
                {props.productsClosedWonByRep.map((r) => {
                  const hp = healthPctFrom30(r.avg_health_score);
                  const key = `${r.rep_name}|${r.product}`;
                  return (
                    <tr key={key} className="border-t border-[color:var(--sf-border)] text-[color:var(--sf-text-primary)]">
                      <td className="px-3 py-2">{r.rep_name}</td>
                      <td className="px-3 py-2">{r.product}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmtMoney(r.won_amount)}</td>
                      <td className="px-3 py-2 text-right">{Number(r.won_count || 0) || 0}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmtMoney(r.avg_order_value)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        <span className={healthColorClass(hp)}>{hp == null ? "—" : `${hp}%`}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Quarter analytics</div>
            <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
              FY{props.fiscalYear} Q{props.fiscalQuarter} · Closed Won rollups
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { k: "rev", label: "Closed Won Revenue", v: fmtMoney(quarterAnalytics.total.wonAmount) },
            { k: "cnt", label: "# Closed Won", v: String(quarterAnalytics.total.wonCount) },
            { k: "aov", label: "Average Order Value", v: quarterAnalytics.total.aov == null ? "—" : fmtMoney(quarterAnalytics.total.aov) },
          ].map((c) => (
            <div
              key={c.k}
              className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm"
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">{c.label}</div>
              <div className="mt-2 font-mono text-lg font-extrabold text-[color:var(--sf-text-primary)]">{c.v}</div>
            </div>
          ))}
        </div>

        {props.quarterKpis ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm">
              <div className="text-xs font-semibold text-[color:var(--sf-text-primary)]">Deal Cards</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Chip label="Win Rate" value={fmtPct01(props.quarterKpis.winRate)} />
                <Chip label="Win/Loss Count" value={`${fmtNum(props.quarterKpis.wonCount)} / ${fmtNum(props.quarterKpis.lostCount)}`} />
                <Chip label="Average Order Value" value={props.quarterKpis.aov == null ? "—" : fmtMoney(props.quarterKpis.aov)} />
                <Chip
                  label="Avg Health Closed Won"
                  value={
                    <span className={healthColorClass(props.quarterKpis.avgHealthWonPct)}>
                      {props.quarterKpis.avgHealthWonPct == null ? "—" : `${props.quarterKpis.avgHealthWonPct}%`}
                    </span>
                  }
                />
                <Chip
                  label="Avg Health Closed Loss"
                  value={
                    <span className={healthColorClass(props.quarterKpis.avgHealthLostPct)}>
                      {props.quarterKpis.avgHealthLostPct == null ? "—" : `${props.quarterKpis.avgHealthLostPct}%`}
                    </span>
                  }
                />
                <Chip label="Opp→Win Conversion" value={fmtPct01(props.quarterKpis.oppToWin)} />
                <Chip
                  label="Aging (avg days)"
                  value={props.quarterKpis.agingAvgDays == null ? "—" : String(Math.round(props.quarterKpis.agingAvgDays))}
                />
              </div>
            </div>

            <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm">
              <div className="text-xs font-semibold text-[color:var(--sf-text-primary)]">Direct vs Partner</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Chip
                  label="Direct vs. Partner (closed won)"
                  value={`${fmtMoney(props.quarterKpis.directVsPartner.directWonAmount)} / ${fmtMoney(props.quarterKpis.directVsPartner.partnerWonAmount)}`}
                />
                <Chip label="# Direct Deals" value={fmtNum(props.quarterKpis.directVsPartner.directClosedDeals)} />
                <Chip label="Direct AOV" value={props.quarterKpis.directVsPartner.directAov == null ? "—" : fmtMoney(props.quarterKpis.directVsPartner.directAov)} />
                <Chip
                  label="Direct Average Age"
                  value={
                    props.quarterKpis.directVsPartner.directAvgAgeDays == null ? "—" : String(Math.round(props.quarterKpis.directVsPartner.directAvgAgeDays))
                  }
                />
                <Chip label="Partner Contribution %" value={fmtPct01(props.quarterKpis.directVsPartner.partnerContributionPct)} />
                <Chip label="# Partner Deals" value={fmtNum(props.quarterKpis.directVsPartner.partnerClosedDeals)} />
                <Chip label="Partner AOV" value={props.quarterKpis.directVsPartner.partnerAov == null ? "—" : fmtMoney(props.quarterKpis.directVsPartner.partnerAov)} />
                <Chip
                  label="Partner Average Age"
                  value={
                    props.quarterKpis.directVsPartner.partnerAvgAgeDays == null ? "—" : String(Math.round(props.quarterKpis.directVsPartner.partnerAvgAgeDays))
                  }
                />
                <Chip label="Partner Win Rate" value={fmtPct01(props.quarterKpis.directVsPartner.partnerWinRate)} />
              </div>
            </div>

            <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm">
              <div className="text-xs font-semibold text-[color:var(--sf-text-primary)]">Pipeline created in quarter</div>
              <div className="mt-3">
                <div className="text-[11px] font-semibold text-[color:var(--sf-text-primary)]">Forecast Mix</div>
                <div className="mt-2 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                  {(() => {
                    const box =
                      "min-w-0 overflow-hidden rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-2 py-2";
                    const Card = (p: { label: string; amount: number; count: number; health: number | null }) => (
                      <div className={box}>
                        <div className="text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">{p.label}</div>
                        <div className="mt-0.5 truncate font-mono text-xs font-semibold leading-tight text-[color:var(--sf-text-primary)]">
                          {fmtMoney(p.amount)}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-tight text-[color:var(--sf-text-secondary)]">
                          <div># Opps: {fmtNum(p.count)}</div>
                          <div>
                            Health: <span className={healthColorClass(p.health)}>{p.health == null ? "—" : `${p.health}%`}</span>
                          </div>
                        </div>
                      </div>
                    );

                    const cp = props.quarterKpis!.createdPipeline;
                    return (
                      <>
                        <Card
                          label={`Commit (${fmtPct01(cp.mixCommit)})`}
                          amount={cp.commitAmount}
                          count={cp.commitCount}
                          health={cp.commitHealthPct}
                        />
                        <Card label={`Best Case (${fmtPct01(cp.mixBest)})`} amount={cp.bestAmount} count={cp.bestCount} health={cp.bestHealthPct} />
                        <Card
                          label={`Pipeline (${fmtPct01(cp.mixPipeline)})`}
                          amount={cp.pipelineAmount}
                          count={cp.pipelineCount}
                          health={cp.pipelineHealthPct}
                        />
                        <Card label="Total Pipeline" amount={cp.totalAmount} count={cp.totalCount} health={cp.totalHealthPct} />
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <PipelineMomentumEngine data={props.pipelineMomentum} />

        {props.quarterKpis ? (
          <details
            className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm"
            open={createdPipelineOpen}
            onToggle={(e) => setCreatedPipelineOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer text-sm font-semibold text-[color:var(--sf-text-primary)]">
              New Pipeline Created In Quarter (show / hide)
            </summary>
            {createdPipelineOpen ? (
              <div className="mt-3 grid gap-2">
                {(() => {
                  const tree = createdPipelineTree;
                  const leaders = tree.leaders || [];

                  const Cell = (amt: number, cnt: number) => (
                    <span className="whitespace-nowrap font-mono text-[11px] text-[color:var(--sf-text-primary)]">
                      {fmtMoney(amt)} <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(cnt)})</span>
                    </span>
                  );

                  const Node = (node: RepDirectoryRow, depth: number, seen: Set<number>): ReactNode => {
                    const id = Number(node.id);
                    if (!Number.isFinite(id) || id <= 0) return null;
                    if (seen.has(id)) return null;
                    seen.add(id);

                    const repIds = quarterAnalytics.descendantRepIds(id);
                    const st = tree.statsForRepIds(repIds);
                    const tAmt = st.commitAmount + st.bestAmount + st.pipelineAmount;
                    const tCnt = st.commitCount + st.bestCount + st.pipelineCount;

                    const kids = (tree.children.get(id) || []).filter((c) => String(c.role || "").trim().toUpperCase() !== "REP");
                    const leafReps = (tree.children.get(id) || []).filter((c) => String(c.role || "").trim().toUpperCase() === "REP");

                    const hasChildren = kids.length > 0 || leafReps.length > 0;
                    const labelRole = String(node.role || "").trim().toUpperCase();
                    const isMgr = labelRole === "MANAGER" || labelRole === "EXEC_MANAGER";
                    const indent = depth > 0 ? `${" ".repeat(Math.min(10, depth * 2))}↳ ` : "";

                    const header = (
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[color:var(--sf-text-primary)]" title={node.name}>
                            <span className="text-[color:var(--sf-text-secondary)]">{indent}</span>
                            {node.name}
                            {isMgr ? <span className="ml-2 text-xs font-semibold text-[color:var(--sf-text-secondary)]">(roll-up)</span> : null}
                          </div>
                          <div className="mt-0.5 text-xs text-[color:var(--sf-text-secondary)]">
                            {repIds.length.toLocaleString()} rep(s) · totals across full descendant team
                          </div>
                        </div>
                        <div className="hidden shrink-0 items-center gap-4 text-right sm:flex">
                          <span>{Cell(st.commitAmount, st.commitCount)}</span>
                          <span>{Cell(st.bestAmount, st.bestCount)}</span>
                          <span>{Cell(st.pipelineAmount, st.pipelineCount)}</span>
                          <span>{Cell(tAmt, tCnt)}</span>
                          <span>{Cell(st.wonAmount, st.wonCount)}</span>
                          <span>{Cell(st.lostAmount, st.lostCount)}</span>
                        </div>
                      </div>
                    );

                    const box = "rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2";

                    if (!hasChildren) return <div key={id} className={box}>{header}</div>;

                    return (
                      <details key={id} className={box}>
                        <summary className="cursor-pointer list-none">{header}</summary>
                        <div className="mt-3 overflow-x-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                          <table className="min-w-[980px] w-full table-auto border-collapse text-[11px]">
                            <thead className="bg-[color:var(--sf-surface)] text-[color:var(--sf-text-secondary)]">
                              <tr>
                                <th className="px-3 py-2 text-left w-[260px]">direct report</th>
                                <th className="px-3 py-2 text-right">commit</th>
                                <th className="px-3 py-2 text-right">best</th>
                                <th className="px-3 py-2 text-right">pipeline</th>
                                <th className="px-3 py-2 text-right">total</th>
                                <th className="px-3 py-2 text-right">won</th>
                                <th className="px-3 py-2 text-right">lost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {kids
                                .slice()
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((c) => {
                                  const repIds2 = quarterAnalytics.descendantRepIds(Number(c.id));
                                  const s2 = tree.statsForRepIds(repIds2);
                                  const t2 = s2.commitAmount + s2.bestAmount + s2.pipelineAmount;
                                  const c2 = s2.commitCount + s2.bestCount + s2.pipelineCount;
                                  return (
                                    <tr key={`mgr:${c.id}`} className="border-t border-[color:var(--sf-border)] text-[color:var(--sf-text-primary)]">
                                      <td className="px-3 py-2 font-semibold">
                                        <span className="text-[color:var(--sf-text-secondary)]">↳</span> {c.name}{" "}
                                        <span className="text-[color:var(--sf-text-secondary)]">(roll-up)</span>
                                      </td>
                                      <td className="px-3 py-2 text-right">{Cell(s2.commitAmount, s2.commitCount)}</td>
                                      <td className="px-3 py-2 text-right">{Cell(s2.bestAmount, s2.bestCount)}</td>
                                      <td className="px-3 py-2 text-right">{Cell(s2.pipelineAmount, s2.pipelineCount)}</td>
                                      <td className="px-3 py-2 text-right">{Cell(t2, c2)}</td>
                                      <td className="px-3 py-2 text-right">{Cell(s2.wonAmount, s2.wonCount)}</td>
                                      <td className="px-3 py-2 text-right">{Cell(s2.lostAmount, s2.lostCount)}</td>
                                    </tr>
                                  );
                                })}
                              {leafReps
                                .slice()
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((r) => {
                                  const id2 = Number(r.id);
                                  const s2 = tree.statsForRepIds([id2]);
                                  const t2 = s2.commitAmount + s2.bestAmount + s2.pipelineAmount;
                                  const c2 = s2.commitCount + s2.bestCount + s2.pipelineCount;
                                  return (
                                    <tr key={`rep:${id2}`} className="border-t border-[color:var(--sf-border)] text-[color:var(--sf-text-primary)]">
                                      <td className="px-3 py-2">
                                        <span className="text-[color:var(--sf-text-secondary)]">↳</span> {r.name}
                                      </td>
                                      <td className="px-3 py-2 text-right">{Cell(s2.commitAmount, s2.commitCount)}</td>
                                      <td className="px-3 py-2 text-right">{Cell(s2.bestAmount, s2.bestCount)}</td>
                                      <td className="px-3 py-2 text-right">{Cell(s2.pipelineAmount, s2.pipelineCount)}</td>
                                      <td className="px-3 py-2 text-right">{Cell(t2, c2)}</td>
                                      <td className="px-3 py-2 text-right">{Cell(s2.wonAmount, s2.wonCount)}</td>
                                      <td className="px-3 py-2 text-right">{Cell(s2.lostAmount, s2.lostCount)}</td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                        </div>

                        <div className="mt-2 grid gap-2">
                          {kids.map((k) => Node(k, depth + 1, new Set(seen)))}
                        </div>
                      </details>
                    );
                  };

                  if (!props.quarterKpis?.createdPipelineByManager?.length && !tree.byRepId.size) {
                    return <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-3 text-xs text-[color:var(--sf-text-secondary)]">No created-pipeline rows found for this quarter.</div>;
                  }

                  return (
                    <div className="grid gap-2">
                      <div className="hidden overflow-x-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] sm:block">
                        <table className="min-w-[980px] w-full table-auto border-collapse text-[11px]">
                          <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                            <tr>
                              <th className="px-3 py-2 text-left w-[260px]">leader (roll-up)</th>
                              <th className="px-3 py-2 text-right">commit</th>
                              <th className="px-3 py-2 text-right">best</th>
                              <th className="px-3 py-2 text-right">pipeline</th>
                              <th className="px-3 py-2 text-right">total</th>
                              <th className="px-3 py-2 text-right">won</th>
                              <th className="px-3 py-2 text-right">lost</th>
                            </tr>
                          </thead>
                          <tbody>
                            {leaders
                              .filter((l) => String(l.role || "").trim().toUpperCase() !== "REP")
                              .slice()
                              .sort((a, b) => a.name.localeCompare(b.name))
                              .map((l) => {
                                const repIds = quarterAnalytics.descendantRepIds(Number(l.id));
                                const st = tree.statsForRepIds(repIds);
                                const tAmt = st.commitAmount + st.bestAmount + st.pipelineAmount;
                                const tCnt = st.commitCount + st.bestCount + st.pipelineCount;
                                return (
                                  <tr key={`top:${l.id}`} className="border-t border-[color:var(--sf-border)] text-[color:var(--sf-text-primary)]">
                                    <td className="px-3 py-2 font-semibold">{l.name}</td>
                                    <td className="px-3 py-2 text-right">{Cell(st.commitAmount, st.commitCount)}</td>
                                    <td className="px-3 py-2 text-right">{Cell(st.bestAmount, st.bestCount)}</td>
                                    <td className="px-3 py-2 text-right">{Cell(st.pipelineAmount, st.pipelineCount)}</td>
                                    <td className="px-3 py-2 text-right">{Cell(tAmt, tCnt)}</td>
                                    <td className="px-3 py-2 text-right">{Cell(st.wonAmount, st.wonCount)}</td>
                                    <td className="px-3 py-2 text-right">{Cell(st.lostAmount, st.lostCount)}</td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>

                      <div className="grid gap-2">
                        {leaders.map((l) => Node(l, 0, new Set<number>()))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : null}
          </details>
        ) : null}

        <details className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-[color:var(--sf-text-primary)]">
            Team AOV Breakdown
            <span className="ml-2 text-xs font-semibold text-[color:var(--sf-text-secondary)]">({quarterAnalytics.directReports.length})</span>
          </summary>

          <div className="mt-3 grid gap-2">
            {quarterAnalytics.directReports.length ? (
              quarterAnalytics.directReports.map((dr) => {
                const drRole = String(dr.role || "").trim().toUpperCase();
                const repIds = quarterAnalytics.descendantRepIds(Number(dr.id));
                const st = quarterAnalytics.statsForRepIds(repIds);
                const isManager = drRole === "MANAGER" || drRole === "EXEC_MANAGER";
                const mgrColor = isManager ? managerColorForId(Number(dr.id)) : null;
                const childReps = (quarterAnalytics.children.get(Number(dr.id)) || []).filter(
                  (c) => String(c.role || "").trim().toUpperCase() === "REP"
                );

                const header = (
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        {isManager ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: mgrColor || palette.accentSecondary }} /> : null}
                        <div className="truncate text-sm font-semibold text-[color:var(--sf-text-primary)]">
                          {dr.name}
                          {isManager ? <span className="ml-2 text-xs font-semibold text-[color:var(--sf-text-secondary)]">(Manager)</span> : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-4 font-mono text-xs text-[color:var(--sf-text-primary)]">
                      <span>{fmtMoney(st.wonAmount)}</span>
                      <span>{st.wonCount}</span>
                      <span>{st.aov == null ? "—" : fmtMoney(st.aov)}</span>
                    </div>
                  </div>
                );

                const baseRowClass = [
                  "rounded-lg border bg-[color:var(--sf-surface)] px-3 py-2",
                  isManager ? "border-[color:var(--sf-border)]" : "border-[color:var(--sf-border)]",
                ].join(" ");

                if (!isManager) {
                  return (
                    <div key={dr.id} className={baseRowClass}>
                      {header}
                    </div>
                  );
                }

                return (
                  <details
                    key={dr.id}
                    className={baseRowClass}
                    style={{
                      borderLeftWidth: 4,
                      borderLeftStyle: "solid",
                      borderLeftColor: mgrColor || palette.accentSecondary,
                      background: `color-mix(in srgb, ${mgrColor || palette.accentSecondary} 10%, var(--sf-surface))`,
                    }}
                  >
                    <summary className="cursor-pointer list-none">{header}</summary>
                    <div className="mt-3 overflow-x-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                      {childReps.length ? (
                        <table className="min-w-[720px] w-full table-auto border-collapse text-sm">
                          <thead className="bg-[color:var(--sf-surface)] text-[color:var(--sf-text-secondary)]">
                            <tr>
                              <th className="px-3 py-2 text-left">Rep</th>
                              <th className="px-3 py-2 text-right">Closed Won</th>
                              <th className="px-3 py-2 text-right"># Closed Won</th>
                              <th className="px-3 py-2 text-right">Avg / Order</th>
                            </tr>
                          </thead>
                          <tbody>
                            {childReps.map((r) => {
                              const rid = Number(r.id);
                              const s = quarterAnalytics.statsForRepIds([rid]);
                              return (
                                <tr key={rid} className="border-t border-[color:var(--sf-border)] text-[color:var(--sf-text-primary)]">
                                  <td className="px-3 py-2">{r.name}</td>
                                  <td className="px-3 py-2 text-right font-mono text-xs">{fmtMoney(s.wonAmount)}</td>
                                  <td className="px-3 py-2 text-right">{s.wonCount}</td>
                                  <td className="px-3 py-2 text-right font-mono text-xs">{s.aov == null ? "—" : fmtMoney(s.aov)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      ) : (
                        <div className="px-4 py-6 text-sm text-[color:var(--sf-text-secondary)]">No reps found under this manager.</div>
                      )}
                    </div>
                  </details>
                );
              })
            ) : (
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-secondary)]">
                No direct reports found in the rep directory for this user.
              </div>
            )}
          </div>

          <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">Displayed as: Closed Won revenue · # Closed Won · Avg / Order</div>
        </details>
      </section>

      {gapDrawerMounted ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close deals driving the gap panel"
            className={[
              "absolute inset-0 bg-black/40 transition-opacity duration-300 ease-out motion-reduce:transition-none",
              gapDrawerOpen ? "opacity-100" : "opacity-0 pointer-events-none",
            ].join(" ")}
            onClick={() =>
              updateUrl((p) => {
                p.delete("gap_drawer");
              })
            }
          />

          <aside
            className={[
              "absolute right-0 top-0 h-full w-full max-w-[980px] border-l border-[color:var(--sf-border)] bg-[color:var(--sf-background)] shadow-2xl",
              "transition-transform duration-300 ease-out motion-reduce:transition-none",
              gapDrawerOpen ? "translate-x-0" : "translate-x-full",
            ].join(" ")}
            onTransitionEnd={() => {
              if (!gapDrawerOpen) setGapDrawerMounted(false);
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Deals driving the gap"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[color:var(--sf-text-primary)]">Deals driving the gap</div>
                <div className="mt-0.5 truncate text-xs text-[color:var(--sf-text-secondary)]">
                  Slide-out detail panel · keeps your place on the executive dashboard
                </div>
              </div>
              <button
                type="button"
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]/70"
                onClick={() =>
                  updateUrl((p) => {
                    p.delete("gap_drawer");
                  })
                }
              >
                Close
              </button>
            </div>

            <div className="h-[calc(100%-52px)] overflow-auto p-4">
              <GapDrivingDealsClient
                basePath={props.basePath}
                periods={props.periods as any}
                reps={props.reps as any}
                initialQuotaPeriodId={quotaPeriodId}
                hideQuotaPeriodSelect={true}
              />
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

