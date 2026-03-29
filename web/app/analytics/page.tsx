import { redirect } from "next/navigation";
import { requireAuth } from "../../lib/auth";
import { getOrganization } from "../../lib/db";
import { UserTopNav } from "../_components/UserTopNav";
import Link from "next/link";
import { HIERARCHY, isAdmin, isManager, isSalesLeader } from "../../lib/roleHelpers";

export const runtime = "nodejs";

function Card({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm hover:border-[color:var(--sf-accent-secondary)]"
    >
      <div className="text-base font-semibold text-[color:var(--sf-text-primary)]">{title}</div>
      <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">{desc}</div>
    </Link>
  );
}

export default async function AnalyticsPage() {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.hierarchy_level === HIERARCHY.REP || ctx.user.hierarchy_level === HIERARCHY.CHANNEL_REP) redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const u = ctx.user;
  const cardCount =
    (isAdmin(u) ? 1 : 0) +
    (isManager(u) ? 1 : 0) +
    (isSalesLeader(u) ? 1 : 0) +
    (isSalesLeader(u) ? 1 : 0);

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Analytics</h1>
        <p className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">
          KPI dashboards, comparisons, quotas, and reporting.
        </p>

        {cardCount < 2 ? (
          <p className="mt-4 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-4 py-3 text-sm text-[color:var(--sf-text-secondary)]">
            Additional analytics are available in the Executive Dashboard tabs.{" "}
            <Link href="/dashboard/executive" className="font-medium text-[color:var(--sf-accent-secondary)] hover:underline">
              Open Executive Dashboard
            </Link>
            .
          </p>
        ) : null}

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          {isAdmin(ctx.user) ? (
            <Card href="/analytics/quotas/admin" title="Quotas (Admin)" desc="Admin quota management." />
          ) : null}
          {isManager(ctx.user) ? (
            <Card href="/analytics/quotas/manager" title="Team Quotas" desc="Assign quotas to direct reports + team rollups." />
          ) : null}
          {isSalesLeader(ctx.user) ? (
            <Card href="/analytics/quotas/executive" title="Top Deals" desc="Top Won + Closed Loss deals for the selected quarter (sortable)." />
          ) : null}
          {isSalesLeader(ctx.user) ? (
            <Card
              href="/analytics/executive/sales-opportunities"
              title="Sales Opportunities (Exec)"
              desc="Sales Opportunities table scoped to your team, with health and forecast context."
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}
