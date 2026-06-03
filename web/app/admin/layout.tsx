import Link from "next/link";
import "../globals.css";
import { requireManagerAdminOrMaster } from "../../lib/auth";
import { getOrganization } from "../../lib/db";
import { isAdmin, isSalesLeader } from "../../lib/roleHelpers";
import { UserProfileBadge } from "../_components/UserProfileBadge";
import { AdminNav } from "./AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireManagerAdminOrMaster();

  const orgId = ctx.kind === "user" ? ctx.user.org_id : ctx.orgId || 0;
  const org = orgId ? await getOrganization({ id: orgId }).catch(() => null) : null;
  const orgName = org?.name || (ctx.kind === "master" ? "SaaS Owner" : "Organization");
  const displayName = ctx.kind === "user" ? ctx.user.display_name : ctx.email;
  const email = ctx.kind === "user" ? ctx.user.email : ctx.email;
  const hasQuotaSetupAccess = ctx.kind === "master" || (ctx.kind === "user" && isAdmin(ctx.user));
  const isMaster = ctx.kind === "master";
  const isSalesLeaderUser = ctx.kind === "user" && isSalesLeader(ctx.user);
  const isAdminUser = ctx.kind === "user" && isAdmin(ctx.user);

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <header className="border-b border-[color:var(--sf-nav-border)] bg-[color:var(--sf-nav-background)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-2.5">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-sm font-semibold tracking-tight text-[color:var(--sf-text-primary)]">
              Admin Dashboard
            </Link>
            <AdminNav
              isMaster={isMaster}
              isSalesLeader={isSalesLeaderUser}
              isAdminUser={isAdminUser}
              hasQuotaSetupAccess={hasQuotaSetupAccess}
            />
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)]">
              Dashboard
            </Link>
            <UserProfileBadge orgName={orgName} displayName={displayName} email={email} showAccountLink={ctx.kind === "user"} />
          </div>
        </div>
      </header>
      <div className="mx-auto min-w-0 max-w-7xl overflow-x-auto px-6 py-6">{children}</div>
    </div>
  );
}

