import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";
import { AdminTestsPanel } from "./AdminTestsPanel";

export default async function AdminHealthTestsPage() {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <a href="/admin/health" className="text-sm text-[color:var(--sf-text-secondary)] hover:underline">
          ← Health
        </a>
      </div>
      <h1 className="text-xl font-semibold text-[color:var(--sf-text-primary)]">Health tests</h1>
      <p className="text-sm text-[color:var(--sf-text-secondary)]">
        Run synthetic tests per workflow; results are written to perf_events with is_test=true.
      </p>
      <AdminTestsPanel />
    </div>
  );
}
