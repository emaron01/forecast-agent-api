import Link from "next/link";
import { redirect } from "next/navigation";
import { listQuotasByCRO, listQuotasByVP } from "../../actions/quotas";
import { requireOrgContext } from "../../../../lib/auth";

type RollupRow = { quota_period_id: string; total_quota_amount: number };

function rollupByPeriod(quotas: Array<{ quota_period_id: string; quota_amount: number }>): RollupRow[] {
  const m = new Map<string, number>();
  for (const q of quotas) {
    const k = String(q.quota_period_id);
    m.set(k, (m.get(k) || 0) + (Number(q.quota_amount) || 0));
  }
  return [...m.entries()]
    .map(([quota_period_id, total_quota_amount]) => ({ quota_period_id, total_quota_amount }))
    .sort((a, b) => a.quota_period_id.localeCompare(b.quota_period_id));
}

export default async function QuotaRollupsPage() {
  const { ctx } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");
  if (ctx.kind === "user" && !ctx.user.admin_has_full_analytics_access) redirect("/admin");

  const vp = await listQuotasByVP().catch(() => []);
  const cro = await listQuotasByCRO().catch(() => []);

  const vpRollups = rollupByPeriod(vp);
  const croRollups = rollupByPeriod(cro);

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Quota roll-ups</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Roll-ups based on quota assignments.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/analytics`}
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Analytics home
          </Link>
        </div>
      </div>

      <section className="mt-5 grid gap-5 md:grid-cols-2">
        <div className="overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
          <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
            <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">VP roll-ups</div>
            <div className="text-xs text-[color:var(--sf-text-secondary)]">Sum of `quota_amount` by `quota_period_id` (role_level = 1).</div>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
              <tr>
                <th className="px-4 py-3">quota_period_id</th>
                <th className="px-4 py-3 text-right">total_quota_amount</th>
              </tr>
            </thead>
            <tbody>
              {vpRollups.length ? (
                vpRollups.map((r) => (
                  <tr key={r.quota_period_id} className="border-t border-[color:var(--sf-border)]">
                    <td className="px-4 py-3 font-mono text-xs">{r.quota_period_id}</td>
                    <td className="px-4 py-3 text-right">{r.total_quota_amount}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                    No VP quotas found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
          <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
            <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">CRO/company roll-ups</div>
            <div className="text-xs text-[color:var(--sf-text-secondary)]">Sum of `quota_amount` by `quota_period_id` (role_level = 0).</div>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
              <tr>
                <th className="px-4 py-3">quota_period_id</th>
                <th className="px-4 py-3 text-right">total_quota_amount</th>
              </tr>
            </thead>
            <tbody>
              {croRollups.length ? (
                croRollups.map((r) => (
                  <tr key={r.quota_period_id} className="border-t border-[color:var(--sf-border)]">
                    <td className="px-4 py-3 font-mono text-xs">{r.quota_period_id}</td>
                    <td className="px-4 py-3 text-right">{r.total_quota_amount}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                    No CRO/company quotas found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

