"use client";

import { useEffect, useMemo, useState } from "react";

type QuarterKey = "q1" | "q2" | "q3" | "q4";

export type QuotaSetupQuarter = {
  key: QuarterKey;
  periodId?: number;
  periodLabel: string;
  initialQuotaAmount: number;
  initialStartDate?: string;
  initialEndDate?: string;
  disabled?: boolean;
};

export type QuotaSetupClientProps = {
  action: (formData: FormData) => void | Promise<void>;
  repPublicId: string;
  repName: string;
  fiscalYear: string;
  initialAnnualQuota: number | null;
  quarters: QuotaSetupQuarter[];
  submitButtonLabel?: string;
  isOverlay?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  hiddenFields?: Record<string, string | number | null | undefined>;
};

function initialStateFromProps(props: QuotaSetupClientProps) {
  const annual =
    props.initialAnnualQuota != null && Number.isFinite(props.initialAnnualQuota)
      ? String(props.initialAnnualQuota)
      : "";
  const a = props.initialAnnualQuota != null && Number.isFinite(props.initialAnnualQuota) ? Number(props.initialAnnualQuota) : 0;
  const pct: Record<QuarterKey, string> = { q1: "", q2: "", q3: "", q4: "" };
  for (const q of props.quarters) {
    if (a > 0 && Number.isFinite(q.initialQuotaAmount)) {
      const p = (Number(q.initialQuotaAmount) / a) * 100;
      pct[q.key] = Number.isFinite(p) ? String(Math.round(p * 100) / 100) : "";
    }
  }
  const amount: Record<QuarterKey, string> = { q1: "", q2: "", q3: "", q4: "" };
  const dates: Record<QuarterKey, { start: string; end: string }> = {
    q1: { start: "", end: "" },
    q2: { start: "", end: "" },
    q3: { start: "", end: "" },
    q4: { start: "", end: "" },
  };
  for (const q of props.quarters) {
    amount[q.key] = q.initialQuotaAmount ? String(q.initialQuotaAmount) : "";
    dates[q.key] = { start: q.initialStartDate || "", end: q.initialEndDate || "" };
  }
  return {
    annual,
    pct,
    amount,
    dates,
    touchedAmount: { q1: false, q2: false, q3: false, q4: false } as Record<QuarterKey, boolean>,
  };
}

function propsDataKey(props: QuotaSetupClientProps) {
  return `${props.fiscalYear}|${props.repPublicId}|${props.initialAnnualQuota ?? ""}|${props.disabled ? 1 : 0}|${props.quarters
    .map((q) => `${q.key}:${q.periodId ?? ""}:${q.initialQuotaAmount}:${q.initialStartDate ?? ""}:${q.initialEndDate ?? ""}:${q.disabled ? 1 : 0}`)
    .join(";")}`;
}

export function QuotaSetupClient(props: QuotaSetupClientProps) {
  const init = initialStateFromProps(props);
  const [annual, setAnnual] = useState<string>(init.annual);
  const [pct, setPct] = useState<Record<QuarterKey, string>>(init.pct);
  const [amount, setAmount] = useState<Record<QuarterKey, string>>(init.amount);
  const [dates, setDates] = useState<Record<QuarterKey, { start: string; end: string }>>(init.dates);
  const [touchedAmount, setTouchedAmount] = useState<Record<QuarterKey, boolean>>(init.touchedAmount);

  const dataKey = propsDataKey(props);
  useEffect(() => {
    const next = initialStateFromProps(props);
    setAnnual(next.annual);
    setPct(next.pct);
    setAmount(next.amount);
    setDates(next.dates);
    setTouchedAmount(next.touchedAmount);
  }, [dataKey]);

  const annualNum = useMemo(() => {
    const n = Number(annual);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [annual]);

  const quarterSum = useMemo(() => {
    let s = 0;
    for (const k of ["q1", "q2", "q3", "q4"] as QuarterKey[]) {
      const n = Number(amount[k] || 0);
      if (Number.isFinite(n) && n > 0) s += n;
    }
    return s;
  }, [amount]);

  const exceedsAnnual = annualNum != null ? quarterSum - annualNum > 1e-6 : false;
  const remaining = annualNum != null ? annualNum - quarterSum : null;
  const hasDateInputs = props.quarters.some((q) => q.initialStartDate != null || q.initialEndDate != null);
  const disabled = props.disabled === true;

  const fmtMoney = (n: number | null) => {
    if (n == null || !Number.isFinite(n)) return "—";
    return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  };

  function applyPct(k: QuarterKey, pctStr: string) {
    setPct((p) => ({ ...p, [k]: pctStr }));
    const a = annualNum;
    const p = Number(pctStr);
    if (a == null || !Number.isFinite(p)) return;
    const next = (a * p) / 100;
    setTouchedAmount((t) => ({ ...t, [k]: false }));
    setAmount((am) => ({ ...am, [k]: String(Math.round(next * 100) / 100) }));
  }

  function onAmountChange(k: QuarterKey, v: string) {
    setTouchedAmount((t) => ({ ...t, [k]: true }));
    setAmount((am) => ({ ...am, [k]: v }));
  }

  function recalcUntouchedFromPct(nextAnnual: number | null, nextPct: Record<QuarterKey, string>) {
    if (nextAnnual == null) return;
    setAmount((prev) => {
      const out: Record<QuarterKey, string> = { ...prev };
      for (const k of ["q1", "q2", "q3", "q4"] as QuarterKey[]) {
        if (touchedAmount[k]) continue;
        const p = Number(nextPct[k]);
        if (!Number.isFinite(p)) continue;
        const v = Math.round(((nextAnnual * p) / 100) * 100) / 100;
        out[k] = String(v);
      }
      return out;
    });
  }

  return (
    <form action={props.action} className="mt-4 grid gap-4">
      <input type="hidden" name="fiscal_year" value={props.fiscalYear} />
      <input type="hidden" name="rep_public_id" value={props.repPublicId} />
      {Object.entries(props.hiddenFields || {}).map(([key, value]) =>
        value == null ? null : <input key={key} type="hidden" name={key} value={String(value)} />
      )}

      {props.isOverlay ? (
        <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-secondary)]">
          <span className="font-medium text-[color:var(--sf-text-primary)]">{props.repName || "Rep"}</span>
          <span className="ml-1">· Overlay</span>
          <div className="mt-1 text-xs">Personal target — not included in your rollup</div>
        </div>
      ) : null}

      {props.disabledReason ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
          {props.disabledReason}
        </div>
      ) : null}

      <div className="grid gap-1">
        <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Annual quota</label>
        <input
          name="annual_target"
          type="number"
          step="0.01"
          value={annual}
          onChange={(e) => {
            const v = e.target.value;
            setAnnual(v);
            const n = Number(v);
            const nextAnnual = Number.isFinite(n) && n > 0 ? n : null;
            recalcUntouchedFromPct(nextAnnual, pct);
          }}
          className="w-64 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
          placeholder="0"
          required
          disabled={disabled}
        />
        <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Total of all 4 quarters must be ≤ annual quota.</div>
      </div>

      <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[color:var(--sf-text-secondary)]">
            <span className="font-medium text-[color:var(--sf-text-primary)]">Total quarters:</span>{" "}
            <span className="font-mono text-xs">{fmtMoney(quarterSum)}</span>
          </div>
          <div className="text-[color:var(--sf-text-secondary)]">
            <span className="font-medium text-[color:var(--sf-text-primary)]">Remaining:</span>{" "}
            <span className={`font-mono text-xs ${remaining != null && remaining < -1e-6 ? "text-[#E74C3C]" : ""}`}>{fmtMoney(remaining)}</span>
          </div>
        </div>
        {exceedsAnnual ? (
          <div className="mt-2 rounded-md border border-[#E74C3C]/40 bg-[#E74C3C]/10 px-3 py-2 text-xs text-[#E74C3C]">
            Quarter quotas exceed the annual quota. Reduce one or more quarters.
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {props.quarters.map((q) => {
          const k = q.key;
          const quarterDisabled = disabled || q.disabled === true;
          return (
            <div key={q.key} className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{q.periodLabel}</div>
              {hasDateInputs ? (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1">
                    <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Start Date</label>
                    <input
                      name={`${k}_start`}
                      type="date"
                      value={dates[k].start}
                      onChange={(e) => setDates((d) => ({ ...d, [k]: { ...d[k], start: e.target.value } }))}
                      className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                      required
                      disabled={quarterDisabled}
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">End Date</label>
                    <input
                      name={`${k}_end`}
                      type="date"
                      value={dates[k].end}
                      onChange={(e) => setDates((d) => ({ ...d, [k]: { ...d[k], end: e.target.value } }))}
                      className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                      required
                      disabled={quarterDisabled}
                    />
                  </div>
                </div>
              ) : null}

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">%</label>
                  <input
                    type="number"
                    step="0.01"
                    value={pct[k]}
                    onChange={(e) => applyPct(k, e.target.value)}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                    placeholder="0"
                    disabled={quarterDisabled}
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Quarter quota</label>
                  <input
                    name={`${k}_quota`}
                    type="number"
                    step="0.01"
                    value={amount[k]}
                    onChange={(e) => onAmountChange(k, e.target.value)}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                    placeholder="0"
                    required
                    disabled={quarterDisabled}
                  />
                  <div className="text-[11px] text-[color:var(--sf-text-secondary)]">
                    {touchedAmount[k] ? "Manual override (edit % to recalc)." : "Auto from % (edit amount to override)."}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-60"
          disabled={disabled || exceedsAnnual}
          title={exceedsAnnual ? "Quarter totals must be ≤ annual quota" : ""}
        >
          {props.submitButtonLabel ?? "Save and next rep"}
        </button>
      </div>
    </form>
  );
}
