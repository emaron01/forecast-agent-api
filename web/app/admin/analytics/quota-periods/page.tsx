import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Modal } from "../../_components/Modal";
import { createQuotaPeriod, deleteQuotaPeriod, listQuotaPeriods, updateQuotaPeriod } from "../../actions/quotas";
import { requireOrgContext } from "../../../../lib/auth";
import { dateOnly } from "../../../../lib/dateOnly";

const QUARTERS: Array<{ label: string; n: "1" | "2" | "3" | "4" }> = [
  { label: "1st Quarter", n: "1" },
  { label: "2nd Quarter", n: "2" },
  { label: "3rd Quarter", n: "3" },
  { label: "4th Quarter", n: "4" },
];

function quarterNumberFromAny(v: unknown): "" | "1" | "2" | "3" | "4" {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "1" || s === "q1" || s.includes("1st")) return "1";
  if (s === "2" || s === "q2" || s.includes("2nd")) return "2";
  if (s === "3" || s === "q3" || s.includes("3rd")) return "3";
  if (s === "4" || s === "q4" || s.includes("4th")) return "4";
  return "";
}

function quarterLabelFromAny(args: { period_name?: unknown; fiscal_quarter?: unknown }): string {
  const n = quarterNumberFromAny(args.period_name) || quarterNumberFromAny(args.fiscal_quarter);
  return QUARTERS.find((q) => q.n === n)?.label || "";
}

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function closeHref() {
  return `/admin/analytics/quota-periods`;
}

async function createQuotaPeriodAction(formData: FormData) {
  "use server";
  const period_name_raw = String(formData.get("period_name") || "").trim();
  const quarter_n = quarterNumberFromAny(period_name_raw);
  const period_name = quarter_n ? QUARTERS.find((q) => q.n === quarter_n)?.label || period_name_raw : period_name_raw;
  const fiscal_quarter = quarter_n ? String(quarter_n) : String(formData.get("fiscal_quarter") || "").trim();

  const next = new FormData();
  next.set("period_name", period_name);
  next.set("period_start", String(formData.get("period_start") || "").trim());
  next.set("period_end", String(formData.get("period_end") || "").trim());
  next.set("fiscal_year", String(formData.get("fiscal_year") || "").trim());
  next.set("fiscal_quarter", fiscal_quarter);

  await createQuotaPeriod(next);
  revalidatePath("/admin/analytics/quota-periods");
  redirect("/admin/analytics/quota-periods");
}

async function updateQuotaPeriodAction(formData: FormData) {
  "use server";
  const period_name_raw = String(formData.get("period_name") || "").trim();
  const quarter_n = quarterNumberFromAny(period_name_raw);
  const period_name = quarter_n ? QUARTERS.find((q) => q.n === quarter_n)?.label || period_name_raw : period_name_raw;
  const fiscal_quarter = quarter_n ? String(quarter_n) : String(formData.get("fiscal_quarter") || "").trim();

  const next = new FormData();
  next.set("id", String(formData.get("id") || "").trim());
  next.set("period_name", period_name);
  next.set("period_start", String(formData.get("period_start") || "").trim());
  next.set("period_end", String(formData.get("period_end") || "").trim());
  next.set("fiscal_year", String(formData.get("fiscal_year") || "").trim());
  next.set("fiscal_quarter", fiscal_quarter);

  await updateQuotaPeriod(next);
  revalidatePath("/admin/analytics/quota-periods");
  redirect("/admin/analytics/quota-periods");
}

async function deleteQuotaPeriodAction(formData: FormData) {
  "use server";
  await deleteQuotaPeriod(formData);
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
  if (ctx.kind === "user" && !ctx.user.admin_has_full_analytics_access) redirect("/admin");

  const modal = sp(searchParams.modal) || "";
  const id = sp(searchParams.id) || "";

  const periods = await listQuotaPeriods();
  const current = id && (modal === "edit") ? periods.find((p) => String(p.id) === String(id)) || null : null;
  const currentDelete = id && (modal === "delete") ? periods.find((p) => String(p.id) === String(id)) || null : null;

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
              <th className="px-4 py-3">Period Name</th>
              <th className="px-4 py-3">Start Date</th>
              <th className="px-4 py-3">End Date</th>
              <th className="px-4 py-3">Fiscal Year</th>
              <th className="px-4 py-3">Fiscal Quarter</th>
              <th className="px-4 py-3 text-right">Actions</th>
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
                    <div className="inline-flex items-center gap-2">
                      <Link
                        href={`/admin/analytics/quota-periods?modal=edit&id=${encodeURIComponent(String(p.id))}`}
                        className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/admin/analytics/quota-periods?modal=delete&id=${encodeURIComponent(String(p.id))}`}
                        className="rounded-md border border-[#E74C3C] px-2 py-1 text-xs text-[#E74C3C] hover:bg-[color:var(--sf-surface-alt)]"
                      >
                        Delete
                      </Link>
                    </div>
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
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Period Name</label>
              <select
                name="period_name"
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              >
                {QUARTERS.map((q) => (
                  <option key={q.n} value={q.label}>
                    {q.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Start Date</label>
                <input
                  name="period_start"
                  type="date"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">End Date</label>
                <input
                  name="period_end"
                  type="date"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Fiscal Year</label>
                <input
                  name="fiscal_year"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <input type="hidden" name="fiscal_quarter" value="" />
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
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Period Name</label>
              <select
                name="period_name"
                defaultValue={quarterLabelFromAny({ period_name: current.period_name, fiscal_quarter: current.fiscal_quarter }) || current.period_name}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              >
                {QUARTERS.map((q) => (
                  <option key={q.n} value={q.label}>
                    {q.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Start Date</label>
                <input
                  name="period_start"
                  type="date"
                  defaultValue={current.period_start}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">End Date</label>
                <input
                  name="period_end"
                  type="date"
                  defaultValue={current.period_end}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Fiscal Year</label>
                <input
                  name="fiscal_year"
                  defaultValue={current.fiscal_year}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  required
                />
              </div>
              <input type="hidden" name="fiscal_quarter" value={String(quarterNumberFromAny(current.fiscal_quarter) || current.fiscal_quarter || "")} />
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

      {modal === "delete" && currentDelete ? (
        <Modal title="Delete quota period" closeHref={closeHref()}>
          <form action={deleteQuotaPeriodAction} className="grid gap-3">
            <input type="hidden" name="id" value={String(currentDelete.id)} />
            <div className="rounded-md border border-[#E74C3C] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
              <div className="font-semibold text-[#E74C3C]">This action cannot be undone.</div>
              <div className="mt-1 text-[color:var(--sf-text-secondary)]">
                You are deleting: <span className="font-medium">{currentDelete.period_name}</span> ·{" "}
                <span className="font-mono text-xs">{currentDelete.fiscal_year}</span> · Quarter{" "}
                <span className="font-mono text-xs">{currentDelete.fiscal_quarter}</span> ·{" "}
                <span className="font-mono text-xs">{dateOnly(currentDelete.period_start)}</span> →{" "}
                <span className="font-mono text-xs">{dateOnly(currentDelete.period_end)}</span>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Link
                href={closeHref()}
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
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

