import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrgContext } from "../../../lib/auth";
import { listHierarchyLevels, listUsers } from "../../../lib/db";
import { updateSalesOrgChartAction } from "../actions/orgChart";
import { HIERARCHY, isAdmin, isSalesLeader } from "../../../lib/roleHelpers";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function HierarchyPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && !isAdmin(ctx.user) && !isSalesLeader(ctx.user)) redirect("/admin/users");

  const saved = sp(searchParams.saved) || "";
  const error = sp(searchParams.error) || "";

  const hierarchyLevels = await listHierarchyLevels().catch(() => []);
  const hierarchyLabelByLevel = new Map<number, string>(
    hierarchyLevels.map((h): [number, string] => [Number(h.level), String(h.label || "").trim()])
  );
  const labelForLevel = (level: number, fallback: string) => hierarchyLabelByLevel.get(level) || fallback;

  const users = await listUsers({ orgId, includeInactive: false }).catch(() => []);
  const activeUsers = users.filter((u) => u.active ?? true);
  const executives = activeUsers.filter((u) => u.hierarchy_level === 1);
  const managers = activeUsers.filter((u) => u.hierarchy_level === 2);
  /** Sales org chart: everyone except pure Admins; Executive Dashboard Admins (CEO/CRO) stay visible as level 0. */
  const salesOrgUsers = activeUsers.filter(
    (u) => u.hierarchy_level !== HIERARCHY.ADMIN || !!u.admin_has_full_analytics_access
  );
  const userById = new Map(salesOrgUsers.map((u) => [u.id, u] as const));
  const directReportsByManagerId = new Map<number, typeof salesOrgUsers>();
  for (const user of salesOrgUsers) {
    const managerId = user.manager_user_id;
    if (managerId == null) continue;
    if (!directReportsByManagerId.has(managerId)) directReportsByManagerId.set(managerId, []);
    directReportsByManagerId.get(managerId)!.push(user);
  }

  const roots = salesOrgUsers.filter((u) => u.manager_user_id == null || !userById.has(u.manager_user_id));
  const attachedIds = new Set(
    salesOrgUsers
      .filter((u) => u.manager_user_id != null && userById.has(u.manager_user_id))
      .map((u) => u.id)
  );
  const unassignedUsers = roots.length > 0
    ? salesOrgUsers.filter((u) => !attachedIds.has(u.id) && !roots.find((r) => r.id === u.id))
    : [];

  function canUserManageCandidate(reportLevel: number, candidate: (typeof activeUsers)[number]): boolean {
    if (!(candidate.active ?? true)) return false;
    const hl = Number(candidate.hierarchy_level);
    const candidateIsExecAdmin = hl === HIERARCHY.ADMIN && !!candidate.admin_has_full_analytics_access;
    if (hl === HIERARCHY.ADMIN && !candidateIsExecAdmin) return false;
    if (reportLevel === HIERARCHY.REP) {
      return hl === HIERARCHY.MANAGER || hl === HIERARCHY.EXEC_MANAGER || candidateIsExecAdmin;
    }
    if (reportLevel === HIERARCHY.MANAGER) {
      return hl === HIERARCHY.EXEC_MANAGER || candidateIsExecAdmin;
    }
    if (reportLevel === HIERARCHY.EXEC_MANAGER) {
      return hl === HIERARCHY.EXEC_MANAGER || candidateIsExecAdmin;
    }
    if (reportLevel === HIERARCHY.ADMIN) {
      return (
        candidateIsExecAdmin ||
        hl === HIERARCHY.EXEC_MANAGER ||
        hl === HIERARCHY.MANAGER ||
        hl === HIERARCHY.CHANNEL_EXEC ||
        hl === HIERARCHY.CHANNEL_MANAGER
      );
    }
    if (reportLevel >= HIERARCHY.CHANNEL_EXEC && reportLevel <= HIERARCHY.CHANNEL_REP) {
      return (
        candidateIsExecAdmin ||
        hl === HIERARCHY.EXEC_MANAGER ||
        hl === HIERARCHY.MANAGER ||
        (hl >= HIERARCHY.CHANNEL_EXEC && hl <= HIERARCHY.CHANNEL_MANAGER)
      );
    }
    return false;
  }

  function managerOptionsForUser(user: (typeof salesOrgUsers)[number]) {
    const rl = Number(user.hierarchy_level);
    return activeUsers.filter((u) => u.id !== user.id && canUserManageCandidate(rl, u));
  }

  function renderNode(user: (typeof salesOrgUsers)[number], isRoot = false): React.JSX.Element {
    const directReports = directReportsByManagerId.get(user.id) || [];
    const managerOptions = managerOptionsForUser(user);
    const currentManagerPublicId =
      user.manager_user_id == null ? "" : String(userById.get(user.manager_user_id)?.public_id || "");

    return (
      <div key={user.id} className={`rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] ${isRoot ? "p-4" : "p-3"}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className={`${isRoot ? "text-sm" : "text-sm"} font-semibold text-[color:var(--sf-text-primary)]`}>
              {labelForLevel(Number(user.hierarchy_level), String(user.role || "User"))}: {user.display_name}
            </div>
            <div className="text-xs text-[color:var(--sf-text-disabled)]">
              {user.title ? `${user.title} · ` : ""}
              {user.email}
            </div>
          </div>
          {isRoot ? <div className="text-xs text-[color:var(--sf-text-disabled)]">{user.public_id}</div> : null}
        </div>

        {!isRoot ? (
          <div className="mt-3 flex items-center gap-2">
            <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Managed by</label>
            <select
              name={`mgr_${user.public_id}`}
              defaultValue={currentManagerPublicId}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-sm text-[color:var(--sf-text-primary)]"
            >
              <option value="">(unassigned)</option>
              {managerOptions.map((manager) => (
                <option key={manager.public_id} value={String(manager.public_id)}>
                  {manager.display_name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {directReports.length > 0 ? (
          <div className="ml-6 mt-4 grid gap-3">
            {directReports.map((report) => renderNode(report))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <main className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Sales Organization</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            set-up, edit and review Sales Org Assignmnets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/users"
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Users
          </Link>
          <Link
            href="/admin/org-profile"
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Org profile
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        {saved ? (
          <div className="mb-4 rounded-md border border-[#2ECC71] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
            Saved.
          </div>
        ) : null}
        {error ? (
          <div className="mb-4 rounded-md border border-[#E74C3C] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
            {error === "cycle_detected"
              ? "Invalid org chart: a user cannot manage themselves (directly or indirectly)."
              : error === "rep_manager_must_be_manager"
                ? "Invalid assignment: Reps must report to a Manager or Executive Manager."
                : error === "manager_manager_must_be_exec"
                  ? "Invalid assignment: Managers must report to an Executive Manager (or be unassigned)."
                  : error === "exec_manager_manager_must_be_exec_or_ceo"
                    ? "Invalid assignment: Executive Managers must report to another Executive Manager or an Executive Dashboard Admin (CEO)."
                    : error === "admin_exec_manager_invalid"
                      ? "Invalid assignment: Executive Dashboard Admin must report to an allowed leader (Executive Dashboard Admin, Executive Manager, Manager, or Channel Executive/Director)."
                      : "Could not save. Please review your selections and try again."}
          </div>
        ) : null}

        <form action={updateSalesOrgChartAction} className="grid gap-5">
          <div className="flex items-center justify-end gap-2">
            <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-4 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
              Save org chart
            </button>
          </div>

          {roots.length ? (
            <div className="grid gap-4 md:grid-cols-3">
              {roots.map((root) => renderNode(root, true))}
            </div>
          ) : (
            <div className="text-sm text-[color:var(--sf-text-secondary)]">
              No users in the sales org tree yet. Add an Executive Dashboard Admin (CEO) and/or Executive Managers, then set reporting lines.
            </div>
          )}

          {unassignedUsers.length ? (
            <section className="rounded-xl border border-[#F1C40F] bg-[color:var(--sf-surface-alt)] p-4">
              <div className="text-sm font-semibold text-[#F1C40F]">Unassigned</div>
              <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                These users do not currently have a manager assigned.
              </p>

              <div className="mt-3 grid gap-3">
                {unassignedUsers.map((user) => renderNode(user))}
              </div>
            </section>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-4 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
              Save org chart
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

