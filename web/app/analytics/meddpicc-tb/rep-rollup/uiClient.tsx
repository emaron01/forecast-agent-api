"use client";

import { Fragment, useMemo } from "react";

export type RepRollupRow = {
  stage_group: string; // Commit | Best Case | Pipeline | Closed Won | Closed Lost | Closed
  forecast_stage_norm: string; // raw normalized string (debug)
  executive_id: string;
  executive_name: string;
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

function fmtNum(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString();
}

function levelBadge(avg: number | null) {
  const n = avg == null ? null : Number(avg);
  if (n == null || !Number.isFinite(n) || n <= 0) {
    return (
      <span className="inline-flex min-w-[64px] items-center justify-center rounded-md bg-[color:var(--sf-surface-alt)] px-2 py-1 text-xs font-semibold text-[color:var(--sf-text-disabled)]">
        —
      </span>
    );
  }
  // Low (0-1), Medium (2), High (3) using existing agent score colors.
  const level = n >= 2.75 ? "High" : n >= 1.75 ? "Medium" : "Low";
  const cls =
    level === "High"
      ? "text-[#2ECC71] bg-[#2ECC71]/10"
      : level === "Medium"
        ? "text-[#F1C40F] bg-[#F1C40F]/10"
        : "text-[#E74C3C] bg-[#E74C3C]/10";
  return (
    <span className={`inline-flex min-w-[64px] items-center justify-center rounded-md px-2 py-1 text-xs font-semibold ${cls}`}>
      {level}
    </span>
  );
}

function healthPctFrom30(score: number | null) {
  const n = score == null ? null : Number(score);
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  const pct = Math.round((n / 30) * 100);
  return Math.max(0, Math.min(100, pct));
}

function healthColorClass(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-disabled)] bg-[color:var(--sf-surface-alt)]";
  if (pct >= 80) return "text-[#2ECC71] bg-[#2ECC71]/10";
  if (pct >= 50) return "text-[#F1C40F] bg-[#F1C40F]/10";
  return "text-[#E74C3C] bg-[#E74C3C]/10";
}

function healthBadge(avgHealthScore: number | null) {
  const pct = healthPctFrom30(avgHealthScore);
  return (
    <span className={`inline-flex min-w-[64px] items-center justify-center rounded-md px-2 py-1 text-xs font-semibold ${healthColorClass(pct)}`}>
      {pct == null ? "—" : `${pct}%`}
    </span>
  );
}

type StageKey = "Commit" | "Best Case" | "Pipeline" | "Closed Won" | "Closed Lost" | "Closed";

function stageOrder(s: string) {
  const k = String(s || "");
  if (k === "Commit") return 1;
  if (k === "Best Case") return 2;
  if (k === "Pipeline") return 3;
  if (k === "Closed Won") return 4;
  if (k === "Closed Lost") return 5;
  if (k === "Closed") return 6;
  return 99;
}

type Rollup = {
  opp_count: number;
  avg_health_score: number | null;
  avg_metrics: number | null;
  avg_eb: number | null;
  avg_criteria: number | null;
  avg_process: number | null;
  avg_pain: number | null;
  avg_champion: number | null;
  avg_competition: number | null;
  avg_timing: number | null;
  avg_budget: number | null;
};

function rollupWeighted(rows: RepRollupRow[]): Rollup {
  const sums: Record<string, { num: number; den: number }> = {};
  const add = (k: keyof Rollup, v: any, w: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    const cur = sums[String(k)] || { num: 0, den: 0 };
    cur.num += n * w;
    cur.den += w;
    sums[String(k)] = cur;
  };

  let opp = 0;
  for (const r of rows || []) {
    const w = Math.max(0, safeNum(r.opp_count));
    if (w <= 0) continue;
    opp += w;
    add("avg_health_score", r.avg_health_score, w);
    add("avg_metrics", r.avg_metrics, w);
    add("avg_eb", r.avg_eb, w);
    add("avg_criteria", r.avg_criteria, w);
    add("avg_process", r.avg_process, w);
    add("avg_pain", r.avg_pain, w);
    add("avg_champion", r.avg_champion, w);
    add("avg_competition", r.avg_competition, w);
    add("avg_timing", r.avg_timing, w);
    add("avg_budget", r.avg_budget, w);
  }

  const avg = (k: keyof Rollup) => {
    const s = sums[String(k)];
    if (!s || s.den <= 0) return null;
    return s.num / s.den;
  };

  return {
    opp_count: opp,
    avg_health_score: avg("avg_health_score"),
    avg_metrics: avg("avg_metrics"),
    avg_eb: avg("avg_eb"),
    avg_criteria: avg("avg_criteria"),
    avg_process: avg("avg_process"),
    avg_pain: avg("avg_pain"),
    avg_champion: avg("avg_champion"),
    avg_competition: avg("avg_competition"),
    avg_timing: avg("avg_timing"),
    avg_budget: avg("avg_budget"),
  };
}

export function MeddpiccRepRollupClient(props: { rows: RepRollupRow[] }) {
  const model = useMemo(() => {
    type RepGroup = {
      rep_id: string;
      rep_name: string;
      stages: Map<StageKey, RepRollupRow>;
      allRows: RepRollupRow[];
    };
    type ManagerGroup = { manager_id: string; manager_name: string; reps: Map<string, RepGroup>; allRows: RepRollupRow[] };
    type ExecGroup = { executive_id: string; executive_name: string; managers: Map<string, ManagerGroup>; allRows: RepRollupRow[] };

    const execs = new Map<string, ExecGroup>();
    for (const r of props.rows || []) {
      const eid = String(r.executive_id || "");
      const ex = execs.get(eid) || {
        executive_id: eid,
        executive_name: String(r.executive_name || "(Unassigned)"),
        managers: new Map(),
        allRows: [],
      };
      ex.allRows.push(r);

      const mid = String(r.manager_id || "");
      const mgr = ex.managers.get(mid) || {
        manager_id: mid,
        manager_name: String(r.manager_name || "(Unassigned)"),
        reps: new Map(),
        allRows: [],
      };
      mgr.allRows.push(r);

      const rid = String(r.rep_id || "");
      const rep = mgr.reps.get(rid) || {
        rep_id: rid,
        rep_name: String(r.rep_name || "(Unknown rep)"),
        stages: new Map(),
        allRows: [],
      };
      rep.allRows.push(r);
      const st = String(r.stage_group || "Pipeline") as StageKey;
      rep.stages.set(st, r);
      mgr.reps.set(rid, rep);
      ex.managers.set(mid, mgr);
      execs.set(eid, ex);
    }

    const execList = Array.from(execs.values()).sort((a, b) => a.executive_name.localeCompare(b.executive_name));
    for (const ex of execList) {
      const mgrList = Array.from(ex.managers.values()).sort((a, b) => a.manager_name.localeCompare(b.manager_name));
      // sort reps by name within each manager, then rehydrate maps for deterministic iteration
      ex.managers = new Map(
        mgrList.map((m) => {
          m.reps = new Map(Array.from(m.reps.entries()).sort(([, a], [, b]) => a.rep_name.localeCompare(b.rep_name)));
          return [m.manager_id, m] as const;
        })
      );
    }
    return execList;
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
      </div>

      <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
        <table className="w-full min-w-[1400px] text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-3 py-3">Sales Rep</th>
              <th className="px-3 py-3 text-right">Opp Count</th>
              <th className="px-3 py-3">Forecast Stage</th>
              <th className="px-2 py-3 text-center">Metrics</th>
              <th className="px-2 py-3 text-center">Economic buyer</th>
              <th className="px-2 py-3 text-center">Decision Criteria</th>
              <th className="px-2 py-3 text-center">Decision Process</th>
              <th className="px-2 py-3 text-center">Pain</th>
              <th className="px-2 py-3 text-center">Champ</th>
              <th className="px-2 py-3 text-center">Comp</th>
              <th className="px-2 py-3 text-center">Timing</th>
              <th className="px-2 py-3 text-center">Budget</th>
              <th className="px-3 py-3 text-center">Average Deal Health</th>
            </tr>
          </thead>
          <tbody>
            {model.map((ex) => {
              const exTotal = rollupWeighted(ex.allRows);
              return (
                <Fragment key={`exec:${ex.executive_id || "unassigned"}`}>
                  <tr className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                    <td colSpan={13} className="px-3 py-3 text-xs font-semibold text-[color:var(--sf-text-primary)]">
                      Executive: {ex.executive_name}
                    </td>
                  </tr>

                  <tr className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]/60">
                    <td className="px-3 py-3 text-xs font-semibold text-[color:var(--sf-text-primary)]">Executive total</td>
                    <td className="px-3 py-3 text-right font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">
                      {fmtNum(exTotal.opp_count)}
                    </td>
                    <td className="px-3 py-3 text-xs text-[color:var(--sf-text-secondary)]">—</td>
                    <td className="px-2 py-3 text-center">{levelBadge(exTotal.avg_metrics)}</td>
                    <td className="px-2 py-3 text-center">{levelBadge(exTotal.avg_eb)}</td>
                    <td className="px-2 py-3 text-center">{levelBadge(exTotal.avg_criteria)}</td>
                    <td className="px-2 py-3 text-center">{levelBadge(exTotal.avg_process)}</td>
                    <td className="px-2 py-3 text-center">{levelBadge(exTotal.avg_pain)}</td>
                    <td className="px-2 py-3 text-center">{levelBadge(exTotal.avg_champion)}</td>
                    <td className="px-2 py-3 text-center">{levelBadge(exTotal.avg_competition)}</td>
                    <td className="px-2 py-3 text-center">{levelBadge(exTotal.avg_timing)}</td>
                    <td className="px-2 py-3 text-center">{levelBadge(exTotal.avg_budget)}</td>
                    <td className="px-3 py-3 text-center">{healthBadge(exTotal.avg_health_score)}</td>
                  </tr>

                  {Array.from(ex.managers.values()).map((mgr) => {
                    const mgrTotal = rollupWeighted(mgr.allRows);
                    return (
                      <Fragment key={`mgr:${ex.executive_id}:${mgr.manager_id || "unassigned"}`}>
                        <tr className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                          <td colSpan={13} className="px-3 py-3 text-xs font-semibold text-[color:var(--sf-text-primary)]">
                            Manager: {mgr.manager_name}
                          </td>
                        </tr>

                        <tr className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]/40">
                          <td className="px-3 py-3 text-xs font-semibold text-[color:var(--sf-text-primary)]">Manager total</td>
                          <td className="px-3 py-3 text-right font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">
                            {fmtNum(mgrTotal.opp_count)}
                          </td>
                          <td className="px-3 py-3 text-xs text-[color:var(--sf-text-secondary)]">—</td>
                          <td className="px-2 py-3 text-center">{levelBadge(mgrTotal.avg_metrics)}</td>
                          <td className="px-2 py-3 text-center">{levelBadge(mgrTotal.avg_eb)}</td>
                          <td className="px-2 py-3 text-center">{levelBadge(mgrTotal.avg_criteria)}</td>
                          <td className="px-2 py-3 text-center">{levelBadge(mgrTotal.avg_process)}</td>
                          <td className="px-2 py-3 text-center">{levelBadge(mgrTotal.avg_pain)}</td>
                          <td className="px-2 py-3 text-center">{levelBadge(mgrTotal.avg_champion)}</td>
                          <td className="px-2 py-3 text-center">{levelBadge(mgrTotal.avg_competition)}</td>
                          <td className="px-2 py-3 text-center">{levelBadge(mgrTotal.avg_timing)}</td>
                          <td className="px-2 py-3 text-center">{levelBadge(mgrTotal.avg_budget)}</td>
                          <td className="px-3 py-3 text-center">{healthBadge(mgrTotal.avg_health_score)}</td>
                        </tr>

                        {Array.from(mgr.reps.values()).map((rep) => {
                          const repTotal = rollupWeighted(rep.allRows);
                          const stages = Array.from(rep.stages.keys()).sort(
                            (a, b) => stageOrder(a) - stageOrder(b) || a.localeCompare(b)
                          );
                          return (
                            <Fragment key={`rep:${ex.executive_id}:${mgr.manager_id}:${rep.rep_id || rep.rep_name}`}>
                              <tr className="border-t border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
                                <td className="px-3 py-3 text-xs font-semibold text-[color:var(--sf-text-primary)]">{rep.rep_name}</td>
                                <td className="px-3 py-3 text-right font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">
                                  {fmtNum(repTotal.opp_count)}
                                </td>
                                <td className="px-3 py-3 text-xs text-[color:var(--sf-text-secondary)]">Rep total</td>
                                <td className="px-2 py-3 text-center">{levelBadge(repTotal.avg_metrics)}</td>
                                <td className="px-2 py-3 text-center">{levelBadge(repTotal.avg_eb)}</td>
                                <td className="px-2 py-3 text-center">{levelBadge(repTotal.avg_criteria)}</td>
                                <td className="px-2 py-3 text-center">{levelBadge(repTotal.avg_process)}</td>
                                <td className="px-2 py-3 text-center">{levelBadge(repTotal.avg_pain)}</td>
                                <td className="px-2 py-3 text-center">{levelBadge(repTotal.avg_champion)}</td>
                                <td className="px-2 py-3 text-center">{levelBadge(repTotal.avg_competition)}</td>
                                <td className="px-2 py-3 text-center">{levelBadge(repTotal.avg_timing)}</td>
                                <td className="px-2 py-3 text-center">{levelBadge(repTotal.avg_budget)}</td>
                                <td className="px-3 py-3 text-center">{healthBadge(repTotal.avg_health_score)}</td>
                              </tr>

                              {stages.map((st) => {
                                const r = rep.stages.get(st)!;
                                return (
                                  <tr key={`stage:${ex.executive_id}:${mgr.manager_id}:${rep.rep_id}:${st}`} className="border-t border-[color:var(--sf-border)]">
                                    <td className="px-3 py-3 text-xs text-[color:var(--sf-text-secondary)]">&nbsp;</td>
                                    <td className="px-3 py-3 text-right font-mono text-xs text-[color:var(--sf-text-primary)]">{fmtNum(r.opp_count)}</td>
                                    <td className="px-3 py-3 text-xs text-[color:var(--sf-text-primary)]">{st}</td>
                                    <td className="px-2 py-3 text-center">{levelBadge(r.avg_metrics)}</td>
                                    <td className="px-2 py-3 text-center">{levelBadge(r.avg_eb)}</td>
                                    <td className="px-2 py-3 text-center">{levelBadge(r.avg_criteria)}</td>
                                    <td className="px-2 py-3 text-center">{levelBadge(r.avg_process)}</td>
                                    <td className="px-2 py-3 text-center">{levelBadge(r.avg_pain)}</td>
                                    <td className="px-2 py-3 text-center">{levelBadge(r.avg_champion)}</td>
                                    <td className="px-2 py-3 text-center">{levelBadge(r.avg_competition)}</td>
                                    <td className="px-2 py-3 text-center">{levelBadge(r.avg_timing)}</td>
                                    <td className="px-2 py-3 text-center">{levelBadge(r.avg_budget)}</td>
                                    <td className="px-3 py-3 text-center">{healthBadge(r.avg_health_score)}</td>
                                  </tr>
                                );
                              })}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
            {!props.rows.length ? (
              <tr>
                <td colSpan={13} className="px-4 py-8 text-center text-sm text-[color:var(--sf-text-disabled)]">
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

