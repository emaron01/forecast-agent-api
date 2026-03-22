import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization } from "../../../../lib/db";
import { UserTopNav } from "../../../_components/UserTopNav";
import { SimpleForecastDashboardClient } from "../../../forecast/simple/simpleClient";

export const runtime = "nodejs";

export default async function ExecutiveSalesOpportunitiesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "REP") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-6xl p-6 space-y-4">
        {/* Optional context heading for analytics section */}
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">
            Sales Opportunities
          </h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Same Sales Opportunities table as the rep dashboard, scoped to the reps you can see based on executive
            hierarchy.
          </p>
        </div>

        {/* Uses /api/forecast/deals, which already applies getScopedRepDirectory for exec/manager visibility */}
        <SimpleForecastDashboardClient />
      </main>
    </div>
  );
}

