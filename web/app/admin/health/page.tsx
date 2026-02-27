import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { HealthDashboard } from "./HealthDashboard";

export default async function AdminHealthPage() {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[color:var(--sf-text-primary)]">Health & Monitoring</h1>
        <a
          href="/admin/health/tests"
          className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-1.5 text-sm text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]"
        >
          Run tests
        </a>
      </div>
      <HealthDashboard />
    </div>
  );
}
