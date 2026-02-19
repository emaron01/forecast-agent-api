import Image from "next/image";
import Link from "next/link";

export const runtime = "nodejs";

export default function SignupPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  void searchParams;

  return (
    <main className="relative min-h-screen bg-[color:var(--sf-background)]">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[color:var(--sf-background)] via-[color:var(--sf-background)] to-[color:var(--sf-surface)]" />
      <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(circle_at_18%_22%,color-mix(in_srgb,var(--sf-accent-tertiary)_28%,transparent),transparent_40%),radial-gradient(circle_at_82%_28%,color-mix(in_srgb,var(--sf-accent-secondary)_20%,transparent),transparent_42%),radial-gradient(circle_at_50%_90%,color-mix(in_srgb,var(--sf-accent-primary)_14%,transparent),transparent_40%)]" />

      <div className="relative mx-auto max-w-3xl p-6">
        <header className="pt-10 text-center">
          <div className="mx-auto inline-flex items-center justify-center rounded-2xl bg-[color:color-mix(in_srgb,var(--sf-surface)_60%,transparent)] p-2 shadow-sm ring-1 ring-[color:var(--sf-border)] backdrop-blur">
            <Image
              src="/brand/salesforecast-logo.svg"
              alt="SalesForecast.io"
              width={520}
              height={120}
              priority
              className="h-10 w-auto"
            />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Invite-only</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Organizations and users are created by an admin. Please sign in or request an invite.
          </p>
          <div className="mt-3 text-sm">
            <Link
              href="/login"
              className="text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)] hover:underline"
            >
              Back to login
            </Link>
          </div>
        </header>

        <footer className="mt-10 pb-10 text-center text-xs text-[color:var(--sf-text-disabled)]">
          Need access? Contact your organization admin.
        </footer>
      </div>
    </main>
  );
}

