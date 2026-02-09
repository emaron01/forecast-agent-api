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
    <main className="relative min-h-screen">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900" />
      <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(circle_at_18%_22%,rgba(37,99,235,0.28),transparent_40%),radial-gradient(circle_at_82%_28%,rgba(132,204,22,0.20),transparent_42%),radial-gradient(circle_at_50%_90%,rgba(99,102,241,0.14),transparent_40%)]" />

      <div className="relative mx-auto max-w-3xl p-6">
        <header className="pt-10 text-center">
          <div className="mx-auto inline-flex items-center justify-center rounded-2xl bg-black/40 p-2 shadow-sm ring-1 ring-white/10 backdrop-blur">
            <Image
              src="/brand/salesforecast-logo.png"
              alt="SalesForecast.io"
              width={520}
              height={120}
              priority
              className="h-10 w-auto"
            />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white">Invite-only</h1>
          <p className="mt-1 text-sm text-slate-300">Organizations and users are created by an admin. Please sign in or request an invite.</p>
          <div className="mt-3 text-sm">
            <Link href="/login" className="text-slate-300 hover:text-white hover:underline">
              Back to login
            </Link>
          </div>
        </header>

        <footer className="mt-10 pb-10 text-center text-xs text-slate-400">
          Need access? Contact your organization admin.
        </footer>
      </div>
    </main>
  );
}

