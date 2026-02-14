import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "../../../../lib/auth";
import { getOrganization } from "../../../../lib/db";
import { pool } from "../../../../lib/pool";
import type { QuotaPeriodRow, QuotaRow } from "../../../../lib/quotaModels";
import { UserTopNav } from "../../../_components/UserTopNav";
import { dateOnly } from "../../../../lib/dateOnly";
import { FiscalYearSelector } from "../../../../components/quotas/FiscalYearSelector";
import { QuotaRollupChart } from "../../../../components/quotas/QuotaRollupChart";
import { QuotaRollupTable, type QuotaRollupRow } from "../../../../components/quotas/QuotaRollupTable";
import { assignQuotaToUser, getDistinctFiscalYears, getQuotaPeriods, getQuotaRollupByManager } from "../actions";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function quarterNumberFromAny(v: unknown): "" | "1" | "2" | "3" | "4" {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "1" || s === "q1" || s.includes("1st")) return "1";
  if (s === "2" || s === "q2" || s.includes("2nd")) return "2";
  if (s === "3" || s === "q3" || s.includes("3rd")) return "3";
  if (s === "4" || s === "q4" || s.includes("4th")) return "4";
  return "";
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

type DirectRep = { id: number; public_id: string; rep_name: string | null };

async function listDirectReps(args: { orgId: number; managerRepId: number }): Promise<DirectRep[]> {
  const { rows } = await pool.query<DirectRep>(
    `
    SELECT r.id, r.public_id::text AS public_id, r.rep_name
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

async function listRepQuotasByPeriodIds(args: { orgId: number; repId: number; quotaPeriodIds: string[] }): Promise<QuotaRow[]> {
  if (!args.quotaPeriodIds.length) return [];
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
      AND role_level = 3
      AND rep_id = $2::bigint
      AND quota_period_id = ANY($3::bigint[])
    ORDER BY quota_period_id DESC, id DESC
    `,
    [args.orgId, args.repId, args.quotaPeriodIds.map((n) => String(n))]
  );
  return rows as QuotaRow[];
}

async function saveRepQuotasForYearAction(formData: FormData) {
  "use server";
  const fiscal_year = String(formData.get("fiscal_year") || "").trim();
  const rep_public_id = String(formData.get("rep_public_id") || "").trim();
  const annual_target_raw = String(formData.get("annual_target") || "").trim();
  const annual_target = annual_target_raw ? Number(annual_target_raw) : undefined;
  const q1_quota = Number(formData.get("q1_quota") || 0) || 0;
  const q2_quota = Number(formData.get("q2_quota") || 0) || 0;
  const q3_quota = Number(formData.get("q3_quota") || 0) || 0;
  const q4_quota = Number(formData.get("q4_quota") || 0) || 0;

  if (!fiscal_year) redirect(`/analytics/quotas/manager?error=${encodeURIComponent("fiscal_year is required")}`);
  if (!rep_public_id)
    redirect(`/analytics/quotas/manager?fiscal_year=${encodeURIComponent(fiscal_year)}&error=${encodeURIComponent("rep is required")}`);

  const ctx = await requireAuth();
  if (ctx.kind !== "user" || ctx.user.role !== "MANAGER") redirect("/dashboard");

  const mgrRepId = await managerRepIdForUser({ orgId: ctx.user.org_id, userId: ctx.user.id });
  if (!mgrRepId) redirect("/dashboard");

  const repId = await resolveRepIdByPublicId({ orgId: ctx.user.org_id, repPublicId: rep_public_id });
  if (!repId)
    redirect(`/analytics/quotas/manager?fiscal_year=${encodeURIComponent(fiscal_year)}&rep_public_id=${encodeURIComponent(rep_public_id)}&error=${encodeURIComponent("rep not found")}`);

  const periodsRes = await getQuotaPeriods().catch(() => ({ ok: true as const, data: [] as QuotaPeriodRow[] }));
  const allPeriods = periodsRes.ok ? periodsRes.data : [];
  const yearPeriods = allPeriods.filter((p) => String(p.fiscal_year) === fiscal_year);
  const byQuarter = new Map<string, QuotaPeriodRow>();
  for (const p of yearPeriods) {
    const fq = quarterNumberFromAny(p.fiscal_quarter);
    if (fq) byQuarter.set(fq, p);
  }
  const q1p = byQuarter.get("1") || null;
  const q2p = byQuarter.get("2") || null;
  const q3p = byQuarter.get("3") || null;
  const q4p = byQuarter.get("4") || null;
  if (!q1p || !q2p || !q3p || !q4p) {
    redirect(
      `/analytics/quotas/manager?fiscal_year=${encodeURIComponent(fiscal_year)}&rep_public_id=${encodeURIComponent(rep_public_id)}&error=${encodeURIComponent(
        "Missing quota periods for this fiscal year (Q1-Q4). Ask Admin to set quarter dates."
      )}`
    );
  }

  const quarterAssignments = [
    { quota_period_id: String(q1p.id), quota_amount: q1_quota },
    { quota_period_id: String(q2p.id), quota_amount: q2_quota },
    { quota_period_id: String(q3p.id), quota_amount: q3_quota },
    { quota_period_id: String(q4p.id), quota_amount: q4_quota },
  ];
  for (const qa of quarterAssignments) {
    const r = await assignQuotaToUser({
      quota_period_id: qa.quota_period_id,
      role_level: 3,
      rep_id: String(repId),
      manager_id: String(mgrRepId),
      quota_amount: qa.quota_amount,
      annual_target,
    });
    if ("error" in r) {
      redirect(
        `/analytics/quotas/manager?fiscal_year=${encodeURIComponent(fiscal_year)}&rep_public_id=${encodeURIComponent(rep_public_id)}&error=${encodeURIComponent(r.error)}`
      );
    }
  }

  revalidatePath("/analytics/quotas/manager");

  const directReps = await listDirectReps({ orgId: ctx.user.org_id, managerRepId: mgrRepId }).catch(() => []);
  const repList = (directReps || []).map((r) => String(r.public_id || "")).filter(Boolean);
  const idx = repList.findIndex((x) => x === rep_public_id);
  const nextRep = idx >= 0 && idx + 1 < repList.length ? repList[idx + 1] : rep_public_id;
  redirect(`/analytics/quotas/manager?fiscal_year=${encodeURIComponent(fiscal_year)}&rep_public_id=${encodeURIComponent(nextRep)}`);
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

  const fiscal_year = String(sp(searchParams.fiscal_year) || "").trim();
  const rep_public_id = String(sp(searchParams.rep_public_id) || "").trim();
  const rollup_quarter = String(sp(searchParams.rollup_quarter) || "").trim() || "Q1";
  const error = String(sp(searchParams.error) || "").trim();

  const fyRes = await getDistinctFiscalYears().catch(() => ({ ok: true as const, data: [] as Array<{ fiscal_year: string }> }));
  const fiscalYears = fyRes.ok ? fyRes.data : [];

  const periodsRes = await getQuotaPeriods().catch(() => ({ ok: true as const, data: [] as QuotaPeriodRow[] }));
  const allPeriods = periodsRes.ok ? periodsRes.data : [];
  const periods = fiscal_year ? allPeriods.filter((p) => String(p.fiscal_year) === fiscal_year) : allPeriods;

  const mgrRepId = await managerRepIdForUser({ orgId: ctx.user.org_id, userId: ctx.user.id });
  if (!mgrRepId) redirect("/dashboard");

  const directReps = await listDirectReps({ orgId: ctx.user.org_id, managerRepId: mgrRepId }).catch(() => []);
  const repOptions = (directReps || []).map((r) => ({ public_id: String(r.public_id || ""), rep_name: String(r.rep_name || "") })).filter((r) => !!r.public_id);
  const selectedRepPublicId = rep_public_id || repOptions[0]?.public_id || "";
  const selectedRepName = repOptions.find((r) => r.public_id === selectedRepPublicId)?.rep_name || "";

  const yearPeriods = fiscal_year ? periods : [];
  const byQuarter = new Map<string, QuotaPeriodRow>();
  for (const p of yearPeriods) {
    const fq = String(p.fiscal_quarter || "").trim();
    if (fq) byQuarter.set(fq, p);
  }
  const q1p = byQuarter.get("Q1") || null;
  const q2p = byQuarter.get("Q2") || null;
  const q3p = byQuarter.get("Q3") || null;
  const q4p = byQuarter.get("Q4") || null;
  const quarterPeriodIds = [q1p?.id, q2p?.id, q3p?.id, q4p?.id].filter(Boolean).map(String);

  const selectedRepId = selectedRepPublicId ? await resolveRepIdByPublicId({ orgId: ctx.user.org_id, repPublicId: selectedRepPublicId }) : null;
  const quotas =
    selectedRepId && quarterPeriodIds.length
      ? await listRepQuotasByPeriodIds({ orgId: ctx.user.org_id, repId: selectedRepId, quotaPeriodIds: quarterPeriodIds }).catch(() => [])
      : [];
  const quotaByPeriodId = new Map<string, QuotaRow>();
  for (const q of quotas) {
    const k = String(q.quota_period_id || "");
    if (!k) continue;
    if (!quotaByPeriodId.has(k)) quotaByPeriodId.set(k, q);
  }

  const rollupPeriodId = (byQuarter.get(rollup_quarter)?.id as any) ? String(byQuarter.get(rollup_quarter)?.id) : "";
  const rollupRes = rollupPeriodId
    ? await getQuotaRollupByManager({ quota_period_id: rollupPeriodId }).catch(() => ({ ok: true as const, data: null as any }))
    : null;
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
            <input type="hidden" name="rollup_quarter" value={rollup_quarter} />
            <FiscalYearSelector name="fiscal_year" fiscalYears={fiscalYears} defaultValue={fiscal_year} required={false} label="Fiscal Year" />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Sales Rep</label>
              <select
                name="rep_public_id"
                defaultValue={selectedRepPublicId}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              >
                {repOptions.map((r) => (
                  <option key={r.public_id} value={r.public_id}>
                    {r.rep_name}
                  </option>
                ))}
              </select>
            </div>
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

        {!fiscal_year ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <p className="text-sm text-[color:var(--sf-text-secondary)]">Select a fiscal year to set rep quotas by quarter.</p>
          </section>
        ) : null}

        {fiscal_year ? (
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Rep quota setup</h2>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Rep: <span className="font-medium">{selectedRepName || "—"}</span> · Fiscal year:{" "}
              <span className="font-mono text-xs">{fiscal_year}</span>
            </p>

            <form action={saveRepQuotasForYearAction} className="mt-4 grid gap-4">
              <input type="hidden" name="fiscal_year" value={fiscal_year} />
              <input type="hidden" name="rep_public_id" value={selectedRepPublicId} />

              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Annual quota</label>
                <input
                  name="annual_target"
                  type="number"
                  step="0.01"
                  className="w-64 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                  placeholder="0"
                  required
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {[
                  { key: "q1", label: "1st Quarter", p: q1p },
                  { key: "q2", label: "2nd Quarter", p: q2p },
                  { key: "q3", label: "3rd Quarter", p: q3p },
                  { key: "q4", label: "4th Quarter", p: q4p },
                ].map((q) => {
                  const pid = q.p ? String(q.p.id) : "";
                  const existing = pid ? quotaByPeriodId.get(pid) || null : null;
                  return (
                    <div key={q.key} className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
                      <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{q.label}</div>
                      <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                        {q.p ? (
                          <>
                            {dateOnly(q.p.period_start)} → {dateOnly(q.p.period_end)}
                          </>
                        ) : (
                          "Missing quarter period"
                        )}
                      </div>
                      <div className="mt-3 grid gap-1">
                        <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Rep quota</label>
                        <input
                          name={`${q.key}_quota`}
                          type="number"
                          step="0.01"
                          defaultValue={existing ? String(existing.quota_amount ?? "") : ""}
                          className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                          placeholder="0"
                          required
                          disabled={!q.p}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-end gap-2">
                <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                  Save and next rep
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {rollupPeriodId ? (
          <section className="mt-5 grid gap-5 md:grid-cols-2">
            <QuotaRollupChart title="Quota vs attainment (direct reports)" rows={repRows} />
            <QuotaRollupTable title="Manager rollup" subtitle="Uses public.manager_attainment" rows={mgrRow} />
          </section>
        ) : null}

        {rollupPeriodId ? (
          <section className="mt-5">
            <QuotaRollupTable title="Rep rollup" subtitle="Uses public.rep_attainment (direct reports only)" rows={repRows} />
          </section>
        ) : null}
      </main>
    </div>
  );
}

