"use client";

import { Fragment } from "react";

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
  manager_id: string;
  manager_name: string;
  quota: number;
  total_count: number;
  won_amount: number;
  won_count: number;
  lost_count: number;
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
  quota: number;
  won_amount: number;
  active_amount: number;
  attainment: number | null;
  win_rate: number | null;
  partner_contribution: number | null;
};

type SortKey = "attainment" | "won" | "pipeline" | "win_rate" | "aov";

export function RepManagerComparisonPanel(props: {
  repRows: RepManagerRepRow[];
  managerRows: RepManagerManagerRow[];
  periodName?: string;
  sortKey?: SortKey;
}) {
  const { repRows, managerRows, periodName = "", sortKey = "attainment" } = props;

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

  const sortHighlight = (k: SortKey) => (sortKey === k ? "text-yellow-700" : "");
  const sortHighlightCell = (k: SortKey) => (sortKey === k ? "bg-yellow-50 text-black" : "");

  return (
    <div className="space-y-3">
      {periodName ? (
        <p className="text-xs text-[color:var(--sf-text-secondary)]">
          Quarter-scoped by <span className="font-mono">close_date</span> in {periodName}. Won/Lost/Open from{" "}
          <span className="font-mono">forecast_stage</span> only.
        </p>
      ) : null}
      <div className="overflow-auto rounded-md border border-[color:var(--sf-border)]">
        <table className="w-full min-w-[1200px] text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">rep</th>
              <th className="px-4 py-3 text-right">quota</th>
              <th className={`px-4 py-3 text-right ${sortHighlight("won")}`}>won</th>
              <th className={`px-4 py-3 text-right ${sortHighlight("attainment")}`}>attainment</th>
              <th className="px-4 py-3 text-right">QoQ Δ attn</th>
              <th className={`px-4 py-3 text-right ${sortHighlight("pipeline")}`}>pipeline</th>
              <th className={`px-4 py-3 text-right ${sortHighlight("win_rate")}`}>win rate</th>
              <th className={`px-4 py-3 text-right ${sortHighlight("aov")}`}>AOV</th>
              <th className="px-4 py-3 text-right">partner %</th>
              <th className="px-4 py-3 text-right">cycle (won)</th>
              <th className="px-4 py-3 text-right">cycle (lost)</th>
              <th className="px-4 py-3 text-right">age (active)</th>
            </tr>
          </thead>
          <tbody>
            {repRows.length ? (
              orderedManagerIds
                .filter((mid) => (repsByManager.get(mid) || []).length)
                .map((mid) => {
                  const repsForMgr = (repsByManager.get(mid) || []).slice();
                  const mgr = managerRows.find((m) => String(m.manager_id || "") === String(mid || "")) || null;
                  const managerLabel =
                    mgr?.manager_name || (mid ? managerNameById.get(mid) || `Manager ${mid}` : "(Unassigned)");
                  return (
                    <Fragment key={`team:${mid || "unassigned"}`}>
                      <tr
                        key={`mgr:${mid || "unassigned"}`}
                        className="border-t-2 border-yellow-300 bg-yellow-50 text-black"
                      >
                        <td className="px-4 py-3 font-semibold">
                          {managerLabel} <span className="text-xs font-normal text-[color:var(--sf-text-secondary)]">(team)</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(mgr?.quota ?? 0)}</td>
                        <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("won")}`}>
                          {fmtMoney(mgr?.won_amount ?? 0)}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("attainment")}`}>
                          {fmtPct(mgr?.attainment ?? null)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">—</td>
                        <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("pipeline")}`}>
                          {fmtMoney(mgr?.active_amount ?? 0)}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("win_rate")}`}>
                          {fmtPct(mgr?.win_rate ?? null)}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("aov")}`}>—</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {fmtPct(mgr?.partner_contribution ?? null)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">—</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">—</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">—</td>
                      </tr>
                      {repsForMgr.map((r) => (
                        <tr
                          key={`rep:${mid || "unassigned"}:${r.rep_id}`}
                          className="border-t border-[color:var(--sf-border)] text-[color:var(--sf-text-primary)]"
                        >
                          <td className="px-4 py-3 font-medium border-l-4 border-yellow-200">{r.rep_name}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(r.quota)}</td>
                          <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("won")}`}>
                            {fmtMoney(r.won_amount)}{" "}
                            <span className="text-[color:var(--sf-text-secondary)]">({fmtNum(r.won_count)})</span>
                          </td>
                          <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("attainment")}`}>
                            {fmtPct(r.attainment)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {r.qoq_attainment_delta == null ? "—" : fmtPct(r.qoq_attainment_delta)}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("pipeline")}`}>
                            {fmtMoney(r.active_amount)}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("win_rate")}`}>
                            {fmtPct(r.win_rate)}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono text-xs ${sortHighlightCell("aov")}`}>
                            {fmtMoney(r.aov)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {fmtPct(r.partner_contribution)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {r.avg_days_won == null ? "—" : String(Math.round(r.avg_days_won))}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {r.avg_days_lost == null ? "—" : String(Math.round(r.avg_days_lost))}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {r.avg_days_active == null ? "—" : String(Math.round(r.avg_days_active))}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })
            ) : (
              <tr>
                <td colSpan={12} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
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
