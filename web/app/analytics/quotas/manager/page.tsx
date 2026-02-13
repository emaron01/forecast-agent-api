import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization } from "../../../../lib/db";
import { pool } from "../../../../lib/pool";
import type { QuotaPeriodRow, QuotaRow } from "../../../../lib/quotaModels";
import { UserTopNav } from "../../../_components/UserTopNav";
import { FiscalYearSelector } from "../../../../components/quotas/FiscalYearSelector";
import { QuotaPeriodSelector } from "../../../../components/quotas/QuotaPeriodSelector";
import { QuotaRollupChart } from "../../../../components/quotas/QuotaRollupChart";
import { QuotaRollupTable, type QuotaRollupRow } from "../../../../components/quotas/QuotaRollupTable";
import { assignQuotaToUser, getDistinctFiscalYears, getQuotaPeriods, getQuotaRollupByManager } from "../actions";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

async function managerRepIdForUser(args: { orgId: number; userId: number }) {
  const { rows } = await pool.query<{ id: number }>(
    `
    SELECT r.id
      FROM reps r
     WHERE r.organization_id = $1
       AND r.user_id = $2
     LIMIT 1
    `,
    [args.orgId, args.userId]
  );
  const id = rows?.[0]?.id;
  return Number.isFinite(id) ? Number(id) : null;
}

type DirectRep = { id: number; rep_name: string | null };

async function listDirectReps(args: { orgId: number; managerRepId: number }): Promise<DirectRep[]> {
  const { rows } = await pool.query<DirectRep>(
    `
    SELECT r.id, r.rep_name
      FROM reps r
     WHERE r.organization_id = $1
       AND r.manager_rep_id = $2
       AND r.active IS TRUE
     ORDER BY r.rep_name ASC, r.id ASC
    `,
    [args.orgId, args.managerRepId]
  );
  return rows as DirectRep[];
}

async function listRepQuotas(args: { orgId: number; quotaPeriodId: string; repIds: number[] }): Promise<QuotaRow[]> {
  if (!args.repIds.length) return [];
  const { rows } = await pool.query<QuotaRow>(
    `
    SELECT
      id::text AS id,
      org_id::text AS org_id,
      rep_id::text AS rep_id,
      manager_id::text AS manager_id,
      role_level,
      quota_period_id::text AS quota_period_id,
      quota_amount::float8 AS quota_amount,
      annual_target::float8 AS annual_target,
      carry_forward::float8 AS carry_forward,
      adjusted_quarterly_quota::float8 AS adjusted_quarterly_quota,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM quotas
    WHERE org_id = $1::bigint
      AND quota_period_id = $2::bigint
      AND role_level = 3
      AND rep_id = ANY($3::bigint[])
    ORDER BY rep_id ASC, id DESC
    `,
    [args.orgId, args.quotaPeriodId, args.repIds.map((n) => String(n))]
  );
  return rows as QuotaRow[];
}

async function assignRepQuotaAction(formData: FormData) {
  "use server";
  const quota_period_id = String(formData.get("quota_period_id") || "").trim();
  const rep_id = String(formData.get("rep_id") || "").trim();
  const quota_amount = Number(formData.get("quota_amount") || 0);

  const r = await assignQuotaToUser({
    quota_period_id,
    role_level: 3,
    rep_id,
    quota_amount,
  });
  if ("error" in r)
    redirect(`/analytics/quotas/manager?quota_period_id=${encodeURIComponent(quota_period_id)}&error=${encodeURIComponent(r.error)}`);
  revalidatePath("/analytics/quotas/manager");
  redirect(`/analytics/quotas/manager?quota_period_id=${encodeURIComponent(quota_period_id)}`);
}

export const runtime = "nodejs";

export default async function AnalyticsQuotasManagerPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role !== "MANAGER") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const quotaPeriodId = String(sp(searchParams.quota_period_id) || "").trim();
  const fiscal_year = String(sp(searchParams.fiscal_year) || "").trim();
  const error = String(sp(searchParams.error) || "").trim();

  const fyRes = await getDistinctFiscalYears().catch(() => ({ ok: true as const, data: [] as Array<{ fiscal_year: string }> }));
  const fiscalYears = fyRes.ok ? fyRes.data : [];

  const periodsRes = await getQuotaPeriods().catch(() => ({ ok: true as const, data: [] as QuotaPeriodRow[] }));
  const allPeriods = periodsRes.ok ? periodsRes.data : [];
  const periods = fiscal_year ? allPeriods.filter((p) => String(p.fiscal_year) === fiscal_year) : allPeriods;
  const selected = quotaPeriodId ? periods.find((p) => String(p.id) === quotaPeriodId) || null : null;

  const mgrRepId = await managerRepIdForUser({ orgId: ctx.user.org_id, userId: ctx.user.id });
  if (!mgrRepId) redirect("/dashboard");

  const directReps = await listDirectReps({ orgId: ctx.user.org_id, managerRepId: mgrRepId }).catch(() => []);
  const repIds = directReps.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
  const quotas = selected ? await listRepQuotas({ orgId: ctx.user.org_id, quotaPeriodId, repIds }).catch(() => []) : [];

  const rollupRes = selected ? await getQuotaRollupByManager({ quota_period_id: quotaPeriodId }).catch(() => ({ ok: true as const, data: null as any })) : null;
  const rollup = rollupRes && rollupRes.ok ? rollupRes.data : null;

  const repRows: QuotaRollupRow[] =
    rollup?.rep_attainment?.map((r: any) => ({
      id: String(r.rep_id),
      name: String(r.rep_name || ""),
      quota_amount: Number(r.quota_amount) || 0,
      actual_amount: Number(r.actual_amount) || 0,
      attainment: r.attainment == null ? null : Number(r.attainment),
    })) || [];

  const mgrRow: QuotaRollupRow[] =
    rollup?.manager_attainment
      ? [
          {
            id: String((rollup.manager_attainment as any).manager_id),
            name: String((rollup.manager_attainment as any).manager_name || ""),
            quota_amount: Number((rollup.manager_attainment as any).quota_amount) || 0,
            actual_amount: Number((rollup.manager_attainment as any).actual_amount) || 0,
            attainment: (rollup.manager_attainment as any).attainment == null ? null : Number((rollup.manager_attainment as any).attainment),
          },
        ]
      : [];

  const quotaByRepId = new Map<string, QuotaRow>();
  for (const q of quotas) {
    const key = String(q.rep_id || "");
    if (!key) continue;
    if (!quotaByRepId.has(key)) quotaByRepId.set(key, q);
  }

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Team Quotas</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Manager quota assignment and team rollups.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/analytics" className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
              Analytics home
            </Link>
          </div>
        </div>

        {error ? (
          <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="text-sm font-medium text-[color:var(--sf-text-primary)]">Error</div>
            <div className="mt-1 font-mono text-xs text-[color:var(--sf-text-secondary)]">{error}</div>
          </section>
        ) : null}

        <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Filters</h2>
          <form method="GET" action="/analytics/quotas/manager" className="mt-3 grid gap-3 md:grid-cols-3">
            <FiscalYearSelector name="fiscal_year" fiscalYears={fiscalYears} defaultValue={fiscal_year} required={false} label="fiscal_year" />
            <QuotaPeriodSelector name="quota_period_id" periods={periods} defaultValue={quotaPeriodId} required label="quota_period_id" />
            <div className="flex items-end justify-end gap-2">
              <Link
                href="/analytics/quotas/manager"
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Reset
              </Link>
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Apply
              </button>
            </div>
          </form>
        </section>

        {!selected ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <p className="text-sm text-[color:var(--sf-text-secondary)]">Select a `quota_period_id` to view and manage team quotas.</p>
          </section>
        ) : null}

        {selected ? (
          <section className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
            <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Direct report quotas</div>
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Role level: 3 (rep quotas)</div>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-4 py-3">rep_id</th>
                  <th className="px-4 py-3">rep_name</th>
                  <th className="px-4 py-3 text-right">quota_amount</th>
                  <th className="px-4 py-3 text-right">actions</th>
                </tr>
              </thead>
              <tbody>
                {directReps.length ? (
                  directReps.map((r) => {
                    const q = quotaByRepId.get(String(r.id)) || null;
                    return (
                      <tr key={String(r.id)} className="border-t border-[color:var(--sf-border)]">
                        <td className="px-4 py-3 font-mono text-xs">{r.id}</td>
                        <td className="px-4 py-3">{r.rep_name || ""}</td>
                        <td className="px-4 py-3 text-right">{q ? q.quota_amount : ""}</td>
                        <td className="px-4 py-3 text-right">
                          <form action={assignRepQuotaAction} className="flex items-center justify-end gap-2">
                            <input type="hidden" name="quota_period_id" value={quotaPeriodId} />
                            <input type="hidden" name="rep_id" value={String(r.id)} />
                            <input
                              name="quota_amount"
                              defaultValue={q ? String(q.quota_amount) : ""}
                              className="w-32 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-right text-sm font-mono text-[color:var(--sf-text-primary)]"
                              required
                            />
                            <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-1 text-xs font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                              Save
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                      No direct reports found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        ) : null}

        {selected ? (
          <section className="mt-5 grid gap-5 md:grid-cols-2">
            <QuotaRollupChart title="Quota vs attainment (direct reports)" rows={repRows} />
            <QuotaRollupTable title="Manager rollup" subtitle="Uses public.manager_attainment" rows={mgrRow} />
          </section>
        ) : null}

        {selected ? (
          <section className="mt-5">
            <QuotaRollupTable title="Rep rollup" subtitle="Uses public.rep_attainment (direct reports only)" rows={repRows} />
          </section>
        ) : null}
      </main>
    </div>
  );
}

