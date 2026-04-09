import "server-only";

import type { AuthUser } from "./auth";
import { getHealthAveragesByRepByPeriods } from "./analyticsHealth";
import { getQuotaByRepPeriod, getRepKpisByPeriod } from "./executiveRepKpis";
import { getMeddpiccAveragesByRepByPeriods } from "./meddpiccHealth";
import { getChannelTerritoryRepIds } from "./channelTerritoryScope";
import { pool } from "./pool";
import { getScopedRepDirectory } from "./repScope";
import { HIERARCHY, isChannelRole } from "./roleHelpers";

type BuilderDirRow = {
  id: number;
  name: string;
  manager_rep_id: number | null;
  hierarchy_level: number | null;
};

function buildDirectoryInScope(
  repDirectory: { id: number; name: string; manager_rep_id: number | null; hierarchy_level?: number | null }[]
): BuilderDirRow[] {
  const filtered: BuilderDirRow[] = repDirectory
    .map((r) => ({
      id: r.id,
      name: r.name,
      manager_rep_id: r.manager_rep_id ?? null,
      hierarchy_level: Number.isFinite(Number(r.hierarchy_level)) ? Number(r.hierarchy_level) : null,
    }))
    .filter((r) => r.hierarchy_level != null && r.hierarchy_level >= HIERARCHY.EXEC_MANAGER && r.hierarchy_level <= HIERARCHY.REP);

  const execs = filtered
    .filter((r) => r.hierarchy_level === HIERARCHY.EXEC_MANAGER)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  const managers = filtered
    .filter((r) => r.hierarchy_level === HIERARCHY.MANAGER)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  const reps = filtered
    .filter((r) => r.hierarchy_level === HIERARCHY.REP)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

  const execIds = new Set<number>(execs.map((e) => e.id));
  const managerIds = new Set<number>(managers.map((m) => m.id));

  const managersByExecId = new Map<number, BuilderDirRow[]>();
  const orphanManagers: BuilderDirRow[] = [];
  for (const m of managers) {
    if (m.manager_rep_id != null && execIds.has(m.manager_rep_id)) {
      const arr = managersByExecId.get(m.manager_rep_id) || [];
      arr.push(m);
      managersByExecId.set(m.manager_rep_id, arr);
    } else {
      orphanManagers.push(m);
    }
  }

  const repsByManagerId = new Map<number, BuilderDirRow[]>();
  const orphanReps: BuilderDirRow[] = [];
  for (const r of reps) {
    if (r.manager_rep_id != null && managerIds.has(r.manager_rep_id)) {
      const arr = repsByManagerId.get(r.manager_rep_id) || [];
      arr.push(r);
      repsByManagerId.set(r.manager_rep_id, arr);
    } else {
      orphanReps.push(r);
    }
  }

  const out: BuilderDirRow[] = [];
  for (const exec of execs) {
    out.push({
      id: exec.id,
      name: exec.name,
      manager_rep_id: exec.manager_rep_id ?? null,
      hierarchy_level: exec.hierarchy_level,
    });

    const execManagers = (managersByExecId.get(exec.id) || []).slice();
    execManagers.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

    for (const mgr of execManagers) {
      out.push({
        id: mgr.id,
        name: mgr.name,
        manager_rep_id: mgr.manager_rep_id ?? null,
        hierarchy_level: mgr.hierarchy_level,
      });

      const mgrReps = (repsByManagerId.get(mgr.id) || []).slice();
      mgrReps.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

      for (const rep of mgrReps) {
        out.push({
          id: rep.id,
          name: rep.name,
          manager_rep_id: rep.manager_rep_id ?? null,
          hierarchy_level: rep.hierarchy_level,
        });
      }
    }
  }

  orphanManagers.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  for (const mgr of orphanManagers) {
    out.push({
      id: mgr.id,
      name: mgr.name,
      manager_rep_id: mgr.manager_rep_id ?? null,
      hierarchy_level: mgr.hierarchy_level,
    });

    const mgrReps = (repsByManagerId.get(mgr.id) || []).slice();
    mgrReps.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
    for (const rep of mgrReps) {
      out.push({
        id: rep.id,
        name: rep.name,
        manager_rep_id: rep.manager_rep_id ?? null,
        hierarchy_level: rep.hierarchy_level,
      });
    }
  }

  orphanReps.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  for (const rep of orphanReps) {
    out.push({
      id: rep.id,
      name: rep.name,
      manager_rep_id: rep.manager_rep_id ?? null,
      hierarchy_level: rep.hierarchy_level,
    });
  }

  return out;
}

/**
 * Loads report-builder rep rows for the executive dashboard / report builder API.
 * Mirrors the pipeline in `dashboard/executive/page.tsx`.
 */
export async function loadReportBuilderRepRowsForUser(args: {
  orgId: number;
  user: AuthUser;
  periodId: string;
}): Promise<{ repRows: any[]; periodLabel: string }> {
  const { orgId, user, periodId } = args;
  const selectedPeriodId = String(periodId || "").trim();
  if (!selectedPeriodId) {
    return { repRows: [], periodLabel: "—" };
  }

  const scope = await getScopedRepDirectory({
    orgId,
    user,
  }).catch(() => ({
    repDirectory: [] as { id: number; name: string; manager_rep_id: number | null; hierarchy_level?: number | null }[],
    allowedRepIds: null as number[] | null,
    myRepId: null as number | null,
  }));

  let visibleRepIds: number[];
  let repDirectoryForBuilder: typeof scope.repDirectory;

  if (isChannelRole(user)) {
    const channelScope = await getChannelTerritoryRepIds({
      orgId,
      channelUserId: user.id,
    }).catch(() => ({ repIds: [] as number[], partnerNames: [] as string[] }));
    visibleRepIds = channelScope.repIds.filter((id) => Number.isFinite(id) && id > 0);
    const allowed = new Set(visibleRepIds);
    repDirectoryForBuilder = scope.repDirectory.filter((r) => allowed.has(r.id));
  } else {
    visibleRepIds =
      scope.allowedRepIds !== null && scope.allowedRepIds.length > 0
        ? scope.allowedRepIds
        : scope.repDirectory.map((r) => r.id).filter((n) => Number.isFinite(n) && n > 0);
    repDirectoryForBuilder = scope.repDirectory;
  }

  if (visibleRepIds.length === 0) {
    return { repRows: [], periodLabel: "—" };
  }

  const directoryInScope = buildDirectoryInScope(repDirectoryForBuilder);

  const { rows: periodRows } = await pool.query<{ period_name: string | null }>(
    `SELECT period_name FROM quota_periods WHERE org_id = $1::bigint AND id = $2::bigint LIMIT 1`,
    [orgId, selectedPeriodId]
  );
  const periodLabel = periodRows?.[0]?.period_name?.trim() || "Current Period";

  const repIdsFilter = visibleRepIds;
  const periodIds = [String(selectedPeriodId)];
  const [repKpisRows, quotaByRepPeriod, repHealthRows, meddpiccRows] = await Promise.all([
    getRepKpisByPeriod({ orgId, periodIds, repIds: repIdsFilter }),
    getQuotaByRepPeriod({ orgId, quotaPeriodIds: periodIds, repIds: repIdsFilter }),
    getHealthAveragesByRepByPeriods({
      orgId,
      periodIds,
      repIds: repIdsFilter,
      dateStart: null,
      dateEnd: null,
    }),
    getMeddpiccAveragesByRepByPeriods({
      orgId,
      periodIds,
      repIds: repIdsFilter,
      dateStart: null,
      dateEnd: null,
    }),
  ]);

  const quotaByRep = new Map<string, number>();
  for (const q of quotaByRepPeriod) {
    if (String(q.quota_period_id) === String(selectedPeriodId)) {
      quotaByRep.set(String(q.rep_id), Number(q.quota_amount || 0) || 0);
    }
  }

  const healthByRepId = new Map<string, any>();
  for (const r of repHealthRows || []) healthByRepId.set(String((r as any).rep_id), r);

  const meddpiccByRepId = new Map<string, any>();
  for (const r of meddpiccRows || []) meddpiccByRepId.set(String((r as any).rep_id), r);

  const kpisByRepId = new Map<string, any>();
  for (const c of repKpisRows || []) {
    if (String(c.quota_period_id) === String(selectedPeriodId)) {
      kpisByRepId.set(String((c as any).rep_id), c);
    }
  }

  const rbRepIdToManagerId = new Map<string, string>();
  const rbManagerNameById = new Map<string, string>();
  for (const r of directoryInScope) {
    rbRepIdToManagerId.set(String(r.id), r.manager_rep_id == null ? "" : String(r.manager_rep_id));
  }
  for (const r of directoryInScope) {
    if (r.manager_rep_id != null) {
      const mid = String(r.manager_rep_id);
      if (!rbManagerNameById.has(mid)) {
        const m = directoryInScope.find((x) => String(x.id) === mid);
        rbManagerNameById.set(mid, m ? m.name : `Manager ${mid}`);
      }
    }
  }

  function safeDivRb(n: number, d: number) {
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
    return n / d;
  }

  let reportBuilderRepRows = directoryInScope.map((opt: any) => {
    const rep_id = String(opt.id);
    const c: any = kpisByRepId.get(rep_id) || null;
    const quota = quotaByRep.get(rep_id) || 0;
    const won_amount = c != null && c.won_amount != null ? Number(c.won_amount) : 0;
    const won_count = c != null && c.won_count != null ? Number(c.won_count) : 0;
    const lost_count = c != null && c.lost_count != null ? Number(c.lost_count) : 0;
    const active_amount = c != null && c.active_amount != null ? Number(c.active_amount) : 0;
    const total_count = c != null && c.total_count != null ? Number(c.total_count) : 0;
    const manager_id = rbRepIdToManagerId.get(rep_id) || "";
    const manager_name = manager_id ? rbManagerNameById.get(manager_id) || `Manager ${manager_id}` : "(Unassigned)";
    const mh: any = meddpiccByRepId.get(rep_id) || null;

    const commit_amount = c != null && c.commit_amount != null ? Number(c.commit_amount) : 0;
    const best_amount = c != null && c.best_amount != null ? Number(c.best_amount) : 0;
    const pipeline_amount = c != null && c.pipeline_amount != null ? Number(c.pipeline_amount) : 0;
    const mixDen = pipeline_amount + best_amount + commit_amount + won_amount;

    return {
      rep_id,
      rep_name: String(opt?.name || "").trim() || String(c?.rep_name || "").trim() || `Rep ${rep_id}`,
      manager_id,
      manager_name,
      avg_health_all: healthByRepId.get(rep_id)?.avg_health_all ?? null,
      avg_health_commit: healthByRepId.get(rep_id)?.avg_health_commit ?? null,
      avg_health_best: healthByRepId.get(rep_id)?.avg_health_best ?? null,
      avg_health_pipeline: healthByRepId.get(rep_id)?.avg_health_pipeline ?? null,
      avg_health_won: healthByRepId.get(rep_id)?.avg_health_won ?? null,
      avg_health_closed: healthByRepId.get(rep_id)?.avg_health_closed ?? null,
      avg_pain: mh?.avg_pain ?? null,
      avg_metrics: mh?.avg_metrics ?? null,
      avg_champion: mh?.avg_champion ?? null,
      avg_eb: mh?.avg_eb ?? null,
      avg_competition: mh?.avg_competition ?? null,
      avg_criteria: mh?.avg_criteria ?? null,
      avg_process: mh?.avg_process ?? null,
      avg_paper: mh?.avg_paper ?? null,
      avg_timing: mh?.avg_timing ?? null,
      avg_budget: mh?.avg_budget ?? null,
      quota,
      total_count,
      won_amount,
      won_count,
      lost_count,
      active_amount,
      commit_amount,
      best_amount,
      pipeline_amount,
      created_amount: 0,
      created_count: 0,
      win_rate: safeDivRb(won_count, won_count + lost_count),
      opp_to_win: safeDivRb(won_count, total_count),
      aov: safeDivRb(won_amount, won_count),
      attainment: safeDivRb(won_amount, quota),
      commit_coverage: safeDivRb(commit_amount, quota),
      best_coverage: safeDivRb(best_amount, quota),
      partner_contribution: safeDivRb(
        c != null && c.partner_closed_amount != null ? Number(c.partner_closed_amount) : 0,
        c != null && c.closed_amount != null ? Number(c.closed_amount) : 0
      ),
      partner_win_rate: safeDivRb(
        c != null && c.partner_won_count != null ? Number(c.partner_won_count) : 0,
        c != null && c.partner_closed_count != null ? Number(c.partner_closed_count) : 0
      ),
      avg_days_won: c?.avg_days_won == null ? null : Number(c.avg_days_won),
      avg_days_lost: c?.avg_days_lost == null ? null : Number(c.avg_days_lost),
      avg_days_active: c?.avg_days_active == null ? null : Number(c.avg_days_active),
      mix_pipeline: safeDivRb(pipeline_amount, mixDen),
      mix_best: safeDivRb(best_amount, mixDen),
      mix_commit: safeDivRb(commit_amount, mixDen),
      mix_won: safeDivRb(won_amount, mixDen),
    };
  });

  reportBuilderRepRows.sort(
    (a: any, b: any) =>
      (b.won_amount != null ? Number(b.won_amount) : 0) - (a.won_amount != null ? Number(a.won_amount) : 0) ||
      String(a.rep_name).localeCompare(String(b.rep_name))
  );

  return { repRows: reportBuilderRepRows, periodLabel };
}
