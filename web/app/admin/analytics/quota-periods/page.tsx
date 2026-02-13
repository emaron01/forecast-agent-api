import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Modal } from "../../_components/Modal";
import { createQuotaPeriod, listQuotaPeriods, updateQuotaPeriod } from "../../actions/quotas";
import { requireOrgContext } from "../../../../lib/auth";
import { dateOnly } from "../../../../lib/dateOnly";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function closeHref() {
  return `/admin/analytics/quota-periods`;
}

async function createQuotaPeriodAction(formData: FormData) {
  "use server";
  await createQuotaPeriod(formData);
  revalidatePath("/admin/analytics/quota-periods");
  redirect("/admin/analytics/quota-periods");
}

async function updateQuotaPeriodAction(formData: FormData) {
  "use server";
  await updateQuotaPeriod(formData);
  revalidatePath("/admin/analytics/quota-periods");
  redirect("/admin/analytics/quota-periods");
}

export default async function QuotaPeriodsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { ctx } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const modal = sp(searchParams.modal) || "";
  const id = sp(searchParams.id) || "";

  const periods = await listQuotaPeriods();
  const current = id && (modal === "edit") ? periods.find((p) => String(p.id) === String(id)) || null : null;

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Fiscal calendar</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Manage quota periods (`quota_periods`).</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/analytics`}
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Analytics home
          </Link>
          <Link
            href={`/admin/analytics/quota-periods?modal=new`}
            className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
          >
            New quota period
          </Link>
        </div>
      </div>

      <div className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">id</th>
              <th className="px-4 py-3">period_name</th>
              <th className="px-4 py-3">period_start</th>
              <th className="px-4 py-3">period_end</th>
              <th className="px-4 py-3">fiscal_year</th>
              <th className="px-4 py-3">fiscal_quarter</th>
              <th className="px-4 py-3 text-right">actions</th>
            </tr>
          </thead>
          <tbody>
            {periods.length ? (
              periods.map((p) => (
                <tr key={p.id} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3 font-mono text-xs">{p.id}</td>
                  <td className="px-4 py-3">{p.period_name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{dateOnly(p.period_start)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{dateOnly(p.period_end)}</td>
                  <td className="px-4 py-3">{p.fiscal_year}</td>
                  <td className="px-4 py-3">{p.fiscal_quarter}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/analytics/quota-periods?modal=edit&id=${encodeURIComponent(String(p.id))}`}
                      className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                  No quota periods found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal === "new" ? (
        <Modal title="New quota period" closeHref={closeHref()}>
          <form action={createQuotaPeriodAction} className="grid gap-3">
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
              <Link
                href={closeHref()}
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
        <Modal title="Edit quota period" closeHref={closeHref()}>
          <form action={updateQuotaPeriodAction} className="grid gap-3">
            <input type="hidden" name="id" value={String(current.id)} />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">period_name</label>
              <input
                name="period_name"
                defaultValue={current.period_name}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">period_start</label>
                <input
                  name="period_start"
                  defaultValue={current.period_start}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">period_end</label>
                <input
                  name="period_end"
                  defaultValue={current.period_end}
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
                  defaultValue={current.fiscal_year}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">fiscal_quarter</label>
                <input
                  name="fiscal_quarter"
                  defaultValue={current.fiscal_quarter}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Link
                href={closeHref()}
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

