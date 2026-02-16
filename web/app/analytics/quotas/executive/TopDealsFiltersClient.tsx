"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type PeriodLite = {
  id: string;
  period_name: string;
  period_start: string;
  period_end: string;
  fiscal_year: string;
  fiscal_quarter: string | number;
};

function isoDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function pickDefaultPeriodId(periodsForYear: PeriodLite[]) {
  if (!periodsForYear.length) return "";
  const todayIso = isoDateOnly(new Date());
  const current =
    periodsForYear.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;
  if (current) return String(current.id);
  // Fallback: latest by period_start.
  const sorted = periodsForYear
    .slice()
    .sort((a, b) => new Date(String(b.period_start)).getTime() - new Date(String(a.period_start)).getTime());
  return String(sorted[0]?.id || "");
}

function setParam(params: URLSearchParams, k: string, v: string) {
  if (!v) params.delete(k);
  else params.set(k, v);
}

export function TopDealsFiltersClient(props: {
  basePath: string;
  fiscalYears: string[];
  periods: PeriodLite[];
  selectedFiscalYear: string;
  selectedPeriodId: string;
  showDateRange?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const startDate = String(sp.get("start_date") || "").trim();
  const endDate = String(sp.get("end_date") || "").trim();

  const periodsForYear = useMemo(() => {
    const y = String(props.selectedFiscalYear || "").trim();
    const list = y ? props.periods.filter((p) => String(p.fiscal_year) === y) : props.periods.slice();
    return list
      .slice()
      .sort((a, b) => new Date(String(b.period_start)).getTime() - new Date(String(a.period_start)).getTime());
  }, [props.periods, props.selectedFiscalYear]);

  function navigate(nextFiscalYear: string, nextPeriodId: string) {
    const params = new URLSearchParams(sp.toString());
    setParam(params, "fiscal_year", nextFiscalYear);
    setParam(params, "quota_period_id", nextPeriodId);
    router.replace(`${props.basePath}?${params.toString()}`);
  }

  return (
    <div className={`mt-3 grid gap-3 ${props.showDateRange ? "md:grid-cols-5" : "md:grid-cols-3"}`}>
      <div className="grid gap-1">
        <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Fiscal Year</label>
        <select
          value={props.selectedFiscalYear}
          onChange={(e) => {
            const nextYear = String(e.target.value || "");
            const nextPeriods = props.periods.filter((p) => String(p.fiscal_year) === nextYear);
            const nextPeriodId = pickDefaultPeriodId(nextPeriods);
            navigate(nextYear, nextPeriodId);
          }}
          className="w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
        >
          {props.fiscalYears.map((fy) => (
            <option key={fy} value={fy}>
              {fy}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-1">
        <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Quarter</label>
        <select
          value={props.selectedPeriodId}
          onChange={(e) => {
            const nextId = String(e.target.value || "");
            navigate(props.selectedFiscalYear, nextId);
          }}
          className="w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
        >
          {periodsForYear.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.period_name} (FY{p.fiscal_year} Q{p.fiscal_quarter})
            </option>
          ))}
        </select>
      </div>

      {props.showDateRange ? (
        <div className="grid gap-1">
          <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              const params = new URLSearchParams(sp.toString());
              setParam(params, "start_date", String(e.target.value || ""));
              router.replace(`${props.basePath}?${params.toString()}`);
            }}
            className="w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
          />
        </div>
      ) : null}

      {props.showDateRange ? (
        <div className="grid gap-1">
          <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">End date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              const params = new URLSearchParams(sp.toString());
              setParam(params, "end_date", String(e.target.value || ""));
              router.replace(`${props.basePath}?${params.toString()}`);
            }}
            className="w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
          />
        </div>
      ) : null}

      <div className="flex items-end justify-end gap-2">
        <button
          type="button"
          onClick={() => router.replace(props.basePath)}
          className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

