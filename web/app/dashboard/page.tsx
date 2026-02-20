import Link from "next/link";
import { requireAuth } from "../../lib/auth";
import { getOrganization } from "../../lib/db";
import { redirect } from "next/navigation";
import { UserTopNav } from "../_components/UserTopNav";
import { QuarterSalesForecastSummary } from "../forecast/_components/QuarterSalesForecastSummary";
import { QuarterRepAnalytics } from "./_components/QuarterRepAnalytics";

export const runtime = "nodejs";

function ActionCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center justify-center rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 text-center shadow-sm hover:border-[color:var(--sf-accent-secondary)]"
    >
      <div className="text-base font-semibold text-[color:var(--sf-text-primary)]">{title}</div>
      <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">{desc}</div>
    </Link>
  );
}

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

  // REP
  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-6xl p-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Dashboard</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Signed in as {ctx.user.display_name} ({ctx.user.email})
          </p>
        </header>

        <div className="mt-6">
          <QuarterSalesForecastSummary
            orgId={ctx.user.org_id}
            user={ctx.user}
            currentPath="/dashboard"
            searchParams={searchParams}
          />
        </div>

        <QuarterRepAnalytics orgId={ctx.user.org_id} user={ctx.user} searchParams={searchParams} />

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <ActionCard href="/forecast/meddpicc-heatmap" title="Analytics" desc="MEDDPICC+TB Heatmap (Timing + Budget)." />
          <ActionCard href="/forecast" title="Sales Opportunities" desc="Primary rep opportunities dashboard." />
          <ActionCard href="/dashboard/excel-upload" title="Upload Opportunities" desc="Upload an Excel file of opportunities." />
        </section>
      </main>
    </div>
  );
}

