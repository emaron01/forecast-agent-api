import type { RepManagerManagerRow, RepManagerRepRow } from "../app/components/dashboard/executive/RepManagerComparisonPanel";
import { getCreatedByRep, getQuotaByRepPeriod, getRepKpisByPeriod } from "./executiveRepKpis";
import type { RepDirectoryRow } from "./repScope";

export type BuildTeamRepSetArgs = {
  orgId: number;
  repDirectory: RepDirectoryRow[];
  viewerRepId: number | null;
  selectedPeriodId: string;
  comparePeriodIds: string[];
  prevPeriodId: string;
};

function safeDiv(n: number, d: number): number | null {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

/**
 * Single source for Team Performance and Coaching: rep rows + manager rollups from scoped
 * repDirectory (manager_rep_id chains only; KPI scope = all rep ids in directory).
 */
export async function buildTeamAndCoachingRepSet(args: BuildTeamRepSetArgs): Promise<{
  repRows: RepManagerRepRow[];
  managerRows: RepManagerManagerRow[];
}> {
  const { orgId, repDirectory, viewerRepId, selectedPeriodId, comparePeriodIds, prevPeriodId } = args;

  if (!selectedPeriodId || !comparePeriodIds.length) {
    return { repRows: [], managerRows: [] };
  }

  const teamRepIds = repDirectory.map((r) => r.id).filter((n) => Number.isFinite(n) && n > 0);
  const scopeRepIdsForKpi = teamRepIds.length > 0 ? teamRepIds : null;

  const [repKpisRows, createdByRepRows, quotaByRepPeriod] = await Promise.all([
    getRepKpisByPeriod({ orgId, periodIds: comparePeriodIds, repIds: scopeRepIdsForKpi }),
    getCreatedByRep({ orgId, periodIds: comparePeriodIds, repIds: scopeRepIdsForKpi }),
    getQuotaByRepPeriod({ orgId, quotaPeriodIds: comparePeriodIds, repIds: scopeRepIdsForKpi }),
  ]);

  const managerNameById = new Map<string, string>();
  for (const r of repDirectory) {
    const id = String(r.id);
    managerNameById.set(id, String(r.name || "").trim() || `Rep ${r.id}`);
  }

  const quotaByRepPeriodMap = new Map<string, number>();
  for (const q of quotaByRepPeriod) {
    const k = `${String(q.quota_period_id)}|${String(q.rep_id)}`;
    quotaByRepPeriodMap.set(k, Number(q.quota_amount || 0) || 0);
  }
  const repKpisByKey = new Map<string, (typeof repKpisRows)[number]>();
  for (const r of repKpisRows) {
    repKpisByKey.set(`${String(r.quota_period_id)}|${String(r.rep_id)}`, r);
  }
  const createdByKey = new Map<string, { created_amount: number; created_count: number }>();
  for (const r of createdByRepRows) {
    const k = `${String(r.quota_period_id)}|${String(r.rep_id)}`;
    createdByKey.set(k, {
      created_amount: Number((r as { created_amount?: number }).created_amount || 0) || 0,
      created_count: Number((r as { created_count?: number }).created_count || 0) || 0,
    });
  }

  const repIdsInData = new Set<string>();
  for (const r of repDirectory) repIdsInData.add(String(r.id));
  for (const r of repKpisRows) repIdsInData.add(String(r.rep_id));
  for (const q of quotaByRepPeriod) repIdsInData.add(String(q.rep_id));

  const repRowsBuild: RepManagerRepRow[] = [];
  for (const rep_id of repIdsInData) {
    const currK = `${selectedPeriodId}|${rep_id}`;
    const prevK = prevPeriodId ? `${prevPeriodId}|${rep_id}` : "";
    const c = repKpisByKey.get(currK) || null;
    const p = prevK ? repKpisByKey.get(prevK) || null : null;
    const quota = quotaByRepPeriodMap.get(currK) || 0;
    const prevQuotaForRep = prevK ? quotaByRepPeriodMap.get(prevK) || 0 : 0;

    const total_count = c ? Number((c as { total_count?: number }).total_count || 0) || 0 : 0;
    const won_amount = c ? Number(c.won_amount || 0) || 0 : 0;
    const won_count = c ? Number(c.won_count || 0) || 0 : 0;
    const active_amount = c ? Number(c.active_amount || 0) || 0 : 0;
    const lost_count = c ? Number((c as { lost_count?: number }).lost_count || 0) || 0 : 0;
    const lost_amount = c ? Number((c as { lost_amount?: number }).lost_amount || 0) || 0 : 0;
    const commit_amount = c ? Number((c as { commit_amount?: number }).commit_amount || 0) || 0 : 0;
    const best_amount = c ? Number((c as { best_amount?: number }).best_amount || 0) || 0 : 0;
    const pipeline_amount = c ? Number((c as { pipeline_amount?: number }).pipeline_amount || 0) || 0 : 0;
    const win_rate = c ? safeDiv(won_count, won_count + lost_count) : null;
    const opp_to_win = c ? safeDiv(won_count, total_count) : null;
    const aov = c ? safeDiv(won_amount, won_count) : null;
    const attainment = c ? safeDiv(won_amount, quota) : null;
    const partner_contribution = c
      ? safeDiv(Number(c.partner_closed_amount || 0) || 0, Number(c.closed_amount || 0) || 0)
      : null;
    const partner_win_rate = c
      ? safeDiv(
          Number((c as { partner_won_count?: number }).partner_won_count || 0) || 0,
          Number((c as { partner_closed_count?: number }).partner_closed_count || 0) || 0
        )
      : null;
    const commit_coverage = c ? safeDiv(commit_amount, quota) : null;
    const best_coverage = c ? safeDiv(best_amount, quota) : null;
    const prevAttainment = p ? safeDiv(Number(p.won_amount || 0) || 0, prevQuotaForRep) : null;

    const created = createdByKey.get(currK) || { created_amount: 0, created_count: 0 };
    const dirEntry = repDirectory.find((x) => String(x.id) === String(rep_id));
    const manager_id =
      dirEntry?.manager_rep_id != null && Number.isFinite(Number(dirEntry.manager_rep_id)) && Number(dirEntry.manager_rep_id) > 0
        ? String(dirEntry.manager_rep_id)
        : "";
    const manager_name = manager_id ? managerNameById.get(manager_id) || `Manager ${manager_id}` : "(Unassigned)";

    const mixDen = pipeline_amount + best_amount + commit_amount + won_amount;
    const mix_pipeline = safeDiv(pipeline_amount, mixDen);
    const mix_best = safeDiv(best_amount, mixDen);
    const mix_commit = safeDiv(commit_amount, mixDen);
    const mix_won = safeDiv(won_amount, mixDen);

    const rep_name =
      (c && String(c.rep_name || "").trim()) ||
      repDirectory.find((r) => String(r.id) === String(rep_id))?.name ||
      `Rep ${rep_id}`;

    repRowsBuild.push({
      rep_id: String(rep_id),
      rep_name,
      manager_id,
      manager_name,
      quota,
      total_count,
      won_amount,
      won_count,
      lost_count,
      lost_amount,
      active_amount,
      commit_amount,
      best_amount,
      pipeline_amount,
      created_amount: created.created_amount,
      created_count: created.created_count,
      win_rate,
      opp_to_win,
      aov,
      attainment,
      commit_coverage,
      best_coverage,
      partner_contribution,
      partner_win_rate,
      avg_days_won: c?.avg_days_won ?? null,
      avg_days_lost: c?.avg_days_lost ?? null,
      avg_days_active: c?.avg_days_active ?? null,
      mix_pipeline,
      mix_best,
      mix_commit,
      mix_won,
      qoq_attainment_delta: attainment != null && prevAttainment != null ? attainment - prevAttainment : null,
    });
  }

  repRowsBuild.sort((a, b) => (Number(b.attainment ?? -1) - Number(a.attainment ?? -1)) || a.rep_name.localeCompare(b.rep_name));

  const managerAgg = new Map<
    string,
    {
      quota: number;
      won_amount: number;
      won_count: number;
      lost_count: number;
      active_amount: number;
      partner_closed_amount: number;
      closed_amount: number;
    }
  >();
  for (const repRow of repRowsBuild) {
    const mid = String(repRow.manager_id || "").trim();
    const a = managerAgg.get(mid) || {
      quota: 0,
      won_amount: 0,
      won_count: 0,
      lost_count: 0,
      active_amount: 0,
      partner_closed_amount: 0,
      closed_amount: 0,
    };
    a.quota += repRow.quota;
    a.won_amount += repRow.won_amount;
    a.won_count += repRow.won_count;
    const ck = `${selectedPeriodId}|${String(repRow.rep_id)}`;
    const c = repKpisByKey.get(ck);
    a.lost_count += Number(c?.lost_count || 0) || 0;
    a.active_amount += repRow.active_amount;
    a.partner_closed_amount += Number((c as { partner_closed_amount?: number })?.partner_closed_amount || 0) || 0;
    a.closed_amount += Number((c as { closed_amount?: number })?.closed_amount || 0) || 0;
    managerAgg.set(mid, a);
  }

  const viewerRepStr =
    viewerRepId != null && Number.isFinite(viewerRepId) && viewerRepId > 0 ? String(viewerRepId) : "";

  const managerRowsBuild: RepManagerManagerRow[] = [];
  for (const [manager_id, agg] of managerAgg.entries()) {
    if (viewerRepStr && String(manager_id) === viewerRepStr) continue;
    const manager_name = manager_id ? managerNameById.get(manager_id) || `Manager ${manager_id}` : "(Unassigned)";
    const attainment = safeDiv(agg.won_amount, agg.quota);
    const win_rate = safeDiv(agg.won_count, agg.won_count + agg.lost_count);
    const partner_contribution = safeDiv(agg.partner_closed_amount, agg.closed_amount);
    managerRowsBuild.push({
      manager_id,
      manager_name,
      quota: agg.quota,
      won_amount: agg.won_amount,
      active_amount: agg.active_amount,
      attainment,
      win_rate,
      partner_contribution,
    });
  }
  managerRowsBuild.sort(
    (a, b) =>
      (Number(b.attainment ?? -1) - Number(a.attainment ?? -1)) ||
      b.won_amount - a.won_amount ||
      a.manager_name.localeCompare(b.manager_name)
  );

  return { repRows: repRowsBuild, managerRows: managerRowsBuild };
}
