import Link from "next/link";
import { resetPasswordAction } from "./actions";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const token = sp(searchParams.token) || "";
  const error = sp(searchParams.error) === "1";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Reset password</h1>
        <p className="mt-1 text-sm text-slate-600">Choose a new password (min 8 characters).</p>

        {error ? (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            This reset link is invalid or expired.
          </div>
        ) : null}

        <form action={resetPasswordAction} className="mt-5 grid gap-3">
          <input type="hidden" name="token" value={token} />

          <div className="grid gap-1">
            <label className="text-sm font-medium text-slate-700">New password</label>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
              minLength={8}
            />
          </div>

          <button className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">Reset password</button>

          <div className="mt-2 flex items-center justify-between text-sm">
            <Link href="/login" className="text-indigo-700 hover:underline">
              Back to login
            </Link>
            <Link href="/" className="text-slate-600 hover:underline">
              Home
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}

