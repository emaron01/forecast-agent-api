import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Modal } from "../../_components/Modal";
import { createQuota, listQuotaPeriods, listQuotasByCRO, listQuotasByManager, listQuotasByRep, listQuotasByVP, updateQuota } from "../../actions/quotas";
import { requireOrgContext } from "../../../../lib/auth";
import { listReps } from "../../../../lib/db";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function closeHref(baseParams?: Record<string, string>) {
  const base = `/admin/analytics/quotas`;
  const p = new URLSearchParams(baseParams || {});
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

type Mode = "rep" | "manager" | "vp" | "cro";

async function createQuotaAction(formData: FormData) {
  "use server";
  const returnTo = String(formData.get("returnTo") || "/admin/analytics/quotas").trim() || "/admin/analytics/quotas";
  await createQuota(formData);
  revalidatePath("/admin/analytics/quotas");
  redirect(returnTo);
}

async function updateQuotaAction(formData: FormData) {
  "use server";
  const returnTo = String(formData.get("returnTo") || "/admin/analytics/quotas").trim() || "/admin/analytics/quotas";
  await updateQuota(formData);
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
  const quotaId = sp(searchParams.id) || "";

  const modeRaw = (sp(searchParams.mode) || "rep") as Mode;
  const mode: Mode = modeRaw === "manager" || modeRaw === "vp" || modeRaw === "cro" ? modeRaw : "rep";

  const rep_id = sp(searchParams.rep_id) || "";
  const manager_id = sp(searchParams.manager_id) || "";

  const reps = await listReps({ organizationId: orgId, activeOnly: false }).catch(() => []);
  const periods = await listQuotaPeriods().catch(() => []);

  const baseParams: Record<string, string> = { mode };
  if (mode === "rep" && rep_id) baseParams.rep_id = rep_id;
  if (mode === "manager" && manager_id) baseParams.manager_id = manager_id;

  const quotas =
    mode === "vp"
      ? await listQuotasByVP().catch(() => [])
      : mode === "cro"
        ? await listQuotasByCRO().catch(() => [])
        : mode === "manager" && manager_id
          ? await listQuotasByManager({ manager_id }).catch(() => [])
          : mode === "rep" && rep_id
            ? await listQuotasByRep({ rep_id }).catch(() => [])
            : ([] as Awaited<ReturnType<typeof listQuotasByRep>>);

  const current = quotaId && modal === "edit" ? quotas.find((q) => String(q.id) === String(quotaId)) || null : null;

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Quota assignments</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Assign quotas (`quotas`).</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/analytics`}
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Analytics home
          </Link>
          <Link
            href={`${closeHref(baseParams)}${Object.keys(baseParams).length ? "&" : "?"}modal=new`}
            className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
          >
            New quota
          </Link>
        </div>
      </div>

      <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Filters</h2>
        <form method="GET" action="/admin/analytics/quotas" className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">mode</label>
            <select
              name="mode"
              defaultValue={mode}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            >
              <option value="rep">rep</option>
              <option value="manager">manager</option>
              <option value="vp">vp</option>
              <option value="cro">cro</option>
            </select>
          </div>
          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">rep_id</label>
            <select
              name="rep_id"
              defaultValue={rep_id}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              disabled={mode !== "rep"}
            >
              <option value="">(select)</option>
              {reps.map((r) => (
                <option key={r.id} value={String(r.id)}>
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
              disabled={mode !== "manager"}
            >
              <option value="">(select)</option>
              {reps.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.rep_name} ({r.id})
                </option>
              ))}
            </select>
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

      <div className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">id</th>
              <th className="px-4 py-3">quota_period_id</th>
              <th className="px-4 py-3">role_level</th>
              <th className="px-4 py-3">rep_id</th>
              <th className="px-4 py-3">manager_id</th>
              <th className="px-4 py-3 text-right">quota_amount</th>
              <th className="px-4 py-3 text-right">annual_target</th>
              <th className="px-4 py-3 text-right">carry_forward</th>
              <th className="px-4 py-3 text-right">adjusted_quarterly_quota</th>
              <th className="px-4 py-3 text-right">actions</th>
            </tr>
          </thead>
          <tbody>
            {quotas.length ? (
              quotas.map((q) => (
                <tr key={q.id} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3 font-mono text-xs">{q.id}</td>
                  <td className="px-4 py-3 font-mono text-xs">{q.quota_period_id}</td>
                  <td className="px-4 py-3">{q.role_level}</td>
                  <td className="px-4 py-3 font-mono text-xs">{q.rep_id || ""}</td>
                  <td className="px-4 py-3 font-mono text-xs">{q.manager_id || ""}</td>
                  <td className="px-4 py-3 text-right">{q.quota_amount}</td>
                  <td className="px-4 py-3 text-right">{q.annual_target ?? ""}</td>
                  <td className="px-4 py-3 text-right">{q.carry_forward ?? ""}</td>
                  <td className="px-4 py-3 text-right">{q.adjusted_quarterly_quota ?? ""}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`${closeHref(baseParams)}&modal=edit&id=${encodeURIComponent(String(q.id))}`}
                      className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                  No quotas found for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal === "new" ? (
        <Modal title="New quota" closeHref={closeHref(baseParams)}>
          <form action={createQuotaAction} className="grid gap-3">
            <input type="hidden" name="returnTo" value={closeHref(baseParams)} />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">quota_period_id</label>
              <select
                name="quota_period_id"
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              >
                <option value="">(select)</option>
                {periods.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.period_name} ({p.id})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">role_level</label>
                <input
                  name="role_level"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">rep_id</label>
                <select
                  name="rep_id"
                  defaultValue=""
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                >
                  <option value="">(none)</option>
                  {reps.map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.rep_name} ({r.id})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">manager_id</label>
                <select
                  name="manager_id"
                  defaultValue=""
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                >
                  <option value="">(none)</option>
                  {reps.map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.rep_name} ({r.id})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">quota_amount</label>
                <input
                  name="quota_amount"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">annual_target</label>
                <input
                  name="annual_target"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">carry_forward</label>
                <input
                  name="carry_forward"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">adjusted_quarterly_quota</label>
                <input
                  name="adjusted_quarterly_quota"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Link
                href={closeHref(baseParams)}
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Cancel
              </Link>
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Create
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "edit" && current ? (
        <Modal title="Edit quota" closeHref={closeHref(baseParams)}>
          <form action={updateQuotaAction} className="grid gap-3">
            <input type="hidden" name="returnTo" value={closeHref(baseParams)} />
            <input type="hidden" name="id" value={String(current.id)} />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">quota_period_id</label>
              <select
                name="quota_period_id"
                defaultValue={String(current.quota_period_id)}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              >
                <option value="">(select)</option>
                {periods.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.period_name} ({p.id})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">role_level</label>
                <input
                  name="role_level"
                  defaultValue={String(current.role_level)}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">rep_id</label>
                <select
                  name="rep_id"
                  defaultValue={current.rep_id || ""}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                >
                  <option value="">(none)</option>
                  {reps.map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.rep_name} ({r.id})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">manager_id</label>
                <select
                  name="manager_id"
                  defaultValue={current.manager_id || ""}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                >
                  <option value="">(none)</option>
                  {reps.map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.rep_name} ({r.id})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">quota_amount</label>
                <input
                  name="quota_amount"
                  defaultValue={String(current.quota_amount)}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">annual_target</label>
                <input
                  name="annual_target"
                  defaultValue={current.annual_target == null ? "" : String(current.annual_target)}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">carry_forward</label>
                <input
                  name="carry_forward"
                  defaultValue={current.carry_forward == null ? "" : String(current.carry_forward)}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">adjusted_quarterly_quota</label>
                <input
                  name="adjusted_quarterly_quota"
                  defaultValue={current.adjusted_quarterly_quota == null ? "" : String(current.adjusted_quarterly_quota)}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Link
                href={closeHref(baseParams)}
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Cancel
              </Link>
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Save
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  );
}

