import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";

export const runtime = "nodejs";

export default async function TestEmailsPage() {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  return (
    <main className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Trigger test emails</h1>
        <p className="mt-1 text-sm text-slate-600">Stub (master only).</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-700">No email-sending integration yet. This page is a placeholder for QA.</p>
      </div>
      <div>
        <Link className="text-sm text-indigo-700 hover:underline" href="/admin/email-templates">
          Edit email templates
        </Link>
      </div>
    </main>
  );
}

