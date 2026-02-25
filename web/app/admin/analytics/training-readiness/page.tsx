import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrgContext } from "../../../../lib/auth";
import { TrainingReadinessAdminClient } from "./TrainingReadinessAdminClient";
import { listQuotaPeriods } from "../../actions/quotas";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function TrainingReadinessAdminPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { ctx } = await requireOrgContext();
  if (ctx.kind !== "user") redirect("/admin/organizations");
  if (ctx.user.role !== "ADMIN" && !ctx.user.admin_has_full_analytics_access) redirect("/admin/users");

  const periods = await listQuotaPeriods().catch(() => []);
  const quotaPeriodId = String(sp(searchParams.quota_period_id) || "").trim();
  const snapshotOffsetDaysParam = sp(searchParams.snapshot_offset_days);
  const snapshotOffsetDays = snapshotOffsetDaysParam ? Number(snapshotOffsetDaysParam) : 90;

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">
            Data Readiness / Training Coverage
          </h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Admin diagnostics for MEDDPICC evidence coverage and training snapshot readiness.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/analytics"
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Analytics home
          </Link>
        </div>
      </div>

      <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Filters</h2>
        <form method="GET" action="/admin/analytics/training-readiness" className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Quota period</label>
            <select
              name="quota_period_id"
              defaultValue={quotaPeriodId}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              <option value="">(all)</option>
              {periods.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.period_name} ({p.fiscal_year} {p.fiscal_quarter})
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Snapshot offset (days ago)</label>
            <input
              type="number"
              name="snapshot_offset_days"
              defaultValue={snapshotOffsetDays}
              min={1}
              max={365}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            />
          </div>
          <div className="flex items-end justify-end gap-2">
            <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
              Apply
            </button>
          </div>
        </form>
      </section>

      <section className="mt-4">
        <TrainingReadinessAdminClient
          quotaPeriodId={quotaPeriodId || undefined}
          snapshotOffsetDays={snapshotOffsetDays}
        />
      </section>
    </main>
  );
}
