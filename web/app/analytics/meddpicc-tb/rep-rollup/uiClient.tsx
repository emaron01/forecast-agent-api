"use client";

import { Fragment, useMemo, useState } from "react";

export type RepRollupRow = {
  stage_group: string; // Commit | Best Case | Pipeline | Closed Won | Closed Lost | Closed
  forecast_stage_norm: string; // raw normalized string (debug)
  manager_id: string;
  manager_name: string;
  rep_id: string;
  rep_name: string;
  opp_count: number;
  avg_health_score: number | null; // 0-30
  avg_pain: number | null;
  avg_metrics: number | null;
  avg_champion: number | null;
  avg_eb: number | null;
  avg_competition: number | null;
  avg_criteria: number | null;
  avg_process: number | null;
  avg_paper: number | null;
  avg_timing: number | null;
  avg_budget: number | null;
};

function safeNum(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function computeAiStageFromAvgHealth(avgHealthScore: number | null, stageGroup: string) {
  const sg = String(stageGroup || "");
  if (sg === "Closed Won") return "Won";
  if (sg === "Closed Lost") return "Lost";
  if (sg === "Closed") return "Closed";
  const n = Number(avgHealthScore);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 24) return "Commit";
  if (n >= 18) return "Best Case";
  return "Pipeline";
}

function scoreColorClassFromAvg(avg: number | null) {
  if (avg == null || !Number.isFinite(avg)) return "text-[color:var(--sf-text-disabled)] bg-[color:var(--sf-surface-alt)]";
  // Convert avg to nearest score bucket (1/2/3), then apply score color rules.
  const bucket = avg >= 2.75 ? 3 : avg >= 1.75 ? 2 : 1;
  return bucket >= 3
    ? "text-[#2ECC71] bg-[#2ECC71]/10"
    : bucket >= 2
      ? "text-[#F1C40F] bg-[#F1C40F]/10"
      : "text-[#E74C3C] bg-[#E74C3C]/10";
}

function scoreCell(avg: number | null) {
  const v = avg == null || !Number.isFinite(avg) ? null : avg;
  return (
    <span className={`inline-flex min-w-[56px] items-center justify-center rounded-md px-2 py-1 text-xs font-semibold ${scoreColorClassFromAvg(v)}`}>
      {v == null ? "—" : v.toFixed(1)}
    </span>
  );
}

function fmtNum(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString();
}

function fmtHealth(avg: number | null) {
  const v = avg == null || !Number.isFinite(avg) ? null : avg;
  if (v == null) return "—";
  return `${v.toFixed(1)}/30`;
}

type SortKey = "opp_count" | "health" | "pain" | "metrics" | "champion" | "eb" | "competition" | "criteria" | "process" | "paper" | "timing" | "budget";

export function MeddpiccRepRollupClient(props: { rows: RepRollupRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("opp_count");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const stageOrder = (s: string) => {
    const k = String(s || "");
    if (k === "Commit") return 1;
    if (k === "Best Case") return 2;
    if (k === "Pipeline") return 3;
    if (k === "Closed Won") return 4;
    if (k === "Closed Lost") return 5;
    if (k === "Closed") return 6;
    return 99;
  };

  const grouped = useMemo(() => {
    const byStage = new Map<string, RepRollupRow[]>();
    for (const r of props.rows || []) {
      const k = String(r.stage_group || "Pipeline");
      const arr = byStage.get(k) || [];
      arr.push(r);
      byStage.set(k, arr);
    }

    const stages = Array.from(byStage.keys()).sort((a, b) => stageOrder(a) - stageOrder(b) || a.localeCompare(b));
    const out: Array<{ stage: string; rows: RepRollupRow[] }> = [];

    const getVal = (r: RepRollupRow) => {
      switch (sortKey) {
        case "health":
          return safeNum(r.avg_health_score);
        case "pain":
          return safeNum(r.avg_pain);
        case "metrics":
          return safeNum(r.avg_metrics);
        case "champion":
          return safeNum(r.avg_champion);
        case "eb":
          return safeNum(r.avg_eb);
        case "competition":
          return safeNum(r.avg_competition);
        case "criteria":
          return safeNum(r.avg_criteria);
        case "process":
          return safeNum(r.avg_process);
        case "paper":
          return safeNum(r.avg_paper);
        case "timing":
          return safeNum(r.avg_timing);
        case "budget":
          return safeNum(r.avg_budget);
        default:
          return safeNum(r.opp_count);
      }
    };

    const dirMult = sortDir === "asc" ? 1 : -1;

    for (const st of stages) {
      const arr = (byStage.get(st) || []).slice();
      // Sort reps inside stage (manager -> rep, but ranked by chosen metric)
      arr.sort((a, b) => {
        // keep within manager groups, but allow managers to float by metric (via their total rows later)
        const am = String(a.manager_name || "");
        const bm = String(b.manager_name || "");
        if (am !== bm) return am.localeCompare(bm);
        const av = getVal(a);
        const bv = getVal(b);
        if (bv !== av) return (bv - av) * dirMult;
        return String(a.rep_name || "").localeCompare(String(b.rep_name || ""));
      });
      out.push({ stage: st, rows: arr });
    }
    return out;
  }, [props.rows, sortDir, sortKey]);

  const managerRollupsByStage = useMemo(() => {
    const byStage = new Map<string, Map<string, { manager_name: string; opp_count: number; avg_health_score: number | null; avg_pain: number | null; avg_metrics: number | null; avg_champion: number | null; avg_eb: number | null; avg_competition: number | null; avg_criteria: number | null; avg_process: number | null; avg_paper: number | null; avg_timing: number | null; avg_budget: number | null }>>();
    for (const r of props.rows || []) {
      const st = String(r.stage_group || "Pipeline");
      const mid = String(r.manager_id || "");
      const stageMap = byStage.get(st) || new Map();
      const cur = stageMap.get(mid) || {
        manager_name: String(r.manager_name || "(Unassigned)"),
        opp_count: 0,
        avg_health_score: null,
        avg_pain: null,
        avg_metrics: null,
        avg_champion: null,
        avg_eb: null,
        avg_competition: null,
        avg_criteria: null,
        avg_process: null,
        avg_paper: null,
        avg_timing: null,
        avg_budget: null,
      };

      const w = Math.max(0, safeNum(r.opp_count));
      const wavg = (prev: number | null, next: number | null) => {
        const p = prev == null ? null : Number(prev);
        const n = next == null ? null : Number(next);
        if (!Number.isFinite(n as any)) return p;
        if (p == null || !Number.isFinite(p as any) || cur.opp_count <= 0) return n;
        return (p * cur.opp_count + (n as number) * w) / (cur.opp_count + w);
      };

      cur.avg_health_score = wavg(cur.avg_health_score, r.avg_health_score);
      cur.avg_pain = wavg(cur.avg_pain, r.avg_pain);
      cur.avg_metrics = wavg(cur.avg_metrics, r.avg_metrics);
      cur.avg_champion = wavg(cur.avg_champion, r.avg_champion);
      cur.avg_eb = wavg(cur.avg_eb, r.avg_eb);
      cur.avg_competition = wavg(cur.avg_competition, r.avg_competition);
      cur.avg_criteria = wavg(cur.avg_criteria, r.avg_criteria);
      cur.avg_process = wavg(cur.avg_process, r.avg_process);
      cur.avg_paper = wavg(cur.avg_paper, r.avg_paper);
      cur.avg_timing = wavg(cur.avg_timing, r.avg_timing);
      cur.avg_budget = wavg(cur.avg_budget, r.avg_budget);

      cur.opp_count += w;
      stageMap.set(mid, cur);
      byStage.set(st, stageMap);
    }
    return byStage;
  }, [props.rows]);

  return (
    <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Report</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Grouped by <span className="font-mono text-xs">Forecast Stage</span> and rolled up to manager.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Sort</label>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as any)}
              className="h-[40px] min-w-[210px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              <option value="opp_count">Opportunity Count</option>
              <option value="health">MEDDPICC+TB (Avg Total)</option>
              <option value="pain">Pain</option>
              <option value="metrics">Metrics</option>
              <option value="champion">Champion</option>
              <option value="eb">Economic Buyer</option>
              <option value="competition">Competition</option>
              <option value="criteria">Decision Criteria</option>
              <option value="process">Decision Process</option>
              <option value="paper">Paper Process</option>
              <option value="timing">Timing</option>
              <option value="budget">Budget</option>
            </select>
          </div>
          <div className="grid gap-1">
            <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Dir</label>
            <select
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value as any)}
              className="h-[40px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
        <table className="w-full min-w-[1500px] text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-3 py-3">Manager</th>
              <th className="px-3 py-3">Sales Rep</th>
              <th className="px-3 py-3 text-right">Opp Count</th>
              <th className="px-3 py-3">Forecast Stage</th>
              <th className="px-3 py-3">AI Stage</th>
              <th className="px-3 py-3 text-right">MEDDPICC+TB</th>
              <th className="px-2 py-3 text-center">Pain</th>
              <th className="px-2 py-3 text-center">Metrics</th>
              <th className="px-2 py-3 text-center">Champion</th>
              <th className="px-2 py-3 text-center">EB</th>
              <th className="px-2 py-3 text-center">Comp</th>
              <th className="px-2 py-3 text-center">Criteria</th>
              <th className="px-2 py-3 text-center">Process</th>
              <th className="px-2 py-3 text-center">Paper</th>
              <th className="px-2 py-3 text-center">Timing</th>
              <th className="px-2 py-3 text-center">Budget</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((g) => {
              const stageManagers = managerRollupsByStage.get(g.stage) || new Map();
              const rowsByManager = new Map<string, RepRollupRow[]>();
              for (const r of g.rows) {
                const k = String(r.manager_id || "");
                const arr = rowsByManager.get(k) || [];
                arr.push(r);
                rowsByManager.set(k, arr);
              }
              const managerIds = Array.from(rowsByManager.keys()).sort((a, b) => {
                const an = stageManagers.get(a)?.manager_name || "";
                const bn = stageManagers.get(b)?.manager_name || "";
                return an.localeCompare(bn);
              });

              return (
                <Fragment key={`stage:${g.stage}`}>
                  <tr className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                    <td colSpan={16} className="px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)]">
                      Forecast Stage: {g.stage}
                    </td>
                  </tr>

                  {managerIds.map((mid) => {
                    const mgr = stageManagers.get(mid) || null;
                    const members = rowsByManager.get(mid) || [];
                    return (
                      <Fragment key={`mgr:${g.stage}:${mid || "unassigned"}`}>
                        {mgr ? (
                          <tr className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
                            <td className="px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)]">{mgr.manager_name}</td>
                            <td className="px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)]">Manager Total</td>
                            <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">
                              {fmtNum(mgr.opp_count)}
                            </td>
                            <td className="px-3 py-2 text-xs text-[color:var(--sf-text-primary)]">{g.stage}</td>
                            <td className="px-3 py-2 text-xs text-[color:var(--sf-text-primary)]">
                              {computeAiStageFromAvgHealth(mgr.avg_health_score, g.stage)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">
                              {fmtHealth(mgr.avg_health_score)}
                            </td>
                            <td className="px-2 py-2 text-center">{scoreCell(mgr.avg_pain)}</td>
                            <td className="px-2 py-2 text-center">{scoreCell(mgr.avg_metrics)}</td>
                            <td className="px-2 py-2 text-center">{scoreCell(mgr.avg_champion)}</td>
                            <td className="px-2 py-2 text-center">{scoreCell(mgr.avg_eb)}</td>
                            <td className="px-2 py-2 text-center">{scoreCell(mgr.avg_competition)}</td>
                            <td className="px-2 py-2 text-center">{scoreCell(mgr.avg_criteria)}</td>
                            <td className="px-2 py-2 text-center">{scoreCell(mgr.avg_process)}</td>
                            <td className="px-2 py-2 text-center">{scoreCell(mgr.avg_paper)}</td>
                            <td className="px-2 py-2 text-center">{scoreCell(mgr.avg_timing)}</td>
                            <td className="px-2 py-2 text-center">{scoreCell(mgr.avg_budget)}</td>
                          </tr>
                        ) : null}

                        {members.map((r) => (
                          <tr key={`rep:${g.stage}:${mid}:${r.rep_id}`} className="border-t border-[color:var(--sf-border)]">
                            <td className="px-3 py-3 text-xs text-[color:var(--sf-text-secondary)]">{r.manager_name}</td>
                            <td className="px-3 py-3 font-medium text-[color:var(--sf-text-primary)]">{r.rep_name}</td>
                            <td className="px-3 py-3 text-right font-mono text-xs text-[color:var(--sf-text-primary)]">{fmtNum(r.opp_count)}</td>
                            <td className="px-3 py-3 text-xs text-[color:var(--sf-text-primary)]">{g.stage}</td>
                            <td className="px-3 py-3 text-xs text-[color:var(--sf-text-primary)]">
                              {computeAiStageFromAvgHealth(r.avg_health_score, g.stage)}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-xs text-[color:var(--sf-text-primary)]">{fmtHealth(r.avg_health_score)}</td>
                            <td className="px-2 py-3 text-center">{scoreCell(r.avg_pain)}</td>
                            <td className="px-2 py-3 text-center">{scoreCell(r.avg_metrics)}</td>
                            <td className="px-2 py-3 text-center">{scoreCell(r.avg_champion)}</td>
                            <td className="px-2 py-3 text-center">{scoreCell(r.avg_eb)}</td>
                            <td className="px-2 py-3 text-center">{scoreCell(r.avg_competition)}</td>
                            <td className="px-2 py-3 text-center">{scoreCell(r.avg_criteria)}</td>
                            <td className="px-2 py-3 text-center">{scoreCell(r.avg_process)}</td>
                            <td className="px-2 py-3 text-center">{scoreCell(r.avg_paper)}</td>
                            <td className="px-2 py-3 text-center">{scoreCell(r.avg_timing)}</td>
                            <td className="px-2 py-3 text-center">{scoreCell(r.avg_budget)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
            {!props.rows.length ? (
              <tr>
                <td colSpan={16} className="px-4 py-8 text-center text-sm text-[color:var(--sf-text-disabled)]">
                  No opportunities found for this period.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

