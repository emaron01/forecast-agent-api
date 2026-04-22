import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { deleteRepQuotaSet, listQuotaPeriods, listQuotasByRep } from "../../actions/quotas";
import { requireOrgContext } from "../../../../lib/auth";
import { listReps, syncRepsFromUsers } from "../../../../lib/db";
import { pool } from "../../../../lib/pool";
import { upsertRepQuotaForPeriod } from "../../../../lib/quotaService";
import type { QuotaPeriodRow } from "../../../../lib/quotaModels";
import { FiscalYearSelector } from "../../../../components/quotas/FiscalYearSelector";
import { QuotaSetupShell } from "../../../../components/quota/QuotaSetupShell";
import { isAdmin } from "../../../../lib/roleHelpers";

function repLabel(r: any) {
  const dn = String(r?.display_name || "").trim();
  if (dn) return dn;
  const rn = String(r?.rep_name || "").trim();
  return rn || "(Unnamed)";
}

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

async function resolveRepByPublicId(args: { orgId: number; repPublicId: string }) {
  const { rows } = await pool.query<{
    id: number;
    public_id: string;
    rep_name: string | null;
    display_name: string | null;
    user_id: number | null;
    hierarchy_level: number | null;
    manager_rep_id: number | null;
  }>(
    `
    SELECT
      r.id,
      r.public_id::text AS public_id,
      r.rep_name,
      r.display_name,
      r.user_id,
      u.hierarchy_level,
      r.manager_rep_id
    FROM reps r
    LEFT JOIN users u
      ON u.id = r.user_id
     AND u.org_id = r.organization_id
    WHERE r.organization_id = $1::bigint
      AND r.public_id::text = $2
    LIMIT 1
    `,
    [args.orgId, args.repPublicId]
  );
  return rows?.[0] ?? null;
}

async function saveQuotaSetupAction(formData: FormData) {
  "use server";
  const rep_public_id = String(formData.get("rep_public_id") || "").trim();
  const fiscal_year = String(formData.get("fiscal_year") || "").trim();
  const annual_target_raw = String(formData.get("annual_target") || "").trim();
  const annual_target = annual_target_raw ? Number(annual_target_raw) : NaN;
  const q1_quota = Number(formData.get("q1_quota") || 0) || 0;
  const q2_quota = Number(formData.get("q2_quota") || 0) || 0;
  const q3_quota = Number(formData.get("q3_quota") || 0) || 0;
  const q4_quota = Number(formData.get("q4_quota") || 0) || 0;

  if (!rep_public_id || !fiscal_year) redirect("/admin/analytics/quotas?error=rep_and_year_required");
  if (!Number.isFinite(annual_target) || annual_target <= 0) {
    redirect(
      `/admin/analytics/quotas?error=${encodeURIComponent("annual quota must be a positive number")}&fiscal_year=${encodeURIComponent(
        fiscal_year
      )}`
    );
  }

  const quarterSum = q1_quota + q2_quota + q3_quota + q4_quota;
  if (quarterSum - annual_target > 1e-6) {
    redirect(
      `/admin/analytics/quotas?error=${encodeURIComponent("all 4 quarters cannot exceed the annual quota")}&fiscal_year=${encodeURIComponent(
        fiscal_year
      )}`
    );
  }

  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && !isAdmin(ctx.user)) redirect("/admin/users");

  const rep = await resolveRepByPublicId({ orgId, repPublicId: rep_public_id });
  if (!rep?.id) {
    redirect(
      `/admin/analytics/quotas?error=${encodeURIComponent("rep not found")}&fiscal_year=${encodeURIComponent(fiscal_year)}`
    );
  }

  const periods = await listQuotaPeriods().catch(() => []);
  const byQuarter = new Map<"1" | "2" | "3" | "4", QuotaPeriodRow>();
  for (const p of periods || []) {
    if (String((p as any).fiscal_year || "") !== fiscal_year) continue;
    const q = quarterNumberFromAny((p as any).fiscal_quarter) || quarterNumberFromAny((p as any).period_name);
    if (q === "1" || q === "2" || q === "3" || q === "4") {
      if (!byQuarter.has(q)) byQuarter.set(q, p as QuotaPeriodRow);
    }
  }
  const assignments = [
    { p: byQuarter.get("1"), amount: q1_quota },
    { p: byQuarter.get("2"), amount: q2_quota },
    { p: byQuarter.get("3"), amount: q3_quota },
    { p: byQuarter.get("4"), amount: q4_quota },
  ];
  if (assignments.some((a) => !a.p?.id)) {
    redirect(
      `/admin/analytics/quotas?error=${encodeURIComponent("missing_quarter_periods")}&fiscal_year=${encodeURIComponent(fiscal_year)}`
    );
  }

  for (const a of assignments) {
    await upsertRepQuotaForPeriod({
      orgId,
      repId: Number(rep.id),
      quotaPeriodId: Number(a.p!.id),
      quotaAmount: a.amount,
      annualTarget: annual_target,
      managerId: rep.manager_rep_id == null ? null : Number(rep.manager_rep_id),
      isAdmin: true,
    });
  }

  revalidatePath("/admin/analytics/quotas");
  redirect(
    `/admin/analytics/quotas?rep_id=${encodeURIComponent(String(rep.id))}&fiscal_year=${encodeURIComponent(fiscal_year)}`
  );
}

async function deleteRepQuotaSetAction(formData: FormData) {
  "use server";
  const rep_id = String(formData.get("rep_id") || "").trim();
  const fiscal_year = String(formData.get("fiscal_year") || "").trim();
  const returnTo =
    rep_id && fiscal_year ? `/admin/analytics/quotas?rep_id=${encodeURIComponent(rep_id)}&fiscal_year=${encodeURIComponent(fiscal_year)}` : "/admin/analytics/quotas";

  await deleteRepQuotaSet(formData);
  revalidatePath("/admin/analytics/quotas");
  redirect(returnTo);
}

export default async function QuotasPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && !isAdmin(ctx.user)) redirect("/admin/users");

  const rep_id = sp(searchParams.rep_id) || "";
  const fiscal_year = sp(searchParams.fiscal_year) || "";
  const error = sp(searchParams.error) || "";

  await syncRepsFromUsers({ organizationId: orgId });
  const reps = await listReps({ organizationId: orgId, activeOnly: true }).catch(() => []);
  const periods = await listQuotaPeriods().catch(() => []);

  const fiscalYears = Array.from(
    new Set((periods || []).map((p) => String((p as any).fiscal_year || "").trim()).filter(Boolean))
  ).sort((a, b) => (a === b ? 0 : a < b ? 1 : -1));

  const quotas = rep_id ? await listQuotasByRep({ rep_id }).catch(() => []) : [];

  const yearPeriods = fiscal_year ? (periods || []).filter((p) => String((p as any).fiscal_year) === String(fiscal_year)) : [];
  const periodIdByQuarter = new Map<"1" | "2" | "3" | "4", string>();
  for (const p of yearPeriods as any[]) {
    const qn = (quarterNumberFromAny(p.fiscal_quarter) || quarterNumberFromAny(p.period_name)) as any;
    if (qn === "1" || qn === "2" || qn === "3" || qn === "4") {
      if (!periodIdByQuarter.has(qn)) periodIdByQuarter.set(qn, String(p.id));
    }
  }

  const q1PeriodId = periodIdByQuarter.get("1") || "";
  const q2PeriodId = periodIdByQuarter.get("2") || "";
  const q3PeriodId = periodIdByQuarter.get("3") || "";
  const q4PeriodId = periodIdByQuarter.get("4") || "";

  const quotaByPeriodId = new Map<string, any>();
  for (const q of quotas as any[]) {
    const pid = String(q.quota_period_id || "");
    if (!pid) continue;
    if (!quotaByPeriodId.has(pid)) quotaByPeriodId.set(pid, q);
  }

  const q1 = q1PeriodId ? quotaByPeriodId.get(q1PeriodId) : null;
  const q2 = q2PeriodId ? quotaByPeriodId.get(q2PeriodId) : null;
  const q3 = q3PeriodId ? quotaByPeriodId.get(q3PeriodId) : null;
  const q4 = q4PeriodId ? quotaByPeriodId.get(q4PeriodId) : null;

  const q1Amt = q1 ? Number(q1.quota_amount) || 0 : 0;
  const q2Amt = q2 ? Number(q2.quota_amount) || 0 : 0;
  const q3Amt = q3 ? Number(q3.quota_amount) || 0 : 0;
  const q4Amt = q4 ? Number(q4.quota_amount) || 0 : 0;
  const quarterSum = q1Amt + q2Amt + q3Amt + q4Amt;
  const annualTargetAny = (q1 as any)?.annual_target ?? (q2 as any)?.annual_target ?? (q3 as any)?.annual_target ?? (q4 as any)?.annual_target ?? null;
  const annualTargetNum = annualTargetAny != null && Number.isFinite(Number(annualTargetAny)) ? Number(annualTargetAny) : null;

  const selectedRepName = rep_id ? repLabel(reps.find((r) => String(r.id) === String(rep_id))) : "";
  const selectedRepDetail =
    rep_id && /^\d+$/.test(rep_id)
      ? await pool
          .query<{
            id: number;
            public_id: string;
            rep_name: string | null;
            display_name: string | null;
            user_id: number | null;
            hierarchy_level: number | null;
            manager_rep_id: number | null;
          }>(
            `
            SELECT
              r.id,
              r.public_id::text AS public_id,
              r.rep_name,
              r.display_name,
              r.user_id,
              u.hierarchy_level,
              r.manager_rep_id
            FROM reps r
            LEFT JOIN users u
              ON u.id = r.user_id
             AND u.org_id = r.organization_id
            WHERE r.organization_id = $1::bigint
              AND r.id = $2::bigint
            LIMIT 1
            `,
            [orgId, rep_id]
          )
          .then((r) => r.rows?.[0] ?? null)
          .catch(() => null)
      : null;

  const quarterIds = [q1PeriodId, q2PeriodId, q3PeriodId, q4PeriodId].filter(Boolean).map(Number);
  const selectedRepWonRows =
    selectedRepDetail?.id && quarterIds.length
      ? await pool
          .query<{ quota_period_id: string; won_amount: number }>(
            `
            WITH periods AS (
              SELECT id, period_start::date AS period_start, period_end::date AS period_end
                FROM quota_periods
               WHERE org_id = $1::bigint
                 AND id = ANY($2::bigint[])
            ),
            deals AS (
              SELECT
                o.rep_id,
                COALESCE(o.amount, 0) AS amount,
                CASE
                  WHEN o.close_date IS NULL THEN NULL
                  WHEN (o.close_date::text ~ '^\\d{4}-\\d{2}-\\d{2}') THEN substring(o.close_date::text from 1 for 10)::date
                  WHEN (o.close_date::text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}') THEN
                    to_date(substring(o.close_date::text from '^(\\d{1,2}/\\d{1,2}/\\d{4})'), 'MM/DD/YYYY')
                  ELSE NULL
                END AS close_d
              FROM opportunities o
             WHERE o.org_id = $1::bigint
               AND o.rep_id = $3::bigint
            )
            SELECT
              p.id::text AS quota_period_id,
              COALESCE(SUM(d.amount), 0)::float8 AS won_amount
            FROM deals d
            JOIN periods p
              ON d.close_d IS NOT NULL
             AND d.close_d >= p.period_start
             AND d.close_d <= p.period_end
            GROUP BY p.id
            `,
            [orgId, quarterIds, selectedRepDetail.id]
          )
          .then((r) => r.rows || [])
          .catch(() => [])
      : [];

  const overlayAssignments =
    selectedRepDetail?.user_id != null
      ? await pool
          .query<{ channel_rep_id: number; partner_name: string }>(
            `
            SELECT channel_rep_id, partner_name
              FROM partner_channel_assignments
             WHERE org_id = $1::bigint
               AND channel_rep_id = $2::int
            `,
            [orgId, selectedRepDetail.user_id]
          )
          .then((r) => r.rows || [])
          .catch(() => [])
      : [];
  const isOverlay = overlayAssignments.length > 0;
  const overlayPartnerNames = Array.from(
    new Set(overlayAssignments.map((r) => String(r.partner_name || "").trim()).filter(Boolean))
  );

  const managerHasQuota =
    selectedRepDetail?.manager_rep_id != null && fiscal_year
      ? await pool
          .query<{ has_quota: boolean }>(
            `
            SELECT COALESCE(SUM(q.quota_amount), 0) > 0 AS has_quota
              FROM quotas q
              JOIN quota_periods qp
                ON qp.id = q.quota_period_id
               AND qp.org_id = q.org_id
             WHERE q.org_id = $1::bigint
               AND q.rep_id = $2::bigint
               AND qp.fiscal_year = $3
            `,
            [orgId, selectedRepDetail.manager_rep_id, fiscal_year]
          )
          .then((r) => r.rows?.[0]?.has_quota === true)
          .catch(() => false)
      : true;

  const viewerSelfRep =
    ctx.kind === "user"
      ? await pool
          .query<{ id: number; public_id: string; rep_name: string | null; display_name: string | null }>(
            `
            SELECT
              r.id,
              r.public_id::text AS public_id,
              r.rep_name,
              r.display_name
            FROM reps r
            WHERE r.organization_id = $1::bigint
              AND r.user_id = $2::bigint
            ORDER BY r.id DESC
            LIMIT 1
            `,
            [orgId, ctx.user.id]
          )
          .then((r) => r.rows?.[0] ?? null)
          .catch(() => null)
      : null;

  const viewerQuotaRows =
    viewerSelfRep?.id && [q1PeriodId, q2PeriodId, q3PeriodId, q4PeriodId].filter(Boolean).length
      ? await pool
          .query<{ quota_period_id: string; quota_amount: number; annual_target: number | null }>(
            `
            SELECT
              q.quota_period_id::text AS quota_period_id,
              q.quota_amount::float8 AS quota_amount,
              q.annual_target::float8 AS annual_target
            FROM quotas q
            WHERE q.org_id = $1::bigint
              AND q.rep_id = $2::bigint
              AND q.quota_period_id = ANY($3::bigint[])
            `,
            [orgId, viewerSelfRep.id, [q1PeriodId, q2PeriodId, q3PeriodId, q4PeriodId].filter(Boolean)]
          )
          .then((r) => r.rows || [])
          .catch(() => [])
      : [];
  const leaderQuarterTotal = viewerQuotaRows.reduce((sum, row) => sum + (Number(row.quota_amount || 0) || 0), 0);
  const leaderHasQuota = leaderQuarterTotal > 0 || viewerQuotaRows.some((row) => Number(row.annual_target || 0) > 0);

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Quota assignments</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Assign rep quotas by quarter (`quotas`).</p>
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

      {error ? (
        <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <div className="text-sm font-medium text-[color:var(--sf-text-primary)]">Error</div>
          <div className="mt-1 font-mono text-xs text-[color:var(--sf-text-secondary)]">{error}</div>
          {error === "missing_quarter_periods" ? (
            <div className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">
              Missing Q1–Q4 quota periods for that fiscal year. Create them in{" "}
              <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/admin/analytics/quota-periods">
                quota periods
              </Link>
              .
            </div>
          ) : null}
        </section>
      ) : null}

        <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Filters</h2>
          <form method="GET" action="/admin/analytics/quotas" className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Rep</label>
              <select
                name="rep_id"
                defaultValue={rep_id}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              >
                <option value="">(select)</option>
                {reps.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {repLabel(r)}
                  </option>
                ))}
              </select>
            </div>
            <FiscalYearSelector name="fiscal_year" fiscalYears={fiscalYears.map((y) => ({ fiscal_year: y }))} defaultValue={fiscal_year} required={false} label="Fiscal Year" />
            <div className="flex items-end justify-end gap-2">
              <Link
                href="/admin/analytics/quotas"
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

      {!rep_id || !fiscal_year ? (
        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <p className="text-sm text-[color:var(--sf-text-secondary)]">Select a Rep and Fiscal Year to view and edit the 4-quarter quota set.</p>
        </section>
      ) : (
          <section className="mt-5 grid gap-5">
            {error === "missing_quarter_periods" ? (
              <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-4 py-3 text-sm text-[color:var(--sf-text-secondary)]">
                Missing Q1–Q4 quota periods for that fiscal year. Create them in{" "}
                <Link className="text-[color:var(--sf-accent-primary)] hover:underline" href="/admin/analytics/quota-periods">
                  quota periods
                </Link>
                .
              </div>
            ) : null}

            {selectedRepDetail ? (
              <>
                <div className="flex items-center justify-end gap-2">
                  <form action={deleteRepQuotaSetAction}>
                    <input type="hidden" name="rep_id" value={rep_id} />
                    <input type="hidden" name="fiscal_year" value={fiscal_year} />
                    <button className="rounded-md border border-[#E74C3C] px-3 py-2 text-sm text-[#E74C3C] hover:bg-[color:var(--sf-surface-alt)]">
                      Delete quota set
                    </button>
                  </form>
                </div>
                <QuotaSetupShell
                  fiscalYear={fiscal_year}
                  quotaPeriods={yearPeriods as any[]}
                  viewer={{
                    repId: viewerSelfRep?.id ?? null,
                    repPublicId: String(viewerSelfRep?.public_id || ""),
                    repName: repLabel(viewerSelfRep),
                    hierarchyLevel: Number(ctx.user.hierarchy_level),
                    isAdmin: true,
                  }}
                  leaderQuota={viewerQuotaRows.map((row) => ({
                    periodId: Number(row.quota_period_id),
                    amount: Number(row.quota_amount || 0) || 0,
                    annualTarget: row.annual_target,
                  }))}
                  leaderHasQuota={leaderHasQuota}
                  leaderQuarterTotal={leaderQuarterTotal}
                  reps={[
                    {
                      repId: Number(selectedRepDetail.id),
                      repPublicId: String(selectedRepDetail.public_id || ""),
                      repName: repLabel(selectedRepDetail),
                      userId: selectedRepDetail.user_id == null ? null : Number(selectedRepDetail.user_id),
                      hierarchyLevel: selectedRepDetail.hierarchy_level == null ? null : Number(selectedRepDetail.hierarchy_level),
                      managerRepId: selectedRepDetail.manager_rep_id == null ? null : Number(selectedRepDetail.manager_rep_id),
                      quota: [q1, q2, q3, q4]
                        .filter(Boolean)
                        .map((q: any) => ({
                          periodId: Number(q.quota_period_id),
                          amount: Number(q.quota_amount || 0) || 0,
                          annualTarget: q.annual_target ?? null,
                        })),
                      wonByPeriod: selectedRepWonRows.map((row) => ({
                        periodId: Number(row.quota_period_id),
                        wonAmount: Number(row.won_amount || 0) || 0,
                      })),
                      isOverlay,
                      managerHasQuota,
                    },
                  ]}
                  selectedRepPublicId={String(selectedRepDetail.public_id || "")}
                  sumRepQuotas={quarterSum}
                  overlayQuotaTotal={isOverlay ? quarterSum : 0}
                  overlayPartnerNames={overlayPartnerNames}
                  saveAction={saveQuotaSetupAction}
                />
              </>
            ) : (
              <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
                <p className="text-sm text-[color:var(--sf-text-secondary)]">Selected rep not found.</p>
              </section>
            )}
          </section>
      )}
    </main>
  );
}

