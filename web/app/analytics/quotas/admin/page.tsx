import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization, listReps } from "../../../../lib/db";
import { pool } from "../../../../lib/pool";
import type { QuotaPeriodRow } from "../../../../lib/quotaModels";
import { listCroAttainment, listManagerAttainment, listRepAttainment, listVpAttainment } from "../../../../lib/quotaRollups";
import { UserTopNav } from "../../../_components/UserTopNav";
import { dateOnly } from "../../../../lib/dateOnly";
import { QuotaPeriodSelector } from "../../../../components/quotas/QuotaPeriodSelector";
import { FiscalYearSelector } from "../../../../components/quotas/FiscalYearSelector";
import {
  assignQuotaToUser,
  createQuotaPeriod,
  getDistinctFiscalYears,
  getQuotaPeriods,
  updateQuotaPeriod,
} from "../actions";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

type RepLite = {
  id: number;
  public_id: string;
  rep_name: string;
  manager_rep_id: number | null;
  manager_rep_public_id: string | null;
  active: boolean | null;
};

async function resolveRepIdByPublicId(args: { orgId: number; repPublicId: string }) {
  const { rows } = await pool.query<{ id: number }>(
    `
    SELECT r.id
      FROM reps r
     WHERE r.organization_id = $1
       AND r.public_id::text = $2
     LIMIT 1
    `,
    [args.orgId, args.repPublicId]
  );
  const id = rows?.[0]?.id;
  return Number.isFinite(id) ? Number(id) : null;
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

async function saveRepQuotaSetupAction(formData: FormData) {
  "use server";
  const fiscal_year = String(formData.get("fiscal_year") || "").trim();
  const exec_public_id = String(formData.get("exec_public_id") || "").trim();
  const manager_public_id = String(formData.get("manager_public_id") || "").trim();
  const rep_public_id = String(formData.get("rep_public_id") || "").trim();

  const q1_start = String(formData.get("q1_start") || "").trim();
  const q1_end = String(formData.get("q1_end") || "").trim();
  const q2_start = String(formData.get("q2_start") || "").trim();
  const q2_end = String(formData.get("q2_end") || "").trim();
  const q3_start = String(formData.get("q3_start") || "").trim();
  const q3_end = String(formData.get("q3_end") || "").trim();
  const q4_start = String(formData.get("q4_start") || "").trim();
  const q4_end = String(formData.get("q4_end") || "").trim();

  const annual_target_raw = String(formData.get("annual_target") || "").trim();
  const annual_target = annual_target_raw ? Number(annual_target_raw) : undefined;

  const q1_quota = Number(formData.get("q1_quota") || 0) || 0;
  const q2_quota = Number(formData.get("q2_quota") || 0) || 0;
  const q3_quota = Number(formData.get("q3_quota") || 0) || 0;
  const q4_quota = Number(formData.get("q4_quota") || 0) || 0;

  if (!fiscal_year) redirect(`/analytics/quotas/admin?error=${encodeURIComponent("fiscal_year is required")}`);
  if (!rep_public_id) redirect(`/analytics/quotas/admin?error=${encodeURIComponent("rep is required")}`);
  if (!manager_public_id) redirect(`/analytics/quotas/admin?error=${encodeURIComponent("manager is required")}`);

  const ctx = await requireAuth();
  if (ctx.kind !== "user" || ctx.user.role !== "ADMIN") redirect("/dashboard");

  const repId = await resolveRepIdByPublicId({ orgId: ctx.user.org_id, repPublicId: rep_public_id });
  const managerId = await resolveRepIdByPublicId({ orgId: ctx.user.org_id, repPublicId: manager_public_id });
  if (!repId) redirect(`/analytics/quotas/admin?error=${encodeURIComponent("rep not found")}`);
  if (!managerId) redirect(`/analytics/quotas/admin?error=${encodeURIComponent("manager not found")}`);

  const quarters: Array<{
    fiscal_quarter: string;
    period_name: string;
    period_start: string;
    period_end: string;
    quota_amount: number;
  }> = [
    { fiscal_quarter: "Q1", period_name: "Q1", period_start: q1_start, period_end: q1_end, quota_amount: q1_quota },
    { fiscal_quarter: "Q2", period_name: "Q2", period_start: q2_start, period_end: q2_end, quota_amount: q2_quota },
    { fiscal_quarter: "Q3", period_name: "Q3", period_start: q3_start, period_end: q3_end, quota_amount: q3_quota },
    { fiscal_quarter: "Q4", period_name: "Q4", period_start: q4_start, period_end: q4_end, quota_amount: q4_quota },
  ];

  // Upsert quota periods (by fiscal_year + fiscal_quarter)
  const periodsRes = await getQuotaPeriods().catch(() => ({ ok: true as const, data: [] as QuotaPeriodRow[] }));
  const allPeriods = periodsRes.ok ? periodsRes.data : [];
  const existingByQuarter = new Map<string, QuotaPeriodRow>();
  for (const p of allPeriods) {
    if (String(p.fiscal_year) !== fiscal_year) continue;
    const fq = String(p.fiscal_quarter || "").trim();
    if (fq) existingByQuarter.set(fq, p);
  }

  const quarterPeriodIds: Record<string, string> = {};
  for (const q of quarters) {
    if (!q.period_start || !q.period_end) {
      redirect(`/analytics/quotas/admin?error=${encodeURIComponent(`${q.fiscal_quarter} start/end dates are required`)}`);
    }
    const existing = existingByQuarter.get(q.fiscal_quarter) || null;
    if (!existing) {
      const created = await createQuotaPeriod({
        period_name: q.period_name,
        period_start: q.period_start,
        period_end: q.period_end,
        fiscal_year,
        fiscal_quarter: q.fiscal_quarter,
      });
      if ("error" in created) redirect(`/analytics/quotas/admin?error=${encodeURIComponent(created.error)}`);
      quarterPeriodIds[q.fiscal_quarter] = String(created.data.id);
    } else {
      const updated = await updateQuotaPeriod({
        id: String(existing.id),
        period_name: q.period_name,
        period_start: q.period_start,
        period_end: q.period_end,
        fiscal_year,
        fiscal_quarter: q.fiscal_quarter,
      });
      if ("error" in updated) redirect(`/analytics/quotas/admin?error=${encodeURIComponent(updated.error)}`);
      quarterPeriodIds[q.fiscal_quarter] = String(updated.data.id);
    }
  }

  // Upsert rep quotas for each quarter.
  for (const q of quarters) {
    const quota_period_id = quarterPeriodIds[q.fiscal_quarter] || "";
    if (!quota_period_id) continue;
    const r = await assignQuotaToUser({
      quota_period_id,
      role_level: 3,
      rep_id: String(repId),
      manager_id: String(managerId),
      quota_amount: q.quota_amount,
      annual_target,
    });
    if ("error" in r) redirect(`/analytics/quotas/admin?error=${encodeURIComponent(r.error)}`);
  }

  revalidatePath("/analytics/quotas/admin");

  // Auto-advance to next rep under the selected manager (if any).
  const { rows } = await pool.query<{ public_id: string }>(
    `
    SELECT public_id::text AS public_id
      FROM reps
     WHERE organization_id = $1
       AND manager_rep_id = $2
       AND active IS TRUE
     ORDER BY rep_name ASC, id ASC
    `,
    [ctx.user.org_id, managerId]
  );
  const repList = (rows || []).map((r) => String(r.public_id || "")).filter(Boolean);
  const idx = repList.findIndex((x) => x === rep_public_id);
  const nextRep = idx >= 0 && idx + 1 < repList.length ? repList[idx + 1] : rep_public_id;

  redirect(
    `/analytics/quotas/admin?fiscal_year=${encodeURIComponent(fiscal_year)}` +
      `&exec_public_id=${encodeURIComponent(exec_public_id)}` +
      `&manager_public_id=${encodeURIComponent(manager_public_id)}` +
      `&rep_public_id=${encodeURIComponent(nextRep)}`
  );
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
  const period_id = String(sp(searchParams.period_id) || "").trim();
  const fiscal_year = String(sp(searchParams.fiscal_year) || "").trim();
  const exec_public_id = String(sp(searchParams.exec_public_id) || "").trim();
  const manager_public_id = String(sp(searchParams.manager_public_id) || "").trim();
  const rep_public_id = String(sp(searchParams.rep_public_id) || "").trim();
  const error = String(sp(searchParams.error) || "").trim();

  const fiscalYearsRes = await getDistinctFiscalYears().catch(() => ({ ok: true as const, data: [] as Array<{ fiscal_year: string }> }));
  const fiscalYears = fiscalYearsRes.ok ? fiscalYearsRes.data : [];

  const periodsRes = await getQuotaPeriods().catch(() => ({ ok: true as const, data: [] as QuotaPeriodRow[] }));
  const allPeriods = periodsRes.ok ? periodsRes.data : [];
  const periods = fiscal_year ? allPeriods.filter((p) => String(p.fiscal_year) === fiscal_year) : allPeriods;

  const currentPeriod = period_id ? periods.find((p) => String(p.id) === String(period_id)) || null : null;

  const repsAll = await listReps({ organizationId: ctx.user.org_id, activeOnly: true }).catch(() => []);
  const repsLite: RepLite[] = (repsAll || []).map((r) => ({
    id: Number(r.id),
    public_id: String(r.public_id || ""),
    rep_name: String(r.rep_name || ""),
    manager_rep_id: r.manager_rep_id == null ? null : Number(r.manager_rep_id),
    manager_rep_public_id: r.manager_rep_public_id ? String(r.manager_rep_public_id) : null,
    active: r.active ?? null,
  }));

  // Build hierarchy deterministically from manager_rep_id relationships.
  const directReportCount = new Map<number, number>();
  for (const r of repsLite) {
    const mid = r.manager_rep_id;
    if (mid == null) continue;
    directReportCount.set(mid, (directReportCount.get(mid) || 0) + 1);
  }
  const managerCandidates = repsLite.filter((r) => (directReportCount.get(r.id) || 0) > 0);
  const executiveCandidates = managerCandidates.filter((r) => r.manager_rep_id == null);

  const selectedExec = exec_public_id ? executiveCandidates.find((r) => r.public_id === exec_public_id) || null : null;
  const managerOptions = selectedExec ? managerCandidates.filter((r) => r.manager_rep_id === selectedExec.id) : managerCandidates;
  const selectedManager = manager_public_id ? managerOptions.find((r) => r.public_id === manager_public_id) || null : null;
  const repOptions = selectedManager ? repsLite.filter((r) => r.manager_rep_id === selectedManager.id) : [];
  const selectedRep = rep_public_id ? repOptions.find((r) => r.public_id === rep_public_id) || null : null;

  const yearPeriods = fiscal_year ? periods : [];
  const quarterByKey = new Map<string, QuotaPeriodRow>();
  for (const p of yearPeriods) {
    const fq = String(p.fiscal_quarter || "").trim();
    if (fq) quarterByKey.set(fq, p);
  }
  const q1p = quarterByKey.get("Q1") || null;
  const q2p = quarterByKey.get("Q2") || null;
  const q3p = quarterByKey.get("Q3") || null;
  const q4p = quarterByKey.get("Q4") || null;
  const quarterPeriodIds = [q1p?.id, q2p?.id, q3p?.id, q4p?.id].filter(Boolean).map(String);

  const selectedRepId = selectedRep?.id && Number.isFinite(Number(selectedRep.id)) ? Number(selectedRep.id) : null;
  const repQuotas =
    selectedRepId && quarterPeriodIds.length
      ? await pool
          .query<{ quota_period_id: string; quota_amount: number | null; annual_target: number | null }>(
            `
            SELECT
              quota_period_id::text AS quota_period_id,
              quota_amount::float8 AS quota_amount,
              annual_target::float8 AS annual_target
            FROM quotas
            WHERE org_id = $1::bigint
              AND role_level = 3
              AND rep_id = $2::bigint
              AND quota_period_id = ANY($3::bigint[])
            ORDER BY id DESC
            `,
            [ctx.user.org_id, selectedRepId, quarterPeriodIds]
          )
          .then((r) => r.rows || [])
          .catch(() => [])
      : [];
  const quotaByPeriodId = new Map<string, { quota_amount: number | null; annual_target: number | null }>();
  for (const q of repQuotas) {
    const k = String((q as any).quota_period_id || "");
    if (!k) continue;
    if (!quotaByPeriodId.has(k)) quotaByPeriodId.set(k, { quota_amount: (q as any).quota_amount ?? null, annual_target: (q as any).annual_target ?? null });
  }
  const annualTargetDefault =
    (repQuotas.find((q) => q.annual_target != null)?.annual_target ?? null) != null ? String(repQuotas.find((q) => q.annual_target != null)?.annual_target) : "";

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
            <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Quota setup</h2>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              1) Choose rep (Admin selects Executive → Manager → Rep). 2) Enter fiscal year + quarter dates. 3) Enter rep quotas per quarter + annual quota.
            </p>

            <form method="GET" action="/analytics/quotas/admin" className="mt-4 grid gap-3">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Executive</label>
                  <select
                    name="exec_public_id"
                    defaultValue={exec_public_id}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="">(select)</option>
                    {executiveCandidates.map((e) => (
                      <option key={e.public_id} value={e.public_id}>
                        {e.rep_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Manager</label>
                  <select
                    name="manager_public_id"
                    defaultValue={manager_public_id}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                    disabled={!managerOptions.length}
                  >
                    <option value="">(select)</option>
                    {managerOptions.map((m) => (
                      <option key={m.public_id} value={m.public_id}>
                        {m.rep_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Sales Rep</label>
                  <select
                    name="rep_public_id"
                    defaultValue={rep_public_id}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                    disabled={!repOptions.length}
                  >
                    <option value="">(select)</option>
                    {repOptions.map((r) => (
                      <option key={r.public_id} value={r.public_id}>
                        {r.rep_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="md:col-span-2 grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Fiscal Year (label)</label>
                  <input
                    name="fiscal_year"
                    defaultValue={fiscal_year}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                    placeholder="2026"
                  />
                </div>
                <div className="flex items-end justify-end gap-2">
                  <Link
                    href="/analytics/quotas/admin"
                    className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
                  >
                    Reset
                  </Link>
                  <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                    Load
                  </button>
                </div>
              </div>
            </form>

            <form action={saveRepQuotaSetupAction} className="mt-5 grid gap-4">
              <input type="hidden" name="exec_public_id" value={exec_public_id} />
              <input type="hidden" name="manager_public_id" value={manager_public_id} />
              <input type="hidden" name="rep_public_id" value={rep_public_id} />
              <input type="hidden" name="fiscal_year" value={fiscal_year} />

              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Annual quota</label>
                  <input
                    name="annual_target"
                    type="number"
                    step="0.01"
                    defaultValue={annualTargetDefault}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                    placeholder="0"
                    required
                    disabled={!selectedRep || !fiscal_year}
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Selected rep</label>
                  <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]">
                    {selectedRep?.rep_name || "—"}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {[
                  { key: "q1", label: "1st Quarter", fq: "Q1", p: q1p },
                  { key: "q2", label: "2nd Quarter", fq: "Q2", p: q2p },
                  { key: "q3", label: "3rd Quarter", fq: "Q3", p: q3p },
                  { key: "q4", label: "4th Quarter", fq: "Q4", p: q4p },
                ].map((q) => {
                  const pid = q.p ? String(q.p.id) : "";
                  const existing = pid ? quotaByPeriodId.get(pid) || null : null;
                  const startDefault = q.p ? String(q.p.period_start || "") : "";
                  const endDefault = q.p ? String(q.p.period_end || "") : "";
                  const quotaDefault = existing && existing.quota_amount != null ? String(existing.quota_amount) : "";
                  return (
                  <div key={q.key} className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
                    <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{q.label}</div>
                    <div className="mt-3 grid gap-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="grid gap-1">
                          <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Start Date</label>
                          <input
                            name={`${q.key}_start`}
                            type="date"
                            defaultValue={startDefault}
                            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                            required
                            disabled={!selectedRep || !fiscal_year}
                          />
                        </div>
                        <div className="grid gap-1">
                          <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">End Date</label>
                          <input
                            name={`${q.key}_end`}
                            type="date"
                            defaultValue={endDefault}
                            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                            required
                            disabled={!selectedRep || !fiscal_year}
                          />
                        </div>
                      </div>
                      <div className="grid gap-1">
                        <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Rep quota ({q.fq})</label>
                        <input
                          name={`${q.key}_quota`}
                          type="number"
                          step="0.01"
                          defaultValue={quotaDefault}
                          className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                          placeholder="0"
                          required
                          disabled={!selectedRep || !fiscal_year}
                        />
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
                  disabled={!selectedRep || !fiscal_year}
                >
                  Save and next rep
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
                        <td colSpan={6} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
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
                        <td colSpan={6} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
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
                        <td colSpan={6} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
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

