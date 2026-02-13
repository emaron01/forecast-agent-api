export function FiscalYearSelector(args: {
  name: string;
  fiscalYears: Array<{ fiscal_year: string }>;
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const { name, fiscalYears, defaultValue, required, disabled, label } = args;
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
        {fiscalYears.map((y) => (
          <option key={String(y.fiscal_year)} value={String(y.fiscal_year)}>
            {String(y.fiscal_year)}
          </option>
        ))}
      </select>
    </div>
  );
}

