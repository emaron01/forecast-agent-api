"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ExecRepOption } from "../../../lib/executiveForecastDashboard";
import { DealsDrivingGapHeatmap, type HeatmapDealRow } from "./DealsDrivingGapHeatmap";
import { MeddpiccRiskDistribution, type RiskDistributionRow } from "./MeddpiccRiskDistribution";
import { RiskRadar, type RiskDriverItem } from "./RiskRadar";
import { KpiCardsRow } from "./KpiCardsRow";
import { ForecastDeltaCard } from "./ForecastDeltaCard";

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
  risk_flags: Array<{ key: RiskCategoryKey; label: string }>;
};

type ApiOk = {
  ok: true;
  totals: { crm_outlook_weighted: number; ai_outlook_weighted: number; gap: number };
  shown_totals?: { crm_outlook_weighted: number; ai_outlook_weighted: number; gap: number };
  groups: {
    commit: { deals: DealOut[] };
    best_case: { deals: DealOut[] };
    pipeline: { deals: DealOut[] };
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

function toneForCount(count: number, totalDeals: number): RiskDriverItem["tone"] {
  if (!totalDeals) return "muted";
  const frac = count / totalDeals;
  if (frac >= 0.4) return "bad";
  if (frac >= 0.2) return "warn";
  if (frac > 0) return "good";
  return "muted";
}

function dealTitle(d: DealOut) {
  const a = String(d.deal_name?.account_name || "").trim();
  const o = String(d.deal_name?.opportunity_name || "").trim();
  const t = [a, o].filter(Boolean).join(" — ");
  return t || "(Untitled deal)";
}

function dealRep(d: DealOut) {
  return String(d.rep?.rep_name || "").trim() || "—";
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

export function ExecutiveGapInsightsClient(props: {
  basePath: string;
  quotaPeriodId: string;
  reps: ExecRepOption[];
  quota: number;
  aiForecast: number;
  crmForecast: number;
  gap: number;
  bucketDeltas: { commit: number; best_case: number; pipeline: number };
  defaultTopN?: number;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [topN, setTopN] = useState(Math.max(1, props.defaultTopN || 5));

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

  const flattenedDeals = useMemo(() => {
    const d = ok;
    if (!d) return [] as DealOut[];
    return [...(d.groups.commit.deals || []), ...(d.groups.best_case.deals || []), ...(d.groups.pipeline.deals || [])];
  }, [ok]);

  const sortedDeals = useMemo(() => {
    const overallGap = ok?.totals?.gap ?? 0;
    const dir = overallGap < 0 ? -1 : overallGap > 0 ? 1 : -1;
    return flattenedDeals.slice().sort((a, b) => (dir < 0 ? a.weighted.gap - b.weighted.gap : b.weighted.gap - a.weighted.gap));
  }, [flattenedDeals, ok]);

  const heatmapRows: HeatmapDealRow[] = useMemo(() => {
    return sortedDeals.slice(0, topN).map((d) => {
      const tone = riskToneForDeal(d);
      return {
        id: String(d.id),
        riskTone: tone,
        riskLabel: riskLabelForTone(tone),
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

  const radarItems: RiskDriverItem[] = useMemo(() => {
    const totalDeals = flattenedDeals.length;
    const items: RiskDriverItem[] = [];

    // Synthetic executive-friendly signal: commit deals with negative gap.
    const commitSoft = flattenedDeals.filter((d) => d.crm_stage?.bucket === "commit" && Number(d.weighted?.gap || 0) < 0).length;
    if (commitSoft > 0) {
      items.push({
        key: "commit_softening",
        label: "Commit Deals Softening",
        count: commitSoft,
        tone: toneForCount(commitSoft, totalDeals),
      });
    }

    const keys: RiskCategoryKey[] = [
      "economic_buyer",
      "paper",
      "process",
      "champion",
      "criteria",
      "competition",
      "budget",
      "timing",
      "pain",
      "metrics",
      "suppressed",
    ];
    for (const k of keys) {
      const c = dealRiskCounts.get(k) || 0;
      if (!c) continue;
      items.push({
        key: k,
        label: riskLabelForKey(k),
        count: c,
        tone: toneForCount(c, totalDeals),
      });
    }

    // Keep it tight.
    items.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return items.slice(0, 4);
  }, [dealRiskCounts, flattenedDeals]);

  const distributionRows: RiskDistributionRow[] = useMemo(() => {
    const out: RiskDistributionRow[] = [];
    for (const [k, c] of dealRiskCounts.entries()) {
      const key = String(k) as RiskCategoryKey;
      // Skip suppression in the distribution unless it's dominating (it can drown signal).
      if (key === "suppressed" && c < 2) continue;
      out.push({ key, label: riskLabelForKey(key), count: c });
    }
    out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return out.slice(0, 8);
  }, [dealRiskCounts]);

  const dealsAtRisk = useMemo(() => {
    return flattenedDeals.filter((d) => Number(d.weighted?.gap || 0) < 0).length;
  }, [flattenedDeals]);

  const viewFullHref = useMemo(() => {
    const params = new URLSearchParams(sp.toString());
    // Ensure we can deep-link the same filters into the existing report.
    setParam(params, "quota_period_id", quotaPeriodId);
    const qs = params.toString();
    return qs ? `/analytics/meddpicc-tb/gap-driving-deals?${qs}` : "/analytics/meddpicc-tb/gap-driving-deals";
  }, [sp, quotaPeriodId]);

  function updateUrl(mut: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(sp.toString());
    mut(params);
    router.replace(`${props.basePath}?${params.toString()}`);
  }

  return (
    <div className="grid gap-4">
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
              onChange={(e) => setTopN(Math.max(1, Number(e.target.value) || 5))}
              className="h-[40px] w-[92px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              {[5, 10, 15].map((n) => (
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

      <KpiCardsRow quota={props.quota} aiForecast={props.aiForecast} crmForecast={props.crmForecast} gap={props.gap} dealsAtRisk={dealsAtRisk} />

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <RiskRadar items={radarItems} subtitle={`Based on ${flattenedDeals.length} deal(s) in the current view.`} />
        </div>
        <div className="lg:col-span-5">
          <ForecastDeltaCard crmOutlook={props.crmForecast} aiOutlook={props.aiForecast} gap={props.gap} bucketDeltas={props.bucketDeltas} />
        </div>
      </div>

      <DealsDrivingGapHeatmap rows={heatmapRows} viewFullHref={viewFullHref} />

      <MeddpiccRiskDistribution rows={distributionRows} />
    </div>
  );
}

