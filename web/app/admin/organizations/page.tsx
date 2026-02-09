import Link from "next/link";
import { redirect } from "next/navigation";
import { Modal } from "../_components/Modal";
import { setMasterOrgAction } from "../../actions/auth";
import { requireAuth } from "../../../lib/auth";
import { getOrganization, listOrganizations } from "../../../lib/db";
import { createOrganizationAction, deleteOrganizationAction, updateOrganizationAction } from "../actions/organizations";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  const modal = sp(searchParams.modal) || "";
  const orgId = Number(sp(searchParams.id) || "0") || 0;

  const orgs = await listOrganizations({ activeOnly: false }).catch(() => []);
  const org = (modal === "edit" || modal === "delete") && orgId ? await getOrganization({ id: orgId }).catch(() => null) : null;

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Organizations</h1>
          <p className="mt-1 text-sm text-slate-600">Create and manage organizations.</p>
        </div>
        <div className="flex items-center gap-2">
          <form action={setMasterOrgAction} className="flex items-end gap-2">
            <input type="hidden" name="returnTo" value="/admin" />
            <div>
              <label className="text-xs font-medium text-slate-600">Active org</label>
              <select
                name="orgId"
                defaultValue={ctx.orgId == null ? "" : String(ctx.orgId)}
                className="mt-1 w-56 rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">(none)</option>
                {orgs
                  .filter((o) => o.active)
                  .map((o) => (
                    <option key={o.id} value={String(o.id)}>
                      {o.name} (id {o.id})
                    </option>
                  ))}
              </select>
            </div>
            <button className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Set</button>
          </form>
          <Link href="/admin/organizations?modal=new" className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white">
            New org
          </Link>
        </div>
      </div>

      <div className="mt-5 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3">id</th>
              <th className="px-4 py-3">name</th>
              <th className="px-4 py-3">active</th>
              <th className="px-4 py-3 text-right">actions</th>
            </tr>
          </thead>
          <tbody>
            {orgs.length ? (
              orgs.map((o) => (
                <tr key={o.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-mono text-xs">{o.id}</td>
                  <td className="px-4 py-3">{o.name}</td>
                  <td className="px-4 py-3">{o.active ? "true" : "false"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <Link
                        href={`/admin/organizations?modal=edit&id=${encodeURIComponent(String(o.id))}`}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/admin/organizations?modal=delete&id=${encodeURIComponent(String(o.id))}`}
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
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  No organizations found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal === "new" ? (
        <Modal title="New organization" closeHref="/admin/organizations">
          <form action={createOrganizationAction} className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">name</label>
              <input name="name" className="rounded-md border border-slate-300 px-3 py-2 text-sm" required />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">active</label>
              <select name="active" defaultValue="true" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">parent_org_id (optional)</label>
              <select name="parent_org_id" defaultValue="" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">(none)</option>
                {orgs.map((o) => (
                  <option key={o.id} value={String(o.id)}>
                    {o.name} (id {o.id})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">billing_plan</label>
              <input name="billing_plan" className="rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="free / pro / enterprise" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">hq_address_line1</label>
                <input name="hq_address_line1" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">hq_address_line2</label>
                <input name="hq_address_line2" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">hq_city</label>
                <input name="hq_city" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">hq_state</label>
                <input name="hq_state" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">hq_postal_code</label>
                <input name="hq_postal_code" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">hq_country</label>
              <input name="hq_country" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Link href="/admin/organizations" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                Cancel
              </Link>
              <button className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white">Create</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "edit" && org ? (
        <Modal title={`Edit organization #${org.id}`} closeHref="/admin/organizations">
          <form action={updateOrganizationAction} className="grid gap-3">
            <input type="hidden" name="id" value={String(org.id)} />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">name</label>
              <input name="name" defaultValue={org.name} className="rounded-md border border-slate-300 px-3 py-2 text-sm" required />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">active</label>
              <select
                name="active"
                defaultValue={org.active ? "true" : "false"}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">parent_org_id (optional)</label>
              <select
                name="parent_org_id"
                defaultValue={org.parent_org_id == null ? "" : String(org.parent_org_id)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">(none)</option>
                {orgs
                  .filter((o) => o.id !== org.id)
                  .map((o) => (
                    <option key={o.id} value={String(o.id)}>
                      {o.name} (id {o.id})
                    </option>
                  ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">billing_plan</label>
              <input
                name="billing_plan"
                defaultValue={org.billing_plan || ""}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="free / pro / enterprise"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">hq_address_line1</label>
                <input name="hq_address_line1" defaultValue={org.hq_address_line1 || ""} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">hq_address_line2</label>
                <input name="hq_address_line2" defaultValue={org.hq_address_line2 || ""} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">hq_city</label>
                <input name="hq_city" defaultValue={org.hq_city || ""} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">hq_state</label>
                <input name="hq_state" defaultValue={org.hq_state || ""} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">hq_postal_code</label>
                <input name="hq_postal_code" defaultValue={org.hq_postal_code || ""} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">hq_country</label>
              <input name="hq_country" defaultValue={org.hq_country || ""} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Link href="/admin/organizations" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                Cancel
              </Link>
              <button className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white">Save</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "delete" && org ? (
        <Modal title={`Delete organization #${org.id}`} closeHref="/admin/organizations">
          <form action={deleteOrganizationAction} className="grid gap-4">
            <input type="hidden" name="id" value={String(org.id)} />
            <p className="text-sm text-slate-700">
              This will permanently delete <span className="font-semibold">{org.name}</span> (and all users in the org). This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Link href="/admin/organizations" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
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

