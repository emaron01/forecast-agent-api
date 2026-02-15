import Image from "next/image";
import Link from "next/link";
import type { AuthUser } from "../../lib/auth";
import { UserProfileBadge } from "./UserProfileBadge";

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md px-2 py-1 text-[12px] font-medium text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface)] hover:text-[color:var(--sf-text-primary)]"
    >
      {label}
    </Link>
  );
}

export function UserTopNav({ orgName, user }: { orgName: string; user: AuthUser }) {
  return (
    <header className="border-b border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
      <div className="flex h-[45px] w-full items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" aria-label="SalesForecast home" className="shrink-0">
            <Image
              src="/brand/salesforecast-logo.png"
              alt="SalesForecast.io"
              width={520}
              height={120}
              priority={false}
              className="h-full w-auto object-contain"
            />
          </Link>
          <nav className="flex flex-wrap items-center gap-1">
            <NavLink href="/dashboard" label="Dashboard" />
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

