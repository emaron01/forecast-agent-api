import Image from "next/image";
import Link from "next/link";
import type { AuthUser } from "../../lib/auth";
import { UserProfileBadge } from "./UserProfileBadge";

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
    >
      {label}
    </Link>
  );
}

export function UserTopNav({ orgName, user }: { orgName: string; user: AuthUser }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <nav className="flex flex-wrap items-center gap-1">
            <NavLink href="/dashboard" label="Dashboard" />
            <NavLink href="/forecast" label="Forecast" />
            <NavLink href="/analytics" label="Analytics" />
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <UserProfileBadge orgName={orgName} displayName={user.display_name} email={user.email} showAccountLink />
          <Link href="/dashboard" aria-label="SalesForecast home">
            <Image
              src="/brand/salesforecast-logo.png"
              alt="SalesForecast.io"
              width={520}
              height={120}
              priority={false}
              className="h-7 w-auto"
            />
          </Link>
        </div>
      </div>
    </header>
  );
}

