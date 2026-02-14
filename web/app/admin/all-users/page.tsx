import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { listAllUsersAcrossOrgs, listHierarchyLevels } from "../../../lib/db";

export const runtime = "nodejs";

export default async function AllUsersPage() {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  const hierarchyLevels = await listHierarchyLevels().catch(() => []);
  const hierarchyLabelByLevel = new Map<number, string>(
    hierarchyLevels.map((h): [number, string] => [Number(h.level), String(h.label || "").trim()])
  );
  const labelForLevel = (level: number, fallback: string) => hierarchyLabelByLevel.get(level) || fallback;

  const users = await listAllUsersAcrossOrgs({ includeInactive: true, includeSuspendedOrgs: true }).catch(
    (): Awaited<ReturnType<typeof listAllUsersAcrossOrgs>> => []
  );
  const userById = new Map<number, (typeof users)[number]>(users.map((u) => [u.id, u]));

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">All users</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Cross-org user list (SaaS owner only).</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/organizations"
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Organizations
          </Link>
          <Link
            href="/admin/control-center"
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Owner control center
          </Link>
        </div>
      </div>

      <div className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">org</th>
              <th className="px-4 py-3">user</th>
              <th className="px-4 py-3">title</th>
              <th className="px-4 py-3">email</th>
              <th className="px-4 py-3">role</th>
              <th className="px-4 py-3">hierarchy</th>
              <th className="px-4 py-3">mgr_public_id</th>
              <th className="px-4 py-3">admin_full_analytics</th>
              <th className="px-4 py-3">user_active</th>
              <th className="px-4 py-3">org_active</th>
            </tr>
          </thead>
          <tbody>
            {users.length ? (
              users.map((u) => (
                <tr key={u.public_id} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3">
                    <div className="text-[color:var(--sf-text-primary)]">{u.org_name}</div>
                    <div className="font-mono text-xs text-[color:var(--sf-text-disabled)]">{u.org_public_id}</div>
                  </td>
                  <td className="px-4 py-3">{u.display_name}</td>
                  <td className="px-4 py-3">{u.title || ""}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">{labelForLevel(Number(u.hierarchy_level), u.role)}</td>
                  <td className="px-4 py-3">{u.hierarchy_level}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {u.manager_user_id != null ? userById.get(u.manager_user_id)?.public_id || "" : ""}
                  </td>
                  <td className="px-4 py-3">{u.admin_has_full_analytics_access ? "true" : "false"}</td>
                  <td className="px-4 py-3">{u.active ? "true" : "false"}</td>
                  <td className="px-4 py-3">{u.org_active ? "true" : "false"}</td>
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
    </main>
  );
}

