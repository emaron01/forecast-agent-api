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
      <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Forgot password</h1>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">We’ll generate a reset link if the account exists.</p>

        {sent ? (
          <div className="mt-4 rounded-md border border-[#2ECC71] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
            If the account exists, a reset link has been sent.
            {reset && process.env.NODE_ENV !== "production" ? (
              <div className="mt-2">
                Dev reset link:{" "}
                <Link className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline" href={reset}>
                  {reset}
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        <form action={forgotPasswordAction} className="mt-5 grid gap-3">
          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Email</label>
            <input
              name="email"
              type="email"
              autoComplete="email"
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              required
            />
          </div>

          <button className="mt-2 rounded-md bg-[color:var(--sf-button-primary-bg)] px-4 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
            Send reset link
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

