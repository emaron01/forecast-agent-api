import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getOrganization, getVisibleUsers } from "../../../lib/db";
import { UserTopNav } from "../../_components/UserTopNav";
import { QuarterSalesForecastSummary } from "../../forecast/_components/QuarterSalesForecastSummary";

export const runtime = "nodejs";

function ActionCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center justify-center rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 text-center shadow-sm hover:border-[color:var(--sf-accent-secondary)]"
    >
      <div className="text-sectionTitle text-[color:var(--sf-text-primary)]">{title}</div>
      <div className="mt-1 text-meta">{desc}</div>
    </Link>
  );
}

export default async function AnalyticsDetailDashboardPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "ADMIN") redirect("/admin");
  if (ctx.user.role === "REP") redirect("/dashboard");
  if (ctx.user.role !== "MANAGER" && ctx.user.role !== "EXEC_MANAGER") redirect("/analytics");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const reps =
    ctx.user.role === "MANAGER"
      ? (
          await getVisibleUsers({
            currentUserId: ctx.user.id,
            orgId: ctx.user.org_id,
            role: "MANAGER",
            hierarchy_level: ctx.user.hierarchy_level,
            see_all_visibility: ctx.user.see_all_visibility,
          }).catch(() => [])
        ).filter((u) => u.role === "REP" && u.active)
      : [];

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-6xl p-6 num-tabular">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-pageTitle text-[color:var(--sf-text-primary)]">Detail dashboard</h1>
            <p className="mt-1 text-body text-[color:var(--sf-text-secondary)]">
              Under Analytics as a report.{" "}
              <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/dashboard/executive">
                Back to Executive Dashboard
              </Link>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/executive"
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
            >
              Executive Dashboard
            </Link>
          </div>
        </header>

        <div className="mt-6">
          <QuarterSalesForecastSummary orgId={ctx.user.org_id} user={ctx.user} currentPath="/analytics/detail-dashboard" searchParams={searchParams} />
        </div>

        {ctx.user.role === "MANAGER" ? (
          <section className="mt-6 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sectionTitle text-[color:var(--sf-text-primary)]">My reps</h2>
              <Link
                href="/admin/users"
                className="text-sm text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline"
              >
                Manage reps
              </Link>
            </div>
            <div className="mt-3 overflow-auto rounded-md border border-[color:var(--sf-border)]">
              <table className="w-full text-left">
                <thead className="bg-[color:var(--sf-surface-alt)] text-tableLabel">
                  <tr>
                    <th className="px-4 py-3">name</th>
                    <th className="px-4 py-3">email</th>
                    <th className="px-4 py-3">account_owner_name</th>
                    <th className="px-4 py-3 text-right">dashboard</th>
                  </tr>
                </thead>
                <tbody className="text-tableValue text-[color:var(--sf-text-primary)]">
                  {reps.length ? (
                    reps.map((u) => (
                      <tr key={u.public_id} className="border-t border-[color:var(--sf-border)]">
                        <td className="px-4 py-3">{u.display_name}</td>
                        <td className="px-4 py-3">{u.email}</td>
                        <td className="px-4 py-3">{u.account_owner_name}</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline"
                            href={`/dashboard/rep/${encodeURIComponent(String(u.public_id))}`}
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]" colSpan={4}>
                        No reps assigned to you.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <ActionCard href="/dashboard/executive" title="Executive Dashboard" desc="Primary executive dashboard." />
          <ActionCard href="/analytics" title="Analytics" desc="KPIs, comparisons, quotas, and reporting." />
          {ctx.user.role === "MANAGER" ? (
            <ActionCard href="/analytics/quotas/manager" title="Team Quotas" desc="Assign quotas to direct reports + team rollups." />
          ) : null}
          <ActionCard href="/forecast" title="Sales Opportunities" desc="Primary rep opportunities dashboard." />
          <ActionCard href="/dashboard/excel-upload" title="Upload Opportunities" desc="Upload an Excel file of opportunities." />
        </section>
      </main>
    </div>
  );
}

