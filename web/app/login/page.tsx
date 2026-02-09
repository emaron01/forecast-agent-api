import Link from "next/link";
import Image from "next/image";
import { loginAction } from "./actions";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const error = sp(searchParams.error) || "";
  const reset = sp(searchParams.reset) === "1";
  const pw = sp(searchParams.pw) === "1";
  const created = sp(searchParams.created) === "1";
  const errorMessage =
    error === "invalid_email"
      ? "Invalid email."
      : error === "invalid_password"
        ? "Invalid password."
        : error === "user_inactive"
          ? "This user account is suspended."
          : error === "org_inactive"
            ? "This organization is suspended."
            : error === "master_misconfigured"
              ? "Master login is not configured on this environment."
              : error === "master_bad_hash"
                ? "Master login is misconfigured (password hash format is invalid)."
              : error === "invalid_request"
                ? "Invalid login request. Please try again."
                : error
                  ? "Could not sign in. Please try again."
                  : "";

  return (
    <main
      className="min-h-screen w-full overflow-auto bg-black"
      style={{ backgroundColor: "#000" }} // fallback if Tailwind isn't applied
    >
      <div
        className="mx-auto w-full max-w-md px-6 pb-10 pt-1"
        style={{
          maxWidth: 448,
          margin: "0 auto",
          paddingLeft: 24,
          paddingRight: 24,
          paddingTop: 4,
          paddingBottom: 40,
        }} // fallback
      >
        <div className="text-center" style={{ textAlign: "center" }}>
          <Image
            src="/brand/salesforecast-logo-trim.png"
            alt="SalesForecast.io"
            width={1536}
            height={1040}
            priority
            sizes="(max-width: 768px) 92vw, 520px"
            className="mx-auto h-auto w-full max-w-[520px]"
          />
        </div>

        <div
          className="mt-6 w-full rounded-xl border border-white/10 bg-white p-6 shadow-sm"
          style={{ marginTop: 24 }} // fallback if Tailwind isn't applied
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-semibold tracking-tight text-slate-900">Sign in</div>
            <div className="mt-1 text-sm text-slate-600">Use your email + password.</div>
            </div>
          </div>

          {created ? (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Organization created. You can sign in now.
            </div>
          ) : null}

          {errorMessage ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {errorMessage}
            </div>
          ) : null}

          {reset ? (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Password reset. Please sign in.
            </div>
          ) : null}

          {pw ? (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Password updated. Please sign in.
            </div>
          ) : null}

          <form action={loginAction} className="mt-5 grid gap-4">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-slate-700">Email</label>
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                required
              />
            </div>

            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-slate-700">Password</label>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                required
              />
              <div className="flex justify-end">
                <Link href="/forgot-password" className="text-xs font-medium text-indigo-700 hover:underline">
                  Forgot password?
                </Link>
              </div>
            </div>

            <button className="mt-1 inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2">
              Sign in
            </button>

            <div className="text-center text-sm text-slate-600">
              Invite-only access. Ask your organization admin to create your user and send you a password set link.
            </div>
          </form>
      </div>
      </div>
    </main>
  );
}

