import Link from "next/link";
import { requireAuth } from "../../lib/auth";
import { updateMyPasswordAction } from "./actions";

export const runtime = "nodejs";

export default async function AccountPage() {
  const ctx = await requireAuth();

  if (ctx.kind === "master") {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Account</h1>
        <p className="mt-2 text-sm text-slate-700">
          Master admin password is managed via environment variables.
        </p>
        <div className="mt-4">
          <Link href="/admin/organizations" className="text-indigo-700 hover:underline">
            Back to admin
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Account</h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as {ctx.user.display_name} ({ctx.user.email})
          </p>
        </div>
        <Link href="/dashboard" className="text-sm text-slate-600 hover:underline">
          Back to dashboard
        </Link>
      </div>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Update password</h2>
        <form action={updateMyPasswordAction} className="mt-4 grid gap-3 max-w-md">
          <div className="grid gap-1">
            <label className="text-sm font-medium text-slate-700">Current password</label>
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div className="grid gap-1">
            <label className="text-sm font-medium text-slate-700">New password</label>
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
              minLength={8}
            />
          </div>
          <button className="mt-2 w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            Update password
          </button>
          <p className="text-xs text-slate-500">You’ll be signed out everywhere after changing your password.</p>
        </form>
      </section>
    </main>
  );
}

