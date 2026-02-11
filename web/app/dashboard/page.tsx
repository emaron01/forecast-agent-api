import Link from "next/link";
import { requireAuth } from "../../lib/auth";
import { getOrganization, getVisibleUsers, listRecentOpportunitiesForAccountOwner } from "../../lib/db";
import { redirect } from "next/navigation";
import { UserTopNav } from "../_components/UserTopNav";

export const runtime = "nodejs";

function ActionCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-300">
      <div className="text-base font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-600">{desc}</div>
    </Link>
  );
}

export default async function DashboardPage() {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "ADMIN") redirect("/admin");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  if (ctx.user.role === "MANAGER") {
    const reps = (
      await getVisibleUsers({
        currentUserId: ctx.user.id,
        orgId: ctx.user.org_id,
        role: "MANAGER",
        hierarchy_level: ctx.user.hierarchy_level,
        see_all_visibility: ctx.user.see_all_visibility,
      }).catch(() => [])
    ).filter((u) => u.role === "REP" && u.active);

    return (
      <div className="min-h-screen bg-slate-50">
        <UserTopNav orgName={orgName} user={ctx.user} />
        <main className="mx-auto max-w-6xl p-6">
          <header>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">
              Signed in as {ctx.user.display_name} ({ctx.user.email})
            </p>
          </header>

          <section className="mt-6 grid gap-4 md:grid-cols-3">
            <ActionCard href="/analytics" title="Analytics" desc="Stub (coming soon)." />
            <ActionCard href="/forecast" title="Sales Forecaster" desc="Open Matthew’s Forecast Agent dashboard." />
            <ActionCard href="/dashboard/excel-upload" title="Upload Opportunities" desc="Upload an Excel file of opportunities." />
          </section>

          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">My reps</h2>
              <Link href="/admin/users" className="text-sm text-indigo-700 hover:underline">
                Manage reps
              </Link>
            </div>
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
                      <tr key={u.public_id} className="border-t border-slate-100">
                        <td className="px-4 py-3">{u.display_name}</td>
                        <td className="px-4 py-3">{u.email}</td>
                        <td className="px-4 py-3">{u.account_owner_name}</td>
                        <td className="px-4 py-3 text-right">
                          <Link className="text-indigo-700 hover:underline" href={`/dashboard/rep/${encodeURIComponent(String(u.public_id))}`}>
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
      </div>
    );
  }

  // REP
  const opportunities = await listRecentOpportunitiesForAccountOwner({
    orgId: ctx.user.org_id,
    accountOwnerName: ctx.user.account_owner_name || "",
    limit: 50,
  }).catch(() => []);

  return (
    <div className="min-h-screen bg-slate-50">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-6xl p-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as {ctx.user.display_name} ({ctx.user.email})
          </p>
        </header>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <ActionCard href="/analytics" title="Analytics" desc="Stub (coming soon)." />
          <ActionCard href="/forecast" title="Sales Forecaster" desc="Open Matthew’s Forecast Agent dashboard." />
          <ActionCard href="/dashboard/excel-upload" title="Upload Opportunities" desc="Upload an Excel file of opportunities." />
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Recent opportunities</h2>
          <div className="mt-3 overflow-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3">public_id</th>
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
                    <tr key={o.public_id} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-mono text-xs">{o.public_id}</td>
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
    </div>
  );
}

