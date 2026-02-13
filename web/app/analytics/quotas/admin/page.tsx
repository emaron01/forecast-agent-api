import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization, listReps } from "../../../../lib/db";
import { pool } from "../../../../lib/pool";
import type { QuotaPeriodRow, QuotaRow } from "../../../../lib/quotaModels";
import { listCroAttainment, listManagerAttainment, listRepAttainment, listVpAttainment } from "../../../../lib/quotaRollups";
import { UserTopNav } from "../../../_components/UserTopNav";
import { dateOnly } from "../../../../lib/dateOnly";
import { QuotaPeriodSelector } from "../../../../components/quotas/QuotaPeriodSelector";
import { QuotaEditor } from "../../../../components/quotas/QuotaEditor";
import { QuotaTable } from "../../../../components/quotas/QuotaTable";
import { FiscalYearSelector } from "../../../../components/quotas/FiscalYearSelector";
import {
  assignQuotaToUser,
  createQuotaPeriod,
  getDistinctFiscalYears,
  getQuotaPeriods,
  updateQuotaPeriod,
  updateQuota,
} from "../actions";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

async function listQuotasForOrg(args: {
  orgId: number;
  quotaPeriodId?: string;
  roleLevel?: number;
  repId?: string;
  managerId?: string;
}): Promise<QuotaRow[]> {
  const where: string[] = ["org_id = $1::bigint"];
  const params: any[] = [args.orgId];
  let idx = params.length;

  if (args.quotaPeriodId) {
    where.push(`quota_period_id = $${++idx}::bigint`);
    params.push(args.quotaPeriodId);
  }
  if (args.roleLevel != null) {
    where.push(`role_level = $${++idx}::int`);
    params.push(args.roleLevel);
  }
  if (args.repId) {
    where.push(`rep_id = $${++idx}::bigint`);
    params.push(args.repId);
  }
  if (args.managerId) {
    where.push(`manager_id = $${++idx}::bigint`);
    params.push(args.managerId);
  }

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
    WHERE ${where.join(" AND ")}
    ORDER BY quota_period_id DESC, role_level ASC, id DESC
    `,
    params
  );
  return rows as QuotaRow[];
}

async function createQuotaPeriodAction(formData: FormData) {
  "use server";
  const r = await createQuotaPeriod({
    period_name: String(formData.get("period_name") || "").trim(),
    period_start: String(formData.get("period_start") || "").trim(),
    period_end: String(formData.get("period_end") || "").trim(),
    fiscal_year: String(formData.get("fiscal_year") || "").trim(),
    fiscal_quarter: String(formData.get("fiscal_quarter") || "").trim(),
  });
  if ("error" in r) redirect(`/analytics/quotas/admin?error=${encodeURIComponent(r.error)}`);
  revalidatePath("/analytics/quotas/admin");
  redirect("/analytics/quotas/admin");
}

async function updateQuotaPeriodAction(formData: FormData) {
  "use server";
  const r = await updateQuotaPeriod({
    id: String(formData.get("id") || "").trim(),
    period_name: String(formData.get("period_name") || "").trim(),
    period_start: String(formData.get("period_start") || "").trim(),
    period_end: String(formData.get("period_end") || "").trim(),
    fiscal_year: String(formData.get("fiscal_year") || "").trim(),
    fiscal_quarter: String(formData.get("fiscal_quarter") || "").trim(),
  });
  if ("error" in r) redirect(`/analytics/quotas/admin?error=${encodeURIComponent(r.error)}`);

  revalidatePath("/analytics/quotas/admin");
  redirect("/analytics/quotas/admin");
}

async function assignQuotaAction(formData: FormData) {
  "use server";
  const r = await assignQuotaToUser({
    quota_period_id: String(formData.get("quota_period_id") || "").trim(),
    role_level: Number(formData.get("role_level") || 0),
    rep_id: String(formData.get("rep_id") || "").trim() || undefined,
    manager_id: String(formData.get("manager_id") || "").trim() || undefined,
    quota_amount: Number(formData.get("quota_amount") || 0),
    annual_target: String(formData.get("annual_target") || "").trim() ? Number(formData.get("annual_target")) : undefined,
    carry_forward: String(formData.get("carry_forward") || "").trim() ? Number(formData.get("carry_forward")) : undefined,
    adjusted_quarterly_quota: String(formData.get("adjusted_quarterly_quota") || "").trim()
      ? Number(formData.get("adjusted_quarterly_quota"))
      : undefined,
  });
  if ("error" in r) redirect(`/analytics/quotas/admin?error=${encodeURIComponent(r.error)}`);
  revalidatePath("/analytics/quotas/admin");
  redirect("/analytics/quotas/admin");
}

async function updateQuotaAction(formData: FormData) {
  "use server";
  const r = await updateQuota({
    id: String(formData.get("id") || "").trim(),
    quota_period_id: String(formData.get("quota_period_id") || "").trim(),
    role_level: Number(formData.get("role_level") || 0),
    rep_id: String(formData.get("rep_id") || "").trim() || undefined,
    manager_id: String(formData.get("manager_id") || "").trim() || undefined,
    quota_amount: Number(formData.get("quota_amount") || 0),
    annual_target: String(formData.get("annual_target") || "").trim() ? Number(formData.get("annual_target")) : undefined,
    carry_forward: String(formData.get("carry_forward") || "").trim() ? Number(formData.get("carry_forward")) : undefined,
    adjusted_quarterly_quota: String(formData.get("adjusted_quarterly_quota") || "").trim()
      ? Number(formData.get("adjusted_quarterly_quota"))
      : undefined,
  });
  if ("error" in r) redirect(`/analytics/quotas/admin?error=${encodeURIComponent(r.error)}`);
  revalidatePath("/analytics/quotas/admin");
  redirect("/analytics/quotas/admin");
}

export const runtime = "nodejs";

export default async function AnalyticsQuotasAdminPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") redirect("/admin/organizations");
  if (ctx.user.role !== "ADMIN") redirect("/dashboard");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const quota_period_id = String(sp(searchParams.quota_period_id) || "").trim();
  const role_level_raw = String(sp(searchParams.role_level) || "").trim();
  const role_level = role_level_raw ? Number(role_level_raw) : null;
  const rep_id = String(sp(searchParams.rep_id) || "").trim();
  const manager_id = String(sp(searchParams.manager_id) || "").trim();
  const quota_id = String(sp(searchParams.quota_id) || "").trim();
  const period_id = String(sp(searchParams.period_id) || "").trim();
  const fiscal_year = String(sp(searchParams.fiscal_year) || "").trim();
  const error = String(sp(searchParams.error) || "").trim();

  const fiscalYearsRes = await getDistinctFiscalYears().catch(() => ({ ok: true as const, data: [] as Array<{ fiscal_year: string }> }));
  const fiscalYears = fiscalYearsRes.ok ? fiscalYearsRes.data : [];

  const periodsRes = await getQuotaPeriods().catch(() => ({ ok: true as const, data: [] as QuotaPeriodRow[] }));
  const allPeriods = periodsRes.ok ? periodsRes.data : [];
  const periods = fiscal_year ? allPeriods.filter((p) => String(p.fiscal_year) === fiscal_year) : allPeriods;

  const reps = await listReps({ organizationId: ctx.user.org_id, activeOnly: false }).catch(() => []);
  const repOptions = reps.map((r) => ({ id: Number(r.id), rep_name: r.rep_name || "" })).filter((r) => Number.isFinite(r.id) && r.id > 0);

  const quotas = await listQuotasForOrg({
    orgId: ctx.user.org_id,
    quotaPeriodId: quota_period_id || undefined,
    roleLevel: role_level == null || !Number.isFinite(role_level) ? undefined : Number(role_level),
    repId: rep_id || undefined,
    managerId: manager_id || undefined,
  }).catch(() => []);

  const current = quota_id ? quotas.find((q) => String(q.id) === String(quota_id)) || null : null;
  const currentPeriod = period_id ? periods.find((p) => String(p.id) === String(period_id)) || null : null;

  const rollupPeriodId = quota_period_id || "";
  const repAtt = rollupPeriodId ? await listRepAttainment({ orgId: ctx.user.org_id, quotaPeriodId: rollupPeriodId }).catch(() => []) : [];
  const mgrAtt = rollupPeriodId ? await listManagerAttainment({ orgId: ctx.user.org_id, quotaPeriodId: rollupPeriodId }).catch(() => []) : [];
  const vpAtt = rollupPeriodId ? await listVpAttainment({ orgId: ctx.user.org_id, quotaPeriodId: rollupPeriodId }).catch(() => []) : [];
  const croAtt = rollupPeriodId ? await listCroAttainment({ orgId: ctx.user.org_id, quotaPeriodId: rollupPeriodId }).catch(() => []) : [];

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-7xl p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Quotas (Admin)</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Admin quota management under Analytics.</p>
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

        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Fiscal years</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Fiscal years are values of `quota_periods.fiscal_year`.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {fiscalYears.length ? (
              fiscalYears.map((y) => (
                <span key={y.fiscal_year} className="rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-1 text-xs">
                  {y.fiscal_year}
                </span>
              ))
            ) : (
              <span className="text-sm text-[color:var(--sf-text-disabled)]">No fiscal years found.</span>
            )}
          </div>
          <form method="GET" action="/analytics/quotas/admin" className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <FiscalYearSelector name="fiscal_year" fiscalYears={fiscalYears} defaultValue={fiscal_year} required={false} label="fiscal_year" />
            </div>
            <div className="flex items-end justify-end gap-2">
              <Link
                href="/analytics/quotas/admin"
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

        <section className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Create quota period</h2>
            <form action={createQuotaPeriodAction} className="mt-3 grid gap-3">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">period_name</label>
                <input
                  name="period_name"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">period_start</label>
                  <input
                    name="period_start"
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                    required
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">period_end</label>
                  <input
                    name="period_end"
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                    required
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">fiscal_year</label>
                  <input
                    name="fiscal_year"
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                    required
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">fiscal_quarter</label>
                  <input
                    name="fiscal_quarter"
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                    required
                  />
                </div>
              </div>
              <div className="mt-2 flex items-center justify-end gap-2">
                <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                  Create
                </button>
              </div>
            </form>
          </div>

          <div className="overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
            <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Quota periods</div>
              <div className="text-xs text-[color:var(--sf-text-secondary)]">Table: `quota_periods`</div>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-4 py-3">id</th>
                  <th className="px-4 py-3">period_name</th>
                  <th className="px-4 py-3">period_start</th>
                  <th className="px-4 py-3">period_end</th>
                  <th className="px-4 py-3">fiscal_year</th>
                  <th className="px-4 py-3">fiscal_quarter</th>
                </tr>
              </thead>
              <tbody>
                {periods.length ? (
                  periods.map((p) => (
                    <tr key={p.id} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-4 py-3 font-mono text-xs">
                        <Link
                          className="text-[color:var(--sf-accent-primary)] hover:underline"
                          href={`/analytics/quotas/admin?period_id=${encodeURIComponent(String(p.id))}`}
                        >
                          {p.id}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{p.period_name}</td>
                      <td className="px-4 py-3 font-mono text-xs">{dateOnly(p.period_start)}</td>
                      <td className="px-4 py-3 font-mono text-xs">{dateOnly(p.period_end)}</td>
                      <td className="px-4 py-3">{p.fiscal_year}</td>
                      <td className="px-4 py-3">{p.fiscal_quarter}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                      No quota periods found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {currentPeriod ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Edit quota period</h2>
                <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">id: {currentPeriod.id}</div>
              </div>
              <Link href="/analytics/quotas/admin" className="text-sm text-[color:var(--sf-accent-primary)] hover:underline">
                Close
              </Link>
            </div>
            <form action={updateQuotaPeriodAction} className="mt-3 grid gap-3">
              <input type="hidden" name="id" value={String(currentPeriod.id)} />
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">period_name</label>
                <input
                  name="period_name"
                  defaultValue={currentPeriod.period_name}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">period_start</label>
                  <input
                    name="period_start"
                    defaultValue={currentPeriod.period_start}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                    required
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">period_end</label>
                  <input
                    name="period_end"
                    defaultValue={currentPeriod.period_end}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                    required
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">fiscal_year</label>
                  <input
                    name="fiscal_year"
                    defaultValue={currentPeriod.fiscal_year}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                    required
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">fiscal_quarter</label>
                  <input
                    name="fiscal_quarter"
                    defaultValue={currentPeriod.fiscal_quarter}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                    required
                  />
                </div>
              </div>
              <div className="mt-2 flex items-center justify-end gap-2">
                <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                  Save
                </button>
              </div>
            </form>
          </section>
        ) : null}

        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Assign quotas</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Table: `quotas`</p>
          <div className="mt-3">
            <QuotaEditor action={assignQuotaAction} periods={periods} reps={repOptions} defaultMode="rep" />
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Quota assignments</h2>
          <form method="GET" action="/analytics/quotas/admin" className="mt-3 grid gap-3 md:grid-cols-4">
            <QuotaPeriodSelector name="quota_period_id" periods={periods} defaultValue={quota_period_id} label="quota_period_id" />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">role_level</label>
              <input
                name="role_level"
                defaultValue={role_level_raw}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">rep_id</label>
              <select
                name="rep_id"
                defaultValue={rep_id}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                <option value="">(any)</option>
                {repOptions.map((r) => (
                  <option key={String(r.id)} value={String(r.id)}>
                    {r.rep_name} ({r.id})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">manager_id</label>
              <select
                name="manager_id"
                defaultValue={manager_id}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                <option value="">(any)</option>
                {repOptions.map((r) => (
                  <option key={String(r.id)} value={String(r.id)}>
                    {r.rep_name} ({r.id})
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-4 flex items-center justify-end gap-2">
              <Link
                href="/analytics/quotas/admin"
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Reset
              </Link>
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Apply
              </button>
            </div>
          </form>

          <div className="mt-4">
            <QuotaTable
              quotas={quotas}
              actions={(q) => (
                <Link
                  href={`/analytics/quotas/admin?quota_id=${encodeURIComponent(String(q.id))}`}
                  className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                >
                  Edit
                </Link>
              )}
            />
          </div>
        </section>

        {current ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Edit quota</h2>
                <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">id: {current.id}</div>
              </div>
              <Link href="/analytics/quotas/admin" className="text-sm text-[color:var(--sf-accent-primary)] hover:underline">
                Close
              </Link>
            </div>
            <div className="mt-3">
              <QuotaEditor action={updateQuotaAction} periods={periods} reps={repOptions} defaultMode="rep" quota={current} />
            </div>
          </section>
        ) : null}

        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Quota rollups</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Select a `quota_period_id` to view rollups by org hierarchy.</p>
          <form method="GET" action="/analytics/quotas/admin" className="mt-3 grid gap-3 md:grid-cols-3">
            <QuotaPeriodSelector name="quota_period_id" periods={periods} defaultValue={quota_period_id} label="quota_period_id" required />
            <div className="md:col-span-2 flex items-end justify-end gap-2">
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Load rollups
              </button>
            </div>
          </form>

          {rollupPeriodId ? (
            <div className="mt-5 grid gap-5">
              <div className="overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
                <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
                  <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Rep attainment</div>
                  <div className="text-xs text-[color:var(--sf-text-secondary)]">Uses `public.rep_attainment(org_id, quota_period_id)`.</div>
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                    <tr>
                      <th className="px-4 py-3">rep_id</th>
                      <th className="px-4 py-3">rep_name</th>
                      <th className="px-4 py-3 text-right">quota_amount</th>
                      <th className="px-4 py-3 text-right">carry_forward</th>
                      <th className="px-4 py-3 text-right">adjusted_quota_amount</th>
                      <th className="px-4 py-3 text-right">actual_amount</th>
                      <th className="px-4 py-3 text-right">attainment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repAtt.length ? (
                      repAtt.map((r) => (
                        <tr key={r.quota_id} className="border-t border-[color:var(--sf-border)]">
                          <td className="px-4 py-3 font-mono text-xs">{r.rep_id}</td>
                          <td className="px-4 py-3">{r.rep_name || ""}</td>
                          <td className="px-4 py-3 text-right">{r.quota_amount}</td>
                          <td className="px-4 py-3 text-right">{r.carry_forward}</td>
                          <td className="px-4 py-3 text-right">{r.adjusted_quota_amount}</td>
                          <td className="px-4 py-3 text-right">{r.actual_amount}</td>
                          <td className="px-4 py-3 text-right">{r.attainment == null ? "" : r.attainment}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                          No rep quotas found for this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
                <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
                  <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Manager attainment</div>
                  <div className="text-xs text-[color:var(--sf-text-secondary)]">Uses `public.manager_attainment(org_id, quota_period_id)`.</div>
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                    <tr>
                      <th className="px-4 py-3">manager_id</th>
                      <th className="px-4 py-3">manager_name</th>
                      <th className="px-4 py-3 text-right">quota_amount</th>
                      <th className="px-4 py-3 text-right">carry_forward</th>
                      <th className="px-4 py-3 text-right">adjusted_quota_amount</th>
                      <th className="px-4 py-3 text-right">actual_amount</th>
                      <th className="px-4 py-3 text-right">attainment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mgrAtt.length ? (
                      mgrAtt.map((m) => (
                        <tr key={m.quota_id} className="border-t border-[color:var(--sf-border)]">
                          <td className="px-4 py-3 font-mono text-xs">{m.manager_id}</td>
                          <td className="px-4 py-3">{m.manager_name || ""}</td>
                          <td className="px-4 py-3 text-right">{m.quota_amount}</td>
                          <td className="px-4 py-3 text-right">{m.carry_forward}</td>
                          <td className="px-4 py-3 text-right">{m.adjusted_quota_amount}</td>
                          <td className="px-4 py-3 text-right">{m.actual_amount}</td>
                          <td className="px-4 py-3 text-right">{m.attainment == null ? "" : m.attainment}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                          No manager quotas found for this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
                <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
                  <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">VP attainment</div>
                  <div className="text-xs text-[color:var(--sf-text-secondary)]">Uses `public.vp_attainment(org_id, quota_period_id)`.</div>
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                    <tr>
                      <th className="px-4 py-3">vp_id</th>
                      <th className="px-4 py-3">vp_name</th>
                      <th className="px-4 py-3 text-right">quota_amount</th>
                      <th className="px-4 py-3 text-right">carry_forward</th>
                      <th className="px-4 py-3 text-right">adjusted_quota_amount</th>
                      <th className="px-4 py-3 text-right">actual_amount</th>
                      <th className="px-4 py-3 text-right">attainment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vpAtt.length ? (
                      vpAtt.map((v) => (
                        <tr key={v.quota_id} className="border-t border-[color:var(--sf-border)]">
                          <td className="px-4 py-3 font-mono text-xs">{v.vp_id}</td>
                          <td className="px-4 py-3">{v.vp_name || ""}</td>
                          <td className="px-4 py-3 text-right">{v.quota_amount}</td>
                          <td className="px-4 py-3 text-right">{v.carry_forward}</td>
                          <td className="px-4 py-3 text-right">{v.adjusted_quota_amount}</td>
                          <td className="px-4 py-3 text-right">{v.actual_amount}</td>
                          <td className="px-4 py-3 text-right">{v.attainment == null ? "" : v.attainment}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                          No VP quotas found for this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
                <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
                  <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Company attainment</div>
                  <div className="text-xs text-[color:var(--sf-text-secondary)]">Uses `public.cro_attainment(org_id, quota_period_id)`.</div>
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                    <tr>
                      <th className="px-4 py-3 text-right">quota_amount</th>
                      <th className="px-4 py-3 text-right">carry_forward</th>
                      <th className="px-4 py-3 text-right">adjusted_quota_amount</th>
                      <th className="px-4 py-3 text-right">actual_amount</th>
                      <th className="px-4 py-3 text-right">attainment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {croAtt.length ? (
                      croAtt.map((c) => (
                        <tr key={c.quota_id} className="border-t border-[color:var(--sf-border)]">
                          <td className="px-4 py-3 text-right">{c.quota_amount}</td>
                          <td className="px-4 py-3 text-right">{c.carry_forward}</td>
                          <td className="px-4 py-3 text-right">{c.adjusted_quota_amount}</td>
                          <td className="px-4 py-3 text-right">{c.actual_amount}</td>
                          <td className="px-4 py-3 text-right">{c.attainment == null ? "" : c.attainment}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                          No company quotas found for this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="mt-4 text-sm text-[color:var(--sf-text-disabled)]">No rollups loaded.</div>
          )}
        </section>
      </main>
    </div>
  );
}

