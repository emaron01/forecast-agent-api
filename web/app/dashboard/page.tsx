import Link from "next/link";
import { logoutAction } from "../actions/auth";
import { requireAuth } from "../../lib/auth";
import { getVisibleUsers, listRecentOpportunitiesForAccountOwner } from "../../lib/db";
import { redirect } from "next/navigation";

export const runtime = "nodejs";

export default async function DashboardPage() {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "ADMIN") redirect("/admin");

  if (ctx.user.role === "MANAGER") {
    const reps = (
      await getVisibleUsers({ currentUserId: ctx.user.id, orgId: ctx.user.org_id, role: "MANAGER" }).catch(() => [])
    ).filter((u) => u.role === "REP" && u.active);

    return (
      <main className="mx-auto max-w-6xl p-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Manager dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">
              Signed in as {ctx.user.display_name} ({ctx.user.email})
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/account" className="text-sm text-indigo-700 hover:underline">
              Account
            </Link>
            <Link href="/admin/users" className="text-sm text-indigo-700 hover:underline">
              Manage reps
            </Link>
            <form action={logoutAction}>
              <button className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50">Sign out</button>
            </form>
          </div>
        </header>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">My reps</h2>
          <div className="mt-3 overflow-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3">name</th>
                  <th className="px-4 py-3">email</th>
                  <th className="px-4 py-3">account_owner_name</th>
                  <th className="px-4 py-3 text-right">dashboard</th>
                </tr>
              </thead>
              <tbody>
                {reps.length ? (
                  reps.map((u) => (
                    <tr key={u.id} className="border-t border-slate-100">
                      <td className="px-4 py-3">{u.display_name}</td>
                      <td className="px-4 py-3">{u.email}</td>
                      <td className="px-4 py-3">{u.account_owner_name}</td>
                      <td className="px-4 py-3 text-right">
                        <Link className="text-indigo-700 hover:underline" href={`/dashboard/rep/${encodeURIComponent(String(u.id))}`}>
                          View
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>
                      No reps assigned to you.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    );
  }

  // REP
  const opportunities = await listRecentOpportunitiesForAccountOwner({
    orgId: ctx.user.org_id,
    accountOwnerName: ctx.user.account_owner_name,
    limit: 50,
  }).catch(() => []);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">My dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as {ctx.user.display_name} ({ctx.user.email})
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/account" className="text-sm text-indigo-700 hover:underline">
            Account
          </Link>
          <form action={logoutAction}>
            <button className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50">Sign out</button>
          </form>
        </div>
      </header>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Recent opportunities</h2>
        <div className="mt-3 overflow-auto rounded-md border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3">id</th>
                <th className="px-4 py-3">account</th>
                <th className="px-4 py-3">opportunity</th>
                <th className="px-4 py-3">amount</th>
                <th className="px-4 py-3">close</th>
                <th className="px-4 py-3">updated</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.length ? (
                opportunities.map((o) => (
                  <tr key={o.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-mono text-xs">{o.id}</td>
                    <td className="px-4 py-3">{o.account_name || ""}</td>
                    <td className="px-4 py-3">{o.opportunity_name || ""}</td>
                    <td className="px-4 py-3">{o.amount ?? ""}</td>
                    <td className="px-4 py-3">{o.close_date ?? ""}</td>
                    <td className="px-4 py-3 font-mono text-xs">{o.updated_at ?? ""}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                    No opportunities found for "{ctx.user.account_owner_name}".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

