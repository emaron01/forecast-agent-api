import { requireAuth } from "../../lib/auth";
import { getOrganization } from "../../lib/db";
import { redirect } from "next/navigation";
import { UserTopNav } from "../_components/UserTopNav";
import { QuarterSalesForecastSummary } from "../forecast/_components/QuarterSalesForecastSummary";
import { RepDashboardHero } from "./_components/RepDashboardHero";

export const runtime = "nodejs";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "ADMIN") redirect("/admin");
  // Make the Executive Dashboard the primary dashboard for leadership roles.
  if (ctx.user.role === "MANAGER" || ctx.user.role === "EXEC_MANAGER") redirect("/dashboard/executive");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  // REP: role-based HERO + Sales Opportunities (QuarterSalesForecastSummary scopes by user so rep sees only their data).
  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-6xl p-6">
        <RepDashboardHero user={ctx.user} orgName={orgName} />

        <section className="mt-6" aria-label="Sales Opportunities">
          <h2 className="sr-only">Sales Opportunities</h2>
          <QuarterSalesForecastSummary
            orgId={ctx.user.org_id}
            user={ctx.user}
            currentPath="/dashboard"
            searchParams={searchParams}
          />
        </section>
      </main>
    </div>
  );
}

