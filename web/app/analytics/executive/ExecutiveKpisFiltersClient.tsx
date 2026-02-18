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
  const initialPick = (() => {
    const s = String(props.defaultScope || "company").trim();
    if (s === "manager" && String(props.defaultManagerRepId || "").trim()) return `mgr:${String(props.defaultManagerRepId).trim()}`;
    if (s === "rep" && String(props.defaultRepId || "").trim()) return `rep:${String(props.defaultRepId).trim()}`;
    return "company";
  })();
  const [teamPick, setTeamPick] = useState<string>(initialPick);

  const { scope, managerRepId, repId } = useMemo(() => {
    const v = String(teamPick || "company").trim();
    if (v.startsWith("mgr:")) return { scope: "manager", managerRepId: v.slice(4), repId: "" };
    if (v.startsWith("rep:")) return { scope: "rep", managerRepId: "", repId: v.slice(4) };
    return { scope: "company", managerRepId: "", repId: "" };
  }, [teamPick]);

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

    const pickFromUrl =
      urlScope === "manager" && urlMgr
        ? `mgr:${urlMgr}`
        : urlScope === "rep" && urlRep
          ? `rep:${urlRep}`
          : "company";

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

    // Keep local pick in sync with URL on first load.
    setTeamPick(pickFromUrl);
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

  const managersSorted = useMemo(
    () => (props.managers || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)) || Number(a.id) - Number(b.id)),
    [props.managers]
  );
  const repsSorted = useMemo(
    () => (props.reps || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)) || Number(a.id) - Number(b.id)),
    [props.reps]
  );
  const repsByManager = useMemo(() => {
    const m = new Map<string, RepOption[]>();
    for (const r of repsSorted) {
      const mid = r.manager_rep_id == null ? "" : String(r.manager_rep_id);
      const list = m.get(mid) || [];
      list.push(r);
      m.set(mid, list);
    }
    return m;
  }, [repsSorted]);

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

      <div className="grid gap-1 md:col-span-2">
        <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Team member</label>
        <select
          value={teamPick}
          onChange={(e) => {
            const next = String(e.target.value || "company");
            setTeamPick(next);
            const parsed =
              next.startsWith("mgr:") ? { scope: "manager", manager_rep_id: next.slice(4), rep_id: "" }
              : next.startsWith("rep:") ? { scope: "rep", manager_rep_id: "", rep_id: next.slice(4) }
              : { scope: "company", manager_rep_id: "", rep_id: "" };
            push({ scope: parsed.scope, manager_rep_id: parsed.manager_rep_id, rep_id: parsed.rep_id });
          }}
          className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
        >
          <option value="company">Company</option>
          {managersSorted.map((m) => {
            const reps = repsByManager.get(String(m.id)) || [];
            return (
              <optgroup key={String(m.id)} label={m.name}>
                <option value={`mgr:${String(m.id)}`}>{`Manager: ${m.name}`}</option>
                {reps.map((r) => (
                  <option key={String(r.id)} value={`rep:${String(r.id)}`}>
                    {`\u00A0\u00A0Rep: ${r.name}`}
                  </option>
                ))}
              </optgroup>
            );
          })}
          {(() => {
            const unassigned = repsByManager.get("") || [];
            if (!unassigned.length) return null;
            return (
              <optgroup label="(Unassigned)">
                {unassigned.map((r) => (
                  <option key={String(r.id)} value={`rep:${String(r.id)}`}>
                    {`Rep: ${r.name}`}
                  </option>
                ))}
              </optgroup>
            );
          })()}
        </select>
        <div className="text-xs text-[color:var(--sf-text-disabled)]">
          Choose a manager to scope to their team; choose a rep to scope to that rep.
        </div>
      </div>
    </form>
  );
}

