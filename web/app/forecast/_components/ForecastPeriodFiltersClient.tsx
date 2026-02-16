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
  const sorted = periodsForYear
    .slice()
    .sort((a, b) => new Date(String(b.period_start)).getTime() - new Date(String(a.period_start)).getTime());
  return String(sorted[0]?.id || "");
}

function setParam(params: URLSearchParams, k: string, v: string) {
  if (!v) params.delete(k);
  else params.set(k, v);
}

export function ForecastPeriodFiltersClient(props: {
  basePath: string;
  fiscalYears: string[];
  periods: PeriodLite[];
  selectedFiscalYear: string;
  selectedPeriodId: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();

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
    <div className="mt-2 flex items-center gap-2">
      <select
        value={props.selectedFiscalYear}
        onChange={(e) => {
          const nextYear = String(e.target.value || "");
          const nextPeriods = props.periods.filter((p) => String(p.fiscal_year) === nextYear);
          const nextPeriodId = pickDefaultPeriodId(nextPeriods);
          navigate(nextYear, nextPeriodId);
        }}
        className="w-[160px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
      >
        {props.fiscalYears.map((fy) => (
          <option key={fy} value={fy}>
            {fy}
          </option>
        ))}
      </select>

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
  );
}

