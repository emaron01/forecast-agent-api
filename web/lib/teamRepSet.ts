import type { RepManagerManagerRow, RepManagerRepRow } from "../app/components/dashboard/executive/RepManagerComparisonPanel";
import {
  getCreatedByRep,
  getQuotaByRepPeriod,
  getRepKpisByPeriod,
  type RepPeriodKpisRow,
} from "./executiveRepKpis";
import type { RepDirectoryRow } from "./repScope";

export type BuildOrgSubtreeArgs = {
  orgId: number;
  viewerRepId: number | null;
  repDirectory: RepDirectoryRow[];
  selectedPeriodId: string;
  comparePeriodIds: string[];
  prevPeriodId: string;
  /** Passed through to KPI SQL (partner-scoped opportunities only when true). */
  requirePartnerName?: boolean;
};

function safeDiv(n: number, d: number): number | null {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

function managerIdKeyForRep(r: RepDirectoryRow, viewerRepId: number | null): string {
  if (r.manager_rep_id == null) return "__unassigned__";
  if (viewerRepId != null && Number(r.manager_rep_id) === viewerRepId) {
    return String(viewerRepId); // nest under viewer card
  }
  return String(r.manager_rep_id);
}

function aggregateDirectReportsToManagerRow(
  direct: RepManagerRepRow[],
  repKpisByKey: Map<string, RepPeriodKpisRow>,
  selectedPeriodId: string
): Omit<RepManagerManagerRow, "manager_id" | "manager_name" | "parent_manager_id"> {
  let quota = 0;
  let won_amount = 0;
  let won_count = 0;
  let lost_count = 0;
  let active_amount = 0;
  let partner_closed_amount = 0;
  let closed_amount = 0;
  for (const repRow of direct) {
    quota += Number(repRow.quota) || 0;
    won_amount += Number(repRow.won_amount) || 0;
    won_count += Number(repRow.won_count) || 0;
    const ck = `${selectedPeriodId}|${String(repRow.rep_id)}`;
    const c = repKpisByKey.get(ck);
    lost_count += Number(c?.lost_count || 0) || 0;
    active_amount += Number(repRow.active_amount) || 0;
    partner_closed_amount += Number((c as { partner_closed_amount?: number })?.partner_closed_amount || 0) || 0;
    closed_amount += Number((c as { closed_amount?: number })?.closed_amount || 0) || 0;
  }
  return {
    quota,
    won_amount,
    active_amount,
    attainment: safeDiv(won_amount, quota),
    win_rate: safeDiv(won_count, won_count + lost_count),
    partner_contribution: safeDiv(partner_closed_amount, closed_amount),
  };
}

/**
 * Team Performance + Coaching: org tree from reps.manager_rep_id only (no hierarchy_level).
 * Viewer rep is omitted from rep cards; never receives a manager rollup card.
 */
export async function buildOrgSubtree(args: BuildOrgSubtreeArgs): Promise<{
  repRows: RepManagerRepRow[];
  managerRows: RepManagerManagerRow[];
}> {
  const {
    orgId,
    repDirectory,
    viewerRepId,
    selectedPeriodId,
    comparePeriodIds,
    prevPeriodId,
    requirePartnerName = false,
  } = args;

  if (!selectedPeriodId || !comparePeriodIds.length) {
    return { repRows: [], managerRows: [] };
  }

  const viewerId = viewerRepId != null && Number.isFinite(viewerRepId) && viewerRepId > 0 ? viewerRepId : null;

  const repIds = repDirectory
    .map((r) => r.id)
    .filter((id) => Number.isFinite(id) && id > 0 && (viewerId == null || id !== viewerId));

  // Quota fetch includes ALL reps (including viewer) so subtree quota walks are complete.
  const allRepIds = repDirectory
    .map((r) => r.id)
    .filter((id) => Number.isFinite(id) && id > 0);
  const scopeRepIdsForKpi = repIds.length > 0 ? repIds : [-1];
  const scopeRepIdsForQuota = allRepIds.length > 0 ? allRepIds : [-1];

  const [repKpisRows, createdByRepRows, quotaByRepPeriod] = await Promise.all([
    getRepKpisByPeriod({
      orgId,
      periodIds: comparePeriodIds,
      repIds: scopeRepIdsForKpi,
      requirePartnerName,
    }),
    getCreatedByRep({ orgId, periodIds: comparePeriodIds, repIds: scopeRepIdsForKpi }),
    getQuotaByRepPeriod({ orgId, quotaPeriodIds: comparePeriodIds, repIds: scopeRepIdsForQuota }),
  ]);

  const managerNameById = new Map<string, string>();
  for (const r of repDirectory) {
    const id = String(r.id);
    managerNameById.set(id, String(r.name || "").trim() || `Rep ${r.id}`);
  }

  const repDirectoryById = new Map<number, RepDirectoryRow>();
  for (const r of repDirectory) {
    if (Number.isFinite(r.id) && r.id > 0) repDirectoryById.set(r.id, r);
  }

  const quotaByRepPeriodMap = new Map<string, number>();
  for (const q of quotaByRepPeriod) {
    const k = `${String(q.quota_period_id)}|${String(q.rep_id)}`;
    quotaByRepPeriodMap.set(k, Number(q.quota_amount || 0) || 0);
  }
  const repKpisByKey = new Map<string, RepPeriodKpisRow>();
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

  const activeRepIdSet = new Set<number>();
  for (const r of repDirectory) {
    if (Number.isFinite(r.id) && r.id > 0) activeRepIdSet.add(r.id);
  }

  const isManagerRepId = new Set<number>();
  for (const r of repDirectory) {
    if (r.manager_rep_id != null && Number.isFinite(Number(r.manager_rep_id)) && Number(r.manager_rep_id) > 0) {
      isManagerRepId.add(Number(r.manager_rep_id));
    }
  }

  const repIdsInData = new Set<string>();
  for (const id of repIds) {
    if (isManagerRepId.has(id)) continue;
    repIdsInData.add(String(id));
  }
  for (const r of repKpisRows) {
    const id = Number(r.rep_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (viewerId != null && id === viewerId) continue;
    if (!activeRepIdSet.has(id)) continue;
    if (isManagerRepId.has(id)) continue;
    repIdsInData.add(String(id));
  }
  for (const q of quotaByRepPeriod) {
    const id = Number(q.rep_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (viewerId != null && id === viewerId) continue;
    if (!activeRepIdSet.has(id)) continue;
    if (isManagerRepId.has(id)) continue;
    repIdsInData.add(String(id));
  }

  const repRowsBuild: RepManagerRepRow[] = [];
  for (const rep_id of repIdsInData) {
    if (viewerId != null && String(rep_id) === String(viewerId)) continue;
    // Exclude viewer from repRows entirely (prevents viewer being treated as "(Unassigned)").
    if (viewerRepId != null && Number(rep_id) === Number(viewerRepId)) continue;

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
    const dirEntry = repDirectoryById.get(Number(rep_id));
    const manager_id = dirEntry ? managerIdKeyForRep(dirEntry, viewerId) : "";
    const manager_name =
      manager_id === "__unassigned__"
        ? "(Unassigned)"
        : managerNameById.get(manager_id) || `Manager ${manager_id}`;

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

  const managerRepIds = new Set<number>();
  for (const r of repDirectory) {
    if (viewerId != null && r.id === viewerId) continue;
    const m = r.manager_rep_id;
    if (m != null && Number.isFinite(Number(m)) && Number(m) > 0) {
      managerRepIds.add(Number(m));
    }
  }

  const managerRowsBuild: RepManagerManagerRow[] = [];

  const wonByRepId = new Map<number, number>();
  for (const row of repKpisRows) {
    if (String(row.quota_period_id) !== String(selectedPeriodId)) continue;
    const repId = Number(row.rep_id);
    if (!Number.isFinite(repId) || repId <= 0) continue;
    wonByRepId.set(repId, Number(row.won_amount || 0) || 0);
  }

  const childrenByManagerId = new Map<number, RepDirectoryRow[]>();
  for (const r of repDirectory) {
    const mid = r.manager_rep_id == null ? null : Number(r.manager_rep_id);
    if (mid == null || !Number.isFinite(mid) || mid <= 0) continue;
    const arr = childrenByManagerId.get(mid) || [];
    arr.push(r);
    childrenByManagerId.set(mid, arr);
  }

  const subtreeWonMemo = new Map<number, number>();
  function sumSubtreeWon(managerId: number): number {
    const cached = subtreeWonMemo.get(managerId);
    if (cached != null) return cached;
    const children = childrenByManagerId.get(managerId) || [];
    let sum = 0;
    for (const child of children) {
      const childId = Number(child.id);
      if (!Number.isFinite(childId) || childId <= 0) continue;
      sum += Number(wonByRepId.get(childId) ?? 0) || 0;
      sum += sumSubtreeWon(childId);
    }
    subtreeWonMemo.set(managerId, sum);
    return sum;
  }

  const midsSorted = Array.from(managerRepIds).sort((a, b) => a - b);
  for (const mid of midsSorted) {
    if (viewerId != null && mid === viewerId) continue;

    const managerDirRow = repDirectoryById.get(mid);
    const parentManagerRepId = managerDirRow?.manager_rep_id ?? null;
    const parentManagerId = parentManagerRepId == null ? "" : String(parentManagerRepId);

    const subtreeWon = sumSubtreeWon(mid);
    const subtreeQuota = quotaByRepPeriodMap.get(`${selectedPeriodId}|${mid}`) ?? 0;

    // directAgg is used for win_rate, partner_contribution, active_amount.
    // quota and won_amount are overridden with subtree values below.
    const direct = repRowsBuild.filter((row) => {
      const d = repDirectoryById.get(Number(row.rep_id));
      return d != null && d.manager_rep_id === mid;
    });
    const directAgg =
      direct.length > 0
        ? aggregateDirectReportsToManagerRow(direct, repKpisByKey, selectedPeriodId)
        : {
            quota: 0,
            won_amount: 0,
            active_amount: 0,
            attainment: null,
            win_rate: null,
            partner_contribution: null,
          };

    managerRowsBuild.push({
      manager_id: String(mid),
      manager_name: managerNameById.get(String(mid)) || `Manager ${mid}`,
      parent_manager_id: parentManagerId,
      ...directAgg,
      quota: subtreeQuota,
      won_amount: subtreeWon,
      attainment: safeDiv(subtreeWon, subtreeQuota),
    });
  }

  const unassignedDirect = repRowsBuild.filter((row) => row.manager_id === "__unassigned__");
  if (unassignedDirect.length > 0) {
    managerRowsBuild.push({
      manager_id: "__unassigned__",
      manager_name: "(Unassigned)",
      parent_manager_id: "",
      ...aggregateDirectReportsToManagerRow(unassignedDirect, repKpisByKey, selectedPeriodId),
    });
  }

  managerRowsBuild.sort(
    (a, b) =>
      (Number(b.attainment ?? -1) - Number(a.attainment ?? -1)) ||
      b.won_amount - a.won_amount ||
      a.manager_name.localeCompare(b.manager_name)
  );

  // Insert viewer as first manager card with full subtree rollup
  if (viewerId != null) {
    const viewerDirRow = repDirectoryById.get(viewerId);
    const viewerWon = sumSubtreeWon(viewerId);
    const viewerQuota = quotaByRepPeriodMap.get(`${selectedPeriodId}|${viewerId}`) ?? 0;

    const viewerManagerRow: RepManagerManagerRow = {
      manager_id: String(viewerId),
      manager_name: viewerDirRow?.name ?? "",
      parent_manager_id: "",
      quota: viewerQuota,
      won_amount: viewerWon,
      active_amount: 0,
      attainment: viewerQuota > 0 ? viewerWon / viewerQuota : null,
      win_rate: null,
      partner_contribution: null,
    };

    managerRowsBuild.unshift(viewerManagerRow);
  }

  return { repRows: repRowsBuild, managerRows: managerRowsBuild };
}
