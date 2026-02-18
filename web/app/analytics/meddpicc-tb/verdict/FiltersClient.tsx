"use client";

import { useState } from "react";

type PeriodLite = {
  id: string;
  fiscal_year: string;
  fiscal_quarter: string;
  period_name: string;
  period_start: string;
  period_end: string;
};

export function VerdictFiltersClient(props: {
  basePath: string;
  periodLabel: string;
  periods: PeriodLite[];
  initialQuotaPeriodId: string;
}) {
  const periods = props.periods || [];

  const [quotaPeriodId, setQuotaPeriodId] = useState<string>(() => String(props.initialQuotaPeriodId || ""));

  const periodLabel = props.periodLabel || "—";

  return (
    <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Filters</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Period: {periodLabel}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        <section>
          <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
            <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Quarter</div>
            <div className="mt-2 grid gap-1">
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Quota period</label>
              <select
                value={quotaPeriodId}
                onChange={(e) => {
                  const next = String(e.target.value || "");
                  setQuotaPeriodId(next);
                  const sp = new URLSearchParams();
                  if (next) sp.set("quota_period_id", next);
                  window.location.href = sp.toString() ? `${props.basePath}?${sp.toString()}` : props.basePath;
                }}
                className="h-[40px] w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                {periods.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {(String(p.period_name || "").trim() || `${p.period_start} → ${p.period_end}`) + ` (FY${p.fiscal_year} Q${p.fiscal_quarter})`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

