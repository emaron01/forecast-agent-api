import Link from "next/link";
import { Modal } from "../_components/Modal";
import { requireOrgContext } from "../../../lib/auth";
import { getUserById, listManagerVisibility, listRepUsersForManager, listUsers } from "../../../lib/db";
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
  const roleFilter = sp(searchParams.role) || "";
  const levelFilter = sp(searchParams.level) || "";

  const isManager = ctx.kind === "user" && ctx.user.role === "MANAGER";
  const isAdmin = ctx.kind === "master" || (ctx.kind === "user" && ctx.user.role === "ADMIN");

  const usersRaw = isManager
    ? await listRepUsersForManager({ orgId, managerUserId: ctx.kind === "user" ? ctx.user.id : 0, includeUnassigned: true }).catch(
        () => []
      )
    : await listUsers({ orgId, includeInactive: true }).catch(() => []);

  const users =
    roleFilter || levelFilter
      ? usersRaw.filter((u) => {
          if (roleFilter && u.role !== roleFilter) return false;
          if (levelFilter && String(u.hierarchy_level) !== String(levelFilter)) return false;
          return true;
        })
      : usersRaw;

  const managers = isAdmin ? usersRaw.filter((u) => u.role === "MANAGER" && u.active) : [];
  const userById = new Map<number, (typeof usersRaw)[number]>(usersRaw.map((u) => [u.id, u]));

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
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Users</h1>
          <p className="mt-1 text-sm text-slate-600">
            {isManager ? "Manage REP users and assignments." : "Manage users, roles, and reporting lines."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/users?modal=new" className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white">
            New user
          </Link>
        </div>
      </div>

      {reset ? (
        <div className="mt-4 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800">
          {reset === "sent" ? (
            <>Reset link generated.</>
          ) : (
            <>
              Reset link (dev):{" "}
              <Link className="text-indigo-700 hover:underline" href={reset}>
                {reset}
              </Link>
            </>
          )}
        </div>
      ) : null}

      <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs font-medium text-slate-600">Role</label>
          <select name="role" defaultValue={roleFilter} className="mt-1 w-48 rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="">(all)</option>
            <option value="ADMIN">ADMIN</option>
            <option value="EXEC_MANAGER">EXEC_MANAGER</option>
            <option value="MANAGER">MANAGER</option>
            <option value="REP">REP</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">Hierarchy level</label>
          <select name="level" defaultValue={levelFilter} className="mt-1 w-48 rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="">(all)</option>
            <option value="0">0 (Admin)</option>
            <option value="1">1 (Exec Manager)</option>
            <option value="2">2 (Manager)</option>
            <option value="3">3 (Rep)</option>
          </select>
        </div>
        <button className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Filter</button>
        <Link href="/admin/users" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
          Clear
        </Link>
      </form>

      <div className="mt-5 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3">public_id</th>
              <th className="px-4 py-3">role</th>
              <th className="px-4 py-3">hierarchy</th>
              <th className="px-4 py-3">display_name</th>
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
                <tr key={u.public_id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-mono text-xs">{u.public_id}</td>
                  <td className="px-4 py-3">{u.role}</td>
                  <td className="px-4 py-3">{u.hierarchy_level}</td>
                  <td className="px-4 py-3">{u.display_name}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">{u.account_owner_name}</td>
                  <td className="px-4 py-3">
                    {u.manager_user_id != null ? (
                      <span className="text-slate-800">
                        {userById.get(u.manager_user_id)?.display_name || ""}{" "}
                        <span className="font-mono text-xs text-slate-500">
                          {userById.get(u.manager_user_id)?.public_id || ""}
                        </span>
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
                          <button className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50">
                            Assign to me
                          </button>
                        </form>
                      ) : null}
                      <Link
                        href={`/admin/users?modal=edit&id=${encodeURIComponent(String(u.public_id))}`}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        Edit
                      </Link>
                      {isAdmin ? (
                        <form action={generateResetLinkAction}>
                          <input type="hidden" name="public_id" value={String(u.public_id)} />
                          <button className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50">
                            Reset password
                          </button>
                        </form>
                      ) : null}
                      <Link
                        href={`/admin/users?modal=delete&id=${encodeURIComponent(String(u.public_id))}`}
                        className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                      >
                        Delete
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-slate-500">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal === "new" ? (
        <Modal title="New user" closeHref={closeHref()}>
          <form action={createUserAction} className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">email</label>
              <input name="email" type="email" className="rounded-md border border-slate-300 px-3 py-2 text-sm" required />
            </div>

            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">password</label>
              <input
                name="password"
                type="password"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Minimum 8 characters"
                required
              />
            </div>

            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">confirm_password</label>
              <input
                name="confirm_password"
                type="password"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Re-enter password"
                required
              />
            </div>

            {isManager ? <input type="hidden" name="role" value="REP" /> : null}

            {!isManager ? (
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">role</label>
                <select name="role" defaultValue="REP" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="ADMIN">ADMIN</option>
                  <option value="EXEC_MANAGER">EXEC_MANAGER</option>
                  <option value="MANAGER">MANAGER</option>
                  <option value="REP">REP</option>
                </select>
              </div>
            ) : null}

            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">hierarchy_level</label>
              <select name="hierarchy_level" defaultValue={isManager ? "3" : "3"} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="0">0 (Admin)</option>
                <option value="1">1 (Executive Manager)</option>
                <option value="2">2 (Manager)</option>
                <option value="3">3 (Rep)</option>
              </select>
              <p className="text-xs text-slate-500">Must match the selected role (Admin=0, Exec Manager=1, Manager=2, Rep=3).</p>
            </div>

            {!isManager ? (
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">see_all_visibility (EXEC_MANAGER/MANAGER only)</label>
                <select name="see_all_visibility" defaultValue="false" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">first_name</label>
                <input name="first_name" className="rounded-md border border-slate-300 px-3 py-2 text-sm" required />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">last_name</label>
                <input name="last_name" className="rounded-md border border-slate-300 px-3 py-2 text-sm" required />
              </div>
            </div>

            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">CRM Account Owner Name</label>
              <input name="account_owner_name" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <p className="text-xs font-medium text-red-700">
                This name is used to exactly match the Account Owner for each Opportunity in CRM used for Forecast Reviews. Please COPY and
                PASTE the name as it appears in CRM. (Required for Reps)
              </p>
            </div>

            {isAdmin ? (
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-sm font-semibold text-slate-900">Manager visibility assignments</div>
                <p className="mt-1 text-xs text-slate-600">
                  If creating a MANAGER and <span className="font-mono">see_all_visibility=false</span>, you must assign at least one visible user.
                </p>
                <div className="mt-2 grid gap-2">
                  {users
                    .filter((u) => u.active)
                    .filter((u) => u.role !== "ADMIN")
                    .map((u) => (
                      <label key={u.public_id} className="flex items-center gap-2 text-sm text-slate-800">
                        <input type="checkbox" name="visible_user_public_id" value={String(u.public_id)} className="h-4 w-4" />
                        <span>
                          {u.display_name} <span className="text-xs text-slate-500">({u.role}, level {u.hierarchy_level})</span>
                        </span>
                      </label>
                    ))}
                </div>
              </div>
            ) : null}

            {isAdmin ? (
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">manager_user (optional)</label>
                <select name="manager_user_public_id" defaultValue="" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="">(none)</option>
                  {managers.map((m) => (
                    <option key={m.public_id} value={String(m.public_id)}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500">Used for the manager chain (applies to REP and MANAGER users).</p>
              </div>
            ) : null}

            {isAdmin ? (
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">admin_has_full_analytics_access (ADMIN only)</label>
                <select name="admin_has_full_analytics_access" defaultValue="false" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </div>
            ) : null}

            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">active</label>
              <select name="active" defaultValue="true" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </div>

            <div className="mt-2 flex items-center justify-end gap-2">
              <Link href={closeHref()} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                Cancel
              </Link>
              <button className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white">Create</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "edit" && user ? (
        <Modal title={`Edit user`} closeHref={closeHref()}>
          <form action={updateUserAction} className="grid gap-3">
            <input type="hidden" name="public_id" value={String(user.public_id)} />

            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">email</label>
              <input
                name="email"
                type="email"
                defaultValue={user.email}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            {isManager ? <input type="hidden" name="role" value="REP" /> : null}
            {!isManager ? (
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">role</label>
                <select name="role" defaultValue={user.role} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="ADMIN">ADMIN</option>
                  <option value="EXEC_MANAGER">EXEC_MANAGER</option>
                  <option value="MANAGER">MANAGER</option>
                  <option value="REP">REP</option>
                </select>
              </div>
            ) : null}

            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">hierarchy_level</label>
              <select name="hierarchy_level" defaultValue={String(user.hierarchy_level)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="0">0 (Admin)</option>
                <option value="1">1 (Executive Manager)</option>
                <option value="2">2 (Manager)</option>
                <option value="3">3 (Rep)</option>
              </select>
              <p className="text-xs text-slate-500">Must match the selected role (Admin=0, Exec Manager=1, Manager=2, Rep=3).</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">first_name</label>
                <input
                  name="first_name"
                  defaultValue={user.first_name || ""}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">last_name</label>
                <input
                  name="last_name"
                  defaultValue={user.last_name || ""}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </div>
            </div>

            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">CRM Account Owner Name</label>
              <input
                name="account_owner_name"
                defaultValue={user.account_owner_name || ""}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <p className="text-xs font-medium text-red-700">
                This name is used to exactly match the Account Owner for each Opportunity in CRM used for Forecast Reviews. Please COPY and
                PASTE the name as it appears in CRM. (Required for Reps)
              </p>
            </div>

            {isAdmin ? (
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">see_all_visibility (EXEC_MANAGER/MANAGER only)</label>
                <select
                  name="see_all_visibility"
                  defaultValue={user.see_all_visibility ? "true" : "false"}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </div>
            ) : null}

            {isAdmin ? (
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-sm font-semibold text-slate-900">Manager visibility assignments</div>
                <p className="mt-1 text-xs text-slate-600">
                  If editing an EXEC_MANAGER/MANAGER and <span className="font-mono">see_all_visibility=false</span>, select which users they can see.
                </p>
                <div className="mt-2 grid gap-2">
                  {users
                    .filter((u) => u.active)
                    .filter((u) => u.id !== user.id)
                    .filter((u) => u.role !== "ADMIN")
                    .map((u) => (
                      <label key={u.public_id} className="flex items-center gap-2 text-sm text-slate-800">
                        <input
                          type="checkbox"
                          name="visible_user_public_id"
                          value={String(u.public_id)}
                          defaultChecked={visibleIds.includes(u.id)}
                          className="h-4 w-4"
                        />
                        <span>
                          {u.display_name} <span className="text-xs text-slate-500">({u.role}, level {u.hierarchy_level})</span>
                        </span>
                      </label>
                    ))}
                </div>
              </div>
            ) : null}

            {isAdmin ? (
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">manager_user</label>
                <select
                  name="manager_user_public_id"
                  defaultValue={user.manager_user_id == null ? "" : String(managers.find((m) => m.id === user.manager_user_id)?.public_id || "")}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
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
              </div>
            ) : null}

            {isAdmin ? (
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">admin_has_full_analytics_access (ADMIN only)</label>
                <select
                  name="admin_has_full_analytics_access"
                  defaultValue={user.admin_has_full_analytics_access ? "true" : "false"}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </div>
            ) : null}

            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">active</label>
              <select
                name="active"
                defaultValue={user.active ? "true" : "false"}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </div>

            <div className="mt-2 flex items-center justify-end gap-2">
              <Link href={closeHref()} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                Cancel
              </Link>
              <button className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white">Save</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "delete" && user ? (
        <Modal title={`Delete user`} closeHref={closeHref()}>
          <form action={deleteUserAction} className="grid gap-4">
            <input type="hidden" name="public_id" value={String(user.public_id)} />
            <p className="text-sm text-slate-700">
              This will permanently delete <span className="font-semibold">{user.display_name}</span> ({user.email}). This cannot
              be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Link href={closeHref()} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                Cancel
              </Link>
              <button className="rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white">Delete</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  );
}

