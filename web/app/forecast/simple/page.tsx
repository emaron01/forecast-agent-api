import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { UserTopNav } from "../../_components/UserTopNav";
import { SimpleForecastDashboardClient } from "./simpleClient";
import { QuarterSalesForecastSummary } from "../_components/QuarterSalesForecastSummary";

export const runtime = "nodejs";

export default async function SimpleForecastPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "ADMIN") redirect("/admin");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const repFilterLocked = ctx.user.role === "REP";
  const defaultRepName = repFilterLocked ? String(ctx.user.account_owner_name || "") : "";

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-6xl p-6">
        <QuarterSalesForecastSummary orgId={ctx.user.org_id} user={ctx.user} currentPath="/forecast/simple" searchParams={searchParams} />
        <SimpleForecastDashboardClient defaultRepName={defaultRepName} repFilterLocked={repFilterLocked} />
      </main>
    </div>
  );
}

