"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { closedOutcomeFromStage } from "../../../lib/opportunityOutcome";
import { dateOnly } from "../../../lib/dateOnly";

type Deal = Record<string, any> & {
  id: string;
  rep_name?: string | null;
  account_name?: string | null;
  opportunity_name?: string | null;
  amount?: number | null;
  close_date?: string | null;
  stage?: string | null;
  forecast_stage?: string | null;
  ai_verdict?: string | null;
  ai_forecast?: string | null;
  health_score?: number | null;
  updated_at?: string | null;

  pain_score?: number | null;
  metrics_score?: number | null;
  champion_score?: number | null;
  eb_score?: number | null;
  competition_score?: number | null;
  criteria_score?: number | null;
  process_score?: number | null;
  paper_score?: number | null;
  timing_score?: number | null;
  budget_score?: number | null;
};

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function safeDate(d: any) {
  const s = dateOnly(d);
  return s || "—";
}

function scoreColorClass(s: any) {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return "text-[color:var(--sf-text-disabled)] bg-[color:var(--sf-surface-alt)]";
  // Agent scoring colors — MUST remain hard-coded (consistent with score cards)
  return n >= 3 ? "text-[#2ECC71] bg-[#2ECC71]/10" : n >= 2 ? "text-[#F1C40F] bg-[#F1C40F]/10" : "text-[#E74C3C] bg-[#E74C3C]/10";
}

function scoreLabel(s: any) {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${Math.round(n)}/3`;
}

function isClosedDeal(d: Deal) {
  return closedOutcomeFromStage((d as any)?.forecast_stage) || closedOutcomeFromStage((d as any)?.stage) || null;
}

type SortKey =
  | "account"
  | "amount"
  | "close_date"
  | "forecast_stage"
  | "ai_stage"
  | "pain"
  | "metrics"
  | "champion"
  | "eb"
  | "competition"
  | "criteria"
  | "process"
  | "paper"
  | "timing"
  | "budget";

export function MeddpiccHeatmapClient(props: {
  defaultRepName?: string;
  repFilterLocked?: boolean;
  quotaPeriods?: Array<{ id: string; label: string }>;
  defaultQuotaPeriodId?: string;
}) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [repFilter, setRepFilter] = useState(props.defaultRepName || "");
  const [quotaPeriodId, setQuotaPeriodId] = useState<string>(props.defaultQuotaPeriodId || "");
  const [includeClosed, setIncludeClosed] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (!props.repFilterLocked && repFilter.trim()) params.set("rep_name", repFilter.trim());
      if (quotaPeriodId) params.set("quota_period_id", quotaPeriodId);
      params.set("limit", "500");
      const res = await fetch(`/api/forecast/deals?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `API error (${res.status})`);
      const list = Array.isArray(json.deals) ? (json.deals as Deal[]) : [];
      setDeals(list);
    } catch (e: any) {
      setDeals([]);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!props.repFilterLocked) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repFilter]);

  useEffect(() => {
    if (quotaPeriodId) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotaPeriodId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = includeClosed ? deals : deals.filter((d) => !isClosedDeal(d));
    if (!q) return base;
    return base.filter((d) => {
      const hay = [d.account_name, d.opportunity_name, d.rep_name, d.forecast_stage, d.ai_verdict, d.ai_forecast].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [deals, includeClosed, search]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const getNum = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : -1;
    };
    const getDate = (v: any) => {
      const t = new Date(String(v || "")).getTime();
      return Number.isFinite(t) ? t : 0;
    };
    const getStr = (v: any) => String(v || "").trim().toLowerCase();

    const val = (d: Deal) => {
      switch (sortKey) {
        case "account":
          return getStr(d.account_name);
        case "amount":
          return getNum(d.amount);
        case "close_date":
          return getDate(d.close_date);
        case "forecast_stage":
          return getStr(d.forecast_stage);
        case "ai_stage":
          return getStr(d.ai_verdict);
        case "pain":
          return getNum(d.pain_score);
        case "metrics":
          return getNum(d.metrics_score);
        case "champion":
          return getNum(d.champion_score);
        case "eb":
          return getNum(d.eb_score);
        case "competition":
          return getNum(d.competition_score);
        case "criteria":
          return getNum(d.criteria_score);
        case "process":
          return getNum(d.process_score);
        case "paper":
          return getNum(d.paper_score);
        case "timing":
          return getNum(d.timing_score);
        case "budget":
          return getNum(d.budget_score);
        default:
          return 0;
      }
    };

    const list = filtered.slice();
    list.sort((a, b) => {
      const av: any = val(a);
      const bv: any = val(b);
      if (typeof av === "number" && typeof bv === "number") {
        if (bv !== av) return (bv - av) * dir;
      } else {
        if (String(bv) !== String(av)) return String(bv).localeCompare(String(av)) * dir;
      }
      // tie-breaker
      return getStr(a.account_name).localeCompare(getStr(b.account_name));
    });
    return list;
  }, [filtered, sortDir, sortKey]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  const thBtn = (label: ReactNode, k: SortKey, align: "left" | "right" | "center" = "left") => {
    const alignClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
    const arrow = sortKey === k ? (sortDir === "asc" ? "↑" : "↓") : "";
    return (
    <button
      type="button"
      onClick={() => toggleSort(k)}
      className={`w-full select-none ${alignClass} hover:text-[color:var(--sf-text-primary)]`}
      title="Sort"
    >
      <span className="inline-flex items-start gap-1">
        <span className="inline-flex flex-col leading-tight">{label}</span>
        {arrow ? <span className="text-[10px] leading-4">{arrow}</span> : null}
      </span>
    </button>
    );
  };

  const scoreCell = (s: any) => (
    <span className={`inline-flex min-w-[48px] items-center justify-center rounded-md px-2 py-1 text-xs font-semibold ${scoreColorClass(s)}`}>
      {scoreLabel(s)}
    </span>
  );

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">MEDDPICC+ Timing & Budget Heatmap</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Sortable deal view with MEDDPICC+TB scores (red/yellow/green follows the same score rules as the score cards).
            </p>
            <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/forecast/opportunity-score-cards">
                Opportunity Score Cards View
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface)] disabled:opacity-60"
              disabled={busy}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-12">
          <div className="md:col-span-4">
            <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Account, opportunity, rep, stage…"
              className="mt-1 w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
            />
          </div>

          {!props.repFilterLocked ? (
            <div className="md:col-span-3">
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Rep</label>
              <input
                value={repFilter}
                onChange={(e) => setRepFilter(e.target.value)}
                placeholder="Filter by rep name…"
                className="mt-1 w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
              />
            </div>
          ) : null}

          {props.quotaPeriods?.length ? (
            <div className="md:col-span-3">
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Quota period</label>
              <select
                value={quotaPeriodId}
                onChange={(e) => setQuotaPeriodId(String(e.target.value || ""))}
                className="mt-1 h-[40px] w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                <option value="">All</option>
                {props.quotaPeriods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="md:col-span-2">
            <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Closed deals</label>
            <div className="mt-2 flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
              <input id="inc-closed" type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
              <label htmlFor="inc-closed">Include closed</label>
            </div>
          </div>
        </div>

        {error ? <div className="mt-3 rounded-md border border-[#E74C3C]/40 bg-[#E74C3C]/10 p-3 text-sm text-[#E74C3C]">{error}</div> : null}

        <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
          <table className="w-full min-w-[1200px] text-left text-sm">
            <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
              <tr>
                <th className="px-3 py-3">{thBtn("Account", "account")}</th>
                <th className="px-3 py-3 text-right">{thBtn("Revenue", "amount", "right")}</th>
                <th className="px-3 py-3">{thBtn("Close Date", "close_date")}</th>
                <th className="px-3 py-3">{thBtn("Forecast Stage", "forecast_stage")}</th>
                <th className="px-3 py-3">{thBtn("AI Stage", "ai_stage")}</th>
                <th className="px-2 py-3 text-center">{thBtn("Pain", "pain", "center")}</th>
                <th className="px-2 py-3 text-center">{thBtn("Metrics", "metrics", "center")}</th>
                <th className="px-2 py-3 text-center">{thBtn("Champion", "champion", "center")}</th>
                <th className="px-2 py-3 text-center">
                  {thBtn(
                    <>
                      <span>Economic</span>
                      <span>Buyer</span>
                    </>,
                    "eb",
                    "center"
                  )}
                </th>
                <th className="px-2 py-3 text-center">{thBtn("Competition", "competition", "center")}</th>
                <th className="px-2 py-3 text-center">
                  {thBtn(
                    <>
                      <span>Decision</span>
                      <span>Criteria</span>
                    </>,
                    "criteria",
                    "center"
                  )}
                </th>
                <th className="px-2 py-3 text-center">
                  {thBtn(
                    <>
                      <span>Decision</span>
                      <span>Process</span>
                    </>,
                    "process",
                    "center"
                  )}
                </th>
                <th className="px-2 py-3 text-center">
                  {thBtn(
                    <>
                      <span>Paper</span>
                      <span>Process</span>
                    </>,
                    "paper",
                    "center"
                  )}
                </th>
                <th className="px-2 py-3 text-center">{thBtn("Timing", "timing", "center")}</th>
                <th className="px-2 py-3 text-center">{thBtn("Budget", "budget", "center")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={String(d.id)} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-3 py-3 font-medium text-[color:var(--sf-text-primary)]">
                    <div className="min-w-[200px]">
                      <div className="truncate">{d.account_name || "—"}</div>
                      <div className="mt-0.5 truncate text-xs text-[color:var(--sf-text-disabled)]">{d.opportunity_name || ""}</div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs text-[color:var(--sf-text-primary)]">{fmtMoney(d.amount)}</td>
                  <td className="px-3 py-3 font-mono text-xs text-[color:var(--sf-text-primary)]">{safeDate(d.close_date)}</td>
                  <td className="px-3 py-3 text-[color:var(--sf-text-primary)]">{d.forecast_stage || "—"}</td>
                  <td className="px-3 py-3 text-[color:var(--sf-text-primary)]">{d.ai_verdict || "—"}</td>
                  <td className="px-2 py-3 text-center">{scoreCell(d.pain_score)}</td>
                  <td className="px-2 py-3 text-center">{scoreCell(d.metrics_score)}</td>
                  <td className="px-2 py-3 text-center">{scoreCell(d.champion_score)}</td>
                  <td className="px-2 py-3 text-center">{scoreCell(d.eb_score)}</td>
                  <td className="px-2 py-3 text-center">{scoreCell(d.competition_score)}</td>
                  <td className="px-2 py-3 text-center">{scoreCell(d.criteria_score)}</td>
                  <td className="px-2 py-3 text-center">{scoreCell(d.process_score)}</td>
                  <td className="px-2 py-3 text-center">{scoreCell(d.paper_score)}</td>
                  <td className="px-2 py-3 text-center">{scoreCell(d.timing_score)}</td>
                  <td className="px-2 py-3 text-center">{scoreCell(d.budget_score)}</td>
                </tr>
              ))}
              {!busy && !sorted.length ? (
                <tr>
                  <td colSpan={15} className="px-4 py-8 text-center text-sm text-[color:var(--sf-text-disabled)]">
                    No deals found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
          Showing <span className="font-mono">{sorted.length}</span> deal(s). Sorting applies to the current filtered set.
        </div>
      </section>
    </div>
  );
}

