import { redirect } from "next/navigation";
import { requireAuth } from "../../../../lib/auth";
import { TraceView } from "./TraceView";

export default async function AdminHealthTracePage() {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <a href="/admin/health" className="text-sm text-[color:var(--sf-text-secondary)] hover:underline">
          ← Health
        </a>
      </div>
      <TraceView />
    </div>
  );
}
