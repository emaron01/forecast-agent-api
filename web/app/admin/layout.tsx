import Link from "next/link";
import "../globals.css";
import { requireManagerAdminOrMaster } from "../../lib/auth";
import { getOrganization } from "../../lib/db";
import { UserProfileBadge } from "../_components/UserProfileBadge";

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md px-2 py-1.5 text-[13px] font-medium text-[color:var(--sf-nav-text)] hover:bg-[color:var(--sf-surface-alt)] hover:text-[color:var(--sf-nav-hover)]"
    >
      {label}
    </Link>
  );
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireManagerAdminOrMaster();

  const orgId = ctx.kind === "user" ? ctx.user.org_id : ctx.orgId || 0;
  const org = orgId ? await getOrganization({ id: orgId }).catch(() => null) : null;
  const orgName = org?.name || (ctx.kind === "master" ? "SaaS Owner" : "Organization");
  const displayName = ctx.kind === "user" ? ctx.user.display_name : ctx.email;
  const email = ctx.kind === "user" ? ctx.user.email : ctx.email;
  const hasAdminAnalyticsAccess =
    ctx.kind === "master" || (ctx.kind === "user" && ctx.user.role === "ADMIN" && !!ctx.user.admin_has_full_analytics_access);

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <header className="border-b border-[color:var(--sf-nav-border)] bg-[color:var(--sf-nav-background)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-2.5">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-sm font-semibold tracking-tight text-[color:var(--sf-text-primary)]">
              Admin Dashboard
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {ctx.kind === "master" ? (
                <>
                  <NavLink href="/admin/control-center" label="Control Center" />
                  <NavLink href="/admin/organizations" label="Organizations" />
                  <NavLink href="/admin/all-users" label="All Users" />
                  <NavLink href="/admin/email-templates" label="Email Templates" />
                  <NavLink href="/admin/ingestion" label="Ingestion" />
                </>
              ) : null}
              <NavLink href="/admin/users" label="Users" />
              <NavLink href="/admin/excel-opportunities" label="Excel Upload" />
              {ctx.kind === "user" && ctx.user.role === "MANAGER" ? null : (
                <>
                  <NavLink href="/admin/org-profile" label="Org Profile" />
                  <NavLink href="/admin/hierarchy" label="Sales Organization" />
                  <NavLink href="/admin/mapping-sets" label="Mapping Sets" />
                  {hasAdminAnalyticsAccess ? <NavLink href="/admin/analytics" label="Analytics" /> : null}
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)]">
              Dashboard
            </Link>
            <UserProfileBadge orgName={orgName} displayName={displayName} email={email} showAccountLink={ctx.kind === "user"} />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>
    </div>
  );
}

