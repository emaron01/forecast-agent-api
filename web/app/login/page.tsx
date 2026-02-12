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
              : error === "server_error"
                ? "Sign-in succeeded, but the server couldn't load your session (database down or misconfigured). Contact support/admin."
              : error === "invalid_request"
                ? "Invalid login request. Please try again."
                : error
                  ? "Could not sign in. Please try again."
                  : "";

  return (
    <main
      className="min-h-screen w-full overflow-auto bg-[color:var(--sf-background)]"
      style={{ backgroundColor: "var(--sf-background)" }} // fallback if Tailwind isn't applied
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
          className="mt-6 w-full rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-6 shadow-sm"
          style={{ marginTop: 24 }} // fallback if Tailwind isn't applied
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Sign in</div>
              <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Use your email + password.</div>
            </div>
          </div>

          {created ? (
            <div className="mt-4 rounded-lg border border-[#2ECC71] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
              Organization created. You can sign in now.
            </div>
          ) : null}

          {errorMessage ? (
            <div className="mt-4 rounded-lg border border-[#E74C3C] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
              {errorMessage}
            </div>
          ) : null}

          {reset ? (
            <div className="mt-4 rounded-lg border border-[#2ECC71] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
              Password reset. Please sign in.
            </div>
          ) : null}

          {pw ? (
            <div className="mt-4 rounded-lg border border-[#2ECC71] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
              Password updated. Please sign in.
            </div>
          ) : null}

          <form action={loginAction} className="mt-5 grid gap-4">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Email</label>
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none transition placeholder:text-[color:var(--sf-text-disabled)] focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
                required
              />
            </div>

            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Password</label>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none transition focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
                required
              />
              <div className="flex justify-end">
                <Link href="/forgot-password" className="text-xs font-medium text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline">
                  Forgot password?
                </Link>
              </div>
            </div>

            <button className="mt-1 inline-flex w-full items-center justify-center rounded-md bg-[color:var(--sf-button-primary-bg)] px-4 py-2.5 text-sm font-medium text-[color:var(--sf-button-primary-text)] shadow-sm transition hover:bg-[color:var(--sf-button-primary-hover)] focus:outline-none focus:ring-2 focus:ring-[color:var(--sf-accent-secondary)] focus:ring-offset-2 focus:ring-offset-[color:var(--sf-background)]">
              Sign in
            </button>

            <div className="text-center text-sm text-[color:var(--sf-text-secondary)]">
              Invite-only access. Ask your organization admin to create your user and send you a password set link.
            </div>
          </form>
      </div>
      </div>
    </main>
  );
}

