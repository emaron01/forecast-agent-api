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
      <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Reset password</h1>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Choose a new password (min 8 characters).</p>

        {error ? (
          <div className="mt-4 rounded-md border border-[#E74C3C] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
            This reset link is invalid or expired.
          </div>
        ) : null}

        <form action={resetPasswordAction} className="mt-5 grid gap-3">
          <input type="hidden" name="token" value={token} />

          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">New password</label>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              required
              minLength={8}
            />
          </div>

          <button className="mt-2 rounded-md bg-[color:var(--sf-button-primary-bg)] px-4 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
            Reset password
          </button>

          <div className="mt-2 flex items-center justify-between text-sm">
            <Link href="/login" className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline">
              Back to login
            </Link>
            <Link href="/" className="text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)] hover:underline">
              Home
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}

