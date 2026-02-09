import Link from "next/link";
import "../globals.css";
import { logoutAction } from "../actions/auth";
import { requireManagerAdminOrMaster } from "../../lib/auth";

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

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireManagerAdminOrMaster();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-base font-semibold tracking-tight text-slate-900">
              Admin Dashboard
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {ctx.kind === "master" ? (
                <>
                  <NavLink href="/admin/control-center" label="Control Center" />
                  <NavLink href="/admin/organizations" label="Organizations" />
                  <NavLink href="/admin/all-users" label="All Users" />
                  <NavLink href="/admin/email-templates" label="Email Templates" />
                </>
              ) : null}
              <NavLink href="/admin/users" label="Users" />
              {ctx.kind === "user" && ctx.user.role === "MANAGER" ? null : (
                <>
                  <NavLink href="/admin/excel-opportunities" label="Excel Upload" />
                  <NavLink href="/admin/org-profile" label="Org Profile" />
                  <NavLink href="/admin/hierarchy" label="Hierarchy" />
                  <NavLink href="/admin/reps" label="Reps" />
                  <NavLink href="/admin/mapping-sets" label="Mapping Sets" />
                  <NavLink href="/admin/ingestion" label="Ingestion" />
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">
              Dashboard
            </Link>
            <Link href="/account" className="text-sm text-slate-600 hover:text-slate-900">
              Account
            </Link>
            <form action={logoutAction}>
              <button className="text-sm text-slate-600 hover:text-slate-900">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>
    </div>
  );
}

