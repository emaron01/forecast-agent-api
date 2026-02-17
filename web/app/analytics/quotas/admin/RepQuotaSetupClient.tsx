"use client";

import { useMemo, useState } from "react";

type QuarterKey = "q1" | "q2" | "q3" | "q4";

export function RepQuotaSetupClient(props: {
  action: (formData: FormData) => void | Promise<void>;
  fiscalYear: string;
  execPublicId: string;
  managerPublicId: string;
  repPublicId: string;
  repName: string;
  initialAnnualQuota: number | null;
  quarters: Array<{
    key: QuarterKey;
    label: string;
    fiscalQuarter: "1" | "2" | "3" | "4";
    initialStartDate: string;
    initialEndDate: string;
    initialQuotaAmount: number;
    disabled?: boolean;
  }>;
}) {
  const isDisabled =
    !props.fiscalYear || !props.execPublicId || !props.managerPublicId || !props.repPublicId || props.quarters.every((q) => q.disabled);

  const [annual, setAnnual] = useState<string>(
    props.initialAnnualQuota != null && Number.isFinite(props.initialAnnualQuota) ? String(props.initialAnnualQuota) : ""
  );

  const [pct, setPct] = useState<Record<QuarterKey, string>>(() => {
    const out: any = { q1: "", q2: "", q3: "", q4: "" };
    const a = props.initialAnnualQuota != null && Number.isFinite(props.initialAnnualQuota) ? Number(props.initialAnnualQuota) : 0;
    for (const q of props.quarters) {
      if (a > 0 && Number.isFinite(q.initialQuotaAmount)) {
        const p = (Number(q.initialQuotaAmount) / a) * 100;
        out[q.key] = Number.isFinite(p) ? String(Math.round(p * 100) / 100) : "";
      }
    }
    return out;
  });

  const [amount, setAmount] = useState<Record<QuarterKey, string>>(() => {
    const out: any = { q1: "", q2: "", q3: "", q4: "" };
    for (const q of props.quarters) out[q.key] = q.initialQuotaAmount ? String(q.initialQuotaAmount) : "";
    return out;
  });

  const [dates, setDates] = useState<Record<QuarterKey, { start: string; end: string }>>(() => {
    const out: any = { q1: { start: "", end: "" }, q2: { start: "", end: "" }, q3: { start: "", end: "" }, q4: { start: "", end: "" } };
    for (const q of props.quarters) out[q.key] = { start: q.initialStartDate || "", end: q.initialEndDate || "" };
    return out;
  });

  const [touchedAmount, setTouchedAmount] = useState<Record<QuarterKey, boolean>>({
    q1: false,
    q2: false,
    q3: false,
    q4: false,
  });

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
      const out: any = { ...prev };
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
    <form action={props.action} className="mt-5 grid gap-4">
      <input type="hidden" name="exec_public_id" value={props.execPublicId} />
      <input type="hidden" name="manager_public_id" value={props.managerPublicId} />
      <input type="hidden" name="rep_public_id" value={props.repPublicId} />
      <input type="hidden" name="fiscal_year" value={props.fiscalYear} />

      <div className="grid gap-3 md:grid-cols-2">
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
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
            placeholder="0"
            required
            disabled={isDisabled}
          />
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Total of all 4 quarters must be ≤ annual quota.</div>
        </div>
        <div className="grid gap-1">
          <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Selected rep</label>
          <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]">
            {props.repName || "—"}
          </div>
        </div>
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
          const disabled = isDisabled || !!q.disabled;
          return (
            <div key={q.key} className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{q.label}</div>
              <div className="mt-3 grid gap-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1">
                    <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Start Date</label>
                    <input
                      name={`${q.key}_start`}
                      type="date"
                      value={dates[k].start}
                      onChange={(e) => setDates((d) => ({ ...d, [k]: { ...d[k], start: e.target.value } }))}
                      className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                      required
                      disabled={disabled}
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">End Date</label>
                    <input
                      name={`${q.key}_end`}
                      type="date"
                      value={dates[k].end}
                      onChange={(e) => setDates((d) => ({ ...d, [k]: { ...d[k], end: e.target.value } }))}
                      className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                      required
                      disabled={disabled}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">%</label>
                    <input
                      type="number"
                      step="0.01"
                      value={pct[k]}
                      onChange={(e) => applyPct(k, e.target.value)}
                      className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                      placeholder="0"
                      disabled={disabled}
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Rep quota ({q.fiscalQuarter})</label>
                    <input
                      name={`${q.key}_quota`}
                      type="number"
                      step="0.01"
                      value={amount[k]}
                      onChange={(e) => onAmountChange(k, e.target.value)}
                      className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                      placeholder="0"
                      required
                      disabled={disabled}
                    />
                    <div className="text-[11px] text-[color:var(--sf-text-secondary)]">
                      {touchedAmount[k] ? "Manual override (edit % to recalc)." : "Auto from % (edit amount to override)."}
                    </div>
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
          disabled={isDisabled || exceedsAnnual}
          title={exceedsAnnual ? "Quarter totals must be ≤ annual quota" : ""}
        >
          Save and next rep
        </button>
      </div>
    </form>
  );
}

