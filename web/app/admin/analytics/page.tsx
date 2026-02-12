import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrgContext } from "../../../lib/auth";

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

export default async function AdminAnalyticsHome() {
  const { ctx } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  return (
    <main>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Analytics</h1>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Quota calendar, quota assignments, roll-ups, and dashboards.</p>
      </div>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <Card href="/admin/analytics/quota-periods" title="Fiscal calendar" desc="Manage quota periods (quota_periods)." />
        <Card href="/admin/analytics/quotas" title="Quota assignments" desc="Assign quotas to reps, managers, VPs, and CRO." />
        <Card href="/admin/analytics/quota-rollups" title="Quota roll-ups" desc="View quota roll-ups by level." />
        <Card href="/admin/analytics/attainment" title="Attainment dashboards" desc="View attainment dashboards." />
        <Card href="/admin/analytics/comparisons" title="Comparisons" desc="Compare CRM vs AI stages and quota attainment." />
      </section>

      <section className="mt-6 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Navigation</h2>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Quick links to all analytics pages:</p>
        <ul className="mt-3 grid gap-2 text-sm">
          <li>
            <Link className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline" href="/admin/analytics/quota-periods">
              /admin/analytics/quota-periods
            </Link>
          </li>
          <li>
            <Link className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline" href="/admin/analytics/quotas">
              /admin/analytics/quotas
            </Link>
          </li>
          <li>
            <Link className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline" href="/admin/analytics/quota-rollups">
              /admin/analytics/quota-rollups
            </Link>
          </li>
          <li>
            <Link className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline" href="/admin/analytics/attainment">
              /admin/analytics/attainment
            </Link>
          </li>
          <li>
            <Link className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline" href="/admin/analytics/comparisons">
              /admin/analytics/comparisons
            </Link>
          </li>
        </ul>
      </section>
    </main>
  );
}

