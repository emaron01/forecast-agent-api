import type { QuotaPeriodRow } from "../../lib/quotaModels";
import { dateOnly } from "../../lib/dateOnly";

export function QuotaPeriodSelector(args: {
  name: string;
  periods: QuotaPeriodRow[];
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const { name, periods, defaultValue, required, disabled, label } = args;
  return (
    <div className="grid gap-1">
      {label ? <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">{label}</label> : null}
      <select
        name={name}
        defaultValue={defaultValue || ""}
        required={required}
        disabled={disabled}
        className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
      >
        <option value="">(select)</option>
        {periods.map((p) => (
          <option key={String(p.id)} value={String(p.id)}>
            {p.period_name} ({p.fiscal_year} {p.fiscal_quarter}) ({dateOnly(p.period_start)} → {dateOnly(p.period_end)}) [id {p.id}]
          </option>
        ))}
      </select>
    </div>
  );
}

