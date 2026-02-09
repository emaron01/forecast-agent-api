import Link from "next/link";
import { requireAuth } from "../../../lib/auth";
import { updatePasswordAction } from "./actions";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function SettingsPasswordPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") return null;

  const error = sp(searchParams.error) || "";
  const errorMessage = error === "invalid_password" ? "Current password is incorrect." : "";

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Password</h1>
          <p className="mt-1 text-sm text-slate-600">Update your password. You’ll be asked to sign in again.</p>
        </div>
        <Link href="/dashboard" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
          Back
        </Link>
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{errorMessage}</div>
      ) : null}

      <form action={updatePasswordAction} className="mt-6 grid gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-1">
          <label className="text-sm font-medium text-slate-700">Current password</label>
          <input name="current_password" type="password" className="rounded-md border border-slate-300 px-3 py-2 text-sm" required />
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium text-slate-700">New password</label>
          <input name="new_password" type="password" className="rounded-md border border-slate-300 px-3 py-2 text-sm" required />
          <p className="text-xs text-slate-500">Minimum 8 characters.</p>
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium text-slate-700">Confirm new password</label>
          <input name="confirm_password" type="password" className="rounded-md border border-slate-300 px-3 py-2 text-sm" required />
        </div>

        <div className="flex items-center justify-end gap-2">
          <button className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Update password</button>
        </div>
      </form>
    </main>
  );
}

