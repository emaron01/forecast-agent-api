import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization, getUserById, getVisibleUsers } from "../../../../lib/db";
import { resolvePublicId } from "../../../../lib/publicId";
import { UserTopNav } from "../../../_components/UserTopNav";
import { QuarterSalesForecastSummary } from "../../../forecast/_components/QuarterSalesForecastSummary";
import { QuarterRepAnalytics } from "../../_components/QuarterRepAnalytics";

export const runtime = "nodejs";

export default async function RepDashboardPage({
  params,
  searchParams,
}: {
  params: { userId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
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

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  // Render rep-facing quarter widgets for this rep user (safe: page already enforces visibility).
  const repAuthUser = {
    id: Number(repUser.id),
    public_id: String((repUser as any).public_id || ""),
    org_id: Number(repUser.org_id),
    email: String(repUser.email || ""),
    role: "REP" as const,
    hierarchy_level: Number((repUser as any).hierarchy_level ?? 3) || 3,
    display_name: String(repUser.display_name || ""),
    account_owner_name: repUser.account_owner_name == null ? null : String(repUser.account_owner_name || ""),
    manager_user_id: repUser.manager_user_id == null ? null : Number(repUser.manager_user_id),
    admin_has_full_analytics_access: !!(repUser as any).admin_has_full_analytics_access,
    see_all_visibility: !!(repUser as any).see_all_visibility,
    active: !!repUser.active,
  };

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

        <div className="mt-6">
          <QuarterSalesForecastSummary
            orgId={ctx.user.org_id}
            user={repAuthUser as any}
            currentPath={`/dashboard/rep/${encodeURIComponent(String(params.userId))}`}
            searchParams={searchParams}
          />
        </div>

        <QuarterRepAnalytics orgId={ctx.user.org_id} user={repAuthUser as any} searchParams={searchParams} />
      </main>
    </div>
  );
}

