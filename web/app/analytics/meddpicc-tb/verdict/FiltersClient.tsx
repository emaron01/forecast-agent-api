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
    <section className="mt-2 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-[color:var(--sf-text-secondary)]">{periodLabel}</div>
        <div className="flex items-center gap-2">
          <label htmlFor="verdict-quota-period" className="sr-only">
            Quota period
          </label>
          <select
            id="verdict-quota-period"
            value={quotaPeriodId}
            onChange={(e) => {
              const next = String(e.target.value || "");
              setQuotaPeriodId(next);
              const sp = new URLSearchParams();
              if (next) sp.set("quota_period_id", next);
              window.location.href = sp.toString() ? `${props.basePath}?${sp.toString()}` : props.basePath;
            }}
            className="h-[36px] max-w-[520px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
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
  );
}

