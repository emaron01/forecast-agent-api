import Image from "next/image";
import Link from "next/link";
import type { AuthUser } from "../../lib/auth";
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
  const dashHref = user.role === "MANAGER" || user.role === "EXEC_MANAGER" ? "/dashboard/executive" : "/dashboard";
  return (
    <header className="border-b border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
      <div className="flex h-[65px] w-full items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Link href={dashHref} aria-label="SalesForecast home" className="shrink-0">
            <div className="h-[65px] w-[min(260px,40vw)] overflow-hidden">
              <Image
                src="/brand/salesforecast-logo-trim.png"
                alt="SalesForecast.io"
                width={520}
                height={120}
                priority={false}
                className="h-full w-full object-cover object-left"
              />
            </div>
          </Link>
          <nav className="ml-3 flex flex-wrap items-center gap-1">
            <NavLink href={dashHref} label="Dashboard" />
            <NavLink href="/forecast" label="Sales Opportunities" />
            <NavLink href="/analytics" label="Analytics" />
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <UserProfileBadge orgName={orgName} displayName={user.display_name} email={user.email} showAccountLink />
        </div>
      </div>
    </header>
  );
}

