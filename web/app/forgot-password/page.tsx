import Link from "next/link";
import { forgotPasswordAction } from "./actions";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const sent = sp(searchParams.sent) === "1";
  const reset = sp(searchParams.reset) || "";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Forgot password</h1>
        <p className="mt-1 text-sm text-slate-600">We’ll generate a reset link if the account exists.</p>

        {sent ? (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            If the account exists, a reset link has been sent.
            {reset && process.env.NODE_ENV !== "production" ? (
              <div className="mt-2">
                Dev reset link:{" "}
                <Link className="text-indigo-700 hover:underline" href={reset}>
                  {reset}
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        <form action={forgotPasswordAction} className="mt-5 grid gap-3">
          <div className="grid gap-1">
            <label className="text-sm font-medium text-slate-700">Email</label>
            <input
              name="email"
              type="email"
              autoComplete="email"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </div>

          <button className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">Send reset link</button>

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

