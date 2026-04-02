import Image from "next/image";
import Link from "next/link";
import type { AuthUser } from "../../lib/auth";
import { isAdmin, isChannelExec, isChannelManager, isSalesLeader, isSalesRep } from "../../lib/roleHelpers";
import { UserProfileBadge } from "./UserProfileBadge";

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md px-2 py-0.5 text-[12px] font-medium leading-none text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface)] hover:text-[color:var(--sf-text-primary)]"
    >
      {label}
    </Link>
  );
}

export function UserTopNav({ orgName, user }: { orgName: string; user: AuthUser }) {
  const dashHref = isSalesLeader(user) ? "/dashboard/executive" : "/dashboard";
  const salesOpportunitiesHref = isSalesRep(user) || user.hierarchy_level === 8 ? "/forecast" : "/analytics/executive/sales-opportunities";
  const isChannelLeader = isChannelExec(user) || isChannelManager(user);
  return (
    <header className="overflow-visible border-b border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
      <div className="flex h-[65px] w-full items-center justify-between overflow-visible px-6">
        <div className="flex items-center gap-4 overflow-visible">
          <Link href={dashHref} aria-label="SalesForecast home" className="relative shrink-0 translate-y-1 overflow-visible">
            <div className="relative h-[72px] w-[min(320px,55vw)] overflow-visible">
              <Image
                src="/brand/salesforecast-logo-trim.png"
                alt="SalesForecast.io"
                width={520}
                height={120}
                priority={false}
                className="h-full w-full object-contain object-left object-top"
              />
            </div>
          </Link>
          <nav className="ml-3 flex flex-wrap items-center gap-1">
            <NavLink href={dashHref} label="Dashboard" />
            <NavLink href={salesOpportunitiesHref} label="Sales Opportunities" />
            {isAdmin(user) && <NavLink href="/analytics" label="Analytics" />}
            {isSalesLeader(user) && <NavLink href="/analytics/quotas/manager" label="Quotas" />}
            {isChannelLeader ? <NavLink href="/analytics/quotas/manager" label="Quotas" /> : null}
            {isChannelLeader ? <NavLink href="/admin/channel-alignment" label="Channel Alignment" /> : null}
            {isChannelLeader ? <NavLink href="/admin/partner-assignments" label="Partner Assignments" /> : null}
            <NavLink href="/dashboard/excel-upload" label="Upload" />
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <UserProfileBadge orgName={orgName} displayName={user.display_name} email={user.email} showAccountLink />
        </div>
      </div>
    </header>
  );
}

