import Link from "next/link";
import { Modal } from "../_components/Modal";
import { UserFormRoleSync } from "../_components/UserFormRoleSync";
import { requireOrgContext } from "../../../lib/auth";
import { getUserById, listDirectReportUserIds, listManagerVisibility, listRepUsersForManager, listUsers } from "../../../lib/db";
import { roleLabel } from "../../../lib/userRoles";
import { resolvePublicId } from "../../../lib/publicId";
import {
  assignRepToMeAction,
  createUserAction,
  deactivateUserAction,
  generateResetLinkAction,
  reactivateUserAction,
  updateUserAction,
} from "../actions/users";
import { EditUserResetEmailButton } from "./EditUserResetEmailButton";
import { RoleSelect } from "../../../components/admin/RoleSelect";
import {
  HIERARCHY,
  isAdmin as isAdminUser,
  isAdminLevel,
  isChannelExec,
  isChannelManager,
  isExecManagerLevel,
  isManager as isManagerUser,
  isManagerLevel,
  isRepLevel,
  isSalesLeaderLevel,
  roleToHierarchyLevel,
} from "../../../lib/roleHelpers";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function YesNoPill(props: { value: any }) {
  const v = !!props.value;
  const cls = v
    ? "border-[#16A34A] bg-[#ECFDF5] text-[#16A34A]"
    : "border-[#E74C3C] bg-[#FEF2F2] text-[#E74C3C]";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{v ? "Yes" : "No"}</span>;
}

function canAssignDirectReportLevel(managerLevel: number | null | undefined, targetLevel: number | null | undefined) {
  const manager = Number(managerLevel);
  const target = Number(targetLevel);
  if (!Number.isFinite(manager) || !Number.isFinite(target) || target === HIERARCHY.ADMIN) return false;
  if (manager === HIERARCHY.ADMIN) {
    return (
      (target >= HIERARCHY.EXEC_MANAGER && target <= HIERARCHY.REP) ||
      (target >= HIERARCHY.CHANNEL_EXEC && target <= HIERARCHY.CHANNEL_REP)
    );
  }
  if (manager === HIERARCHY.EXEC_MANAGER) return target >= HIERARCHY.EXEC_MANAGER;
  if (manager === HIERARCHY.MANAGER) return target >= HIERARCHY.MANAGER;
  if (manager === HIERARCHY.CHANNEL_EXEC) return target >= HIERARCHY.CHANNEL_EXEC;
  if (manager === HIERARCHY.CHANNEL_MANAGER) return target >= HIERARCHY.CHANNEL_MANAGER;
  return false;
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { ctx, orgId } = await requireOrgContext();

  const modal = sp(searchParams.modal) || "";
  const userPublicId = sp(searchParams.id) || "";
  const reset = sp(searchParams.reset) || "";
  const created = sp(searchParams.created) || "";
  const roleFilter = sp(searchParams.role) || "";
  const error = sp(searchParams.error) || "";
  const prefillEmail = sp(searchParams.email) || "";
  const prefillFirstName = sp(searchParams.first_name) || "";
  const prefillLastName = sp(searchParams.last_name) || "";
  const prefillTitle = sp(searchParams.title) || "";
  const prefillRole = sp(searchParams.role) || "";
  const prefillAccountOwnerName = sp(searchParams.account_owner_name) || "";
  const prefillManagerUserPublicId = sp(searchParams.manager_user_public_id) || "";
  const prefillSeeAll = sp(searchParams.see_all_visibility) || "";
  const prefillAnalytics = sp(searchParams.admin_has_full_analytics_access) || "";
  const prefillActive = sp(searchParams.active) || "";

  const isManager = ctx.kind === "user" && isManagerUser(ctx.user);
  const isAdmin = ctx.kind === "master" || (ctx.kind === "user" && isAdminUser(ctx.user));

  const roleOptions = [
    { role: "ADMIN" as const, label: roleLabel("ADMIN") },
    { role: "EXEC_MANAGER" as const, label: roleLabel("EXEC_MANAGER") },
    { role: "MANAGER" as const, label: roleLabel("MANAGER") },
    { role: "REP" as const, label: roleLabel("REP") },
    { role: "CHANNEL_EXECUTIVE" as const, label: roleLabel("CHANNEL_EXECUTIVE") },
    { role: "CHANNEL_DIRECTOR" as const, label: roleLabel("CHANNEL_DIRECTOR") },
    { role: "CHANNEL_REP" as const, label: roleLabel("CHANNEL_REP") },
  ] as const;

  const usersRaw = isManager
    ? await listRepUsersForManager({ orgId, managerUserId: ctx.kind === "user" ? ctx.user.id : 0, includeUnassigned: true }).catch(
        () => []
      )
    : await listUsers({ orgId, includeInactive: true }).catch(() => []);

  const users =
    roleFilter
      ? (usersRaw ?? []).filter((u) => {
          if (roleFilter && u.role !== roleFilter) return false;
          return true;
        })
      : usersRaw;

  const execManagers = isAdmin ? (usersRaw ?? []).filter((u) => isExecManagerLevel(roleToHierarchyLevel(u.role)) && u.active) : [];
  const managers = isAdmin ? (usersRaw ?? []).filter((u) => isManagerLevel(roleToHierarchyLevel(u.role)) && u.active) : [];
  const admins = isAdmin ? (usersRaw ?? []).filter((u) => isAdminLevel(roleToHierarchyLevel(u.role)) && u.active) : [];
  const repManagerCandidates = isAdmin
    ? (usersRaw ?? []).filter((u) => {
        const level = Number(u.hierarchy_level);
        return !!u.active && (level === HIERARCHY.EXEC_MANAGER || level === HIERARCHY.MANAGER);
      })
    : [];
  const managerManagerCandidates = isAdmin
    ? (usersRaw ?? []).filter((u) => {
        const level = Number(u.hierarchy_level);
        return !!u.active && (level === HIERARCHY.ADMIN || level === HIERARCHY.EXEC_MANAGER);
      })
    : [];
  const execManagerCandidates = isAdmin
    ? (usersRaw ?? []).filter((u) => {
        const level = Number(u.hierarchy_level);
        return !!u.active && (level === HIERARCHY.ADMIN || level === HIERARCHY.EXEC_MANAGER);
      })
    : [];

  /** Active org users only — dedicated query so manager dropdowns stay populated for admins. */
  const allActiveUsers = isAdmin
    ? (await listUsers({ orgId, includeInactive: false }).catch(() => [])).slice().sort((a, b) => {
        const an = String(a.display_name || a.email || "").toLocaleLowerCase();
        const bn = String(b.display_name || b.email || "").toLocaleLowerCase();
        return an.localeCompare(bn);
      })
    : [];
  const channelAndSalesLeaders = allActiveUsers.filter((u) => {
    const level = Number(u.hierarchy_level);
    return !!u.active && u.hierarchy_level !== 0 && (level <= 2 || (level >= 6 && level <= 7));
  });
  const userById = new Map<number, (typeof usersRaw)[number]>((usersRaw ?? []).map((u) => [u.id, u]));
  for (const u of allActiveUsers) {
    if (!userById.has(u.id)) userById.set(u.id, u as any);
  }
  // When a MANAGER views their REP list, `usersRaw` intentionally only contains REPs.
  // Ensure we can still render the Manager name (the current user) in the Manager column.
  if (ctx.kind === "user" && !userById.has(ctx.user.id)) {
    userById.set(ctx.user.id, ctx.user as any);
  }

  const createdUser = created ? (usersRaw ?? []).find((u) => String(u.public_id) === String(created)) || null : null;

  const userId = userPublicId ? await resolvePublicId("users", userPublicId).catch(() => 0) : 0;
  const user =
    (modal === "edit" || modal === "delete") && userId ? await getUserById({ orgId, userId }).catch(() => null) : null;

  const visibleIds =
    user &&
    (user.hierarchy_level === 1 ||
      user.hierarchy_level === 2 ||
      user.hierarchy_level === 6 ||
      user.hierarchy_level === 7 ||
      (user.hierarchy_level === 0 && !!user.admin_has_full_analytics_access))
      ? user.hierarchy_level === 6 || user.hierarchy_level === 7
        ? await listDirectReportUserIds({ orgId, managerUserId: user.id }).catch(() => [])
        : await listManagerVisibility({ orgId, managerUserId: user.id }).catch(() => [])
      : [];

  const channelAndSalesLeadersEdit =
    isAdmin && user
      ? (() => {
          const base = channelAndSalesLeaders.filter((u) => u.id !== user.id);
          const mid = user.manager_user_id;
          if (mid != null && !base.some((u) => u.id === mid)) {
            const mgr = userById?.get(Number(mid));
            if (mgr) base.unshift(mgr as (typeof base)[number]);
          }
          return base;
        })()
      : [];

  function closeHref() {
    return "/admin/users";
  }

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Users</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            {isManager ? "Manage REP users and assignments." : "Manage users, roles, and reporting lines."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/users?modal=new"
            className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
          >
            New user
          </Link>
        </div>
      </div>

      {reset ? (
        <div className="mt-4 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
          {reset === "sent" ? (
            <>Reset link generated.</>
          ) : (
            <>
              Reset link (dev):{" "}
              <Link className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline" href={reset}>
                {reset}
              </Link>
            </>
          )}
        </div>
      ) : null}

      {created ? (
        <div className="mt-4 rounded-md border border-[#2ECC71] bg-[color:var(--sf-surface)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
          {createdUser ? (
            <>
              User created: <span className="font-semibold">{createdUser.display_name}</span>
            </>
          ) : (
            <>User created.</>
          )}
        </div>
      ) : null}

      <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Role</label>
          <select
            name="role"
            defaultValue={roleFilter}
            className="mt-1 w-48 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
          >
            <option value="">(all)</option>
            <option value="ADMIN">{roleLabel("ADMIN")}</option>
            <option value="EXEC_MANAGER">{roleLabel("EXEC_MANAGER")}</option>
            <option value="MANAGER">{roleLabel("MANAGER")}</option>
            <option value="REP">{roleLabel("REP")}</option>
            <option value="CHANNEL_EXECUTIVE">{roleLabel("CHANNEL_EXECUTIVE")}</option>
            <option value="CHANNEL_DIRECTOR">{roleLabel("CHANNEL_DIRECTOR")}</option>
            <option value="CHANNEL_REP">{roleLabel("CHANNEL_REP")}</option>
          </select>
        </div>
        <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
          Filter
        </button>
        <Link
          href="/admin/users"
          className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
        >
          Clear
        </Link>
      </form>

      <div className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">User Name</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">CRM Name</th>
              <th className="px-4 py-3">Manager</th>
              <th className="px-4 py-3">See All Users</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3 text-right">actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length ? (
              users.map((u) => (
                <tr
                  key={u.public_id}
                  className={`border-t border-[color:var(--sf-border)] ${u.active ? "" : "bg-[color:var(--sf-surface-alt)] opacity-60"}`}
                >
                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <RoleSelect
                        userId={String(u.public_id)}
                        orgId={orgId}
                        currentRole={u.role}
                        roleOptions={roleOptions}
                        disableIfUnknown
                      />
                    ) : (
                      roleLabel(u.role)
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="inline-flex items-center gap-2">
                      <span>{u.display_name}</span>
                      {!u.active ? (
                        <span className="rounded-full border border-[color:var(--sf-border)] px-2 py-0.5 text-xs text-[color:var(--sf-text-secondary)]">
                          Inactive
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">{u.title || ""}</td>
                  <td className="px-4 py-3">{u.account_owner_name}</td>
                  <td className="px-4 py-3">
                    {u.manager_user_id != null ? (
                      <span className="text-[color:var(--sf-text-primary)]">
                        {String((userById?.get(u.manager_user_id) as any)?.display_name || "").trim() ||
                          String((userById?.get(u.manager_user_id) as any)?.email || "").trim() ||
                          ""}
                      </span>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <YesNoPill value={u.see_all_visibility} />
                  </td>
                  <td className="px-4 py-3">
                    <YesNoPill value={u.active} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      {isManager && u.manager_user_id == null ? (
                        <form action={assignRepToMeAction}>
                          <input type="hidden" name="public_id" value={String(u.public_id)} />
                          <button className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]">
                            Assign to me
                          </button>
                        </form>
                      ) : null}
                      <Link
                        href={`/admin/users?modal=edit&id=${encodeURIComponent(String(u.public_id))}`}
                        className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                      >
                        Edit
                      </Link>
                      {isAdmin ? (
                        <form action={generateResetLinkAction}>
                          <input type="hidden" name="public_id" value={String(u.public_id)} />
                          <button className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]">
                            Reset password
                          </button>
                        </form>
                      ) : null}
                      {u.active ? (
                        <Link
                          href={`/admin/users?modal=delete&id=${encodeURIComponent(String(u.public_id))}`}
                          className="rounded-md border border-[#E74C3C] px-2 py-1 text-xs text-[#E74C3C] hover:bg-[color:var(--sf-surface-alt)]"
                        >
                          Deactivate
                        </Link>
                      ) : (
                        <form action={reactivateUserAction}>
                          <input type="hidden" name="public_id" value={String(u.public_id)} />
                          <button className="rounded-md border border-[#16A34A] px-2 py-1 text-xs text-[#16A34A] hover:bg-[color:var(--sf-surface-alt)]">
                            Reactivate
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal === "new" ? (
        <Modal title="New user" closeHref={closeHref()}>
          <form action={createUserAction} className="grid gap-3" data-user-form="1">
            {error ? (
              <div className="rounded-lg border border-[#E74C3C] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
                {error === "passwords_do_not_match"
                  ? "Passwords don't match. Please re-enter them."
                  : error === "missing_account_owner_name"
                    ? "CRM Account Owner Name is required for Reps only. Copy/paste it exactly as it appears in your CRM."
                    : error === "email_in_use"
                      ? "That email is already in use. Choose a different email."
                      : error === "missing_visibility_assignments"
                        ? "Managers must have visibility assignments unless “Can View All User Data” is enabled."
                        : error === "invalid_manager"
                          ? "Invalid manager selection. Please choose a valid manager in this org for the selected role."
                          : "Unable to create user. Please check your inputs and try again."}
              </div>
            ) : null}
            {isManager ? <input type="hidden" name="role" value="REP" /> : null}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">First Name</label>
                <input
                  name="first_name"
                  defaultValue={prefillFirstName}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Last Name</label>
                <input
                  name="last_name"
                  defaultValue={prefillLastName}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
            </div>

            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Title</label>
              <input
                name="title"
                defaultValue={prefillTitle}
                maxLength={100}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
            </div>

            {!isManager ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Role</label>
                  <select
                    name="role"
                    defaultValue={prefillRole || "REP"}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="ADMIN">{roleLabel("ADMIN")}</option>
                    <option value="EXEC_MANAGER">{roleLabel("EXEC_MANAGER")}</option>
                    <option value="MANAGER">{roleLabel("MANAGER")}</option>
                    <option value="REP">{roleLabel("REP")}</option>
                    <option value="CHANNEL_EXECUTIVE">{roleLabel("CHANNEL_EXECUTIVE")}</option>
                    <option value="CHANNEL_DIRECTOR">{roleLabel("CHANNEL_DIRECTOR")}</option>
                    <option value="CHANNEL_REP">{roleLabel("CHANNEL_REP")}</option>
                  </select>
                </div>

                <div
                  className="grid gap-1 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3"
                  data-show-roles="EXEC_MANAGER,MANAGER"
                  hidden
                >
                  <label className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Can View All User Data</label>
                  <label className="flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
                    <input name="see_all_visibility" type="checkbox" className="h-5 w-5" defaultChecked={prefillSeeAll === "true"} />
                    <span className="font-medium">Yes</span>
                  </label>
                  <p className="text-xs text-[color:var(--sf-text-secondary)]">If unchecked, visibility is limited to assigned users.</p>
                </div>

                {isAdmin ? (
                  <div
                    className="grid gap-1 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3"
                    data-show-roles="ADMIN"
                    data-show-when-admin-exec="1"
                    hidden
                  >
                    <label className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Can View All User Data</label>
                    <label className="flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
                      <input name="see_all_visibility" type="checkbox" className="h-5 w-5" defaultChecked={prefillSeeAll === "true"} />
                      <span className="font-medium">Yes</span>
                    </label>
                    <p className="text-xs text-[color:var(--sf-text-secondary)]">
                      If unchecked, visibility is limited to assigned users (same as Executive Manager / Manager).
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Name As It Appears In CRM</label>
              <input
                name="account_owner_name"
                defaultValue={prefillAccountOwnerName}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
              <p className="text-xs font-medium text-[#E74C3C]">
                This name is used to exactly match the Account Owner for each Opportunity in CRM used for Forecast Reviews. Please COPY and
                PASTE the name as it appears in CRM. (Required for Reps and Channel Reps)
              </p>
            </div>

            {isAdmin ? (
              <div
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3"
                data-show-roles="EXEC_MANAGER,MANAGER,CHANNEL_EXECUTIVE,CHANNEL_DIRECTOR"
                hidden
              >
                <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Direct reports (assignments)</div>
                <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                  Select which existing users report to this leader. These selections also control their visibility scope.
                </p>
                <div className="mt-2 grid gap-2">
                  {users
                    .filter((u) => u.active)
                    .filter((u) => u.id !== user?.id)
                    .filter((u) => !isAdminLevel(roleToHierarchyLevel(u.role)))
                    .map((u) => (
                      <label
                        key={u.public_id}
                        className="flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]"
                        data-direct-report-level={String(Number(u.hierarchy_level ?? ""))}
                        hidden={!canAssignDirectReportLevel(roleToHierarchyLevel(prefillRole || "REP"), u.hierarchy_level)}
                      >
                        <input type="checkbox" name="visible_user_public_id" value={String(u.public_id)} className="h-4 w-4" />
                        <span>
                          {u.display_name}{" "}
                          <span className="text-xs text-[color:var(--sf-text-disabled)]">
                            ({u.role})
                          </span>
                        </span>
                      </label>
                    ))}
                </div>
              </div>
            ) : null}

            {isAdmin ? (
              <div className="grid gap-2">
                <div className="grid gap-1" data-show-roles="REP" hidden>
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Who is Their Manager (optional)</label>
                  <select
                    name="manager_user_public_id"
                    defaultValue={prefillManagerUserPublicId || ""}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="">(none)</option>
                    {repManagerCandidates.map((m) => (
                      <option key={m.public_id} value={String(m.public_id)}>
                        {m.display_name} ({m.role})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-[color:var(--sf-text-disabled)]">Optional. Sets the reporting line for this rep.</p>
                </div>

                <div className="grid gap-1" data-show-roles="MANAGER" hidden>
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Who is Their Manager (optional)</label>
                  <select
                    name="manager_user_public_id"
                    defaultValue={prefillManagerUserPublicId || ""}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="">(none)</option>
                    {managerManagerCandidates.map((m) => (
                      <option key={m.public_id} value={String(m.public_id)}>
                        {m.display_name} ({m.role})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-[color:var(--sf-text-disabled)]">Optional. Sets the reporting line for this manager.</p>
                </div>

                <div className="grid gap-1" data-show-roles="EXEC_MANAGER" hidden>
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Who is Their Manager (optional)</label>
                  <select
                    name="manager_user_public_id"
                    defaultValue={prefillManagerUserPublicId || ""}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="">(none)</option>
                    {execManagerCandidates.map((u) => (
                      <option key={u.public_id} value={String(u.public_id)}>
                        {u.display_name} ({u.role})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-[color:var(--sf-text-disabled)]">Optional. Sets the reporting line for this executive.</p>
                </div>

                <div className="grid gap-1" data-show-roles="CHANNEL_EXECUTIVE,CHANNEL_DIRECTOR,CHANNEL_REP" hidden>
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Who is Their Manager (optional)</label>
                  <select
                    name="manager_user_public_id"
                    defaultValue={prefillManagerUserPublicId || ""}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="">(none)</option>
                    {channelAndSalesLeaders.map((u) => (
                      <option key={u.public_id} value={String(u.public_id)}>
                        {u.display_name} ({u.role})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-[color:var(--sf-text-disabled)]">
                    Sets the reporting line for this channel user. Also controls territory scope if no Channel Alignment is set.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              {isAdmin ? (
                <div className="grid gap-1" data-show-roles="ADMIN" hidden>
                  <label className="flex items-center gap-2 text-sm font-semibold text-[color:var(--sf-text-primary)]">
                    <input
                      name="admin_has_full_analytics_access"
                      type="checkbox"
                      className="h-5 w-5"
                      defaultChecked={prefillAnalytics === "true"}
                    />
                    <span>Executive Dashboard Access (Admin only)</span>
                  </label>
                </div>
              ) : null}
              <div className="grid gap-1">
                <label className="flex items-center gap-2 text-sm font-semibold text-[color:var(--sf-text-primary)]">
                  <input name="active" type="checkbox" className="h-5 w-5" defaultChecked={prefillActive ? prefillActive === "true" : true} />
                  <span>User is Active</span>
                </label>
              </div>
            </div>

            {isAdmin ? (
              <>
                <div
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3"
                  data-show-roles="ADMIN"
                  data-show-when-admin-exec="1"
                  hidden
                >
                  <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Direct reports (assignments)</div>
                  <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                    Select which existing users report to this leader. These selections also control their visibility scope.
                  </p>
                  <div className="mt-2 grid gap-2">
                    {users
                      .filter((u) => u.active)
                      .filter((u) => !isAdminLevel(roleToHierarchyLevel(u.role)))
                      .map((u) => (
                        <label
                          key={u.public_id}
                          className="flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]"
                          data-direct-report-level={String(Number(u.hierarchy_level ?? ""))}
                          hidden={!canAssignDirectReportLevel(HIERARCHY.ADMIN, u.hierarchy_level)}
                        >
                          <input type="checkbox" name="visible_user_public_id" value={String(u.public_id)} className="h-4 w-4" />
                          <span>
                            {u.display_name}{" "}
                            <span className="text-xs text-[color:var(--sf-text-disabled)]">({u.role})</span>
                          </span>
                        </label>
                      ))}
                  </div>
                </div>
                <div className="grid gap-1" data-show-roles="ADMIN" data-show-when-admin-exec="1" hidden>
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Who is Their Manager (optional)</label>
                  <select
                    name="manager_user_public_id"
                    defaultValue={prefillManagerUserPublicId || ""}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="">(none)</option>
                    {channelAndSalesLeaders.map((u) => (
                      <option key={u.public_id} value={String(u.public_id)}>
                        {u.display_name} ({u.role})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-[color:var(--sf-text-disabled)]">
                    Sets the reporting line for this channel user. Also controls territory scope if no Channel Alignment is set.
                  </p>
                </div>
              </>
            ) : null}

            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Email</label>
              <input
                name="email"
                type="email"
                defaultValue={prefillEmail}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Password</label>
                <input
                  name="password"
                  type="password"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  placeholder="Minimum 8 characters"
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Confirm Password</label>
                <input
                  name="confirm_password"
                  type="password"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  placeholder="Re-enter password"
                  required
                />
              </div>
            </div>

            <div className="mt-2 flex items-center justify-end gap-2">
              <Link
                href={closeHref()}
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Cancel
              </Link>
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Create
              </button>
            </div>

            <UserFormRoleSync />
          </form>
        </Modal>
      ) : null}

      {modal === "edit" && user ? (
        <Modal title={`Edit user`} closeHref={closeHref()}>
          <form action={updateUserAction} className="grid gap-3" data-user-form="1">
            <input type="hidden" name="public_id" value={String(user.public_id)} />

            {isManager ? <input type="hidden" name="role" value="REP" /> : null}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">First Name</label>
                <input
                  name="first_name"
                  defaultValue={user.first_name || ""}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Last Name</label>
                <input
                  name="last_name"
                  defaultValue={user.last_name || ""}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
            </div>

            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Title</label>
              <input
                name="title"
                defaultValue={user.title || ""}
                maxLength={100}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
            </div>

            {!isManager ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Role</label>
                  <select
                    name="role"
                    defaultValue={user.role}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="ADMIN">{roleLabel("ADMIN")}</option>
                    <option value="EXEC_MANAGER">{roleLabel("EXEC_MANAGER")}</option>
                    <option value="MANAGER">{roleLabel("MANAGER")}</option>
                    <option value="REP">{roleLabel("REP")}</option>
                    <option value="CHANNEL_EXECUTIVE">{roleLabel("CHANNEL_EXECUTIVE")}</option>
                    <option value="CHANNEL_DIRECTOR">{roleLabel("CHANNEL_DIRECTOR")}</option>
                    <option value="CHANNEL_REP">{roleLabel("CHANNEL_REP")}</option>
                  </select>
                </div>

                <div
                  className="grid gap-1 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3"
                  data-show-roles="EXEC_MANAGER,MANAGER"
                  hidden={!isSalesLeaderLevel(roleToHierarchyLevel(user.role))}
                >
                  <label className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Can View All User Data</label>
                  <label className="flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
                    <input
                      name="see_all_visibility"
                      type="checkbox"
                      className="h-5 w-5"
                      defaultChecked={!!user.see_all_visibility}
                    />
                    <span className="font-medium">Yes</span>
                  </label>
                  <p className="text-xs text-[color:var(--sf-text-secondary)]">If unchecked, visibility is limited to assigned users.</p>
                </div>

                {isAdmin ? (
                  <div
                    className="grid gap-1 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3"
                    data-show-roles="ADMIN"
                    data-show-when-admin-exec="1"
                    hidden
                  >
                    <label className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Can View All User Data</label>
                    <label className="flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
                      <input
                        name="see_all_visibility"
                        type="checkbox"
                        className="h-5 w-5"
                        defaultChecked={!!user.see_all_visibility}
                      />
                      <span className="font-medium">Yes</span>
                    </label>
                    <p className="text-xs text-[color:var(--sf-text-secondary)]">
                      If unchecked, visibility is limited to assigned users (same as Executive Manager / Manager).
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-1" data-show-roles="REP" hidden={!isRepLevel(roleToHierarchyLevel(user.role))}>
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Name As It Appears In CRM</label>
              <input
                name="account_owner_name"
                defaultValue={user.account_owner_name || ""}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
              <p className="text-xs font-medium text-[#E74C3C]">
                This name is used to exactly match the Account Owner for each Opportunity in CRM used for Forecast Reviews. Please COPY and
                PASTE the name as it appears in CRM. (Required for Reps only)
              </p>
            </div>

            {isAdmin ? (
              <div
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3"
                data-show-roles="EXEC_MANAGER,MANAGER,CHANNEL_EXECUTIVE,CHANNEL_DIRECTOR"
                hidden={
                  !isSalesLeaderLevel(roleToHierarchyLevel(user.role)) && !isChannelExec(user) && !isChannelManager(user)
                }
              >
                <input type="hidden" name="direct_reports_submitted" value="1" />
                <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Direct reports (assignments)</div>
                <div className="mt-1 space-y-3 text-[calc(0.75rem+1pt)] leading-snug text-[color:var(--sf-text-secondary)]">
                  <p>
                    Select which existing users report to this leader. These selections also control their visibility scope.
                  </p>
                  <p>
                    Assigning a Team leader automatically includes that team leader&apos;s direct reports. Do not select INDIRECT reports as
                    direct reports, as this will pull them from their manager&apos;s team and place them directly under this leader.
                  </p>
                </div>
                <div className="mt-2 flex items-center justify-end">
                  <button
                    type="submit"
                    name="remove_all_direct_reports"
                    value="1"
                    className="rounded-full border border-[color:var(--sf-border)] bg-white px-3 py-1 text-xs font-semibold text-[#E74C3C] hover:bg-[color:var(--sf-surface-alt)]"
                  >
                    Remove all direct reports
                  </button>
                </div>
                <div className="mt-2 grid gap-2">
                  {users
                    .filter((u) => u.active)
                    .filter((u) => u.id !== user.id)
                    .filter((u) => !isAdminLevel(roleToHierarchyLevel(u.role)))
                    .map((u) => (
                      <label
                        key={u.public_id}
                        className="flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]"
                        data-direct-report-level={String(Number(u.hierarchy_level ?? ""))}
                        hidden={!canAssignDirectReportLevel(roleToHierarchyLevel(user.role), u.hierarchy_level)}
                      >
                        <input
                          type="checkbox"
                          name="visible_user_public_id"
                          value={String(u.public_id)}
                          defaultChecked={visibleIds.includes(u.id)}
                          className="h-4 w-4"
                        />
                        <span>
                          {u.display_name}{" "}
                          <span className="text-xs text-[color:var(--sf-text-disabled)]">
                            ({u.role})
                          </span>
                        </span>
                      </label>
                    ))}
                </div>
              </div>
            ) : null}

            {isAdmin ? (
              <div
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3"
                data-show-roles="ADMIN"
                data-show-when-admin-exec="1"
                hidden
              >
                <input type="hidden" name="direct_reports_submitted" value="1" />
                <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Direct reports (assignments)</div>
                <div className="mt-1 space-y-3 text-[calc(0.75rem+1pt)] leading-snug text-[color:var(--sf-text-secondary)]">
                  <p>
                    Select which existing users report to this leader. These selections also control their visibility scope.
                  </p>
                  <p>
                    Assigning a Team leader automatically includes that team leader&apos;s direct reports. Do not select INDIRECT reports as
                    direct reports, as this will pull them from their manager&apos;s team and place them directly under this leader.
                  </p>
                </div>
                <div className="mt-2 flex items-center justify-end">
                  <button
                    type="submit"
                    name="remove_all_direct_reports"
                    value="1"
                    className="rounded-full border border-[color:var(--sf-border)] bg-white px-3 py-1 text-xs font-semibold text-[#E74C3C] hover:bg-[color:var(--sf-surface-alt)]"
                  >
                    Remove all direct reports
                  </button>
                </div>
                <div className="mt-2 grid gap-2">
                  {users
                    .filter((u) => u.active)
                    .filter((u) => u.id !== user.id)
                    .filter((u) => !isAdminLevel(roleToHierarchyLevel(u.role)))
                    .map((u) => (
                      <label
                        key={`admin-dr-${u.public_id}`}
                        className="flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]"
                        data-direct-report-level={String(Number(u.hierarchy_level ?? ""))}
                        hidden={!canAssignDirectReportLevel(HIERARCHY.ADMIN, u.hierarchy_level)}
                      >
                        <input
                          type="checkbox"
                          name="visible_user_public_id"
                          value={String(u.public_id)}
                          defaultChecked={visibleIds.includes(u.id)}
                          className="h-4 w-4"
                        />
                        <span>
                          {u.display_name}{" "}
                          <span className="text-xs text-[color:var(--sf-text-disabled)]">({u.role})</span>
                        </span>
                      </label>
                    ))}
                </div>
              </div>
            ) : null}

            {isAdmin ? (
              <div className="grid gap-2">
                <div className="grid gap-1" data-show-roles="REP" hidden>
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Who is Their Manager (optional)</label>
                  <select
                    name="manager_user_public_id"
                    defaultValue={
                      user.manager_user_id == null
                        ? ""
                        : String(userById?.get(user.manager_user_id)?.public_id || "")
                    }
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="">(none)</option>
                    {repManagerCandidates
                      .filter((m) => m.id !== user.id)
                      .map((m) => (
                        <option key={m.public_id} value={String(m.public_id)}>
                          {m.display_name} ({m.role})
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-[color:var(--sf-text-disabled)]">Optional. Sets the reporting line for this rep.</p>
                </div>

                <div className="grid gap-1" data-show-roles="MANAGER" hidden>
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Who is Their Manager (optional)</label>
                  <select
                    name="manager_user_public_id"
                    defaultValue={
                      user.manager_user_id == null
                        ? ""
                        : String(userById?.get(user.manager_user_id)?.public_id || "")
                    }
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="">(none)</option>
                    {managerManagerCandidates
                      .filter((m) => m.id !== user.id)
                      .map((m) => (
                        <option key={m.public_id} value={String(m.public_id)}>
                          {m.display_name} ({m.role})
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-[color:var(--sf-text-disabled)]">Optional. Sets the reporting line for this manager.</p>
                </div>

                <div className="grid gap-1" data-show-roles="EXEC_MANAGER" hidden>
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Who is Their Manager (optional)</label>
                  <select
                    name="manager_user_public_id"
                    defaultValue={user.manager_user_id == null ? "" : String(userById?.get(user.manager_user_id)?.public_id || "")}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="">(none)</option>
                    {execManagerCandidates
                      .filter((u) => u.id !== user.id)
                      .map((u) => (
                        <option key={u.public_id} value={String(u.public_id)}>
                          {u.display_name} ({u.role})
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-[color:var(--sf-text-disabled)]">Optional. Sets the reporting line for this executive.</p>
                </div>

                <div className="grid gap-1" data-show-roles="CHANNEL_EXECUTIVE,CHANNEL_DIRECTOR,CHANNEL_REP" hidden>
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Who is Their Manager (optional)</label>
                  <select
                    key={`channel-manager-${user.public_id}`}
                    name="manager_user_public_id"
                    defaultValue={user.manager_user_id == null ? "" : String(userById?.get(user.manager_user_id)?.public_id || "")}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="">(none)</option>
                    {channelAndSalesLeadersEdit.map((u) => (
                      <option key={u.public_id} value={String(u.public_id)}>
                        {u.display_name} ({u.role})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-[color:var(--sf-text-disabled)]">
                    Sets the reporting line for this channel user. Also controls territory scope if no Channel Alignment is set.
                  </p>
                </div>

                <div className="grid gap-1" data-show-roles="ADMIN" data-show-when-admin-exec="1" hidden>
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Who is Their Manager (optional)</label>
                  <select
                    key={`admin-exec-manager-${user.public_id}`}
                    name="manager_user_public_id"
                    defaultValue={user.manager_user_id == null ? "" : String(userById?.get(user.manager_user_id)?.public_id || "")}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="">(none)</option>
                    {channelAndSalesLeadersEdit.map((u) => (
                      <option key={u.public_id} value={String(u.public_id)}>
                        {u.display_name} ({u.role})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-[color:var(--sf-text-disabled)]">
                    Sets the reporting line for this channel user. Also controls territory scope if no Channel Alignment is set.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              {isAdmin ? (
                <div className="grid gap-1" data-show-roles="ADMIN" hidden={!isAdminLevel(roleToHierarchyLevel(user.role))}>
                  <label className="flex items-center gap-2 text-sm font-semibold text-[color:var(--sf-text-primary)]">
                    <input
                      name="admin_has_full_analytics_access"
                      type="checkbox"
                      className="h-5 w-5"
                      defaultChecked={!!user.admin_has_full_analytics_access}
                    />
                    <span>Executive Dashboard Access (Admin only)</span>
                  </label>
                </div>
              ) : null}
              <div className="grid gap-1">
                <label className="flex items-center gap-2 text-sm font-semibold text-[color:var(--sf-text-primary)]">
                  <input name="active" type="checkbox" className="h-5 w-5" defaultChecked={!!user.active} />
                  <span>User is Active</span>
                </label>
              </div>
            </div>

            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Email</label>
              <input
                name="email"
                type="email"
                defaultValue={user.email}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              />
            </div>

            {isAdmin ? <EditUserResetEmailButton email={user.email} /> : null}

            <div className="mt-2 flex items-center justify-end gap-2">
              <Link
                href={closeHref()}
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Cancel
              </Link>
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Save
              </button>
            </div>

            <UserFormRoleSync />
          </form>
        </Modal>
      ) : null}

      {modal === "delete" && user ? (
        <Modal title={`Deactivate user`} closeHref={closeHref()}>
          <form action={deactivateUserAction} className="grid gap-4">
            <input type="hidden" name="public_id" value={String(user.public_id)} />
            <p className="text-sm text-[color:var(--sf-text-secondary)]">
              This will deactivate <span className="font-semibold">{user.display_name}</span> ({user.email}). The record will be kept
              and can be reactivated later.
            </p>
            <p className="text-sm text-[color:var(--sf-text-secondary)]">
              <span className="font-semibold text-[color:var(--sf-text-primary)]">Go-forward quota:</span> If a new hire gets quota for
              the same future periods this user still has, attainment can be double-counted. You can fix that before deactivating by
              adjusting go-forward quota assignments—or wait until the replacement is set up, then reactivate this user, adjust overlapping
              quota, and deactivate again.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Link
                href={closeHref()}
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Cancel
              </Link>
              <button className="rounded-md bg-[#E74C3C] px-3 py-2 text-sm font-medium text-[color:var(--sf-text-primary)]">
                Deactivate
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  );
}

