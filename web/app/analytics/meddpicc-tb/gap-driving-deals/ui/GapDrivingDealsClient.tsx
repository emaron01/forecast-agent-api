"use client";

import Link from "next/link";
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
      rep_context: null | {
        rep_public_id: string;
        rep_name: string | null;
        commit: { deals: number; avg_health_pct: number | null };
        best_case: { deals: number; avg_health_pct: number | null };
        pipeline: { deals: number; avg_health_pct: number | null };
        last_quarter_accuracy_pct: number | null;
      };
      groups: {
        commit: { label: string; deals: DealOut[]; totals: { crm_weighted: number; ai_weighted: number; gap: number } };
        best_case: { label: string; deals: DealOut[]; totals: { crm_weighted: number; ai_weighted: number; gap: number } };
        pipeline: { label: string; deals: DealOut[]; totals: { crm_weighted: number; ai_weighted: number; gap: number } };
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

export function GapDrivingDealsClient(props: {
  basePath: string;
  periods: PeriodLite[];
  reps: RepOption[];
  initialQuotaPeriodId: string;
}) {
  const periods = props.periods || [];
  const reps = props.reps || [];

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, string>>({});

  const currentSearch = typeof window !== "undefined" ? window.location.search : "";
  const qs = useMemo(() => {
    const sp = new URLSearchParams(currentSearch || "");
    if (!sp.get("quota_period_id") && props.initialQuotaPeriodId) sp.set("quota_period_id", props.initialQuotaPeriodId);
    return sp;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSearch, props.initialQuotaPeriodId]);

  const apiUrl = useMemo(() => {
    const sp = new URLSearchParams(qs);
    const str = sp.toString();
    return str ? `/api/forecast/gap-driving-deals?${str}` : `/api/forecast/gap-driving-deals`;
  }, [qs]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    fetch(apiUrl, { method: "GET" })
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
  }, [apiUrl]);

  const stage = String(qs.get("stage") || "");
  const repPublicId = String(qs.get("rep_public_id") || "");
  const riskCategory = String(qs.get("risk_category") || "");
  const suppressedOnly = String(qs.get("suppressed_only") || "") === "1";
  const healthPreset = healthPresetFromParams(qs);

  const setParamAndGo = (mutate: (sp: URLSearchParams) => void) => {
    const sp = new URLSearchParams(qs);
    mutate(sp);
    window.location.href = buildHref(props.basePath, sp);
  };

  const headerTotals =
    data && (data as any).ok === true
      ? (data as any).totals
      : { crm_outlook_weighted: 0, ai_outlook_weighted: 0, gap: 0 };

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
          </div>
          <div className="flex flex-wrap items-center gap-2">
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

            <select
              value={repPublicId}
              onChange={(e) =>
                setParamAndGo((sp) => {
                  const next = String(e.target.value || "").trim();
                  if (next) sp.set("rep_public_id", next);
                  else sp.delete("rep_public_id");
                })
              }
              className="h-[36px] max-w-[280px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              <option value="">All reps</option>
              {reps.map((r) => (
                <option key={r.public_id} value={r.public_id}>
                  {r.name}
                </option>
              ))}
            </select>

            <select
              value={stage}
              onChange={(e) =>
                setParamAndGo((sp) => {
                  const next = String(e.target.value || "").trim();
                  if (next) sp.set("stage", next);
                  else sp.delete("stage");
                })
              }
              className="h-[36px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              <option value="">All stages</option>
              <option value="Commit">Commit</option>
              <option value="Best Case">Best Case</option>
              <option value="Pipeline">Pipeline</option>
            </select>

            <select
              value={healthPreset}
              onChange={(e) =>
                setParamAndGo((sp) => {
                  const next = String(e.target.value || "") as HealthPreset;
                  sp.delete("health_min_pct");
                  sp.delete("health_max_pct");
                  if (next === "green") {
                    sp.set("health_min_pct", "80");
                    sp.set("health_max_pct", "100");
                  } else if (next === "yellow") {
                    sp.set("health_min_pct", "50");
                    sp.set("health_max_pct", "79");
                  } else if (next === "red") {
                    sp.set("health_min_pct", "0");
                    sp.set("health_max_pct", "49");
                  }
                })
              }
              className="h-[36px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              <option value="all">All health</option>
              <option value="green">Green (80–100%)</option>
              <option value="yellow">Yellow (50–79%)</option>
              <option value="red">Red (0–49%)</option>
            </select>

            <select
              value={riskCategory}
              onChange={(e) =>
                setParamAndGo((sp) => {
                  const next = String(e.target.value || "").trim();
                  if (next) sp.set("risk_category", next);
                  else sp.delete("risk_category");
                })
              }
              className="h-[36px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              <option value="">All risks</option>
              <option value="economic_buyer">Economic Buyer</option>
              <option value="paper">Paper Process</option>
              <option value="champion">Internal Sponsor</option>
              <option value="process">Decision Process</option>
              <option value="timing">Timing</option>
              <option value="criteria">Criteria</option>
              <option value="competition">Competition</option>
              <option value="budget">Budget</option>
              <option value="pain">Pain</option>
              <option value="metrics">Metrics</option>
              <option value="suppressed">Suppressed</option>
            </select>

            <label className="inline-flex items-center gap-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]">
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
              Suppressed only
            </label>

            <button
              onClick={() => {
                window.location.href = buildHref(props.basePath, new URLSearchParams({ quota_period_id: String(qs.get("quota_period_id") || props.initialQuotaPeriodId || "") }));
              }}
              className="h-[36px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 text-sm hover:bg-[color:var(--sf-surface-alt)]"
            >
              Clear
            </button>
          </div>
        </div>

        {asOk(data)?.rep_context ? (
          <div className="mt-4 overflow-auto rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
            <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Rep Summary</div>
            <div className="mt-2 grid gap-2 text-sm text-[color:var(--sf-text-primary)] md:grid-cols-4">
              <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                <div className="text-xs text-[color:var(--sf-text-secondary)]">Rep</div>
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
          {(["commit", "best_case", "pipeline"] as const).map((k) => {
            const g = asOk(data)!.groups[k];
            const totals = g.totals;
            const deals = g.deals || [];
            return (
              <section key={k} className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-[color:var(--sf-text-primary)]">{g.label}</div>
                    <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                      CRM {fmtMoney(totals.crm_weighted)} · AI {fmtMoney(totals.ai_weighted)} ·{" "}
                      <span className={deltaClass(totals.gap)}>Gap {fmtMoney(totals.gap)}</span> · {deals.length} deal(s)
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
                      return (
                        <div key={d.id} className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-base font-semibold text-[color:var(--sf-text-primary)]">{title}</div>
                              <div className="mt-1 text-base text-[color:var(--sf-text-secondary)]">
                                Close {d.close_date || "—"} · Stage {d.crm_stage.label}
                                {d.health.suppression ? " · Suppressed" : ""}
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
                              <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                                Health{" "}
                                <span className={`font-semibold ${healthPctClass(d.health.health_pct)}`}>
                                  {d.health.health_pct == null ? "—" : `${d.health.health_pct}%`}
                                </span>
                              </div>
                            </div>
                            <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                              <div className="text-xs text-[color:var(--sf-text-secondary)]">CRM weighted</div>
                              <div className="mt-0.5 font-mono text-sm font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(d.weighted.crm_weighted)}</div>
                              <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Stage prob {(d.weighted.stage_probability * 100).toFixed(1)}%</div>
                            </div>
                            <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                              <div className="text-xs text-[color:var(--sf-text-secondary)]">AI weighted</div>
                              <div className="mt-0.5 font-mono text-sm font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(d.weighted.ai_weighted)}</div>
                              <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Modifier × {Number(d.health.health_modifier || 1).toFixed(2)}</div>
                            </div>
                            <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                              <div className="text-xs text-[color:var(--sf-text-secondary)]">Gap</div>
                              <div className={`mt-0.5 font-mono text-sm font-semibold ${deltaClass(d.weighted.gap)}`}>{fmtMoney(d.weighted.gap)}</div>
                              <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">AI − CRM</div>
                            </div>
                          </div>

                          <div className="mt-4 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">MEDDPICC+TB</div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {d.meddpicc_tb.map((c) => {
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

