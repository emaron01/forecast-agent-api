import { redirect } from "next/navigation";
import { requireAuth } from "../../lib/auth";
import { getOrganization } from "../../lib/db";
import { UserTopNav } from "../_components/UserTopNav";

export const runtime = "nodejs";

export default async function AnalyticsPage() {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role === "ADMIN") redirect("/admin");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  return (
    <div className="min-h-screen bg-slate-50">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Analytics</h1>
        <p className="mt-2 text-sm text-slate-600">Stub (coming soon).</p>
      </main>
    </div>
  );
}

