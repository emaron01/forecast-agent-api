import Link from "next/link";
import { redirect } from "next/navigation";
import { requireManagerAdminOrMaster } from "../../lib/auth";

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

export default async function AdminHome() {
  const ctx = await requireManagerAdminOrMaster();
  if (ctx.kind === "user" && ctx.user.role === "MANAGER") redirect("/admin/users");

  const hasQuotaSetupAccess = ctx.kind === "master" || (ctx.kind === "user" && ctx.user.role === "ADMIN");
  const hasFullAnalyticsAccess =
    ctx.kind === "master" || (ctx.kind === "user" && ctx.user.role === "ADMIN" && !!ctx.user.admin_has_full_analytics_access);

  return (
    <main className="grid gap-4 md:grid-cols-3">
      {ctx.kind === "master" ? (
        <>
          <Card href="/admin/control-center" title="Owner Control Center" desc="Site map + QA panel (master only)." />
          <Card href="/admin/organizations" title="Organizations" desc="Create and manage organizations. Set your active org." />
          <Card href="/admin/all-users" title="All Users" desc="View users across all organizations." />
          <Card href="/admin/email-templates" title="Email Templates" desc="Manage welcome/invite/reset templates." />
          <Card href="/admin/ingestion" title="Ingestion" desc="Tech support: monitor staging rows and trigger processing (owner only)." />
        </>
      ) : null}
      <Card href="/admin/users" title="Users" desc="Create, edit, deactivate, and manage roles and reporting lines." />
      <Card href="/admin/excel-opportunities" title="Excel Upload" desc="Upload an Excel of opportunities and map fields." />
      <Card href="/admin/org-profile" title="Org Profile" desc="Manage organization profile fields." />
      <Card href="/admin/hierarchy" title="Sales Organization" desc="set-up, edit and review Sales Org Assignmnets." />
      <Card href="/admin/mapping-sets" title="Mapping Sets" desc="Manage mapping sets and their field mappings." />
      {hasQuotaSetupAccess ? (
        <>
          <Card href="/admin/analytics/quota-periods" title="Quota periods" desc="Manage fiscal calendar (quota periods)." />
          <Card href="/admin/analytics/quotas" title="Quotas" desc="Assign quotas to reps and manage quota sets." />
          {hasFullAnalyticsAccess ? (
            <>
              <Card href="/analytics/executive" title="Executive Analytics" desc="Company + manager + rep KPI views." />
              <Card href="/analytics/partners/executive" title="Top Partners" desc="Top partner deals by revenue (won + closed loss)." />
              <Card href="/analytics/quotas/executive" title="Executive Quotas" desc="Quota rollups and attainment (executive view)." />
              <Card href="/analytics/custom-reports" title="Custom Reports" desc="Build and save custom rep comparison reports." />
            </>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

