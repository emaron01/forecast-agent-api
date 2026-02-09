import Link from "next/link";
import { redirect } from "next/navigation";
import { Modal } from "../_components/Modal";
import { createRepAction, deleteRepAction, updateRepAction } from "../actions/reps";
import { getRep, listReps } from "../../../lib/db";
import { requireOrgContext } from "../../../lib/auth";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function closeHref() {
  return `/admin/reps`;
}

export default async function RepsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");
  const modal = sp(searchParams.modal) || "";
  const repId = Number(sp(searchParams.repId) || "0") || 0;

  const reps = await listReps({ organizationId: orgId, activeOnly: false });
  const rep = modal === "edit" || modal === "delete" ? await getRep({ organizationId: orgId, repId }) : null;

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Reps</h1>
          <p className="mt-1 text-sm text-slate-600">Create, edit, activate/deactivate reps.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/reps?modal=new`}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white"
          >
            New rep
          </Link>
        </div>
      </div>

      <div className="mt-5 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3">id</th>
              <th className="px-4 py-3">rep_name</th>
              <th className="px-4 py-3">display_name</th>
              <th className="px-4 py-3">role</th>
              <th className="px-4 py-3">active</th>
              <th className="px-4 py-3 text-right">actions</th>
            </tr>
          </thead>
          <tbody>
            {reps.length ? (
              reps.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-mono text-xs">{r.id}</td>
                  <td className="px-4 py-3">{r.rep_name}</td>
                  <td className="px-4 py-3">{r.display_name || ""}</td>
                  <td className="px-4 py-3">{r.role || ""}</td>
                  <td className="px-4 py-3">{r.active ? "true" : "false"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <Link
                        href={`/admin/reps?modal=edit&repId=${encodeURIComponent(String(r.id))}`}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/admin/reps?modal=delete&repId=${encodeURIComponent(String(r.id))}`}
                        className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                      >
                        Delete
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  No reps found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal === "new" ? (
        <Modal title="New rep" closeHref={closeHref()}>
          <form action={createRepAction} className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">rep_name</label>
              <input name="rep_name" className="rounded-md border border-slate-300 px-3 py-2 text-sm" required />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">display_name</label>
              <input name="display_name" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">role</label>
                <input name="role" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">active</label>
                <select name="active" defaultValue="true" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">crm_owner_id</label>
                <input name="crm_owner_id" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">crm_owner_name</label>
                <input name="crm_owner_name" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">user_id</label>
                <input name="user_id" inputMode="numeric" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">manager_rep_id</label>
                <select name="manager_rep_id" defaultValue="" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="">(none)</option>
                  {reps.map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.rep_name} (id {r.id})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Link href={closeHref()} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                Cancel
              </Link>
              <button className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white">Create</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "edit" && rep ? (
        <Modal title={`Edit rep #${rep.id}`} closeHref={closeHref()}>
          <form action={updateRepAction} className="grid gap-3">
            <input type="hidden" name="repId" value={String(rep.id)} />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">rep_name</label>
              <input
                name="rep_name"
                defaultValue={rep.rep_name}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">display_name</label>
              <input
                name="display_name"
                defaultValue={rep.display_name || ""}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">role</label>
                <input name="role" defaultValue={rep.role || ""} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">active</label>
                <select
                  name="active"
                  defaultValue={rep.active ? "true" : "false"}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">crm_owner_id</label>
                <input
                  name="crm_owner_id"
                  defaultValue={rep.crm_owner_id || ""}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">crm_owner_name</label>
                <input
                  name="crm_owner_name"
                  defaultValue={rep.crm_owner_name || ""}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">user_id</label>
                <input
                  name="user_id"
                  inputMode="numeric"
                  defaultValue={rep.user_id ?? ""}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">manager_rep_id</label>
                <select
                  name="manager_rep_id"
                  defaultValue={rep.manager_rep_id ?? ""}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">(none)</option>
                  {reps
                    .filter((r) => r.id !== rep.id)
                    .map((r) => (
                      <option key={r.id} value={String(r.id)}>
                        {r.rep_name} (id {r.id})
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Link href={closeHref()} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                Cancel
              </Link>
              <button className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white">Save</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "delete" && rep ? (
        <Modal title={`Delete rep #${rep.id}`} closeHref={closeHref()}>
          <form action={deleteRepAction} className="grid gap-4">
            <input type="hidden" name="repId" value={String(rep.id)} />
            <p className="text-sm text-slate-700">
              This will permanently delete <span className="font-semibold">{rep.rep_name}</span>. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Link href={closeHref()} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                Cancel
              </Link>
              <button className="rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white">Delete</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  );
}

