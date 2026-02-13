import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization, getUserById, getVisibleUsers, listRecentOpportunitiesForAccountOwner } from "../../../../lib/db";
import { resolvePublicId } from "../../../../lib/publicId";
import { UserTopNav } from "../../../_components/UserTopNav";
import { dateOnly } from "../../../../lib/dateOnly";

export const runtime = "nodejs";

export default async function RepDashboardPage({ params }: { params: { userId: string } }) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role !== "ADMIN" && ctx.user.role !== "EXEC_MANAGER" && ctx.user.role !== "MANAGER") redirect("/dashboard");

  const userId = await resolvePublicId("users", params.userId).catch(() => 0);
  if (!userId) redirect("/dashboard");

  const repUser = await getUserById({ orgId: ctx.user.org_id, userId });
  if (!repUser || repUser.role !== "REP") redirect("/dashboard");

  if (ctx.user.role === "MANAGER" || ctx.user.role === "EXEC_MANAGER") {
    // Managers can only view dashboards for visible reps.
    const visible = await getVisibleUsers({
      currentUserId: ctx.user.id,
      orgId: ctx.user.org_id,
      role: ctx.user.role,
      hierarchy_level: ctx.user.hierarchy_level,
      see_all_visibility: ctx.user.see_all_visibility,
    }).catch(() => []);
    if (!visible.some((u) => u.id === repUser.id && u.role === "REP")) redirect("/dashboard");
  }

  const opportunities = await listRecentOpportunitiesForAccountOwner({
    orgId: ctx.user.org_id,
    accountOwnerName: repUser.account_owner_name || "",
    limit: 50,
  }).catch(() => []);

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-6xl p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">{repUser.display_name}</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              {repUser.email} · account_owner_name: {repUser.account_owner_name}
            </p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Back to dashboard
          </Link>
        </header>

        <section className="mt-6 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Recent opportunities</h2>
          <div className="mt-3 overflow-auto rounded-md border border-[color:var(--sf-border)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
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
                    <tr key={o.public_id} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-4 py-3 font-mono text-xs">{o.public_id}</td>
                      <td className="px-4 py-3">{o.account_name || ""}</td>
                      <td className="px-4 py-3">{o.opportunity_name || ""}</td>
                      <td className="px-4 py-3">{o.amount ?? ""}</td>
                      <td className="px-4 py-3">{dateOnly(o.close_date) || ""}</td>
                      <td className="px-4 py-3 font-mono text-xs">{dateOnly(o.updated_at) || ""}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]" colSpan={6}>
                      No opportunities found for "{repUser.account_owner_name}".
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

