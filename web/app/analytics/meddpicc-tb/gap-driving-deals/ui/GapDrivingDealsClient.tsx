"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MEDDPICC_CANONICAL } from "../../../../../lib/meddpiccCanonical";

type PeriodLite = {
  id: string;
  fiscal_year: string;
  fiscal_quarter: string;
  period_name: string;
  period_start: string;
  period_end: string;
};

type RepOption = { public_id: string; name: string };

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
  rep: { rep_id: string | null; rep_public_id: string | null; rep_name: string | null };
  deal_name: { account_name: string | null; opportunity_name: string | null };
  close_date: string | null;
  crm_stage: { forecast_stage: string | null; bucket: "commit" | "best_case" | "pipeline" | null; label: string };
  ai_verdict_stage: "Commit" | "Best Case" | "Pipeline" | null;
  amount: number;
  health: {
    health_score: number | null;
    health_pct: number | null;
    suppression: boolean;
    probability_modifier: number;
    health_modifier: number;
  };
  weighted: {
    stage_probability: number;
    crm_weighted: number;
    ai_weighted: number;
    gap: number;
  };
  meddpicc_tb: Array<{
    key:
      | "pain"
      | "metrics"
      | "champion"
      | "criteria"
      | "competition"
      | "timing"
      | "budget"
      | "economic_buyer"
      | "process"
      | "paper";
    score: number | null;
    score_label: string;
    tip: string | null;
    evidence: string | null;
  }>;
  signals: {
    risk_summary: string | null;
    next_steps: string | null;
  };
  risk_flags: Array<{ key: RiskCategoryKey; label: string; tip: string | null }>;
  coaching_insights: string[];
};

type ApiResponse =
  | { ok: false; error: string }
  | {
      ok: true;
      quota_period: PeriodLite | null;
      filters: Record<string, any>;
      totals: { crm_outlook_weighted: number; ai_outlook_weighted: number; gap: number };
      shown_totals?: { crm_outlook_weighted: number; ai_outlook_weighted: number; gap: number };
      debug?: any;
      rep_context: null | {
        rep_public_id: string;
        rep_name: string | null;
        commit: { deals: number; avg_health_pct: number | null };
        best_case: { deals: number; avg_health_pct: number | null };
        pipeline: { deals: number; avg_health_pct: number | null };
        last_quarter_accuracy_pct: number | null;
      };
      groups: {
        commit: { label: string; deals: DealOut[]; totals: { crm_weighted: number; ai_weighted: number; gap: number }; shown_totals?: { crm_weighted: number; ai_weighted: number; gap: number } };
        best_case: { label: string; deals: DealOut[]; totals: { crm_weighted: number; ai_weighted: number; gap: number }; shown_totals?: { crm_weighted: number; ai_weighted: number; gap: number } };
        pipeline: { label: string; deals: DealOut[]; totals: { crm_weighted: number; ai_weighted: number; gap: number }; shown_totals?: { crm_weighted: number; ai_weighted: number; gap: number } };
      };
    };

function asError(r: ApiResponse | null): { ok: false; error: string } | null {
  return r && (r as any).ok === false ? (r as any) : null;
}

function asOk(r: ApiResponse | null): Extract<ApiResponse, { ok: true }> | null {
  return r && (r as any).ok === true ? (r as any) : null;
}

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

function deltaClass(n: number) {
  if (!Number.isFinite(n) || n === 0) return "text-[color:var(--sf-text-secondary)]";
  return n > 0 ? "text-[#2ECC71]" : "text-[#E74C3C]";
}

function fmtDateMmddyyyy(raw: string | null | undefined) {
  const s = String(raw || "").trim();
  if (!s) return "—";
  // ISO date or timestamp starting with YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, yyyy, mm, dd] = iso;
    return `${mm}-${dd}-${yyyy}`;
  }
  // US-style M/D/YYYY or MM/DD/YYYY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const mm = String(us[1]).padStart(2, "0");
    const dd = String(us[2]).padStart(2, "0");
    const yyyy = us[3];
    return `${mm}-${dd}-${yyyy}`;
  }
  // Fall back: try Date parse, but keep deterministic output.
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${mm}-${dd}-${yyyy}`;
}

function scoreBadgeClass(score: number | null) {
  const s = Number(score == null ? 0 : score);
  // Spec:
  // - Red: 0-1
  // - Yellow: 2
  // - Green: 3
  if (s >= 3) return "border-[#2ECC71]/50 bg-[#2ECC71]/10 text-[#2ECC71]";
  if (s >= 2) return "border-[#F1C40F]/60 bg-[#F1C40F]/10 text-[#F1C40F]";
  return "border-[#E74C3C]/60 bg-[#E74C3C]/10 text-[#E74C3C]";
}

function healthPctClass(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-secondary)]";
  const n = Number(pct);
  if (!Number.isFinite(n)) return "text-[color:var(--sf-text-secondary)]";
  if (n >= 80) return "text-[#2ECC71]";
  if (n >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

function canonicalTitle(key: string) {
  const row = (MEDDPICC_CANONICAL as any)?.[key] || null;
  return String(row?.titleLine || key).trim() || key;
}

function canonicalMeaning(key: string) {
  const row = (MEDDPICC_CANONICAL as any)?.[key] || null;
  return String(row?.meaningLine || "").trim();
}

function chipLabel(key: string) {
  const k = String(key || "").trim();
  if (k === "economic_buyer") return "Economic Buyer";
  if (k === "paper") return "Paper Process";
  if (k === "process") return "Decision Process";
  if (k === "champion") return "Champion";
  if (k === "criteria") return "Decision Criteria";
  if (k === "competition") return "Competition";
  if (k === "timing") return "Timeline";
  if (k === "budget") return "Budget";
  if (k === "metrics") return "Metrics";
  if (k === "pain") return "Pain";
  return canonicalTitle(k);
}

function isGreenScore(score: number | null) {
  const s = Number(score == null ? 0 : score);
  return Number.isFinite(s) && s >= 3;
}

function equalsName(a: any, b: any) {
  const x = String(a || "").trim().toLowerCase();
  const y = String(b || "").trim().toLowerCase();
  return !!x && !!y && x === y;
}

function stageOrder(s: string | null | undefined) {
  const v = String(s || "").trim().toLowerCase();
  if (v === "commit") return 2;
  if (v === "best case" || v === "best_case" || v === "best") return 1;
  if (v === "pipeline") return 0;
  return null;
}

function stageDeltaClass(crm: string, ai: string) {
  const crmO = stageOrder(crm);
  const aiO = stageOrder(ai);
  if (crmO == null || aiO == null) return "text-[color:var(--sf-text-primary)]";
  if (aiO < crmO) return "text-[#E74C3C]"; // downgraded
  if (aiO > crmO) return "text-[#2ECC71]"; // upgraded
  return "text-[color:var(--sf-text-primary)]"; // matched
}

function buildHref(basePath: string, params: URLSearchParams) {
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

type HealthPreset = "all" | "green" | "yellow" | "red";

function healthPresetFromParams(sp: URLSearchParams): HealthPreset {
  const min = sp.get("health_min_pct");
  const max = sp.get("health_max_pct");
  if (!min && !max) return "all";
  if (min === "80" && max === "100") return "green";
  if (min === "50" && max === "79") return "yellow";
  if (min === "0" && max === "49") return "red";
  return "all";
}

function boolParam(sp: URLSearchParams, key: string): boolean | null {
  const raw = sp.get(key);
  if (raw == null) return null;
  const s = String(raw || "").trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return null;
}

export function GapDrivingDealsClient(props: {
  basePath: string;
  periods: PeriodLite[];
  reps: RepOption[];
  initialQuotaPeriodId: string;
  hideQuotaPeriodSelect?: boolean;
  defaultRepName?: string | null;
}) {
  const periods = props.periods || [];
  const reps = props.reps || [];

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, string>>({});
  const [refreshNonce, setRefreshNonce] = useState(0);

  const sp = useSearchParams();
  const router = useRouter();
  const spKey = sp?.toString() || "";
  const qs = useMemo(() => {
    const next = new URLSearchParams(spKey || "");
    if (!next.get("quota_period_id") && props.initialQuotaPeriodId) next.set("quota_period_id", props.initialQuotaPeriodId);
    const hasRepFilter = !!String(next.get("rep_public_id") || "").trim() || !!String(next.get("rep_name") || "").trim();
    const defaultRepName = String(props.defaultRepName || "").trim();
    if (!hasRepFilter && defaultRepName) {
      const match = reps.find((r) => equalsName(r?.name, defaultRepName)) || null;
      if (match?.public_id) next.set("rep_public_id", String(match.public_id));
      else next.set("rep_name", defaultRepName);
    }
    // Guard: stale `health_min_pct=0&health_max_pct=0` can break results; treat as "no health filter".
    if (next.get("health_min_pct") === "0" && next.get("health_max_pct") === "0") {
      next.delete("health_min_pct");
      next.delete("health_max_pct");
    }
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spKey, props.initialQuotaPeriodId, props.defaultRepName]);

  const apiUrl = useMemo(() => {
    const sp = new URLSearchParams(qs);
    const str = sp.toString();
    return str ? `/api/forecast/gap-driving-deals?${str}` : `/api/forecast/gap-driving-deals`;
  }, [qs]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    const url = `${apiUrl}${apiUrl.includes("?") ? "&" : "?"}_r=${refreshNonce}`;
    fetch(url, { method: "GET" })
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

  const repPublicId = String(qs.get("rep_public_id") || "");
  const repName = String(qs.get("rep_name") || "");
  const riskCategory = String(qs.get("risk_category") || "");
  const suppressedOnly = String(qs.get("suppressed_only") || "") === "1";
  const healthPreset = healthPresetFromParams(qs);

  const mode = (String(qs.get("mode") || "").trim() === "risk" ? "risk" : "drivers") as "drivers" | "risk";

  const driverMode = String(qs.get("driver_mode") || "") !== "0";
  const driverMinAbsGap = Number(qs.get("driver_min_abs_gap") || 0) || 0;
  const driverRequireScoreEffect = String(qs.get("driver_require_score_effect") || "") !== "0";

  const riskMinDownside = Number(qs.get("risk_min_downside") || 0) || 0;
  const riskRequireScoreEffect = String(qs.get("risk_require_score_effect") || "") !== "0";

  const bucketAnyParam = qs.has("bucket_commit") || qs.has("bucket_best_case") || qs.has("bucket_pipeline");
  const bucketCommit = bucketAnyParam ? boolParam(qs, "bucket_commit") !== false : true;
  const bucketBestCase = bucketAnyParam ? boolParam(qs, "bucket_best_case") !== false : true;
  const bucketPipeline = bucketAnyParam ? boolParam(qs, "bucket_pipeline") === true : false;

  const repSelectValue = repPublicId || (repName ? `__rep_name__:${repName}` : "");

  const setParamAndGo = (mutate: (sp: URLSearchParams) => void) => {
    const sp = new URLSearchParams(qs);
    mutate(sp);
    router.replace(buildHref(props.basePath, sp));
  };

  const resetToGapDriversDefaults = () => {
    const sp = new URLSearchParams(qs);

    // Always keep quarter selection.
    const qp = String(sp.get("quota_period_id") || props.initialQuotaPeriodId || "").trim();
    sp.forEach((_v, k) => {
      // no-op (can't mutate during forEach reliably)
    });

    // Clear report filters.
    [
      "fiscal_year",
      "rep_public_id",
      "repPublicId",
      "rep_name",
      "stage",
      "health_min_pct",
      "health_max_pct",
      "risk_category",
      "riskType",
      "suppressed_only",
      "suppressedOnly",
      "bucket_commit",
      "bucket_best_case",
      "bucket_pipeline",
      "mode",
      "driver_mode",
      "driver_take_per_bucket",
      "driver_min_abs_gap",
      "driver_require_score_effect",
      "risk_take_per_bucket",
      "risk_min_downside",
      "risk_require_score_effect",
    ].forEach((k) => sp.delete(k));

    if (qp) sp.set("quota_period_id", qp);

    // Gap Drivers defaults.
    sp.set("bucket_commit", "1");
    sp.set("bucket_best_case", "1");
    sp.set("bucket_pipeline", "0");

    sp.set("mode", "drivers");
    sp.set("driver_mode", "1");
    sp.set("driver_take_per_bucket", "50");
    sp.set("driver_min_abs_gap", "0");
    sp.set("driver_require_score_effect", "1");

    router.replace(buildHref(props.basePath, sp));
  };

  const resetToAllAtRiskDefaults = () => {
    const sp = new URLSearchParams(qs);

    // Always keep quarter selection.
    const qp = String(sp.get("quota_period_id") || props.initialQuotaPeriodId || "").trim();
    sp.forEach((_v, k) => {
      // no-op (can't mutate during forEach reliably)
    });

    [
      "fiscal_year",
      "rep_public_id",
      "repPublicId",
      "rep_name",
      "stage",
      "health_min_pct",
      "health_max_pct",
      "risk_category",
      "riskType",
      "suppressed_only",
      "suppressedOnly",
      "bucket_commit",
      "bucket_best_case",
      "bucket_pipeline",
      "mode",
      "driver_mode",
      "driver_take_per_bucket",
      "driver_min_abs_gap",
      "driver_require_score_effect",
      "risk_take_per_bucket",
      "risk_min_downside",
      "risk_require_score_effect",
    ].forEach((k) => sp.delete(k));

    if (qp) sp.set("quota_period_id", qp);

    // All At Risk defaults (Commit + Best Case).
    sp.set("bucket_commit", "1");
    sp.set("bucket_best_case", "1");
    sp.set("bucket_pipeline", "0");

    sp.set("mode", "risk");
    sp.set("risk_take_per_bucket", "2000");
    sp.set("risk_min_downside", "0");
    sp.set("risk_require_score_effect", "1");

    router.replace(buildHref(props.basePath, sp));
  };

  const headerTotals =
    data && (data as any).ok === true
      ? (data as any).totals
      : { crm_outlook_weighted: 0, ai_outlook_weighted: 0, gap: 0 };
  const headerShownTotals =
    data && (data as any).ok === true && (data as any).shown_totals
      ? (data as any).shown_totals
      : null;

  const riskOptions: Array<{ key: string; label: string }> = [
    { key: "economic_buyer", label: "Economic Buyer" },
    { key: "paper", label: "Paper Process" },
    { key: "champion", label: "Internal Sponsor" },
    { key: "process", label: "Decision Process" },
    { key: "timing", label: "Timing" },
    { key: "criteria", label: "Criteria" },
    { key: "competition", label: "Competition" },
    { key: "budget", label: "Budget" },
    { key: "pain", label: "Pain" },
    { key: "metrics", label: "Metrics" },
    { key: "suppressed", label: "Suppressed Best Case (low score)" },
  ];

  return (
    <div className="mt-4 grid gap-4">
      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-[color:var(--sf-text-primary)]">Deals Driving the Gap</div>
            <div className="mt-1 text-base font-semibold text-[color:var(--sf-text-primary)]">
              CRM Outlook {fmtMoney(headerTotals.crm_outlook_weighted)} · AI Outlook {fmtMoney(headerTotals.ai_outlook_weighted)} ·{" "}
              <span className={deltaClass(headerTotals.gap)}>Gap {fmtMoney(headerTotals.gap)}</span>
            </div>
            <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
              {mode === "drivers"
                ? "Gap Drivers: top score-driven deals explaining the AI vs CRM delta."
                : "All At Risk: every deal where AI outlook is lower than CRM (sorted by downside)."}
            </div>
            {headerShownTotals ? (
              <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                Showing {fmtMoney(headerShownTotals.gap)} of {fmtMoney(headerTotals.gap)} gap from displayed deals.
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!props.hideQuotaPeriodSelect ? (
              <select
                value={String(qs.get("quota_period_id") || props.initialQuotaPeriodId || "")}
                onChange={(e) =>
                  setParamAndGo((sp) => {
                    const next = String(e.target.value || "");
                    if (next) sp.set("quota_period_id", next);
                    else sp.delete("quota_period_id");
                  })
                }
                className="h-[36px] max-w-[520px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                {periods.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {(String(p.period_name || "").trim() || `${p.period_start} → ${p.period_end}`) + ` (FY${p.fiscal_year} Q${p.fiscal_quarter})`}
                  </option>
                ))}
              </select>
            ) : null}

            <button
              onClick={resetToGapDriversDefaults}
              className="h-[36px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 text-sm font-medium hover:bg-[color:var(--sf-surface-alt)]"
            >
              Gap Drivers
            </button>

            <button
              onClick={resetToAllAtRiskDefaults}
              className="h-[36px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 text-sm font-medium hover:bg-[color:var(--sf-surface-alt)]"
            >
              All At Risk
            </button>

            <button
              onClick={() => setRefreshNonce((n) => n + 1)}
              className="h-[36px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 text-sm hover:bg-[color:var(--sf-surface-alt)]"
            >
              Refresh data
            </button>

            <button
              onClick={() =>
                setParamAndGo((sp) => {
                  const on = String(sp.get("debug") || "").trim() === "1";
                  if (on) sp.delete("debug");
                  else sp.set("debug", "1");
                })
              }
              className="h-[36px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 text-sm hover:bg-[color:var(--sf-surface-alt)]"
            >
              Debug
            </button>
          </div>
        </div>

        {asOk(data)?.debug ? (
          <details className="mt-3 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
            <summary className="cursor-pointer text-sm font-semibold text-[color:var(--sf-text-primary)]">Debug output</summary>
            <pre className="mt-2 max-h-[360px] overflow-auto rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-2 text-[11px] text-[color:var(--sf-text-secondary)]">
              {JSON.stringify(asOk(data)?.debug ?? null, null, 2)}
            </pre>
          </details>
        ) : null}

        <div className="mt-3 grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Forecast Stage</span>
            <label className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]">
              <input
                type="checkbox"
                checked={bucketCommit}
                onChange={(e) =>
                  setParamAndGo((sp) => {
                    sp.set("bucket_commit", e.target.checked ? "1" : "0");
                  })
                }
              />
              Commit
            </label>
            <label className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]">
              <input
                type="checkbox"
                checked={bucketBestCase}
                onChange={(e) =>
                  setParamAndGo((sp) => {
                    sp.set("bucket_best_case", e.target.checked ? "1" : "0");
                  })
                }
              />
              Best Case
            </label>
            <label className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]">
              <input
                type="checkbox"
                checked={bucketPipeline}
                onChange={(e) =>
                  setParamAndGo((sp) => {
                    sp.set("bucket_pipeline", e.target.checked ? "1" : "0");
                  })
                }
              />
              Pipeline
            </label>

            <span className="ml-2 text-xs font-semibold text-[color:var(--sf-text-secondary)]">Sales Rep</span>
            <select
              value={repSelectValue}
              onChange={(e) =>
                setParamAndGo((sp) => {
                  const next = String(e.target.value || "").trim();
                  if (!next) {
                    sp.delete("rep_public_id");
                    sp.delete("repPublicId");
                    sp.delete("rep_name");
                    return;
                  }
                  if (next.startsWith("__rep_name__:")) {
                    // Keep existing rep_name filter; this option is only shown when we already have it.
                    sp.delete("rep_public_id");
                    sp.delete("repPublicId");
                    if (repName) sp.set("rep_name", repName);
                    return;
                  }
                  sp.delete("rep_name");
                  sp.set("rep_public_id", next);
                })
              }
              className="h-[30px] max-w-[320px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]"
            >
              <option value="">All Sales Reps</option>
              {repName && !repPublicId ? <option value={`__rep_name__:${repName}`}>{repName}</option> : null}
              {reps.map((r) => (
                <option key={r.public_id} value={r.public_id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">MEDDPIC+TB Risk Category</span>
            <details className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]">
              <summary className="cursor-pointer select-none">
                Select Categories {riskCategory ? `(${riskOptions.find((x) => x.key === riskCategory)?.label || riskCategory})` : "(All Categories)"}
              </summary>
              <div className="mt-2 flex flex-wrap gap-2 pb-2">
                <label className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]">
                  <input
                    type="checkbox"
                    checked={!riskCategory}
                    onChange={(e) =>
                      setParamAndGo((sp) => {
                        if (e.target.checked) {
                          sp.delete("risk_category");
                          sp.delete("riskType");
                        }
                      })
                    }
                  />
                  All Categories
                </label>
                {riskOptions.map((opt) => (
                  <label
                    key={opt.key}
                    className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]"
                  >
                    <input
                      type="checkbox"
                      checked={riskCategory === opt.key}
                      onChange={(e) =>
                        setParamAndGo((sp) => {
                          if (e.target.checked) sp.set("risk_category", opt.key);
                          else sp.delete("risk_category");
                        })
                      }
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </details>

            <label className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]">
              <input
                type="checkbox"
                checked={suppressedOnly}
                onChange={(e) =>
                  setParamAndGo((sp) => {
                    if (e.target.checked) sp.set("suppressed_only", "1");
                    else sp.delete("suppressed_only");
                  })
                }
              />
              Suppressed Best Case (low score)
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">{mode === "drivers" ? "AI Drivers" : "At-risk filter"}</span>

            {mode === "drivers" ? (
              <>
                <label className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]">
                  <input
                    type="checkbox"
                    checked={driverMode}
                    onChange={(e) =>
                      setParamAndGo((sp) => {
                        sp.set("mode", "drivers");
                        sp.set("driver_mode", e.target.checked ? "1" : "0");
                      })
                    }
                  />
                  AI Top Drivers
                </label>

                <label className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]">
                  <input
                    type="checkbox"
                    checked={driverRequireScoreEffect}
                    onChange={(e) =>
                      setParamAndGo((sp) => {
                        sp.set("mode", "drivers");
                        sp.set("driver_require_score_effect", e.target.checked ? "1" : "0");
                      })
                    }
                  />
                  AI Score Drivers Only
                </label>

                <details className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]">
                  <summary className="cursor-pointer select-none">
                    Set Min Revenue to Ignore {driverMinAbsGap > 0 ? `$${driverMinAbsGap.toLocaleString()}` : "(Any)"}
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2 pb-2">
                    {[0, 1000, 2500, 5000, 10000].map((n) => (
                      <label
                        key={n}
                        className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]"
                      >
                        <input
                          type="checkbox"
                          checked={driverMinAbsGap === n}
                          onChange={(e) =>
                            setParamAndGo((sp) => {
                              sp.set("mode", "drivers");
                              if (!e.target.checked) {
                                sp.delete("driver_min_abs_gap");
                                return;
                              }
                              if (n <= 0) sp.delete("driver_min_abs_gap");
                              else sp.set("driver_min_abs_gap", String(n));
                            })
                          }
                        />
                        {n <= 0 ? "Any" : `$${n.toLocaleString()}`}
                      </label>
                    ))}
                  </div>
                </details>
              </>
            ) : (
              <>
                <label className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]">
                  <input
                    type="checkbox"
                    checked={riskRequireScoreEffect}
                    onChange={(e) =>
                      setParamAndGo((sp) => {
                        sp.set("mode", "risk");
                        sp.set("risk_require_score_effect", e.target.checked ? "1" : "0");
                      })
                    }
                  />
                  AI Score Drivers Only
                </label>

                <details className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]">
                  <summary className="cursor-pointer select-none">
                    Set Min Revenue to Ignore {riskMinDownside > 0 ? `$${riskMinDownside.toLocaleString()}` : "(Any)"}
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2 pb-2">
                    {[0, 1000, 2500, 5000, 10000].map((n) => (
                      <label
                        key={n}
                        className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]"
                      >
                        <input
                          type="checkbox"
                          checked={riskMinDownside === n}
                          onChange={(e) =>
                            setParamAndGo((sp) => {
                              sp.set("mode", "risk");
                              if (!e.target.checked) {
                                sp.delete("risk_min_downside");
                                return;
                              }
                              if (n <= 0) sp.delete("risk_min_downside");
                              else sp.set("risk_min_downside", String(n));
                            })
                          }
                        />
                        {n <= 0 ? "Any" : `$${n.toLocaleString()}`}
                      </label>
                    ))}
                  </div>
                </details>
              </>
            )}

            <details className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]">
              <summary className="cursor-pointer select-none">Health Scores</summary>
              <div className="mt-2 flex flex-wrap gap-2 pb-2">
                {(["all", "green", "yellow", "red"] as const).map((p) => (
                  <label
                    key={p}
                    className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]"
                  >
                    <input
                      type="checkbox"
                      checked={healthPreset === p}
                      onChange={(e) =>
                        setParamAndGo((sp) => {
                          if (!e.target.checked) {
                            sp.delete("health_min_pct");
                            sp.delete("health_max_pct");
                            return;
                          }
                          sp.delete("health_min_pct");
                          sp.delete("health_max_pct");
                          if (p === "green") {
                            sp.set("health_min_pct", "80");
                            sp.set("health_max_pct", "100");
                          } else if (p === "yellow") {
                            sp.set("health_min_pct", "50");
                            sp.set("health_max_pct", "79");
                          } else if (p === "red") {
                            sp.set("health_min_pct", "0");
                            sp.set("health_max_pct", "49");
                          }
                        })
                      }
                    />
                    {p === "all" ? "All" : p === "green" ? "High" : p === "yellow" ? "Medium" : "Low"}
                  </label>
                ))}
              </div>
            </details>
          </div>
        </div>

        {asOk(data)?.rep_context ? (
          <div className="mt-4 overflow-auto rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
            <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Sales Rep Summary</div>
            <div className="mt-2 grid gap-2 text-sm text-[color:var(--sf-text-primary)] md:grid-cols-4">
              <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Sales Rep</div>
                <div className="mt-0.5 font-medium">{asOk(data)?.rep_context?.rep_name || "—"}</div>
              </div>
              <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Commit</div>
                <div className="mt-0.5 font-medium">
                  {asOk(data)?.rep_context?.commit.deals} deals{" "}
                  <span className="text-xs text-[color:var(--sf-text-secondary)]">(avg health {fmtPct(asOk(data)?.rep_context?.commit.avg_health_pct ?? null)})</span>
                </div>
              </div>
              <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Best Case</div>
                <div className="mt-0.5 font-medium">
                  {asOk(data)?.rep_context?.best_case.deals} deals{" "}
                  <span className="text-xs text-[color:var(--sf-text-secondary)]">(avg health {fmtPct(asOk(data)?.rep_context?.best_case.avg_health_pct ?? null)})</span>
                </div>
              </div>
              <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Pipeline</div>
                <div className="mt-0.5 font-medium">
                  {asOk(data)?.rep_context?.pipeline.deals} deals{" "}
                  <span className="text-xs text-[color:var(--sf-text-secondary)]">(avg health {fmtPct(asOk(data)?.rep_context?.pipeline.avg_health_pct ?? null)})</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {loading ? (
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 text-sm text-[color:var(--sf-text-secondary)] shadow-sm">
          Loading…
        </section>
      ) : null}

      {asError(data) ? (
        <section className="rounded-xl border border-[#E74C3C]/40 bg-[#E74C3C]/10 p-4 text-sm text-[#E74C3C] shadow-sm">{asError(data)?.error}</section>
      ) : null}

      {asOk(data) ? (
        <div className="grid gap-4">
          {(["commit", "best_case", "pipeline"] as const)
            .filter((k) => (k === "commit" ? bucketCommit : k === "best_case" ? bucketBestCase : bucketPipeline))
            .map((k) => {
            const g = asOk(data)!.groups[k];
            const totals = g.totals;
            const deals = g.deals || [];
            const shownTotals = (g as any).shown_totals || null;
            return (
              <section key={k} className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-[color:var(--sf-text-primary)]">{g.label}</div>
                    <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                      CRM {fmtMoney(totals.crm_weighted)} · AI {fmtMoney(totals.ai_weighted)} ·{" "}
                      <span className={deltaClass(totals.gap)}>Gap {fmtMoney(totals.gap)}</span> · {deals.length} deal(s)
                      {shownTotals ? (
                        <span>
                          {" "}
                          · showing {fmtMoney(Number(shownTotals.gap || 0) || 0)} gap from displayed
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {!deals.length ? (
                  <div className="mt-4 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 text-sm text-[color:var(--sf-text-secondary)]">
                    No deals found for this bucket + filters.
                  </div>
                ) : (
                  <div className="mt-4 grid gap-3">
                    {deals.map((d) => {
                      const title = [d.deal_name.account_name, d.deal_name.opportunity_name].filter(Boolean).join(" — ") || "(Untitled deal)";
                      const activeKey = String(expanded[d.id] || "").trim();
                      const activeCat = d.meddpicc_tb.find((c) => c.key === (activeKey as any)) || null;
                      const activeTitle = activeCat ? canonicalTitle(activeCat.key) : "";
                      const activeMeaning = activeCat ? canonicalMeaning(activeCat.key) : "";
                      const crmStageLabel = String(d.crm_stage.label || "").trim() || "—";
                      const aiStageLabel = String(d.ai_verdict_stage || "").trim() || "—";
                      const repLabel = String(d.rep?.rep_name || "").trim() || "—";
                      return (
                        <div key={d.id} className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-base font-semibold text-[color:var(--sf-text-primary)]">{title}</div>
                              <div className="mt-1 text-base text-[color:var(--sf-text-secondary)]">
                                Sales Rep {repLabel} · Close {fmtDateMmddyyyy(d.close_date)} · CRM Forecast Stage{" "}
                                <span className="font-semibold text-[color:var(--sf-text-primary)]">{crmStageLabel}</span> · AI Verdict Stage{" "}
                                <span className={["font-semibold", stageDeltaClass(crmStageLabel, aiStageLabel)].join(" ")}>{aiStageLabel}</span>
                                {d.health.suppression ? " · Suppressed Best Case (low score)" : ""}
                              </div>
                              <div className="mt-2">
                                <Link
                                  href={`/opportunities/${encodeURIComponent(d.id)}/deal-review`}
                                  className="inline-flex h-[34px] items-center justify-center rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 text-sm font-medium text-[color:var(--sf-accent-primary)] hover:bg-[color:var(--sf-surface-alt)]"
                                >
                                  View Full Deal
                                </Link>
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 grid gap-3 md:grid-cols-4">
                            <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                              <div className="text-xs text-[color:var(--sf-text-secondary)]">Amount</div>
                              <div className="mt-0.5 font-mono text-sm font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(d.amount)}</div>
                              <div className="mt-2">
                                <div className="text-xs text-[color:var(--sf-text-secondary)]">Health</div>
                                <div className={`mt-0.5 text-lg font-extrabold leading-none ${healthPctClass(d.health.health_pct)}`}>
                                  {d.health.health_pct == null ? "—" : `${d.health.health_pct}%`}
                                </div>
                              </div>
                            </div>
                            <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                              <div className="text-xs text-[color:var(--sf-text-secondary)]">CRM weighted</div>
                              <div className="mt-0.5 font-mono text-sm font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(d.weighted.crm_weighted)}</div>
                            </div>
                            <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                              <div className="text-xs text-[color:var(--sf-text-secondary)]">AI weighted</div>
                              <div className="mt-0.5 font-mono text-sm font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(d.weighted.ai_weighted)}</div>
                            </div>
                            <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                              <div className="text-xs text-[color:var(--sf-text-secondary)]">Gap</div>
                              <div className={`mt-0.5 font-mono text-sm font-semibold ${deltaClass(d.weighted.gap)}`}>{fmtMoney(d.weighted.gap)}</div>
                            </div>
                          </div>

                          <div className="mt-4 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">MEDDPICC+TB Risk Factors</div>
                              <div className="text-xs text-[color:var(--sf-text-secondary)]">Click to view AI assessment</div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {d.meddpicc_tb
                                .filter((c) => !isGreenScore(c.score))
                                .map((c) => {
                                const s = Number(c.score == null ? 0 : c.score);
                                const active = activeKey === c.key;
                                const label = chipLabel(c.key);
                                return (
                                  <button
                                    key={c.key}
                                    type="button"
                                    onClick={() =>
                                      setExpanded((prev) => ({
                                        ...prev,
                                        [d.id]: active ? "" : c.key,
                                      }))
                                    }
                                    className={[
                                      "rounded-full border px-3 py-1 text-xs font-semibold",
                                      scoreBadgeClass(Number.isFinite(s) ? s : 0),
                                      active ? "ring-2 ring-[color:var(--sf-accent-primary)]/30" : "",
                                    ].join(" ")}
                                    title={label}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>

                            {activeCat ? (
                              <div className="mt-3 overflow-hidden rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                                <div className="p-3">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
                                        {activeTitle} {activeMeaning ? <span className="font-normal text-[color:var(--sf-text-secondary)]">— {activeMeaning}</span> : null}
                                      </div>
                                      <div className="mt-1 text-sm font-semibold text-[color:var(--sf-accent-primary)]">
                                        {activeCat.score_label || "—"}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                                    <div className="rounded-md border border-[#F1C40F]/40 bg-[#F1C40F]/10 p-3 text-sm text-[color:var(--sf-text-primary)]">
                                      <div className="text-xs font-semibold text-[#F1C40F]">Tip</div>
                                      <div className="mt-1">{activeCat.tip || "—"}</div>
                                    </div>
                                    <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3 text-sm text-[color:var(--sf-text-primary)]">
                                      <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Evidence</div>
                                      <div className="mt-1">{activeCat.evidence || "—"}</div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : null}

                            <div className="mt-3 grid gap-2 md:grid-cols-2">
                              <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                                <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Risk Summary</div>
                                <div className="mt-1 text-sm text-[color:var(--sf-text-primary)]">{d.signals.risk_summary || "—"}</div>
                              </div>
                              <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                                <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Next Steps</div>
                                <div className="mt-1 text-sm text-[color:var(--sf-text-primary)]">{d.signals.next_steps || "—"}</div>
                              </div>
                            </div>
                          </div>

                          {d.risk_flags.length ? (
                            <div className="mt-3">
                              <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Risks</div>
                              <div className="mt-1 flex flex-wrap gap-2">
                                {d.risk_flags.slice(0, 8).map((rf, idx) => (
                                  <span
                                    key={`${rf.key}:${idx}`}
                                    className="rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-2 py-1 text-xs text-[color:var(--sf-text-primary)]"
                                  >
                                    {rf.label}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {d.coaching_insights.length ? (
                            <div className="mt-3">
                              <div className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">Coaching insights</div>
                              <ul className="mt-1 list-disc pl-5 text-sm text-[color:var(--sf-text-primary)]">
                                {d.coaching_insights.slice(0, 6).map((t, idx) => (
                                  <li key={idx}>{t}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

