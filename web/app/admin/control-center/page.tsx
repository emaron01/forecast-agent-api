import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";

export const runtime = "nodejs";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="mt-3 grid gap-2">{children}</div>
    </section>
  );
}

function Item({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="rounded-lg border border-slate-200 p-4 hover:border-slate-300">
      <div className="font-medium text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-600">{desc}</div>
    </Link>
  );
}

export default async function OwnerControlCenterPage() {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  return (
    <main className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">SaaS Owner Control Center</h1>
          <p className="mt-1 text-sm text-slate-600">Site map + QA panel (master only).</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/organizations" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
            Organizations
          </Link>
          <Link href="/admin" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
            Admin home
          </Link>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="1. Organization Management">
          <Item href="/admin/organizations?modal=new" title="Create Organization" desc="Create a new customer organization." />
          <Item href="/admin/organizations" title="List Organizations" desc="View all orgs and set active org context." />
          <Item href="/admin/organizations" title="Edit Organization" desc="Edit org name/status (and profile fields once added)." />
          <Item href="/admin/organizations" title="Suspend / Reactivate Organization" desc="Toggle organization active flag." />
        </Section>

        <Section title="2. User Management">
          <Item href="/admin/all-users" title="List All Users (across all orgs)" desc="Cross-org view for support and QA." />
          <Item href="/admin/users" title="User Management (org admin view)" desc="Create/edit users within the active org." />
          <Item href="/admin/users?modal=new" title="Create First Admin for Org" desc="Set active org, then create ADMIN user." />
          <Item href="/admin/users" title="Suspend / Reactivate User" desc="Toggle user active flag within org." />
        </Section>

        <Section title="3. Email Templates">
          <Item href="/admin/email-templates" title="Welcome Email Template" desc="Edit the welcome email stub." />
          <Item href="/admin/email-templates" title="Invite Email Template" desc="Edit invite email stub." />
          <Item href="/admin/email-templates" title="Password Reset Template" desc="Edit reset email stub." />
        </Section>

        <Section title="4. System Utilities">
          <Item href="/admin/system/logs" title="View System Logs (placeholder)" desc="Placeholder page for future log viewing." />
          <Item href="/admin/system/ingestion-status" title="View Ingestion Status (placeholder)" desc="Placeholder page for ingestion monitoring." />
          <Item href="/admin/system/test-emails" title="Trigger Test Emails (stub)" desc="Stub to exercise email templating." />
          <Item href="/admin/system/test-notifications" title="Trigger Test Notifications (stub)" desc="Stub page for future notifications." />
        </Section>

        <Section title="5. Application Pages (for testing)">
          <Item href="/dashboard" title="Dashboard" desc="Role-based dashboard routing." />
          <Item href="/admin/users" title="User Management" desc="Users + reporting lines UI." />
          <Item href="/admin/excel-opportunities" title="Excel Opportunities Upload" desc="Upload Excel, map fields, and ingest opportunities." />
          <Item href="/admin/org-profile" title="Org Profile Page" desc="Org profile editor (to be implemented)." />
          <Item href="/admin/hierarchy" title="Hierarchy Tree" desc="Org hierarchy view (to be implemented)." />
          <Item href="/login" title="Login Page" desc="Login flow." />
          <Item href="/forgot-password" title="Forgot Password Page" desc="Password reset request flow." />
          <Item href="/reset-password" title="Reset Password Page" desc="Password reset set-new-password flow." />
        </Section>
      </div>
    </main>
  );
}

