"use client";

import { Fragment, useState } from "react";

function fmtMoney(n: unknown) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function fmtNum(n: unknown) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString();
}

export type RepManagerRepRow = {
  rep_id: string;
  rep_name: string;
  /** When `false`, rep is inactive (departed); omit or non-`false` = active. */
  active?: boolean;
  manager_id: string;
  manager_name: string;
  quota: number;
  total_count: number;
  won_amount: number;
  won_count: number;
  lost_count: number;
  lost_amount?: number;
  active_amount: number;
  commit_amount: number;
  best_amount: number;
  pipeline_amount: number;
  created_amount: number;
  created_count: number;
  win_rate: number | null;
  opp_to_win: number | null;
  aov: number | null;
  attainment: number | null;
  commit_coverage: number | null;
  best_coverage: number | null;
  partner_contribution: number | null;
  partner_win_rate: number | null;
  avg_days_won: number | null;
  avg_days_lost: number | null;
  avg_days_active: number | null;
  mix_pipeline: number | null;
  mix_best: number | null;
  mix_commit: number | null;
  mix_won: number | null;
  qoq_attainment_delta: number | null;
};

export type RepManagerManagerRow = {
  manager_id: string;
  manager_name: string;
  /** Rep id of this manager’s own manager; "" when parent is the viewer, unassigned, or unknown. */
  parent_manager_id: string;
  quota: number;
  won_amount: number;
  active_amount: number;
  attainment: number | null;
  win_rate: number | null;
  partner_contribution: number | null;
};

function getSortValue(r: RepManagerRepRow, col: string): number {
  switch (col) {
    case "quota":
      return Number(r.quota) || 0;
    case "won":
      return Number(r.won_amount) || 0;
    case "attainment":
      return r.attainment != null && Number.isFinite(r.attainment) ? r.attainment : NaN;
    case "qoq":
      return r.qoq_attainment_delta != null && Number.isFinite(r.qoq_attainment_delta)
        ? r.qoq_attainment_delta
        : NaN;
    case "pipeline":
      return Number(r.active_amount) || 0;
    case "win_rate":
      return r.win_rate != null && Number.isFinite(r.win_rate) ? r.win_rate : NaN;
    case "aov":
      return r.aov != null && Number.isFinite(r.aov) ? r.aov : NaN;
    case "partner":
      return r.partner_contribution != null && Number.isFinite(r.partner_contribution)
        ? r.partner_contribution
        : NaN;
    case "cycle_won":
      return r.avg_days_won != null && Number.isFinite(r.avg_days_won) ? r.avg_days_won : NaN;
    case "cycle_lost":
      return r.avg_days_lost != null && Number.isFinite(r.avg_days_lost) ? r.avg_days_lost : NaN;
    case "age":
      return r.avg_days_active != null && Number.isFinite(r.avg_days_active) ? r.avg_days_active : NaN;
    default:
      return NaN;
  }
}

function compareReps(a: RepManagerRepRow, b: RepManagerRepRow, sortCol: string, sortDir: "asc" | "desc"): number {
  if (sortCol === "rep") {
    const cmp = a.rep_name.localeCompare(b.rep_name, "en", { sensitivity: "base" });
    return sortDir === "desc" ? -cmp : cmp;
  }
  const va = getSortValue(a, sortCol);
  const vb = getSortValue(b, sortCol);
  const aBad = !Number.isFinite(va);
  const bBad = !Number.isFinite(vb);
  if (aBad && bBad) return 0;
  if (aBad) return 1;
  if (bBad) return -1;
  const cmp = va - vb;
  return sortDir === "desc" ? -cmp : cmp;
}

const thClass =
  "px-2 py-2 text-xs cursor-pointer select-none hover:text-[color:var(--sf-text-primary)] whitespace-nowrap text-[color:var(--sf-text-secondary)]";

export function RepManagerComparisonPanel(props: {
  repRows: RepManagerRepRow[];
  managerRows: RepManagerManagerRow[];
  periodName?: string;
}) {
  const { repRows, managerRows } = props;

  const [sortCol, setSortCol] = useState<string>("attainment");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(col: string) {
    if (sortCol === col) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  }

  const sortIndicator = (col: string) =>
    sortCol === col ? (sortDir === "desc" ? " ↓" : " ↑") : " ↕";

  const repsByManager = new Map<string, RepManagerRepRow[]>();
  for (const r of repRows) {
    const k = r.manager_id || "";
    const arr = repsByManager.get(k) || [];
    arr.push(r);
    repsByManager.set(k, arr);
  }
  const managerIdsInRepRows = Array.from(repsByManager.keys());
  const orderedManagerIds = [
    ...managerRows.map((m) => m.manager_id || ""),
    ...managerIdsInRepRows.filter((id) => !managerRows.some((m) => String(m.manager_id || "") === String(id || ""))),
  ];
  const managerNameById = new Map<string, string>();
  for (const m of managerRows) managerNameById.set(m.manager_id || "", m.manager_name);
  for (const r of repRows) {
    const id = r.manager_id || "";
    if (id && !managerNameById.has(id)) managerNameById.set(id, r.manager_name);
  }

  const sortedRepsByManager = new Map<string, RepManagerRepRow[]>();
  for (const [mid, arr] of repsByManager.entries()) {
    sortedRepsByManager.set(mid, [...arr].sort((a, b) => compareReps(a, b, sortCol, sortDir)));
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-[color:var(--sf-border)]">
        <table className="w-full table-fixed text-left text-xs">
          <thead className="bg-[color:var(--sf-surface-alt)]">
            <tr>
              <th className={`${thClass} w-[160px] text-left`} onClick={() => toggleSort("rep")}>
                Rep
                {sortIndicator("rep")}
              </th>
              <th className={`${thClass} w-[80px] text-right`} onClick={() => toggleSort("quota")}>
                Quota
                {sortIndicator("quota")}
              </th>
              <th className={`${thClass} w-[90px] text-right`} onClick={() => toggleSort("won")}>
                Won
                {sortIndicator("won")}
              </th>
              <th className={`${thClass} w-[70px] text-right`} onClick={() => toggleSort("attainment")}>
                Attain%
                {sortIndicator("attainment")}
              </th>
              <th className={`${thClass} w-[60px] text-right`} onClick={() => toggleSort("qoq")}>
                QoQ
                {sortIndicator("qoq")}
              </th>
              <th className={`${thClass} w-[80px] text-right`} onClick={() => toggleSort("pipeline")}>
                Pipeline
                {sortIndicator("pipeline")}
              </th>
              <th className={`${thClass} w-[55px] text-right`} onClick={() => toggleSort("win_rate")}>
                Win%
                {sortIndicator("win_rate")}
              </th>
              <th className={`${thClass} w-[70px] text-right`} onClick={() => toggleSort("aov")}>
                AOV
                {sortIndicator("aov")}
              </th>
              <th className={`${thClass} w-[65px] text-right`} onClick={() => toggleSort("partner")}>
                Partner%
                {sortIndicator("partner")}
              </th>
              <th className={`${thClass} w-[60px] text-right`} onClick={() => toggleSort("cycle_won")}>
                Cycle W
                {sortIndicator("cycle_won")}
              </th>
              <th className={`${thClass} w-[60px] text-right`} onClick={() => toggleSort("cycle_lost")}>
                Cycle L
                {sortIndicator("cycle_lost")}
              </th>
              <th className={`${thClass} w-[55px] text-right`} onClick={() => toggleSort("age")}>
                Age
                {sortIndicator("age")}
              </th>
            </tr>
          </thead>
          <tbody>
            {repRows.length ? (
              orderedManagerIds
                .filter((mid) => (repsByManager.get(mid) || []).length)
                .map((mid) => {
                  const repsForMgr = sortedRepsByManager.get(mid) || [];
                  const mgr = managerRows.find((m) => String(m.manager_id || "") === String(mid || "")) || null;
                  const managerLabel =
                    mgr?.manager_name || (mid ? managerNameById.get(mid) || `Manager ${mid}` : "(Unassigned)");
                  return (
                    <Fragment key={`team:${mid || "unassigned"}`}>
                      <tr
                        key={`mgr:${mid || "unassigned"}`}
                        className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] text-[color:var(--sf-text-primary)]"
                      >
                        <td className="px-2 py-2 font-semibold">
                          {managerLabel} <span className="text-xs font-normal text-[color:var(--sf-text-secondary)]">(team)</span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono">{fmtMoney(mgr?.quota ?? 0)}</td>
                        <td className="px-2 py-2 text-right font-mono">{fmtMoney(mgr?.won_amount ?? 0)}</td>
                        <td className="px-2 py-2 text-right font-mono">{fmtPct(mgr?.attainment ?? null)}</td>
                        <td className="px-2 py-2 text-right font-mono">—</td>
                        <td className="px-2 py-2 text-right font-mono">{fmtMoney(mgr?.active_amount ?? 0)}</td>
                        <td className="px-2 py-2 text-right font-mono">{fmtPct(mgr?.win_rate ?? null)}</td>
                        <td className="px-2 py-2 text-right font-mono">—</td>
                        <td className="px-2 py-2 text-right font-mono">{fmtPct(mgr?.partner_contribution ?? null)}</td>
                        <td className="px-2 py-2 text-right font-mono">—</td>
                        <td className="px-2 py-2 text-right font-mono">—</td>
                        <td className="px-2 py-2 text-right font-mono">—</td>
                      </tr>
                      {repsForMgr.map((r) => (
                        <tr
                          key={`rep:${mid || "unassigned"}:${r.rep_id}`}
                          className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] text-[color:var(--sf-text-primary)]"
                        >
                          <td className="px-2 py-2 font-medium">{r.rep_name}</td>
                          <td className="px-2 py-2 text-right font-mono">{fmtMoney(r.quota)}</td>
                          <td className="px-2 py-2 text-right font-mono">
                            {fmtMoney(r.won_amount)}{" "}
                            <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(r.won_count)})</span>
                          </td>
                          <td className="px-2 py-2 text-right font-mono">{fmtPct(r.attainment)}</td>
                          <td className="px-2 py-2 text-right font-mono">
                            {r.qoq_attainment_delta == null ? "—" : fmtPct(r.qoq_attainment_delta)}
                          </td>
                          <td className="px-2 py-2 text-right font-mono">{fmtMoney(r.active_amount)}</td>
                          <td className="px-2 py-2 text-right font-mono">{fmtPct(r.win_rate)}</td>
                          <td className="px-2 py-2 text-right font-mono">{fmtMoney(r.aov)}</td>
                          <td className="px-2 py-2 text-right font-mono">{fmtPct(r.partner_contribution)}</td>
                          <td className="px-2 py-2 text-right font-mono">
                            {r.avg_days_won == null ? "—" : String(Math.round(r.avg_days_won))}
                          </td>
                          <td className="px-2 py-2 text-right font-mono">
                            {r.avg_days_lost == null ? "—" : String(Math.round(r.avg_days_lost))}
                          </td>
                          <td className="px-2 py-2 text-right font-mono">
                            {r.avg_days_active == null ? "—" : String(Math.round(r.avg_days_active))}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })
            ) : (
              <tr>
                <td colSpan={12} className="px-2 py-6 text-center text-[color:var(--sf-text-disabled)]">
                  No rep data found for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
