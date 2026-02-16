import Link from "next/link";
import { Modal } from "../_components/Modal";
import { requireOrgContext } from "../../../lib/auth";
import { getUserById, listHierarchyLevels, listManagerVisibility, listRepUsersForManager, listUsers } from "../../../lib/db";
import { resolvePublicId } from "../../../lib/publicId";
import {
  assignRepToMeAction,
  createUserAction,
  deleteUserAction,
  generateResetLinkAction,
  updateUserAction,
} from "../actions/users";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
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

  const isManager = ctx.kind === "user" && ctx.user.role === "MANAGER";
  const isAdmin = ctx.kind === "master" || (ctx.kind === "user" && ctx.user.role === "ADMIN");

  const hierarchyLevels = await listHierarchyLevels().catch(() => []);
  const hierarchyLabelByLevel = new Map<number, string>(
    hierarchyLevels.map((h): [number, string] => [Number(h.level), String(h.label || "").trim()])
  );
  const labelForLevel = (level: number, fallback: string) => hierarchyLabelByLevel.get(level) || fallback;
  const roleToLevel = (role: string) => (role === "ADMIN" ? 0 : role === "EXEC_MANAGER" ? 1 : role === "MANAGER" ? 2 : 3);

  const usersRaw = isManager
    ? await listRepUsersForManager({ orgId, managerUserId: ctx.kind === "user" ? ctx.user.id : 0, includeUnassigned: true }).catch(
        () => []
      )
    : await listUsers({ orgId, includeInactive: true }).catch(() => []);

  const users =
    roleFilter
      ? usersRaw.filter((u) => {
          if (roleFilter && u.role !== roleFilter) return false;
          return true;
        })
      : usersRaw;

  const execManagers = isAdmin ? usersRaw.filter((u) => u.role === "EXEC_MANAGER" && u.active) : [];
  const managers = isAdmin ? usersRaw.filter((u) => u.role === "MANAGER" && u.active) : [];
  const userById = new Map<number, (typeof usersRaw)[number]>(usersRaw.map((u) => [u.id, u]));

  const createdUser = created ? usersRaw.find((u) => String(u.public_id) === String(created)) || null : null;

  const userId = userPublicId ? await resolvePublicId("users", userPublicId).catch(() => 0) : 0;
  const user =
    (modal === "edit" || modal === "delete") && userId ? await getUserById({ orgId, userId }).catch(() => null) : null;

  const visibleIds =
    user && (user.hierarchy_level === 1 || user.hierarchy_level === 2)
      ? await listManagerVisibility({ orgId, managerUserId: user.id }).catch(() => [])
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
              User created: <span className="font-semibold">{createdUser.display_name}</span>{" "}
              <span className="text-[color:var(--sf-text-secondary)]">({createdUser.email})</span>
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
            <option value="ADMIN">{labelForLevel(0, "Admin")}</option>
            <option value="EXEC_MANAGER">{labelForLevel(1, "Executive Manager")}</option>
            <option value="MANAGER">{labelForLevel(2, "Manager")}</option>
            <option value="REP">{labelForLevel(3, "Rep")}</option>
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
              <th className="px-4 py-3">role</th>
              <th className="px-4 py-3">display_name</th>
              <th className="px-4 py-3">title</th>
              <th className="px-4 py-3">email</th>
              <th className="px-4 py-3">account_owner_name</th>
              <th className="px-4 py-3">manager_user</th>
              <th className="px-4 py-3">admin_full_analytics</th>
              <th className="px-4 py-3">see_all</th>
              <th className="px-4 py-3">active</th>
              <th className="px-4 py-3 text-right">actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length ? (
              users.map((u) => (
                <tr key={u.public_id} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3">{labelForLevel(roleToLevel(u.role), u.role)}</td>
                  <td className="px-4 py-3">{u.display_name}</td>
                  <td className="px-4 py-3">{u.title || ""}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">{u.account_owner_name}</td>
                  <td className="px-4 py-3">
                    {u.manager_user_id != null ? (
                      <span className="text-[color:var(--sf-text-primary)]">
                        {userById.get(u.manager_user_id)?.display_name || ""}
                      </span>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="px-4 py-3">{u.admin_has_full_analytics_access ? "true" : "false"}</td>
                  <td className="px-4 py-3">{u.see_all_visibility ? "true" : "false"}</td>
                  <td className="px-4 py-3">{u.active ? "true" : "false"}</td>
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
                      <Link
                        href={`/admin/users?modal=delete&id=${encodeURIComponent(String(u.public_id))}`}
                        className="rounded-md border border-[#E74C3C] px-2 py-1 text-xs text-[#E74C3C] hover:bg-[color:var(--sf-surface-alt)]"
                      >
                        Delete
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
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
                    ? "CRM Account Owner Name is required for REPs. Copy/paste it exactly as it appears in your CRM."
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
                    <option value="ADMIN">{labelForLevel(0, "Admin")}</option>
                    <option value="EXEC_MANAGER">{labelForLevel(1, "Executive Manager")}</option>
                    <option value="MANAGER">{labelForLevel(2, "Manager")}</option>
                    <option value="REP">{labelForLevel(3, "Rep")}</option>
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
                PASTE the name as it appears in CRM. (Required for Reps)
              </p>
            </div>

            {isAdmin ? (
              <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3" data-show-roles="EXEC_MANAGER,MANAGER" hidden>
                <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Direct reports (assignments)</div>
                <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                  If creating an EXEC_MANAGER/MANAGER and <span className="font-mono">Can View All User Data</span> is unchecked, select who reports to them.
                  These selections also control their visibility scope.
                </p>
                <div className="mt-2 grid gap-2">
                  {users
                    .filter((u) => u.active)
                    .filter((u) => u.role !== "ADMIN")
                    .map((u) => (
                      <label key={u.public_id} className="flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
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
                    {managers.map((m) => (
                      <option key={m.public_id} value={String(m.public_id)}>
                        {m.display_name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-[color:var(--sf-text-disabled)]">For reps, this must be a Manager.</p>
                </div>

                <div className="grid gap-1" data-show-roles="MANAGER" hidden>
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Who is Their Manager (optional)</label>
                  <select
                    name="manager_user_public_id"
                    defaultValue={prefillManagerUserPublicId || ""}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="">(none)</option>
                    {execManagers.map((m) => (
                      <option key={m.public_id} value={String(m.public_id)}>
                        {m.display_name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-[color:var(--sf-text-disabled)]">For managers, this must be an Executive Manager.</p>
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
                    <span>Full Analytics (Admin Only)</span>
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

            {/* Progressive enhancement: show/hide role-dependent fields */}
            <script
              dangerouslySetInnerHTML={{
                __html: `
(function () {
  function sync(form) {
    var roleEl = form.querySelector('select[name="role"]');
    var role = roleEl ? String(roleEl.value || "") : "REP";
    var dep = form.querySelectorAll('[data-show-roles]');
    for (var i = 0; i < dep.length; i++) {
      var el = dep[i];
      var rolesAttr = el.getAttribute('data-show-roles') || "";
      var roles = rolesAttr.split(',').map(function (s) { return String(s || "").trim(); }).filter(Boolean);
      var shouldShow = roles.indexOf(role) !== -1;
      el.hidden = !shouldShow;
      var fields = el.querySelectorAll('input, select, textarea, button');
      for (var k = 0; k < fields.length; k++) fields[k].disabled = !shouldShow;
    }
  }
  var forms = document.querySelectorAll('form[data-user-form="1"]');
  for (var j = 0; j < forms.length; j++) {
    (function (form) {
      sync(form);
      form.addEventListener('change', function (e) {
        var t = e && e.target;
        if (t && t.name === 'role') sync(form);
      });
    })(forms[j]);
  }
})();`,
              }}
            />
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
                    <option value="ADMIN">{labelForLevel(0, "Admin")}</option>
                    <option value="EXEC_MANAGER">{labelForLevel(1, "Executive Manager")}</option>
                    <option value="MANAGER">{labelForLevel(2, "Manager")}</option>
                    <option value="REP">{labelForLevel(3, "Rep")}</option>
                  </select>
                </div>

                <div
                  className="grid gap-1 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3"
                  data-show-roles="EXEC_MANAGER,MANAGER"
                  hidden={!(user.role === "EXEC_MANAGER" || user.role === "MANAGER")}
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
              </div>
            ) : null}

            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Name As It Appears In CRM</label>
              <input
                name="account_owner_name"
                defaultValue={user.account_owner_name || ""}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
              <p className="text-xs font-medium text-[#E74C3C]">
                This name is used to exactly match the Account Owner for each Opportunity in CRM used for Forecast Reviews. Please COPY and
                PASTE the name as it appears in CRM. (Required for Reps)
              </p>
            </div>

            {isAdmin ? (
              <div
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-3"
                data-show-roles="EXEC_MANAGER,MANAGER"
                hidden={!(user.role === "EXEC_MANAGER" || user.role === "MANAGER")}
              >
                <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Direct reports (assignments)</div>
                <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                  If editing an EXEC_MANAGER/MANAGER and <span className="font-mono">Can View All User Data</span> is unchecked, select which users
                  report to them. These selections also control their visibility scope.
                </p>
                <div className="mt-2 grid gap-2">
                  {users
                    .filter((u) => u.active)
                    .filter((u) => u.id !== user.id)
                    .filter((u) => u.role !== "ADMIN")
                    .map((u) => (
                      <label key={u.public_id} className="flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
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
              <div className="grid gap-2">
                <div className="grid gap-1" data-show-roles="REP" hidden>
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Who is Their Manager (optional)</label>
                  <select
                    name="manager_user_public_id"
                    defaultValue={
                      user.manager_user_id == null
                        ? ""
                        : String(managers.find((m) => m.id === user.manager_user_id)?.public_id || "")
                    }
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="">(none)</option>
                    {managers
                      .filter((m) => m.id !== user.id)
                      .map((m) => (
                        <option key={m.public_id} value={String(m.public_id)}>
                          {m.display_name}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-[color:var(--sf-text-disabled)]">For reps, this must be a Manager.</p>
                </div>

                <div className="grid gap-1" data-show-roles="MANAGER" hidden>
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Who is Their Manager (optional)</label>
                  <select
                    name="manager_user_public_id"
                    defaultValue={
                      user.manager_user_id == null
                        ? ""
                        : String(execManagers.find((m) => m.id === user.manager_user_id)?.public_id || "")
                    }
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="">(none)</option>
                    {execManagers
                      .filter((m) => m.id !== user.id)
                      .map((m) => (
                        <option key={m.public_id} value={String(m.public_id)}>
                          {m.display_name}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-[color:var(--sf-text-disabled)]">For managers, this must be an Executive Manager.</p>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              {isAdmin ? (
                <div className="grid gap-1" data-show-roles="ADMIN" hidden={user.role !== "ADMIN"}>
                  <label className="flex items-center gap-2 text-sm font-semibold text-[color:var(--sf-text-primary)]">
                    <input
                      name="admin_has_full_analytics_access"
                      type="checkbox"
                      className="h-5 w-5"
                      defaultChecked={!!user.admin_has_full_analytics_access}
                    />
                    <span>Full Analytics (Admin Only)</span>
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

            {/* Progressive enhancement: show/hide role-dependent fields */}
            <script
              dangerouslySetInnerHTML={{
                __html: `
(function () {
  function sync(form) {
    var roleEl = form.querySelector('select[name="role"]');
    var role = roleEl ? String(roleEl.value || "") : "REP";
    var dep = form.querySelectorAll('[data-show-roles]');
    for (var i = 0; i < dep.length; i++) {
      var el = dep[i];
      var rolesAttr = el.getAttribute('data-show-roles') || "";
      var roles = rolesAttr.split(',').map(function (s) { return String(s || "").trim(); }).filter(Boolean);
      var shouldShow = roles.indexOf(role) !== -1;
      el.hidden = !shouldShow;
      var fields = el.querySelectorAll('input, select, textarea, button');
      for (var k = 0; k < fields.length; k++) fields[k].disabled = !shouldShow;
    }
  }
  var forms = document.querySelectorAll('form[data-user-form="1"]');
  for (var j = 0; j < forms.length; j++) {
    (function (form) {
      sync(form);
      form.addEventListener('change', function (e) {
        var t = e && e.target;
        if (t && t.name === 'role') sync(form);
      });
    })(forms[j]);
  }
})();`,
              }}
            />
          </form>
        </Modal>
      ) : null}

      {modal === "delete" && user ? (
        <Modal title={`Delete user`} closeHref={closeHref()}>
          <form action={deleteUserAction} className="grid gap-4">
            <input type="hidden" name="public_id" value={String(user.public_id)} />
            <p className="text-sm text-[color:var(--sf-text-secondary)]">
              This will permanently delete <span className="font-semibold">{user.display_name}</span> ({user.email}). This cannot
              be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Link
                href={closeHref()}
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Cancel
              </Link>
              <button className="rounded-md bg-[#E74C3C] px-3 py-2 text-sm font-medium text-[color:var(--sf-text-primary)]">Delete</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  );
}

