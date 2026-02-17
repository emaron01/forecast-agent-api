"use client";

import { useMemo, useState } from "react";

type QuarterKey = "q1" | "q2" | "q3" | "q4";

export function RepQuotaSetFormClient(props: {
  action: (formData: FormData) => void | Promise<void>;
  mode: "new" | "edit";
  reps: Array<{ id: string; name: string }>;
  fiscalYears: string[];
  defaultRepId: string;
  defaultFiscalYear: string;
  cancelHref?: string;
  initialAnnualQuota: number | null;
  initialAmounts: Record<QuarterKey, number>;
}) {
  const [repId, setRepId] = useState<string>(props.defaultRepId || "");
  const [fiscalYear, setFiscalYear] = useState<string>(props.defaultFiscalYear || "");

  const [annual, setAnnual] = useState<string>(
    props.initialAnnualQuota != null && Number.isFinite(props.initialAnnualQuota) ? String(props.initialAnnualQuota) : ""
  );

  const [pct, setPct] = useState<Record<QuarterKey, string>>(() => {
    const out: any = { q1: "", q2: "", q3: "", q4: "" };
    const a = props.initialAnnualQuota != null && Number.isFinite(props.initialAnnualQuota) ? Number(props.initialAnnualQuota) : 0;
    for (const k of ["q1", "q2", "q3", "q4"] as QuarterKey[]) {
      const amt = props.initialAmounts[k] || 0;
      if (a > 0 && Number.isFinite(amt)) {
        const p = (amt / a) * 100;
        out[k] = Number.isFinite(p) ? String(Math.round(p * 100) / 100) : "";
      }
    }
    return out;
  });

  const [amount, setAmount] = useState<Record<QuarterKey, string>>(() => {
    const out: any = { q1: "", q2: "", q3: "", q4: "" };
    for (const k of ["q1", "q2", "q3", "q4"] as QuarterKey[]) {
      const v = props.initialAmounts[k] || 0;
      out[k] = v ? String(v) : "";
    }
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

  const canSubmit = Boolean(repId && fiscalYear && annualNum != null && !exceedsAnnual);

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
    <form action={props.action} className="grid gap-3">
      {props.mode === "edit" ? (
        <>
          <input type="hidden" name="rep_id" value={repId} />
          <input type="hidden" name="fiscal_year" value={fiscalYear} />
        </>
      ) : null}

      {props.mode === "new" ? (
        <>
          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Rep</label>
            <select
              name="rep_id"
              value={repId}
              onChange={(e) => setRepId(e.target.value)}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              required
            >
              <option value="">(select)</option>
              {props.reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.id})
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Fiscal Year</label>
            <select
              name="fiscal_year"
              value={fiscalYear}
              onChange={(e) => setFiscalYear(e.target.value)}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              required
            >
              <option value="">(select)</option>
              {props.fiscalYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </>
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
          className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
          placeholder="0"
          required
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

      <div className="grid gap-3 md:grid-cols-2">
        {(["q1", "q2", "q3", "q4"] as QuarterKey[]).map((k) => (
          <div key={k} className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
            <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{k.toUpperCase()}</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">%</label>
                <input
                  type="number"
                  step="0.01"
                  value={pct[k]}
                  onChange={(e) => applyPct(k, e.target.value)}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                  placeholder="0"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Quarter quota</label>
                <input
                  name={`${k}_quota_amount`}
                  type="number"
                  step="0.01"
                  value={amount[k]}
                  onChange={(e) => onAmountChange(k, e.target.value)}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                  placeholder="0"
                  required
                />
                <div className="text-[11px] text-[color:var(--sf-text-secondary)]">
                  {touchedAmount[k] ? "Manual override (edit % to recalc)." : "Auto from % (edit amount to override)."}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-end gap-2">
        {props.cancelHref ? (
          <a
            href={props.cancelHref}
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Cancel
          </a>
        ) : null}
        <button
          className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-60"
          disabled={!canSubmit}
          title={!canSubmit ? "Rep, fiscal year, and valid annual quota are required; quarter totals must be ≤ annual" : ""}
        >
          Save
        </button>
      </div>
    </form>
  );
}

