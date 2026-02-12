import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";

export const runtime = "nodejs";

export default async function TestNotificationsPage() {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  return (
    <main className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Trigger test notifications</h1>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Stub (master only).</p>
      </div>
      <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <p className="text-sm text-[color:var(--sf-text-secondary)]">No notifications implemented yet.</p>
      </div>
      <div>
        <Link className="text-sm text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline" href="/admin/control-center">
          Back to Owner Control Center
        </Link>
      </div>
    </main>
  );
}

