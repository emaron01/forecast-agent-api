import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "../../../actions/auth";
import { requireAuth } from "../../../../lib/auth";
import { getUserById, getVisibleUsers, listRecentOpportunitiesForAccountOwner } from "../../../../lib/db";

export const runtime = "nodejs";

export default async function RepDashboardPage({ params }: { params: { userId: string } }) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role !== "ADMIN" && ctx.user.role !== "MANAGER") redirect("/dashboard");
  if (ctx.user.role === "ADMIN" && !ctx.user.admin_has_full_analytics_access) redirect("/admin/users");

  const userId = Number(params.userId);
  if (!userId) redirect("/dashboard");

  const repUser = await getUserById({ orgId: ctx.user.org_id, userId });
  if (!repUser || repUser.role !== "REP") redirect("/dashboard");

  if (ctx.user.role === "MANAGER") {
    // Managers can only view dashboards for their reps.
    const visible = await getVisibleUsers({
      currentUserId: ctx.user.id,
      orgId: ctx.user.org_id,
      role: "MANAGER",
    }).catch(() => []);
    if (!visible.some((u) => u.id === repUser.id && u.role === "REP")) redirect("/dashboard");
  }

  const opportunities = await listRecentOpportunitiesForAccountOwner({
    orgId: ctx.user.org_id,
    accountOwnerName: repUser.account_owner_name,
    limit: 50,
  }).catch(() => []);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{repUser.display_name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {repUser.email} · account_owner_name: {repUser.account_owner_name}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-indigo-700 hover:underline">
            Back
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
                    No opportunities found for "{repUser.account_owner_name}".
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

