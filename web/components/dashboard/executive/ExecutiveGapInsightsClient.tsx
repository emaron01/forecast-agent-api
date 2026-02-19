"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import type { ExecRepOption } from "../../../lib/executiveForecastDashboard";
import type { RepDirectoryRow } from "../../../lib/repScope";
import { DealsDrivingGapHeatmap, type HeatmapDealRow } from "./DealsDrivingGapHeatmap";
import { KpiCardsRow } from "./KpiCardsRow";
import { RiskRadarPlot, type RadarDeal } from "./RiskRadarPlot";
import { palette } from "../../../lib/palette";

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
  const [loading, setLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [topN, setTopN] = useState(Math.max(1, props.defaultTopN || 15));
  const [stageView, setStageView] = useState<"commit" | "best_case" | "pipeline" | "all">("commit");

  const quotaPeriodId = String(sp.get("quota_period_id") || props.quotaPeriodId || "").trim();
  const repPublicId = String(sp.get("rep_public_id") || "").trim();
  const riskCategory = String(sp.get("risk_category") || "").trim();
  const mode = String(sp.get("mode") || "drivers").trim() === "risk" ? "risk" : "drivers";
  const scoreDrivenOnly = String(sp.get("driver_require_score_effect") || sp.get("risk_require_score_effect") || "1").trim() !== "0";

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams(sp.toString());
    // Ensure quarter selection is always honored.
    setParam(params, "quota_period_id", quotaPeriodId);
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

  const ok = asOk(data);
  const err = asErr(data);

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
    const deals = flattenedDeals;
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
    if (props.leftToGo > 0) bullets.push(`Quarter end outlook is ${fmtMoney(props.leftToGo)} short of quota at current AI-weighted projection.`);
    else if (props.leftToGo < 0) bullets.push(`Quarter end outlook is ${fmtMoney(Math.abs(props.leftToGo))} ahead of quota at current AI-weighted projection.`);

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

    return { bullets: bullets.filter(Boolean).slice(0, 4) };
  }, [flattenedDeals, props.leftToGo, props.gap]);

  const viewFullHref = useMemo(() => {
    const params = new URLSearchParams(sp.toString());
    // Ensure we can deep-link the same filters into the existing report.
    setParam(params, "quota_period_id", quotaPeriodId);
    const qs = params.toString();
    return qs ? `/analytics/meddpicc-tb/gap-driving-deals?${qs}` : "/analytics/meddpicc-tb/gap-driving-deals";
  }, [sp, quotaPeriodId]);

  const dataDetailsGapHref = useMemo(() => {
    const params = new URLSearchParams(sp.toString());
    setParam(params, "quota_period_id", quotaPeriodId);

    const buckets =
      stageView === "commit"
        ? { c: "1", b: "0", p: "0" }
        : stageView === "best_case"
          ? { c: "0", b: "1", p: "0" }
          : stageView === "pipeline"
            ? { c: "0", b: "0", p: "1" }
            : { c: "1", b: "1", p: "1" };
    params.set("bucket_commit", buckets.c);
    params.set("bucket_best_case", buckets.b);
    params.set("bucket_pipeline", buckets.p);

    const qs = params.toString();
    return (qs ? `/dashboard?${qs}` : "/dashboard") + "#gap-driving-deals";
  }, [sp, quotaPeriodId, stageView]);

  const quarterAnalytics = useMemo(() => {
    const repRows = Array.isArray(props.repRollups) ? props.repRollups : [];
    const dir = Array.isArray(props.repDirectory) ? props.repDirectory : [];

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
        const node = dir.find((x) => Number(x.id) === cur) || null;
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
      descendantRepIds,
      statsForRepIds,
    };
  }, [props.repRollups, props.repDirectory, props.myRepId]);

  const productViz = useMemo(() => {
    const rows = Array.isArray(props.productsClosedWon) ? props.productsClosedWon : [];
    const totalWon = rows.reduce((acc, r) => acc + (Number((r as any).won_amount || 0) || 0), 0);
    const totalOrders = rows.reduce((acc, r) => acc + (Number((r as any).won_count || 0) || 0), 0);
    const maxWon = rows.reduce((m, r) => Math.max(m, Number((r as any).won_amount || 0) || 0), 0);
    return { totalWon, totalOrders, maxWon: Math.max(1, maxWon) };
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
            <div className="flex items-center justify-center gap-4">
              <div className="relative h-[44px] w-[240px] shrink-0 sm:h-[52px] sm:w-[280px]">
                <Image src="/brand/salesforecast-logo.svg" alt="SalesForecast.io" fill sizes="280px" className="object-contain" priority={false} />
              </div>
              <div className="text-4xl font-extrabold tracking-tight text-[color:var(--sf-text-primary)] sm:text-5xl">OUTLOOK</div>
            </div>

            <div className="mt-4">
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
                const cls =
                  c.tone === "good"
                    ? "text-[#2ECC71]"
                    : c.tone === "warn"
                      ? "text-[#F1C40F]"
                      : c.tone === "bad"
                        ? "text-[#E74C3C]"
                        : "text-[color:var(--sf-text-secondary)]";
                return <div className={`mt-2 text-sm font-semibold ${cls}`}>{c.label}</div>;
              })()}
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
                This Quarter’s Outlook Driven By:
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

      <div className="w-full">
        <RiskRadarPlot deals={radarDeals} size={680} />
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
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="grid gap-1">
            <label className="text-xs text-[color:var(--sf-text-secondary)]">Sales Rep</label>
            <select
              value={repPublicId}
              onChange={(e) =>
                updateUrl((p) => {
                  const v = String(e.target.value || "").trim();
                  setParam(p, "rep_public_id", v);
                  p.delete("rep_name");
                })
              }
              className="h-[40px] min-w-[220px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              <option value="">All Sales Reps</option>
              {props.reps.map((r) => (
                <option key={r.public_id} value={r.public_id}>
                  {r.name}
                </option>
              ))}
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

          <div className="ml-auto flex items-center gap-2">
            <label className="text-xs text-[color:var(--sf-text-secondary)]">Show</label>
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

        {loading ? <div className="mt-3 text-sm text-[color:var(--sf-text-secondary)]">Loading…</div> : null}
        {err ? <div className="mt-3 text-sm text-[#E74C3C]">{err.error}</div> : null}
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
            <div className="flex flex-wrap items-center justify-between gap-2">
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
                      "h-[34px] rounded-md border px-3 text-sm",
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

            <DealsDrivingGapHeatmap
              rows={heatmapRows}
              viewFullHref={viewFullHref}
              rowHref={() => dataDetailsGapHref}
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

      {props.productsClosedWon.length ? (
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Team revenue by product (Closed Won)</div>
              <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Quick view of what’s closing this quarter.</div>
            </div>
            <div className="flex items-center gap-2 text-xs text-[color:var(--sf-text-secondary)]">
              <span className="rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-1">
                Total: <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(productViz.totalWon)}</span>
              </span>
              <span className="rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-1">
                Orders: <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{productViz.totalOrders}</span>
              </span>
            </div>
          </div>

          <div className="mt-3 overflow-x-auto rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
            <table className="min-w-[860px] w-full table-auto border-collapse text-sm">
              <thead className="bg-[color:var(--sf-surface)] text-xs text-[color:var(--sf-text-secondary)]">
                <tr className="text-left">
                  <th className="border-b border-[color:var(--sf-border)] px-3 py-2">Product</th>
                  <th className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right">Closed Won</th>
                  <th className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right"># Orders</th>
                  <th className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right">Avg / Order</th>
                  <th className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right">Avg Health</th>
                </tr>
              </thead>
              <tbody>
                {props.productsClosedWon.map((p, idx) => {
                  const hp = healthPctFrom30(p.avg_health_score);
                  const barPct = Math.round(((Number(p.won_amount || 0) || 0) / productViz.maxWon) * 100);
                  const badge =
                    hp == null
                      ? "border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] text-[color:var(--sf-text-secondary)]"
                      : hp >= 80
                        ? "border-[#2ECC71]/40 bg-[#2ECC71]/10 text-[#2ECC71]"
                        : hp >= 50
                          ? "border-[#F1C40F]/50 bg-[#F1C40F]/10 text-[#F1C40F]"
                          : "border-[#E74C3C]/50 bg-[#E74C3C]/10 text-[#E74C3C]";

                  return (
                    <tr
                      key={p.product}
                      className={[
                        "text-[color:var(--sf-text-primary)]",
                        idx % 2 === 0 ? "bg-transparent" : "bg-[color:var(--sf-surface)]/20",
                        "hover:bg-[color:var(--sf-surface)]/35",
                      ].join(" ")}
                    >
                      <td className="border-b border-[color:var(--sf-border)] px-3 py-2 font-semibold">{p.product}</td>
                      <td className="border-b border-[color:var(--sf-border)] px-3 py-2">
                        <div className="relative flex items-center justify-end">
                          <div
                            className="absolute left-0 top-1/2 h-[10px] -translate-y-1/2 rounded-full bg-[color:var(--sf-accent-primary)]/20"
                            style={{ width: `${Math.max(6, barPct)}%` }}
                            aria-hidden="true"
                          />
                          <span className="relative font-mono text-xs font-semibold">{fmtMoney(p.won_amount)}</span>
                        </div>
                      </td>
                      <td className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right">{Number(p.won_count || 0) || 0}</td>
                      <td className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right font-mono text-xs">{fmtMoney(p.avg_order_value)}</td>
                      <td className="border-b border-[color:var(--sf-border)] px-3 py-2 text-right">
                        <span className={["inline-flex min-w-[52px] justify-center rounded-full border px-2 py-0.5 font-mono text-xs", badge].join(" ")}>
                          {hp == null ? "—" : `${hp}%`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
    </div>
  );
}

