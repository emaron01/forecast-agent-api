"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type QuotaPeriodLite = {
  id: string;
  period_name: string;
  period_start: string;
  period_end: string;
  fiscal_year: string;
  fiscal_quarter: string;
};

type ManagerOption = { id: number; name: string };
type RepOption = { id: number; name: string; manager_rep_id: number | null };

function byPeriodStartDesc(a: QuotaPeriodLite, b: QuotaPeriodLite) {
  return new Date(b.period_start).getTime() - new Date(a.period_start).getTime();
}

function findCurrentPeriod(periods: QuotaPeriodLite[]) {
  const todayIso = new Date().toISOString().slice(0, 10);
  return periods.find((p) => String(p.period_start) <= todayIso && String(p.period_end) >= todayIso) || null;
}

export function ExecutiveKpisFiltersClient(props: {
  periods: QuotaPeriodLite[];
  managers: ManagerOption[];
  reps: RepOption[];
  defaultFiscalYear: string;
  defaultQuotaPeriodId: string;
  defaultScope: string;
  defaultManagerRepId: string;
  defaultRepId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const years = useMemo(() => {
    const ys = Array.from(new Set(props.periods.map((p) => String(p.fiscal_year || "").trim()).filter(Boolean)));
    ys.sort((a, b) => b.localeCompare(a));
    return ys;
  }, [props.periods]);

  const [year, setYear] = useState(props.defaultFiscalYear || years[0] || "");
  const periodsForYear = useMemo(() => {
    const list = (year ? props.periods.filter((p) => String(p.fiscal_year) === year) : props.periods).slice().sort(byPeriodStartDesc);
    return list;
  }, [props.periods, year]);

  const [quotaPeriodId, setQuotaPeriodId] = useState(props.defaultQuotaPeriodId || periodsForYear[0]?.id || "");
  const [scope, setScope] = useState(props.defaultScope || "company");
  const [managerRepId, setManagerRepId] = useState(props.defaultManagerRepId || "");
  const [repId, setRepId] = useState(props.defaultRepId || "");

  function push(next: Record<string, string>) {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || String(v).trim() === "") sp.delete(k);
      else sp.set(k, String(v));
    }
    router.replace(`${pathname}?${sp.toString()}`);
  }

  // Ensure URL reflects defaults (current quarter/year) for deep links.
  useEffect(() => {
    const urlYear = String(searchParams.get("fiscal_year") || "").trim();
    const urlQp = String(searchParams.get("quota_period_id") || "").trim();
    const urlScope = String(searchParams.get("scope") || "").trim();
    const urlMgr = String(searchParams.get("manager_rep_id") || "").trim();
    const urlRep = String(searchParams.get("rep_id") || "").trim();

    const needYear = !urlYear && !!year;
    const needQp = !urlQp && !!quotaPeriodId;
    const needScope = !urlScope && !!scope;
    const needMgr = !urlMgr && !!managerRepId && scope === "manager";
    const needRep = !urlRep && !!repId && scope === "rep";

    if (needYear || needQp || needScope || needMgr || needRep) {
      push({
        fiscal_year: urlYear || year,
        quota_period_id: urlQp || quotaPeriodId,
        scope: urlScope || scope,
        manager_rep_id: urlMgr || (scope === "manager" ? managerRepId : ""),
        rep_id: urlRep || (scope === "rep" ? repId : ""),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When year changes, pick current quarter (if any) for that year; else the most recent.
  useEffect(() => {
    if (!year) return;
    const current = findCurrentPeriod(periodsForYear);
    const nextQp = current?.id || periodsForYear[0]?.id || "";
    setQuotaPeriodId(nextQp);
    push({ fiscal_year: year, quota_period_id: nextQp });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  // Keep quotaPeriodId valid if periodsForYear changes (e.g. periods loaded / year changed).
  useEffect(() => {
    if (!quotaPeriodId) return;
    if (!periodsForYear.some((p) => String(p.id) === String(quotaPeriodId))) {
      const current = findCurrentPeriod(periodsForYear);
      const nextQp = current?.id || periodsForYear[0]?.id || "";
      setQuotaPeriodId(nextQp);
      push({ quota_period_id: nextQp });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodsForYear]);

  return (
    <form className="mt-3 grid gap-3 md:grid-cols-4" onSubmit={(e) => e.preventDefault()}>
      <div className="grid gap-1">
        <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Fiscal Year</label>
        <select
          value={year}
          onChange={(e) => setYear(String(e.target.value || "").trim())}
          className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
        >
          {years.map((fy) => (
            <option key={fy} value={fy}>
              {fy}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-1">
        <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Quarter</label>
        <select
          value={quotaPeriodId}
          onChange={(e) => {
            const next = String(e.target.value || "").trim();
            setQuotaPeriodId(next);
            push({ quota_period_id: next });
          }}
          className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
        >
          {periodsForYear.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.period_name} (FY{p.fiscal_year} Q{p.fiscal_quarter})
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-1">
        <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Compare scope</label>
        <select
          value={scope}
          onChange={(e) => {
            const next = String(e.target.value || "company").trim();
            setScope(next);
            push({
              scope: next,
              manager_rep_id: next === "manager" ? managerRepId : "",
              rep_id: next === "rep" ? repId : "",
            });
          }}
          className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
        >
          <option value="company">Company</option>
          <option value="manager">Manager (direct reports)</option>
          <option value="rep">Rep</option>
        </select>
      </div>

      <div className="grid gap-1 md:col-span-2">
        <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Manager</label>
        <select
          value={managerRepId}
          onChange={(e) => {
            const next = String(e.target.value || "").trim();
            setManagerRepId(next);
            setScope(next ? "manager" : scope);
            push({ scope: next ? "manager" : scope, manager_rep_id: next, rep_id: "" });
          }}
          className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
        >
          <option value="">(select)</option>
          {props.managers.map((m) => (
            <option key={String(m.id)} value={String(m.id)}>
              {m.name}
            </option>
          ))}
        </select>
        <div className="text-xs text-[color:var(--sf-text-disabled)]">Selecting a manager sets scope = Manager.</div>
      </div>

      <div className="grid gap-1 md:col-span-2">
        <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Rep</label>
        <select
          value={repId}
          onChange={(e) => {
            const next = String(e.target.value || "").trim();
            setRepId(next);
            setScope(next ? "rep" : scope);
            push({ scope: next ? "rep" : scope, rep_id: next, manager_rep_id: "" });
          }}
          className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
        >
          <option value="">(select)</option>
          {props.reps.map((r) => (
            <option key={String(r.id)} value={String(r.id)}>
              {r.name}
            </option>
          ))}
        </select>
        <div className="text-xs text-[color:var(--sf-text-disabled)]">Selecting a rep sets scope = Rep.</div>
      </div>
    </form>
  );
}

