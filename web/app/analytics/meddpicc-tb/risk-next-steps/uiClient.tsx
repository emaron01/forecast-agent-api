"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { closedOutcomeFromStage } from "../../../../lib/opportunityOutcome";
import { dateOnly } from "../../../../lib/dateOnly";

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
  risk_summary?: string | null;
  next_steps?: string | null;
  updated_at?: string | null;
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

function isClosedDeal(d: Deal) {
  // Analytics/reporting standard: forecast_stage drives all “closed” detection.
  return closedOutcomeFromStage((d as any)?.forecast_stage) || null;
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

type SortKey = "account" | "amount" | "close_date" | "forecast_stage" | "ai_stage" | "health" | "risk_summary" | "next_steps";

export function MeddpiccRiskNextStepsClient(props: {
  quotaPeriods?: Array<{ id: string; label: string }>;
  defaultQuotaPeriodId?: string;
}) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [repFilter, setRepFilter] = useState("");
  const [quotaPeriodId, setQuotaPeriodId] = useState<string>(props.defaultQuotaPeriodId || "");
  const [includeClosed, setIncludeClosed] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (repFilter.trim()) params.set("rep_name", repFilter.trim());
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
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repFilter, quotaPeriodId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = includeClosed ? deals : deals.filter((d) => !isClosedDeal(d));
    if (!q) return base;
    return base.filter((d) => {
      const hay = [
        d.account_name,
        d.opportunity_name,
        d.rep_name,
        d.forecast_stage,
        d.ai_verdict,
        d.ai_forecast,
        d.risk_summary,
        d.next_steps,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
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
        case "health":
          return getNum(healthPctFrom30(d.health_score));
        case "risk_summary":
          return getStr(d.risk_summary);
        case "next_steps":
          return getStr(d.next_steps);
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

  const thBtn = (label: string, k: SortKey, align: "left" | "right" = "left") => (
    <button
      type="button"
      onClick={() => toggleSort(k)}
      className={`w-full select-none ${align === "right" ? "text-right" : "text-left"} hover:text-[color:var(--sf-text-primary)]`}
      title="Sort"
    >
      {label}
      {sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </button>
  );

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">MEDDPICC Report: Risk Summary + Next Steps</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Sortable deals view for risk + next actions.</p>
            <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/analytics/meddpicc-tb">
                MEDDPICC+TB Reports
              </Link>
              {" · "}
              <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/analytics">
                Analytics home
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
              placeholder="Account, opportunity, stage, risk…"
              className="mt-1 w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
            />
          </div>
          <div className="md:col-span-3">
            <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Rep</label>
            <input
              value={repFilter}
              onChange={(e) => setRepFilter(e.target.value)}
              placeholder="Filter by rep name…"
              className="mt-1 w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
            />
          </div>
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
          <table className="w-full min-w-[1400px] text-left text-sm">
            <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
              <tr>
                <th className="px-4 py-3">{thBtn("Account Name", "account")}</th>
                <th className="px-4 py-3 text-right">{thBtn("Avg Health Score", "health", "right")}</th>
                <th className="px-4 py-3 text-right">{thBtn("Revenue", "amount", "right")}</th>
                <th className="px-4 py-3">{thBtn("Close Date", "close_date")}</th>
                <th className="px-4 py-3">{thBtn("Forecast Stage", "forecast_stage")}</th>
                <th className="px-4 py-3">{thBtn("AI Stage", "ai_stage")}</th>
                <th className="px-4 py-3">{thBtn("Risk Summary", "risk_summary")}</th>
                <th className="px-4 py-3">{thBtn("Next Steps", "next_steps")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={String(d.id)} className="border-t border-[color:var(--sf-border)] align-top">
                  <td className="px-4 py-3 font-medium text-[color:var(--sf-text-primary)]">
                    <div className="min-w-[220px]">
                      <div className="truncate">{d.account_name || "—"}</div>
                      <div className="mt-0.5 truncate text-xs text-[color:var(--sf-text-disabled)]">{d.opportunity_name || ""}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {(() => {
                      const hp = healthPctFrom30(d.health_score);
                      return <span className={healthColorClass(hp)}>{hp == null ? "—" : `${hp}%`}</span>;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-[color:var(--sf-text-primary)]">{fmtMoney(d.amount)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[color:var(--sf-text-primary)]">{safeDate(d.close_date)}</td>
                  <td className="px-4 py-3 text-[color:var(--sf-text-primary)]">{d.forecast_stage || "—"}</td>
                  <td className="px-4 py-3 text-[color:var(--sf-text-primary)]">{d.ai_verdict || "—"}</td>
                  <td className="px-4 py-3 text-xs text-[color:var(--sf-text-primary)]">
                    <div className="min-w-[320px] whitespace-pre-wrap">{String(d.risk_summary || "").trim() || "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[color:var(--sf-text-primary)]">
                    <div className="min-w-[320px] whitespace-pre-wrap">{String(d.next_steps || "").trim() || "—"}</div>
                  </td>
                </tr>
              ))}
              {!busy && !sorted.length ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-[color:var(--sf-text-disabled)]">
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

