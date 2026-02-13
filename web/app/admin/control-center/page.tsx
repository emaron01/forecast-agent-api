import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";

export const runtime = "nodejs";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">{title}</h2>
      <div className="mt-3 grid gap-2">{children}</div>
    </section>
  );
}

function Item({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="rounded-lg border border-[color:var(--sf-border)] p-4 hover:border-[color:var(--sf-accent-secondary)]">
      <div className="font-medium text-[color:var(--sf-text-primary)]">{title}</div>
      <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">{desc}</div>
    </Link>
  );
}

export default async function OwnerControlCenterPage() {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  const activeOrg = ctx.orgId ? await getOrganization({ id: ctx.orgId }).catch(() => null) : null;

  return (
    <main className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">SaaS Owner Control Center</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Site map + QA panel (master only).</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/organizations"
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Organizations
          </Link>
          <Link href="/admin" className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
            Admin home
          </Link>
        </div>
      </header>

      {!activeOrg ? (
        <div className="rounded-xl border border-[#F1C40F] bg-[color:var(--sf-surface-alt)] px-5 py-4 text-sm text-[color:var(--sf-text-primary)]">
          <div className="font-semibold">No active organization selected</div>
          <div className="mt-1 text-[color:var(--sf-text-secondary)]">
            Org-scoped pages (Users/Reps/Ingestion/Mapping Sets/Org Profile) require an active org. Set it on{" "}
            <Link href="/admin/organizations" className="font-medium underline">
              Organizations
            </Link>
            .
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-5 py-4 text-sm text-[color:var(--sf-text-primary)]">
          <div className="font-semibold">Active organization</div>
          <div className="mt-1">
            <span className="font-medium">{activeOrg.name}</span>{" "}
            <span className="font-mono text-xs text-[color:var(--sf-text-disabled)]">{activeOrg.public_id}</span>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="1. SaaS Owner (master) tasks">
          <Item href="/admin/organizations?modal=new" title="Create organization" desc="Create a new customer organization." />
          <Item href="/admin/organizations" title="Organizations" desc="List orgs + set active org context." />
          <Item href="/admin/all-users" title="All users (cross-org)" desc="Support/QA view across all orgs." />
          <Item href="/admin/email-templates" title="Email templates" desc="Manage welcome/invite/reset templates." />
          <Item href="/api/db-check" title="DB check" desc="Health/status endpoint (admin/master only)." />
        </Section>

        <Section title="2. Active org (org-scoped) tasks">
          <Item href="/admin/users" title="Users" desc="Create/edit users, roles, reporting lines (active org)." />
          <Item href="/admin/reps" title="Reps" desc="Manage reps + reporting relationships (active org)." />
          <Item href="/admin/org-profile" title="Org profile" desc="Org profile editor (active org)." />
          <Item href="/admin/hierarchy" title="Hierarchy tree" desc="View org hierarchy + manager chain (active org)." />
        </Section>

        <Section title="3. Ingestion + mappings (active org)">
          <Item href="/admin/mapping-sets" title="Mapping sets" desc="Create mapping sets + field mappings." />
          <Item href="/admin/ingestion" title="Ingestion" desc="View staging rows, retry failures, trigger processing." />
          <Item href="/admin/excel-opportunities" title="Excel opportunities upload" desc="Upload Excel, map fields, ingest opportunities." />
        </Section>

        <Section title="4. System utilities (placeholders)">
          <Item href="/admin/system/logs" title="View System Logs (placeholder)" desc="Placeholder page for future log viewing." />
          <Item href="/admin/system/ingestion-status" title="View Ingestion Status (placeholder)" desc="Placeholder page for ingestion monitoring." />
          <Item href="/admin/system/test-emails" title="Trigger Test Emails (stub)" desc="Stub to exercise email templating." />
          <Item href="/admin/system/test-notifications" title="Trigger Test Notifications (stub)" desc="Stub page for future notifications." />
        </Section>

        <Section title="5. App pages (for testing)">
          <Item href="/dashboard" title="Dashboard" desc="Role-based dashboard routing." />
          <Item href="/admin" title="Admin home" desc="Admin landing page cards." />
          <Item href="/admin/users" title="Users" desc="Users + reporting lines UI." />
          <Item href="/admin/reps" title="Reps" desc="Rep management UI." />
          <Item href="/admin/mapping-sets" title="Mapping sets" desc="Mapping sets + field mappings UI." />
          <Item href="/admin/ingestion" title="Ingestion" desc="Staging rows UI." />
          <Item href="/admin/analytics" title="Admin Analytics" desc="Admin analytics landing page." />
          <Item href="/admin/analytics/quota-periods" title="Admin quota periods" desc="Manage quota_periods." />
          <Item href="/admin/analytics/quotas" title="Admin quotas" desc="Manage quotas." />
          <Item href="/admin/analytics/quota-rollups" title="Admin quota rollups" desc="Quota rollups by level." />
          <Item href="/admin/analytics/attainment" title="Admin attainment" desc="Attainment dashboards." />
          <Item href="/admin/analytics/comparisons" title="Admin comparisons" desc="Stage comparisons + attainment." />
          <Item href="/analytics/quotas/admin" title="/analytics/quotas/admin" desc="Admin-only quota management (org user)." />
          <Item href="/analytics/quotas/manager" title="/analytics/quotas/manager" desc="Manager-only team quotas (org user)." />
          <Item href="/analytics/quotas/executive" title="/analytics/quotas/executive" desc="Executive-only company quotas (org user)." />
          <Item href="/login" title="Login Page" desc="Login flow." />
          <Item href="/forgot-password" title="Forgot Password Page" desc="Password reset request flow." />
          <Item href="/reset-password" title="Reset Password Page" desc="Password reset set-new-password flow." />
        </Section>
      </div>
    </main>
  );
}

