import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Modal } from "../../_components/Modal";
import { deleteRepQuotaSet, listQuotaPeriods, listQuotasByRep, upsertRepQuotaSet } from "../../actions/quotas";
import { requireOrgContext } from "../../../../lib/auth";
import { listReps, syncRepsFromUsers } from "../../../../lib/db";
import { RepQuotaSetFormClient } from "./RepQuotaSetFormClient";

function repLabel(r: any) {
  const dn = String(r?.display_name || "").trim();
  if (dn) return dn;
  const rn = String(r?.rep_name || "").trim();
  return rn || "(Unnamed)";
}

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function closeHref(baseParams?: Record<string, string>) {
  const base = `/admin/analytics/quotas`;
  const p = new URLSearchParams(baseParams || {});
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
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

async function upsertRepQuotaSetAction(formData: FormData) {
  "use server";
  const rep_id = String(formData.get("rep_id") || "").trim();
  const fiscal_year = String(formData.get("fiscal_year") || "").trim();
  const returnTo =
    rep_id && fiscal_year ? `/admin/analytics/quotas?rep_id=${encodeURIComponent(rep_id)}&fiscal_year=${encodeURIComponent(fiscal_year)}` : "/admin/analytics/quotas";

  await upsertRepQuotaSet(formData);
  revalidatePath("/admin/analytics/quotas");
  redirect(returnTo);
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
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const modal = sp(searchParams.modal) || "";
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
    if (String(q.role_level) !== "3") continue;
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
          <Link
            href={`${closeHref({ rep_id, fiscal_year })}${rep_id || fiscal_year ? "&" : "?"}modal=new`}
            className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
          >
            New quota
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
                  {repLabel(r)} ({r.id})
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Fiscal Year</label>
            <select
              name="fiscal_year"
              defaultValue={fiscal_year}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              required
            >
              <option value="">(select)</option>
              {fiscalYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]"> </label>
            <div className="text-sm text-[color:var(--sf-text-secondary)]">{""}</div>
          </div>
          <div className="md:col-span-3 flex items-center justify-end gap-2">
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
        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Quota Set</h2>
              <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                Rep: <span className="font-medium">{selectedRepName || rep_id}</span> · Fiscal Year:{" "}
                <span className="font-mono text-xs">{fiscal_year}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`${closeHref({ rep_id, fiscal_year })}&modal=edit`}
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Edit
              </Link>
              <Link
                href={`${closeHref({ rep_id, fiscal_year })}&modal=delete`}
                className="rounded-md border border-[#E74C3C] px-3 py-2 text-sm text-[#E74C3C] hover:bg-[color:var(--sf-surface-alt)]"
              >
                Delete
              </Link>
            </div>
          </div>

          <div className="mt-4 overflow-auto rounded-md border border-[color:var(--sf-border)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-4 py-3">Q1</th>
                  <th className="px-4 py-3">Q2</th>
                  <th className="px-4 py-3">Q3</th>
                  <th className="px-4 py-3">Q4</th>
                  <th className="px-4 py-3 text-right">Annual Quota</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3 font-mono text-xs">{q1 ? q1Amt : ""}</td>
                  <td className="px-4 py-3 font-mono text-xs">{q2 ? q2Amt : ""}</td>
                  <td className="px-4 py-3 font-mono text-xs">{q3 ? q3Amt : ""}</td>
                  <td className="px-4 py-3 font-mono text-xs">{q4 ? q4Amt : ""}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {q1 || q2 || q3 || q4 || annualTargetNum != null ? annualTargetNum ?? quarterSum : ""}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {modal === "new" ? (
        <Modal title="New Quota Set" closeHref={closeHref({ rep_id, fiscal_year })}>
          <RepQuotaSetFormClient
            action={upsertRepQuotaSetAction}
            mode="new"
            reps={reps.map((r) => ({ id: String(r.id), name: repLabel(r) }))}
            fiscalYears={fiscalYears}
            defaultRepId={rep_id}
            defaultFiscalYear={fiscal_year}
            cancelHref={closeHref({ rep_id, fiscal_year })}
            initialAnnualQuota={annualTargetNum}
            initialAmounts={{ q1: q1Amt, q2: q2Amt, q3: q3Amt, q4: q4Amt }}
          />
        </Modal>
      ) : null}

      {modal === "edit" ? (
        <Modal title="Edit Quota Set" closeHref={closeHref({ rep_id, fiscal_year })}>
          <RepQuotaSetFormClient
            action={upsertRepQuotaSetAction}
            mode="edit"
            reps={reps.map((r) => ({ id: String(r.id), name: repLabel(r) }))}
            fiscalYears={fiscalYears}
            defaultRepId={rep_id}
            defaultFiscalYear={fiscal_year}
            cancelHref={closeHref({ rep_id, fiscal_year })}
            initialAnnualQuota={annualTargetNum}
            initialAmounts={{ q1: q1Amt, q2: q2Amt, q3: q3Amt, q4: q4Amt }}
          />
        </Modal>
      ) : null}

      {modal === "delete" ? (
        <Modal title="Delete Quota Set" closeHref={closeHref({ rep_id, fiscal_year })}>
          <form action={deleteRepQuotaSetAction} className="grid gap-3">
            <input type="hidden" name="rep_id" value={rep_id} />
            <input type="hidden" name="fiscal_year" value={fiscal_year} />
            <div className="rounded-md border border-[#E74C3C] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
              <div className="font-semibold text-[#E74C3C]">This action cannot be undone.</div>
              <div className="mt-1 text-[color:var(--sf-text-secondary)]">
                Delete quota set for Rep <span className="font-medium">{selectedRepName || rep_id}</span> in Fiscal Year{" "}
                <span className="font-mono text-xs">{fiscal_year}</span>.
              </div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Link href={closeHref({ rep_id, fiscal_year })} className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
                Cancel
              </Link>
              <button className="rounded-md bg-[#E74C3C] px-3 py-2 text-sm font-medium text-white hover:opacity-90">Delete</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  );
}

