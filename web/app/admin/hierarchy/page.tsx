import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrgContext } from "../../../lib/auth";
import { listHierarchyLevels, listUsers } from "../../../lib/db";
import { updateSalesOrgChartAction } from "../actions/orgChart";
import { isAdmin, isSalesLeader } from "../../../lib/roleHelpers";

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
  const nonAdminUsers = activeUsers.filter((u) => u.hierarchy_level !== 0);
  const userById = new Map(nonAdminUsers.map((u) => [u.id, u] as const));
  const directReportsByManagerId = new Map<number, typeof nonAdminUsers>();
  for (const user of nonAdminUsers) {
    const managerId = user.manager_user_id;
    if (managerId == null) continue;
    if (!directReportsByManagerId.has(managerId)) directReportsByManagerId.set(managerId, []);
    directReportsByManagerId.get(managerId)!.push(user);
  }

  const roots = executives;
  const unassignedUsers = nonAdminUsers.filter((u) => u.hierarchy_level !== 1 && u.manager_user_id == null);

  function managerOptionsForUser(user: (typeof nonAdminUsers)[number]) {
    if (user.hierarchy_level === 2) return executives;
    return [...executives, ...managers];
  }

  function renderNode(user: (typeof nonAdminUsers)[number], isRoot = false): React.JSX.Element {
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
              No Executive Managers found. Create an Executive Manager user first.
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

