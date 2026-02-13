import { redirect } from "next/navigation";
import { requireAuth } from "../../lib/auth";
import { getOrganization } from "../../lib/db";
import { UserTopNav } from "../_components/UserTopNav";
import Link from "next/link";

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

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Analytics</h1>
        <p className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">
          Quota attainment dashboards and stage comparisons.
        </p>

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <Card href="/analytics/attainment" title="Attainment dashboards" desc="Rep → Manager → VP → CRO roll-ups for a quota period." />
          <Card href="/analytics/comparisons" title="Comparisons" desc="CRM Forecast Stage vs AI Forecast Stage + quota attainment." />
          {ctx.user.role === "ADMIN" ? (
            <Card href="/analytics/quotas/admin" title="Quotas (Admin)" desc="Admin quota management." />
          ) : null}
          {ctx.user.role === "MANAGER" ? (
            <Card href="/analytics/quotas/manager" title="Team Quotas" desc="Assign quotas to direct reports + team rollups." />
          ) : null}
          {ctx.user.role === "EXEC_MANAGER" ? (
            <Card href="/analytics/quotas/executive" title="Company Quotas" desc="Company-wide quota rollup + pacing." />
          ) : null}
        </section>
      </main>
    </div>
  );
}

