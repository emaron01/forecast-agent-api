"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import type { ExecRepOption } from "../../../lib/executiveForecastDashboard";
import type { RepDirectoryRow } from "../../../lib/repScope";
import type { QuarterKpisSnapshot } from "../../../lib/quarterKpisSnapshot";
import { ExecutiveDealsDrivingGapModule, type ExecutiveGapDeal } from "./ExecutiveDealsDrivingGapModule";
import { KpiCardsRow, type CommitAdmissionAggregates } from "./KpiCardsRow";
import { RiskRadarPlot, type RadarDeal } from "./RiskRadarPlot";
import { palette } from "../../../lib/palette";
import { ExecutiveProductPerformance } from "./ExecutiveProductPerformance";
import type { ExecutiveProductPerformanceData } from "../../../lib/executiveProductInsights";
import { ExecutiveQuarterKpisModule, ExecutiveRemainingQuarterlyForecastBlock } from "./ExecutiveQuarterKpisModule";
import type { PipelineMomentumData } from "../../../lib/pipelineMomentum";
import { AiSummaryReportClient } from "../../ai/AiSummaryReportClient";
import { PartnersExecutiveAiTakeawayClient } from "../../ai/PartnersExecutiveAiTakeawayClient";

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

type DealOut = ExecutiveGapDeal;

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

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtNum(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US");
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

function fmtDeltaCount(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "0";
  const s = Math.round(v);
  return s > 0 ? `+${s.toLocaleString("en-US")}` : `${s.toLocaleString("en-US")}`;
}

function fmtDays(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = Math.round(n);
  return `${v.toLocaleString("en-US")} day${v === 1 ? "" : "s"}`;
}

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
              <span className="text-[color:var(--sf-accent-primary)]">•</span>
              <span className="min-w-0">
                <span className="font-semibold">{label}:</span> {rest}
              </span>
            </div>
          );
        }
        return (
          <div key={idx} className="flex gap-2">
            <span className="text-[color:var(--sf-accent-primary)]">•</span>
            <span className="min-w-0 whitespace-pre-wrap">{bullet}</span>
          </div>
        );
      })}
    </div>
  );
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

function clampScore100(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 100) return 100;
  return v;
}

// Canonical normalization helper.
function normalize(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0.5;
  if (max === min) return 0.5;
  return clamp01((value - min) / (max - min));
}

function health01FromScore30(rawScore: number | null) {
  if (rawScore == null || !Number.isFinite(rawScore)) return null;
  return clamp01(rawScore / 30);
}

function wicBand(score: number) {
  if (!Number.isFinite(score)) return { label: "—", tone: "muted" as const };
  if (score >= 80) return { label: "INVEST AGGRESSIVELY", tone: "good" as const };
  if (score >= 60) return { label: "SCALE SELECTIVELY", tone: "good" as const };
  if (score >= 40) return { label: "MAINTAIN", tone: "warn" as const };
  return { label: "DEPRIORITIZE", tone: "bad" as const };
}

function pillToneClass(tone: "good" | "warn" | "bad" | "muted") {
  if (tone === "good") return "border-[#16A34A]/35 bg-[#16A34A]/10 text-[#16A34A]";
  if (tone === "warn") return "border-[#F1C40F]/50 bg-[#F1C40F]/12 text-[#F1C40F]";
  if (tone === "bad") return "border-[#E74C3C]/45 bg-[#E74C3C]/12 text-[#E74C3C]";
  return "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]";
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
  productsClosedWonPrevSummary: { total_revenue: number; total_orders: number; blended_acv: number } | null;
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
  crmTotals: { commit_amount: number; best_case_amount: number; pipeline_amount: number; won_amount: number };
  partnersExecutive: {
    direct: {
      opps: number;
      won_opps: number;
      lost_opps: number;
      win_rate: number | null;
      aov: number | null;
      avg_days: number | null;
      avg_health_score: number | null;
      won_amount: number;
      lost_amount: number;
      open_pipeline: number;
    } | null;
    partner: {
      opps: number;
      won_opps: number;
      lost_opps: number;
      win_rate: number | null;
      aov: number | null;
      avg_days: number | null;
      avg_health_score: number | null;
      won_amount: number;
      lost_amount: number;
      open_pipeline: number;
    } | null;
    revenue_mix_partner_pct01: number | null;
    cei_prev_partner_index: number | null;
    top_partners: Array<{
      partner_name: string;
      opps: number;
      won_opps: number;
      lost_opps: number;
      win_rate: number | null;
      aov: number | null;
      avg_days: number | null;
      avg_health_score: number | null;
      won_amount: number;
      open_pipeline: number;
    }>;
    previous: {
      direct: {
        opps: number;
        won_opps: number;
        lost_opps: number;
        win_rate: number | null;
        aov: number | null;
        avg_days: number | null;
        avg_health_score: number | null;
        won_amount: number;
        lost_amount: number;
        open_pipeline: number;
      } | null;
      partner: {
        opps: number;
        won_opps: number;
        lost_opps: number;
        win_rate: number | null;
        aov: number | null;
        avg_days: number | null;
        avg_health_score: number | null;
        won_amount: number;
        lost_amount: number;
        open_pipeline: number;
      } | null;
      top_partners: Array<{
        partner_name: string;
        opps: number;
        won_opps: number;
        lost_opps: number;
        win_rate: number | null;
        aov: number | null;
        avg_days: number | null;
        avg_health_score: number | null;
        won_amount: number;
        open_pipeline: number;
      }>;
    } | null;
  } | null;
  quota: number;
  aiForecast: number;
  crmForecast: number;
  gap: number;
  bucketDeltas: { commit: number; best_case: number; pipeline: number };
  aiPctToGoal: number | null;
  leftToGo: number;
  commitAdmission?: CommitAdmissionAggregates | null;
  defaultTopN?: number;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [analysisData, setAnalysisData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [heroAiSummary, setHeroAiSummary] = useState<string>("");
  const [heroAiExtended, setHeroAiExtended] = useState<string>("");
  const [heroAiPayloadSha, setHeroAiPayloadSha] = useState<string>("");
  const [heroAiLoading, setHeroAiLoading] = useState(false);
  const [heroAiExpanded, setHeroAiExpanded] = useState(false);
  const [heroAiToast, setHeroAiToast] = useState<string>("");
  const [heroAiCopied, setHeroAiCopied] = useState(false);

  const [radarAiSummary, setRadarAiSummary] = useState<string>("");
  const [radarAiExtended, setRadarAiExtended] = useState<string>("");
  const [radarAiPayloadSha, setRadarAiPayloadSha] = useState<string>("");
  const [radarAiLoading, setRadarAiLoading] = useState(false);
  const [radarAiExpanded, setRadarAiExpanded] = useState(false);
  const [radarAiToast, setRadarAiToast] = useState<string>("");
  const [radarAiCopied, setRadarAiCopied] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const topXOptions = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] as const;
  const clampInt = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.trunc(v)));

  // Deals list: keep small by default (space).
  const [topN, setTopN] = useState(() => clampInt(props.defaultTopN ?? 5, 5, 50));
  // Radar + account review: default to broader context.
  const [radarTopN, setRadarTopN] = useState(20);
  const [stageView, setStageView] = useState<"commit" | "best_case" | "pipeline" | "all">("all");

  const quotaPeriodId = String(sp.get("quota_period_id") || props.quotaPeriodId || "").trim();
  const teamRepIdRaw = String(sp.get("team_rep_id") || "").trim();
  const teamRepId = Number(teamRepIdRaw);
  const teamRepIdValue = Number.isFinite(teamRepId) && teamRepId > 0 ? String(teamRepId) : "";
  const riskCategory = String(sp.get("risk_category") || "").trim();
  const mode = String(sp.get("mode") || "drivers").trim() === "risk" ? "risk" : "drivers";
  const scoreDrivenOnly = String(sp.get("driver_require_score_effect") || sp.get("risk_require_score_effect") || "1").trim() !== "0";

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

  const activePeriod = useMemo(() => {
    const id = String(quotaPeriodId || "").trim();
    if (!id) return null;
    return (props.periods || []).find((p) => String(p.id) === id) || null;
  }, [props.periods, quotaPeriodId]);

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

  async function runHeroAi(args: { force: boolean; showNoChangeToast: boolean }) {
    if (!heroTakeawayPayload?.quota_period_id) return;
    setHeroAiLoading(true);
    try {
      const r = await fetch("/api/forecast/ai-strategic-takeaway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surface: "hero",
          payload: heroTakeawayPayload,
          force: args.force,
          previous_payload_sha256: heroAiPayloadSha || undefined,
          previous_summary: heroAiSummary || undefined,
          previous_extended: heroAiExtended || undefined,
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

      const persistSummary = noChange ? (heroAiSummary || nextSummary) : (nextSummary || heroAiSummary);
      const persistExtended = noChange ? (heroAiExtended || nextExtended) : (nextExtended || heroAiExtended);

      if (nextSha) setHeroAiPayloadSha(nextSha);
      // Even when `no_change=true`, still apply formatting hardening so we never "stick" on an empty/raw envelope.
      if (nextSummary && nextSummary !== heroAiSummary) setHeroAiSummary(nextSummary);
      if (nextExtended && nextExtended !== heroAiExtended) setHeroAiExtended(nextExtended);

      if (noChange && args.showNoChangeToast && (persistSummary || persistExtended)) {
        setHeroAiToast("No material change in the underlying data.");
        window.setTimeout(() => setHeroAiToast(""), 2500);
      }

      // Persist for end-of-page summary.
      try {
        sessionStorage.setItem(
          `sf_ai:hero:${String(heroTakeawayPayload.quota_period_id)}`,
          JSON.stringify({
            summary: persistSummary,
            extended: persistExtended,
            payload_sha256: nextSha || heroAiPayloadSha,
            updatedAt: Date.now(),
          })
        );
      } catch {
        // ignore
      }
    } catch {
      // Keep prior content on failure.
    } finally {
      setHeroAiLoading(false);
    };
  }

  async function copyHeroAi() {
    const text = [heroAiSummary ? `Summary:\n${heroAiSummary}` : "", heroAiExtended ? `Extended analysis:\n${heroAiExtended}` : ""].filter(Boolean).join("\n\n").trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setHeroAiCopied(true);
      window.setTimeout(() => setHeroAiCopied(false), 2000);
    } catch {
      // ignore
    }
  }

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
    void runHeroAi({ force: false, showNoChangeToast: false });
  }, [heroTakeawayPayload, refreshNonce]);

  async function copyRadarAi() {
    const text = [radarAiSummary ? `Summary:\n${radarAiSummary}` : "", radarAiExtended ? `Extended analysis:\n${radarAiExtended}` : ""].filter(Boolean).join("\n\n").trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setRadarAiCopied(true);
      window.setTimeout(() => setRadarAiCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  const sortedDeals = useMemo(() => {
    const overallGap = ok?.totals?.gap ?? 0;
    const dir = overallGap < 0 ? -1 : overallGap > 0 ? 1 : -1;
    return stageDeals.slice().sort((a, b) => (dir < 0 ? a.weighted.gap - b.weighted.gap : b.weighted.gap - a.weighted.gap));
  }, [stageDeals, ok]);

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
    // Radar (dots + account list) is a display slice, independent from the deals table Top N.
    const shown = sortedDeals.slice(0, radarTopN).filter((d) => Number(d.weighted?.gap || 0) < 0);
    return shown.map((d) => ({
      id: String(d.id),
      label: dealTitle(d),
      legendLabel: dealAccountLabel(d),
      color: colorForDealId(String(d.id)),
      meddpicc_tb: (d.meddpicc_tb || []).map((c) => ({ key: String(c.key || ""), score: c.score == null ? null : (Number(c.score) as any) })),
    }));
  }, [sortedDeals, radarTopN]);

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
    const sourceDeals = analysisFlattenedDeals.length ? analysisFlattenedDeals : flattenedDeals;
    const riskSet = sourceDeals.filter((d) => Number(d.weighted?.gap || 0) < 0);
    const isRiskScore = (score: number | null) => {
      if (score == null) return true;
      if (!Number.isFinite(score)) return true;
      return score <= 1;
    };

    const gapAbs = riskSet.reduce((acc, d) => acc + Math.abs(Math.min(0, Number(d.weighted?.gap || 0) || 0)), 0);
    const byBucket = riskSet.reduce(
      (acc, d) => {
        const b = String(d.crm_stage?.bucket || "pipeline") as "commit" | "best_case" | "pipeline";
        acc[b] = (acc[b] || 0) + 1;
        return acc;
      },
      { commit: 0, best_case: 0, pipeline: 0 } as Record<"commit" | "best_case" | "pipeline", number>
    );

    const catCounts = new Map<string, { key: string; label: string; count: number; tips: string[]; evidenceFragilityCount: number }>();
    const repGap = new Map<string, number>();
    const repCat = new Map<string, Map<string, number>>();
    const dealGapCount = new Map<string, number>();

    for (const d of riskSet) {
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
        const cur = catCounts.get(key) || { key, label, count: 0, tips: [] as string[], evidenceFragilityCount: 0 };
        cur.count += 1;
        const conf = String((c as any).confidence || "").toLowerCase();
        const isLateStage = ["paper", "process", "timing", "budget"].includes(key);
        if (isLateStage && conf && conf !== "high") cur.evidenceFragilityCount += 1;
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

    const quickWins = riskSet
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

    return {
      riskSetCount: riskSet.length,
      gapAbs,
      byBucket,
      topCats,
      repTrends,
      quickWins,
    };
  }, [analysisFlattenedDeals, flattenedDeals]);

  const coachingTips = useMemo(() => {
    const out: Array<{ key: string; tip: string; evidence: string; rep: string; account: string }> = [];
    const seen = new Set<string>();
    const sourceDeals = analysisFlattenedDeals.length ? analysisFlattenedDeals : flattenedDeals;
    // Include tips from categories with scores 0–2 (coaching moments); ignore categories with score 3
    const isCoachingScore = (score: number | null) => {
      if (score == null) return true;
      if (!Number.isFinite(score)) return true;
      return score <= 2;
    };

    for (const d of sourceDeals) {
      const rep = dealRep(d);
      const account = dealAccountLabel(d);
      for (const c of d.meddpicc_tb || []) {
        const key = String((c as any).key || "").trim();
        const tip = String((c as any).tip || "").trim();
        if (!key || !tip) continue;
        if (seen.has(key)) continue;
        const score = (c as any).score == null ? null : Number((c as any).score);
        if (!isCoachingScore(score)) continue;
        seen.add(key);
        out.push({
          key,
          tip,
          evidence: String((c as any).evidence || "").trim(),
          rep,
          account,
        });
        if (out.length >= 6) return out;
      }
    }

    return out;
  }, [analysisFlattenedDeals, flattenedDeals]);

  const radarTakeawayPayload = useMemo(() => {
    return {
      fiscal_year: props.fiscalYear,
      fiscal_quarter: props.fiscalQuarter,
      quota_period_id: quotaPeriodId,
      risk_scope: {
        kind: analysisFlattenedDeals.length ? "full_at_risk_set" : "current_loaded_set",
        note: "Compute all risk counts/downsides from the full at-risk set; Top N and sorts are display-only.",
      },
      radar_risk: {
        risk_set_total: {
          at_risk_count: radarStrategicTakeaway.riskSetCount,
          at_risk_by_bucket: radarStrategicTakeaway.byBucket,
          downside_gap_abs: radarStrategicTakeaway.gapAbs,
          top_meddpicc_gaps: radarStrategicTakeaway.topCats.map((c) => ({
            key: c.key,
            label: c.label,
            count: c.count,
            tip: c.tips?.[0] || null,
            ...(c.evidenceFragilityCount > 0 ? { evidence_fragility_count: c.evidenceFragilityCount } : {}),
          })),
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
      },
    };
  }, [props.fiscalYear, props.fiscalQuarter, quotaPeriodId, radarStrategicTakeaway, analysisFlattenedDeals.length]);

  async function runRadarAi(args: { force: boolean; showNoChangeToast: boolean }) {
    if (!radarTakeawayPayload?.quota_period_id) return;
    setRadarAiLoading(true);
    try {
      const r = await fetch("/api/forecast/ai-strategic-takeaway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surface: "radar",
          payload: radarTakeawayPayload,
          force: args.force,
          previous_payload_sha256: radarAiPayloadSha || undefined,
          previous_summary: radarAiSummary || undefined,
          previous_extended: radarAiExtended || undefined,
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

      const persistSummary = noChange ? (radarAiSummary || nextSummary) : (nextSummary || radarAiSummary);
      const persistExtended = noChange ? (radarAiExtended || nextExtended) : (nextExtended || radarAiExtended);

      if (nextSha) setRadarAiPayloadSha(nextSha);
      // Even when `no_change=true`, still apply formatting hardening so we never "stick" on an empty/raw envelope.
      if (nextSummary && nextSummary !== radarAiSummary) setRadarAiSummary(nextSummary);
      if (nextExtended && nextExtended !== radarAiExtended) setRadarAiExtended(nextExtended);

      if (noChange && args.showNoChangeToast && (persistSummary || persistExtended)) {
        setRadarAiToast("No material change in the underlying data.");
        window.setTimeout(() => setRadarAiToast(""), 2500);
      }

      try {
        sessionStorage.setItem(
          `sf_ai:radar:${String(radarTakeawayPayload.quota_period_id)}`,
          JSON.stringify({
            summary: persistSummary,
            extended: persistExtended,
            payload_sha256: nextSha || radarAiPayloadSha,
            updatedAt: Date.now(),
          })
        );
      } catch {
        // ignore
      }
    } catch {
      // keep prior
    } finally {
      setRadarAiLoading(false);
    }
  }

  useEffect(() => {
    if (!radarTakeawayPayload?.quota_period_id) return;
    const key = [
      radarTakeawayPayload.quota_period_id,
      radarTakeawayPayload.radar_risk?.risk_set_total?.at_risk_count || 0,
      radarTakeawayPayload.radar_risk?.risk_set_total?.downside_gap_abs || 0,
      stageView,
      refreshNonce,
    ].join("|");
    if (key === lastRadarAiKey.current) return;
    lastRadarAiKey.current = key;
    void runRadarAi({ force: false, showNoChangeToast: false });
  }, [radarTakeawayPayload, stageView, refreshNonce]);

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

  const productKpiPrev = props.productsClosedWonPrevSummary;

  const partnersDecisionEngine = useMemo(() => {
    const pe = props.partnersExecutive;
    if (!pe?.direct || !pe?.partner) return null;

    const direct = pe.direct;
    const partner = pe.partner;
    const prev = pe.previous || null;

    const denom = Number(direct.won_amount || 0) + Number(partner.won_amount || 0);
    const partnerMix = denom > 0 ? Number(partner.won_amount || 0) / denom : null;
    const directMix = partnerMix == null ? null : Math.max(0, Math.min(1, 1 - partnerMix));

    const narrative = (() => {
      const aovD = direct.aov == null ? null : Number(direct.aov);
      const aovP = partner.aov == null ? null : Number(partner.aov);
      const daysD = direct.avg_days == null ? null : Number(direct.avg_days);
      const daysP = partner.avg_days == null ? null : Number(partner.avg_days);
      const mix = partnerMix == null ? null : Math.round(partnerMix * 100);
      const sizeDeltaPct = aovD != null && aovP != null && aovD > 0 ? Math.round(((aovP - aovD) / aovD) * 100) : null;
      const velDeltaDays = daysD != null && daysP != null ? Math.round(daysP - daysD) : null;

      const sizePhrase =
        sizeDeltaPct == null
          ? "Deal size is mixed across motions"
          : sizeDeltaPct === 0
            ? "Partners and Direct are similar in deal size"
            : sizeDeltaPct > 0
              ? `Partners run ~${Math.abs(sizeDeltaPct)}% larger than Direct`
              : `Partners run ~${Math.abs(sizeDeltaPct)}% smaller than Direct`;

      const velPhrase =
        velDeltaDays == null
          ? "velocity differs by segment"
          : velDeltaDays === 0
            ? "with similar cycle time"
            : velDeltaDays > 0
              ? `but are ~${Math.abs(velDeltaDays)} days slower`
              : `but are ~${Math.abs(velDeltaDays)} days faster`;

      const mixPhrase = mix == null ? "with unclear channel contribution" : `and contribute ~${mix}% of closed-won`;
      return `${sizePhrase} ${velPhrase} ${mixPhrase} in this period.`;
    })();

    const baseRows = [
      {
        key: "direct",
        label: "Direct",
        open_pipeline: Number(direct.open_pipeline || 0) || 0,
        win_rate: direct.win_rate,
        avg_health_01: health01FromScore30(direct.avg_health_score),
        avg_days: direct.avg_days,
        aov: direct.aov,
        deal_count: direct.opps,
      },
      ...(pe.top_partners || []).map((p) => ({
        key: `partner:${String(p.partner_name)}`,
        label: String(p.partner_name),
        open_pipeline: Number(p.open_pipeline || 0) || 0,
        win_rate: p.win_rate,
        avg_health_01: health01FromScore30(p.avg_health_score),
        avg_days: p.avg_days,
        aov: p.aov,
        deal_count: p.opps,
      })),
    ];

    const prevBaseRows = prev?.direct
      ? [
          {
            key: "direct",
            label: "Direct",
            open_pipeline: Number(prev.direct.open_pipeline || 0) || 0,
            win_rate: prev.direct.win_rate,
            avg_health_01: health01FromScore30(prev.direct.avg_health_score),
            avg_days: prev.direct.avg_days,
            aov: prev.direct.aov,
            deal_count: prev.direct.opps,
          },
          ...(prev.top_partners || []).map((p) => ({
            key: `partner:${String(p.partner_name)}`,
            label: String(p.partner_name),
            open_pipeline: Number(p.open_pipeline || 0) || 0,
            win_rate: p.win_rate,
            avg_health_01: health01FromScore30(p.avg_health_score),
            avg_days: p.avg_days,
            aov: p.aov,
            deal_count: p.opps,
          })),
        ]
      : [];

    const boundsRows = prevBaseRows.length ? [...baseRows, ...prevBaseRows] : baseRows;

    const gcVals = boundsRows.map((r) => r.open_pipeline).filter((v) => Number.isFinite(v));
    const aovValsAll = boundsRows.map((r) => Number(r.aov ?? NaN)).filter((v) => Number.isFinite(v));
    const daysValsAll = boundsRows.map((r) => Number(r.avg_days ?? NaN)).filter((v) => Number.isFinite(v));
    const gcMin = gcVals.length ? Math.min(...gcVals) : 0;
    const gcMax = gcVals.length ? Math.max(...gcVals) : 0;
    const aovMin = aovValsAll.length ? Math.min(...aovValsAll) : 0;
    const aovMax = aovValsAll.length ? Math.max(...aovValsAll) : 0;
    const daysMin = daysValsAll.length ? Math.min(...daysValsAll) : 0;
    const daysMax = daysValsAll.length ? Math.max(...daysValsAll) : 0;

    const partnerOnly = boundsRows.filter((r) => r.key.startsWith("partner:"));
    const pAovVals = partnerOnly.map((r) => Number(r.aov ?? NaN)).filter((v) => Number.isFinite(v));
    const pDaysVals = partnerOnly.map((r) => Number(r.avg_days ?? NaN)).filter((v) => Number.isFinite(v));
    const pAovMin = pAovVals.length ? Math.min(...pAovVals) : 0;
    const pAovMax = pAovVals.length ? Math.max(...pAovVals) : 0;
    const pDaysMin = pDaysVals.length ? Math.min(...pDaysVals) : 0;
    const pDaysMax = pDaysVals.length ? Math.max(...pDaysVals) : 0;

    const scoreRow = (r: (typeof boundsRows)[number]) => {
      const GC = normalize(r.open_pipeline, gcMin, gcMax);
      const win = r.win_rate != null && Number.isFinite(r.win_rate) ? clamp01(Number(r.win_rate)) : null;
      const health01 = r.avg_health_01 != null && Number.isFinite(r.avg_health_01) ? clamp01(Number(r.avg_health_01)) : null;
      const WQ = win == null ? 0 : health01 == null ? win : win * health01;
      const VE = 1 - normalize(Number(r.avg_days ?? 0) || 0, daysMin, daysMax);
      const DE = normalize(Number(r.aov ?? 0) || 0, aovMin, aovMax);
      const WIC_raw = GC * 0.35 + WQ * 0.3 + VE * 0.2 + DE * 0.15;
      const WIC = clampScore100(WIC_raw * 100);

      let PQS: number | null = null;
      if (r.key.startsWith("partner:")) {
        const WRF = win == null ? 0 : win;
        const DSF = normalize(Number(r.aov ?? 0) || 0, pAovMin, pAovMax);
        const VP = normalize(Number(r.avg_days ?? 0) || 0, pDaysMin, pDaysMax);
        const dc = Math.max(0, Number(r.deal_count || 0) || 0);
        const CF = Math.min(1, Math.log(dc + 1) / Math.log(10));
        const PQS_raw = WRF * 0.4 + DSF * 0.25 + CF * 0.2 - VP * 0.15;
        PQS = clampScore100(PQS_raw * 100);
      }

      return { wic: WIC, pqs: PQS };
    };

    const prevByKey = new Map<string, { wic: number; pqs: number | null }>();
    for (const r of prevBaseRows) prevByKey.set(String(r.key), scoreRow(r));

    const scored = baseRows.map((r) => {
      const cur = scoreRow(r);
      const prev0 = prevByKey.get(String(r.key)) || null;
      return { ...r, wic: cur.wic, wic_prev: prev0?.wic ?? null, wic_band: wicBand(cur.wic), pqs: cur.pqs };
    });

    const cei = (() => {
      const directDays = direct.avg_days == null ? null : Number(direct.avg_days);
      const partnerDays = partner.avg_days == null ? null : Number(partner.avg_days);
      const directWon = Number(direct.won_amount || 0) || 0;
      const partnerWon = Number(partner.won_amount || 0) || 0;
      const directWin = direct.win_rate == null ? null : clamp01(Number(direct.win_rate));
      const partnerWin = partner.win_rate == null ? null : clamp01(Number(partner.win_rate));
      const directH = health01FromScore30(direct.avg_health_score);
      const partnerH = health01FromScore30(partner.avg_health_score);

      const RV_direct = directDays && directDays > 0 ? directWon / directDays : 0;
      const RV_partner = partnerDays && partnerDays > 0 ? partnerWon / partnerDays : 0;
      const QM_direct = directWin == null ? 0 : directH == null ? directWin : directWin * directH;
      const QM_partner = partnerWin == null ? 0 : partnerH == null ? partnerWin : partnerWin * partnerH;
      const CEI_raw_direct = RV_direct * QM_direct;
      const CEI_raw_partner = RV_partner * QM_partner;
      const partner_index = CEI_raw_direct > 0 ? (CEI_raw_partner / CEI_raw_direct) * 100 : null;
      return { direct_index: 100, partner_index };
    })();

    return { narrative, directMix, partnerMix, direct, partner, scored, cei, cei_prev_partner_index: pe.cei_prev_partner_index ?? null };
  }, [props.partnersExecutive]);

  function updateUrl(mut: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(sp.toString());
    mut(params);
    router.replace(`${props.basePath}?${params.toString()}`);
  }

  const kpis = props.quarterKpis;
  const avgHealthWon = kpis?.avgHealthWonPct ?? null;
  const avgHealthLost = kpis?.avgHealthLostPct ?? null;
  const oppToWin = kpis?.oppToWin ?? null; // 0..1
  const agingAvgDays = kpis?.agingAvgDays ?? null;

  const curProd = productViz.summary;
  const prevProd = productKpiPrev;
  const curRev = curProd ? Number(curProd.total_revenue || 0) || 0 : 0;
  const curOrders = curProd ? Number(curProd.total_orders || 0) || 0 : 0;
  const curAcv = curProd ? Number(curProd.blended_acv || 0) || 0 : 0;
  const prevRev = prevProd ? Number(prevProd.total_revenue || 0) || 0 : 0;
  const prevOrders = prevProd ? Number(prevProd.total_orders || 0) || 0 : 0;
  const prevAcv = prevProd ? Number(prevProd.blended_acv || 0) || 0 : 0;

  const fmtPct = (p01: number | null) => {
    if (p01 == null || !Number.isFinite(p01)) return "—";
    return `${Math.round(p01 * 100)}%`;
  };

  const heroCard = "h-full rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm";
  const heroVal = "mt-2 text-kpiValue text-[color:var(--sf-text-primary)]";

  const productDelta = (cur: number, prev: number) => {
    const d = cur - prev;
    const up = d > 0;
    const down = d < 0;
    const tone = up ? "text-[#16A34A]" : down ? "text-[#E74C3C]" : "text-[color:var(--sf-text-secondary)]";
    const arrow = up ? "↑" : down ? "↓" : "→";
    return { d, tone, arrow };
  };

  return (
    <div className="grid gap-4">
      <section className="w-full rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,620px)] lg:items-start">
          <div className="min-w-0">
            <div className="flex items-center justify-center">
              <div className="relative w-[320px] max-w-[85vw] shrink-0 aspect-[1024/272] sm:w-[420px]">
                <Image
                  src="/brand/logooutlook.png"
                  alt="SalesForecast.io Outlook"
                  fill
                  sizes="(min-width: 640px) 420px, 320px"
                  className="origin-center scale-90 object-contain"
                  priority={true}
                />
              </div>
            </div>

            <div className="mt-4">
              <div className="text-left">
                <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Quarter End Outlook</div>
                <div className="mt-1 text-kpiHero text-[color:var(--sf-text-primary)]">
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
                    <span className={`inline-flex rounded-full border px-3 py-1 text-meta font-[500] ${pill}`}>{c.label}</span>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="min-w-0 lg:pt-1">
            <div className="ml-auto grid max-w-[560px] gap-3 sm:grid-cols-2">
              <div className="contents">
                {(() => {
                  const rev = productDelta(curRev, prevRev);
                  const ord = productDelta(curOrders, prevOrders);
                  const acv = productDelta(curAcv, prevAcv);
                  const fmtSignedInt = (n: number) => {
                    const v = Number(n || 0);
                    if (!Number.isFinite(v)) return "—";
                    if (v === 0) return "0";
                    const abs = Math.abs(Math.trunc(v));
                    return `${v > 0 ? "+" : "-"}${abs.toLocaleString("en-US")}`;
                  };

                  return (
                    <>
                      <div className={heroCard}>
                        <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Closed Won (QTD)</div>
                        <div className={heroVal}>{fmtMoney(curRev)}</div>
                        <div className="mt-2 grid grid-cols-[auto_1fr] items-start gap-3">
                          <div className={["flex items-center gap-2 text-meta font-[500] leading-none num-tabular", rev.tone].join(" ")}>
                            <div>{prevProd ? fmtMoney(rev.d) : "—"}</div>
                            <div aria-hidden="true" className="text-base leading-none">
                              {rev.arrow}
                            </div>
                          </div>
                          <div className="min-w-0 truncate text-right text-meta">
                            Last Quarter{" "}
                            <span className="num-tabular font-[500] text-[color:var(--sf-text-primary)]">{prevProd ? fmtMoney(prevRev) : "—"}</span>
                          </div>
                        </div>
                      </div>

                      <div className={heroCard}>
                        <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Total Orders</div>
                        <div className={heroVal}>{curOrders.toLocaleString("en-US")}</div>
                        <div className="mt-2 grid grid-cols-[auto_1fr] items-start gap-3">
                          <div className={["flex items-center gap-2 text-meta font-[500] leading-none num-tabular", ord.tone].join(" ")}>
                            <div>{prevProd ? fmtSignedInt(ord.d) : "—"}</div>
                            <div aria-hidden="true" className="text-base leading-none">
                              {ord.arrow}
                            </div>
                          </div>
                          <div className="min-w-0 truncate text-right text-meta">
                            Last Quarter{" "}
                            <span className="num-tabular font-[500] text-[color:var(--sf-text-primary)]">{prevProd ? prevOrders.toLocaleString("en-US") : "—"}</span>
                          </div>
                        </div>
                      </div>

                      <div className={heroCard}>
                        <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Blended ACV</div>
                        <div className={heroVal}>{fmtMoney(curAcv)}</div>
                        <div className="mt-2 grid grid-cols-[auto_1fr] items-start gap-3">
                          <div className={["flex items-center gap-2 text-meta font-[500] leading-none num-tabular", acv.tone].join(" ")}>
                            <div>{prevProd ? fmtMoney(acv.d) : "—"}</div>
                            <div aria-hidden="true" className="text-base leading-none">
                              {acv.arrow}
                            </div>
                          </div>
                          <div className="min-w-0 truncate text-right text-meta">
                            Last Quarter{" "}
                            <span className="num-tabular font-[500] text-[color:var(--sf-text-primary)]">{prevProd ? fmtMoney(prevAcv) : "—"}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="contents">
                <div className={[heroCard, "h-auto"].join(" ")}>
                  <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Avg Health Closed Won</div>
                  <div className="mt-2 text-kpiSupport text-[color:var(--sf-text-primary)]">
                    <span className={["num-tabular", healthColorClass(avgHealthWon)].join(" ")}>{avgHealthWon == null ? "—" : `${avgHealthWon}%`}</span>
                  </div>
                </div>
                <div className={heroCard}>
                  <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Opp→Win Conversion</div>
                  <div className="mt-2 text-kpiSupport text-[color:var(--sf-text-primary)]">{fmtPct(oppToWin)}</div>
                </div>
                <div className={heroCard}>
                  <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Avg Health Closed Loss</div>
                  <div className="mt-2 text-kpiSupport text-[color:var(--sf-text-primary)]">
                    <span className={["num-tabular", healthColorClass(avgHealthLost)].join(" ")}>{avgHealthLost == null ? "—" : `${avgHealthLost}%`}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-4 py-3 shadow-sm">
              <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Avg Days Aging</div>
              <div className="mt-1 text-tableLabel">Closed Won</div>
              <div className="mt-2 text-kpiSupport text-[color:var(--sf-text-primary)]">{fmtDays(props.quarterKpis?.wonAvgDays ?? null)}</div>
            </div>

            <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-4 py-3 shadow-sm">
              <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Avg Days Aging</div>
              <div className="mt-1 text-tableLabel">Remaining Pipeline</div>
              <div className="mt-2 text-kpiSupport text-[color:var(--sf-text-primary)]">
                {fmtDays(props.quarterKpis?.agingAvgDays ?? null)}
              </div>
            </div>
          </div>

          <ExecutiveRemainingQuarterlyForecastBlock crmTotals={props.crmTotals} quota={props.quota} pipelineMomentum={props.pipelineMomentum} />

          <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">
                <Image
                  src="/brand/salesforecast-logo-white.png"
                  alt="SalesForecast.io"
                  width={258}
                  height={47}
                  className="h-[1.95rem] w-auto opacity-90"
                />
                <span>✨ Strategic Takeaway</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runHeroAi({ force: true, showNoChangeToast: true })}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)]/70"
                >
                  Reanalyze
                </button>
                <button
                  type="button"
                  onClick={() => void copyHeroAi()}
                  className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)]/70"
                  disabled={!heroAiSummary && !heroAiExtended}
                  title={heroAiSummary || heroAiExtended ? "Copy summary + extended" : "No summary to copy yet"}
                >
                  <span aria-hidden="true">⧉</span>
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => setHeroAiExpanded((v) => !v)}
                  className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)]"
                >
                  {heroAiExpanded ? "Hide extended analysis" : "Extended analysis"}
                </button>
              </div>
            </div>

            {heroAiToast ? <div className="mt-3 text-xs font-semibold text-[color:var(--sf-text-secondary)]">{heroAiToast}</div> : null}
            {heroAiCopied ? <div className="mt-3 text-xs font-semibold text-[color:var(--sf-text-secondary)]">Copied.</div> : null}
            {heroAiLoading ? (
              <div className="mt-3 text-xs text-[color:var(--sf-text-secondary)]">AI agent is generating a CRO-grade takeaway…</div>
            ) : heroAiSummary || heroAiExtended ? (
              <div className="mt-3 grid gap-3">
                {heroAiSummary ? (
                  <div className="rounded-lg border border-[color:var(--sf-border)] bg-white p-3 text-sm text-black">
                    {renderCategorizedText(heroAiSummary) || <div className="whitespace-pre-wrap">{heroAiSummary}</div>}
                  </div>
                ) : null}
                {heroAiExpanded && heroAiExtended ? (
                  <div className="rounded-lg border border-[color:var(--sf-border)] bg-white p-3 text-left text-sm leading-relaxed text-black whitespace-pre-wrap">
                    {renderCategorizedText(heroAiExtended) || <div className="whitespace-pre-wrap">{heroAiExtended}</div>}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

      </section>

      <div className="mt-5">
        <KpiCardsRow
          quota={props.quota}
          aiForecast={props.aiForecast}
          crmForecast={props.crmForecast}
          gap={props.gap}
          bucketDeltas={props.bucketDeltas}
          dealsAtRisk={dealsAtRisk}
          topN={topN}
          usingFullRiskSet={quarterDrivers.usingFullRiskSet}
          productKpis={productViz.summary}
          productKpisPrev={productKpiPrev}
          commitAdmission={props.commitAdmission}
          variant="forecast_only"
        />
      </div>

      {props.commitAdmission && (props.commitAdmission.totalCommitCrmAmount > 0 || props.commitAdmission.unsupportedCommitAmount > 0 || props.commitAdmission.commitNeedsReviewAmount > 0 || props.commitAdmission.aiSupportedCommitAmount > 0) ? (
        <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
          <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Commit Integrity</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Total Commit (CRM) $</div>
              <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">
                {props.commitAdmission.totalCommitCrmAmount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
              </div>
            </div>
            <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
              <div className="text-xs text-[color:var(--sf-text-secondary)]">AI-Supported Commit $</div>
              <div className="mt-1 text-lg font-semibold text-[#2ECC71]">
                {props.commitAdmission.aiSupportedCommitAmount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
              </div>
            </div>
            <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Unsupported Commit $</div>
              <div className={`mt-1 text-lg font-semibold ${props.commitAdmission.unsupportedCommitAmount > 0 ? "text-[#E74C3C]" : "text-[color:var(--sf-text-primary)]"}`}>
                {props.commitAdmission.unsupportedCommitAmount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
              </div>
            </div>
            <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Needs Review $</div>
              <div className={`mt-1 text-lg font-semibold ${props.commitAdmission.commitNeedsReviewAmount > 0 ? "text-[#F1C40F]" : "text-[color:var(--sf-text-primary)]"}`}>
                {props.commitAdmission.commitNeedsReviewAmount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <div className="mt-4">
        <ExecutiveQuarterKpisModule
          period={activePeriod}
          quota={props.quota}
          pipelineMomentum={props.pipelineMomentum}
        crmTotals={props.crmTotals}
          quarterKpis={props.quarterKpis}
          repRollups={props.repRollups as any}
          productsClosedWon={props.productsClosedWon as any}
        />
      </div>

      <div className="grid w-full gap-4 lg:grid-cols-[minmax(200px,280px)_1fr] lg:items-start">
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Quick Account Review - Top {radarTopN}</div>
            <select
              value={radarTopN}
              onChange={(e) => setRadarTopN(clampInt(Number(e.target.value) || 20, 5, 50))}
              className="h-[36px] w-[80px] shrink-0 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]"
            >
              {topXOptions.map((n) => (
                <option key={n} value={n}>
                  Top {n}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 text-sm text-[color:var(--sf-text-primary)]">
            {radarDeals.length ? (
              <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                {radarDeals.map((d) => (
                  <div
                    key={d.id}
                    className="flex min-w-0 items-center gap-1.5 rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full border border-[color:var(--sf-border)]"
                      style={{ background: d.color }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 truncate text-xs" title={String(d.legendLabel || d.label)}>
                      {String(d.legendLabel || d.label)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[color:var(--sf-text-secondary)]">No at-risk deals in the current view.</div>
            )}
          </div>
        </section>

        <div className="min-w-0">
          <RiskRadarPlot deals={radarDeals} size={960} />
        </div>
      </div>

      <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
        <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Coaching tips (from opportunities)</div>
          {coachingTips.length ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-[color:var(--sf-text-primary)]">
              {coachingTips.map((t) => (
                <li key={`${t.key}-${t.rep}-${t.account}`}>
                  <span className="font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{t.key}</span>: {t.tip}
                  <span className="text-[color:var(--sf-text-secondary)]"> · Rep: {t.rep} · Account: {t.account}</span>
                  {t.evidence ? <span className="text-[color:var(--sf-text-secondary)]"> · Evidence: {t.evidence}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">No coaching tips from opportunities in the current view.</div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
            <Image
              src="/brand/salesforecast-logo-white.png"
              alt="SalesForecast.io"
              width={258}
              height={47}
              className="h-[1.95rem] w-auto opacity-90"
            />
            <span>✨ AI Strategic Takeaway</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void runRadarAi({ force: true, showNoChangeToast: true })}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]/70"
            >
              Reanalyze
            </button>
            <button
              type="button"
              onClick={() => void copyRadarAi()}
              className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]/70"
              disabled={!radarAiSummary && !radarAiExtended}
              title={radarAiSummary || radarAiExtended ? "Copy summary + extended" : "No summary to copy yet"}
            >
              <span aria-hidden="true">⧉</span>
              Copy
            </button>
            <button
              type="button"
              onClick={() => setRadarAiExpanded((v) => !v)}
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]"
            >
              {radarAiExpanded ? "Hide extended analysis" : "Extended analysis"}
            </button>
          </div>
        </div>
        {radarAiToast ? <div className="mt-2 text-xs font-semibold text-[color:var(--sf-text-secondary)]">{radarAiToast}</div> : null}
        {radarAiCopied ? <div className="mt-2 text-xs font-semibold text-[color:var(--sf-text-secondary)]">Copied.</div> : null}
        {radarAiLoading ? (
          <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">AI agent is generating MEDDPICC+TB coaching guidance…</div>
        ) : radarAiSummary || radarAiExtended ? (
          <div className="mt-2 grid gap-3">
            {radarAiSummary ? (
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-white p-3 text-sm text-black">
                {renderCategorizedText(radarAiSummary) || <div className="whitespace-pre-wrap">{radarAiSummary}</div>}
              </div>
            ) : null}
            {radarAiExpanded && radarAiExtended ? (
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-white p-3 text-left text-sm leading-relaxed text-black whitespace-pre-wrap">
                {renderCategorizedText(radarAiExtended) || <div className="whitespace-pre-wrap">{radarAiExtended}</div>}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Adjust Risk Radae and Account View</div>
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
                onChange={(e) => setTopN(clampInt(Number(e.target.value) || 5, 5, 50))}
                className="h-[40px] w-[92px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                {topXOptions.map((n) => (
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
            <ExecutiveDealsDrivingGapModule
              title={stageLabel}
              subtitle={undefined}
              deals={sortedDeals.slice(0, topN)}
            />
          </div>
        );
      })()}

      {props.productsClosedWon.length ? <ExecutiveProductPerformance data={productViz} quotaPeriodId={quotaPeriodId} /> : null}

      {partnersDecisionEngine ? (
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-[color:var(--sf-text-primary)]">Direct vs. Indirect Performance</div>
            </div>
          </div>

          {(() => {
            const direct = partnersDecisionEngine.direct;
            const partner = partnersDecisionEngine.partner;

            const directWin = direct.win_rate == null ? null : Number(direct.win_rate);
            const partnerWin = partner.win_rate == null ? null : Number(partner.win_rate);

            const directHealth01 = direct.avg_health_score == null ? null : Number(direct.avg_health_score) / 30;
            const partnerHealth01 = partner.avg_health_score == null ? null : Number(partner.avg_health_score) / 30;

            const directRev = direct.won_amount == null ? null : Number(direct.won_amount);
            const partnerRev = partner.won_amount == null ? null : Number(partner.won_amount);

            const directMix = partnersDecisionEngine.directMix == null ? null : Number(partnersDecisionEngine.directMix);
            const partnerMix = partnersDecisionEngine.partnerMix == null ? null : Number(partnersDecisionEngine.partnerMix);

            function fmtMoneyK(n: any) {
              const v = Number(n || 0);
              if (!Number.isFinite(v)) return "—";
              const k = Math.round(v / 1000);
              return `$${k.toLocaleString("en-US")}K`;
            }

            function highlightClass(value: number | null, a: number | null, b: number | null) {
              if (value == null || a == null || b == null) return "";
              const aa = Number(a);
              const bb = Number(b);
              if (!Number.isFinite(aa) || !Number.isFinite(bb)) return "";
              const denom = Math.max(Math.abs(aa), Math.abs(bb));
              if (denom <= 0) return "";
              const relDiffPct = (Math.abs(aa - bb) / denom) * 100;
              if (relDiffPct <= 5) return "";
              if (aa === bb) return "";
              const max = Math.max(aa, bb);
              const min = Math.min(aa, bb);
              if (value === max) return "text-[#16A34A]";
              if (value === min) return "text-[#E74C3C]";
              return "";
            }

            const rows = [
              {
                k: "Direct",
                win: directWin,
                health: directHealth01,
                rev: directRev,
                mix: directMix,
              },
              {
                k: "Partner",
                win: partnerWin,
                health: partnerHealth01,
                rev: partnerRev,
                mix: partnerMix,
              },
            ] as const;

            return (
              <div className="mt-4 rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Motion Performance Snapshot</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {rows.map((row) => (
                    <div key={row.k} className="h-full rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
                      <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{row.k}</div>
                      <div className="mt-3 grid gap-2 text-[11px] text-[color:var(--sf-text-secondary)]">
                        <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                          <span>Win Rate</span>
                          <span
                            className={[
                              "font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]",
                              highlightClass(row.win, directWin, partnerWin),
                            ].join(" ")}
                          >
                            {row.win == null ? "—" : fmtPct01(row.win)}
                          </span>
                        </div>
                        <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                          <span>Avg Health</span>
                          <span
                            className={[
                              "font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]",
                              highlightClass(row.health, directHealth01, partnerHealth01),
                            ].join(" ")}
                          >
                            {row.health == null ? "—" : `${Math.round(row.health * 100)}%`}
                          </span>
                        </div>
                        <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                          <span>Revenue</span>
                          <span
                            className={[
                              "font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]",
                              highlightClass(row.rev, directRev, partnerRev),
                            ].join(" ")}
                          >
                            {row.rev == null ? "—" : fmtMoneyK(row.rev)}
                          </span>
                        </div>
                        <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                          <span>Mix</span>
                          <span
                            className={[
                              "font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]",
                              highlightClass(row.mix, directMix, partnerMix),
                            ].join(" ")}
                          >
                            {row.mix == null ? "—" : fmtPct01(row.mix)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {(() => {
                    const deltaTone = (d: number | null) => (d == null || !Number.isFinite(d) ? "text-[color:var(--sf-text-disabled)]" : d > 0 ? "text-[#16A34A]" : d < 0 ? "text-[#E74C3C]" : "text-[color:var(--sf-text-primary)]");
                    const fmtPp = (d01: number | null) => {
                      if (d01 == null || !Number.isFinite(d01)) return "—";
                      const pp = d01 * 100;
                      const abs = Math.abs(pp);
                      const txt = `${Math.round(abs)}pp`;
                      return `${pp > 0 ? "+" : pp < 0 ? "-" : ""}${txt}`;
                    };
                    const fmtMoneyKSigned = (d: number | null) => {
                      if (d == null || !Number.isFinite(d)) return "—";
                      const k = Math.round(Math.abs(d) / 1000);
                      const txt = `$${k.toLocaleString("en-US")}K`;
                      return `${d > 0 ? "+" : d < 0 ? "-" : ""}${txt}`;
                    };

                    const dWin = directWin == null || partnerWin == null ? null : directWin - partnerWin;
                    const dHealth = directHealth01 == null || partnerHealth01 == null ? null : directHealth01 - partnerHealth01;
                    const dRev = directRev == null || partnerRev == null ? null : directRev - partnerRev;
                    const dMix = directMix == null || partnerMix == null ? null : directMix - partnerMix;

                    return (
                      <div className="h-full rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
                        <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Direct Vs. Indirect Performance</div>
                        <div className="mt-3 grid gap-2 text-[11px] text-[color:var(--sf-text-secondary)]">
                          <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                            <span>Win Rate</span>
                            <span className={["font-mono text-xs font-semibold", deltaTone(dWin)].join(" ")}>{fmtPp(dWin)}</span>
                          </div>
                          <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                            <span>Avg Health</span>
                            <span className={["font-mono text-xs font-semibold", deltaTone(dHealth)].join(" ")}>{fmtPp(dHealth)}</span>
                          </div>
                          <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                            <span>Revenue</span>
                            <span className={["font-mono text-xs font-semibold", deltaTone(dRev)].join(" ")}>{fmtMoneyKSigned(dRev)}</span>
                          </div>
                          <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                            <span>Mix</span>
                            <span className={["font-mono text-xs font-semibold", deltaTone(dMix)].join(" ")}>{fmtPp(dMix)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="h-fit self-start rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
                    {(() => {
                      const ceiCur = partnersDecisionEngine.cei.partner_index;
                      const ceiPrev = partnersDecisionEngine.cei_prev_partner_index;
                      const ceiCurN = ceiCur == null ? null : Number(ceiCur);
                      const ceiPrevN = ceiPrev == null ? null : Number(ceiPrev);
                      const delta = ceiCurN != null && ceiPrevN != null ? ceiCurN - ceiPrevN : null;

                      const status =
                        ceiCurN == null
                          ? { label: "—", tone: "muted" as const }
                          : ceiCurN >= 120
                            ? { label: "HIGH", tone: "good" as const }
                            : ceiCurN >= 90
                              ? { label: "MEDIUM", tone: "warn" as const }
                              : ceiCurN >= 70
                                ? { label: "LOW", tone: "bad" as const }
                                : { label: "CRITICAL", tone: "bad" as const };

                      const partnerWon = Number(partnersDecisionEngine.partner.won_opps || 0) || 0;
                      const sampleFactor = Math.min(1, partnerWon / 12);
                      const revenueShare = partnersDecisionEngine.partnerMix == null ? 0 : Number(partnersDecisionEngine.partnerMix);
                      const revenueFactor = Math.min(1, revenueShare / 0.4);
                      const volatilityFactor = delta != null ? 1 - normalize(Math.abs(delta), 0, 100) : 0.6;
                      const conf01 = sampleFactor * 0.5 + revenueFactor * 0.3 + volatilityFactor * 0.2;
                      const conf = clampScore100(conf01 * 100);
                      const confBand =
                        conf >= 75 ? "HIGH CONFIDENCE" : conf >= 50 ? "MODERATE CONFIDENCE" : conf >= 30 ? "LOW CONFIDENCE" : "PRELIMINARY";

                      const trend =
                        delta == null
                          ? { label: "—", arrow: "→", tone: "muted" as const }
                          : delta >= 15
                            ? { label: "Improving", arrow: "↑", tone: "good" as const }
                            : delta <= -15
                              ? { label: "Declining", arrow: "↓", tone: "bad" as const }
                              : { label: "Stable", arrow: "→", tone: "muted" as const };

                      return (
                        <>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">CEI Performance</div>
                          <div className="mt-2 grid gap-2 text-sm text-[color:var(--sf-text-primary)]">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[color:var(--sf-text-secondary)]">CEI Status</span>
                              <span
                                className={[
                                  "inline-flex min-w-[110px] items-center justify-center rounded-full border px-3 py-1 text-[11px] font-semibold",
                                  pillToneClass(status.tone),
                                ].join(" ")}
                              >
                                {status.label}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[color:var(--sf-text-secondary)]">Partner CEI</span>
                              <span className="font-mono font-semibold">
                                {ceiCurN == null ? "—" : `${Math.round(ceiCurN).toLocaleString("en-US")} (Direct = 100)`}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[color:var(--sf-text-secondary)]">Confidence</span>
                              <span className="font-mono font-semibold">{confBand}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[color:var(--sf-text-secondary)]">Trend</span>
                              <span
                                className={[
                                  "flex items-center gap-1 font-mono font-semibold",
                                  trend.tone === "good" ? "text-[#16A34A]" : trend.tone === "bad" ? "text-[#E74C3C]" : "text-[color:var(--sf-text-secondary)]",
                                ].join(" ")}
                              >
                                <span aria-hidden="true">{trend.arrow}</span>
                                <span>{trend.label}</span>
                              </span>
                            </div>
                            <div className="text-[11px] text-[color:var(--sf-text-secondary)]">
                              Based on {partnerWon.toLocaleString("en-US")} partner closed-won deal(s).
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            );
          })()}

          <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Canonical Scoring Engine (WIC / PQS / CEI)</div>
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">WIC + PQS (top partners)</div>
                <div className="mt-3 flex flex-wrap gap-3">
                  {partnersDecisionEngine.scored
                    .slice(0, 1 + Math.min(15, Math.max(0, partnersDecisionEngine.scored.length - 1)))
                    .map((r) => {
                      const pill = r.wic_band;
                      const bandTone = (() => {
                        const s = String(pill.label || "").toLowerCase();
                        if (s.includes("scale")) return "good" as const;
                        if (s.includes("deprior")) return "bad" as const;
                        if (s.includes("maintain")) return "warn" as const;
                        return pill.tone;
                      })();
                      const trendArrow = (() => {
                        const cur = Number(r.wic);
                        const prev = r.wic_prev == null ? null : Number(r.wic_prev);
                        if (!Number.isFinite(cur) || prev == null || !Number.isFinite(prev)) return "—";
                        const d = cur - prev;
                        if (d >= 5) return "↑";
                        if (d <= -5) return "↓";
                        return "→";
                      })();
                      const trendTone = trendArrow === "↑" ? "up" : trendArrow === "↓" ? "down" : "flat";
                      const trendCls =
                        trendTone === "up"
                          ? "text-[#16A34A]"
                          : trendTone === "down"
                            ? "text-[#E74C3C]"
                            : "text-[#F1C40F]";
                      return (
                        <div
                          key={r.key}
                          className="flex w-full flex-col rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3 shadow-sm sm:w-[220px]"
                        >
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0 truncate text-sm font-semibold text-[color:var(--sf-text-primary)]">{r.label}</div>
                            <span
                              className={[
                                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                                pillToneClass(bandTone),
                              ].join(" ")}
                            >
                              {pill.label}
                            </span>
                          </div>

                          <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
                            <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">WIC:</span>{" "}
                            <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">
                              {Math.round(r.wic).toLocaleString("en-US")}
                            </span>{" "}
                            <span className="text-[color:var(--sf-text-secondary)]">|</span>{" "}
                            <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">PQS:</span>{" "}
                            <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">
                              {r.pqs == null ? "—" : Math.round(r.pqs).toLocaleString("en-US")}
                            </span>{" "}
                            <span className="text-[color:var(--sf-text-secondary)]">|</span>{" "}
                            <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">Trend:</span>{" "}
                            <span className={["font-mono text-base font-bold leading-none", trendCls].join(" ")}>{trendArrow}</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
                <div className="mt-2 text-[11px] text-[color:var(--sf-text-secondary)]">
                  WIC computed for Direct + each partner. PQS computed per partner only. Scores are clamped 0–100.
                </div>
              </div>
            </div>
          </section>

          <div className="mt-4">
            <PartnersExecutiveAiTakeawayClient
              quotaPeriodId={quotaPeriodId}
              payload={{
                page: "dashboard/executive",
                quota_period_id: quotaPeriodId,
                fiscal_year: props.fiscalYear,
                fiscal_quarter: props.fiscalQuarter,
                direct: partnersDecisionEngine.direct,
                partner: partnersDecisionEngine.partner,
                revenue_mix_partner_pct: partnersDecisionEngine.partnerMix,
                decision_engine: {
                  executive_narrative: partnersDecisionEngine.narrative,
                  cei_index: partnersDecisionEngine.cei,
                  wic: partnersDecisionEngine.scored.map((r) => ({ label: r.label, wic: r.wic, band: r.wic_band.label, open_pipeline: r.open_pipeline })),
                  pqs: partnersDecisionEngine.scored.filter((r) => String(r.key).startsWith("partner:")).map((r) => ({ label: r.label, pqs: r.pqs })),
                },
                top_partners: (props.partnersExecutive?.top_partners || []).slice(0, 20),
              }}
            />
          </div>
        </section>
      ) : null}

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

      {/* Removed from Executive Dashboard (redundant with KPI tiles + focused sections). */}
      {/*
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
                <Chip
                  label="Revenue Mix (Direct)"
                  value={
                    (() => {
                      const d = Number(props.quarterKpis.directVsPartner.directWonAmount || 0) || 0;
                      const p = Number(props.quarterKpis.directVsPartner.partnerWonAmount || 0) || 0;
                      const denom = d + p;
                      return denom > 0 ? fmtPct01(d / denom) : "—";
                    })()
                  }
                />
                <Chip
                  label="Revenue Mix (Partner)"
                  value={
                    (() => {
                      const d = Number(props.quarterKpis.directVsPartner.directWonAmount || 0) || 0;
                      const p = Number(props.quarterKpis.directVsPartner.partnerWonAmount || 0) || 0;
                      const denom = d + p;
                      return denom > 0 ? fmtPct01(p / denom) : "—";
                    })()
                  }
                />
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
                            {repIds.length.toLocaleString("en-US")} rep(s) · totals across full descendant team
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
      */}

      <div className="mt-6">
        <AiSummaryReportClient
          entries={[
            { label: "SalesForecast.io Outlook", surface: "hero", quotaPeriodId },
            { label: "Risk radar takeaway", surface: "radar", quotaPeriodId },
            { label: "Partner executive takeaways", surface: "partners_executive", quotaPeriodId },
            { label: "Product performance takeaway", surface: "product_performance", quotaPeriodId },
          ]}
        />
      </div>

    </div>
  );
}

