import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrgContext } from "../../../lib/auth";
import { getOrganization, listOrganizations } from "../../../lib/db";
import { updateOrgProfileAction } from "../actions/orgProfile";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function OrgProfilePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const saved = sp(searchParams.saved) || "";
  const org = await getOrganization({ id: orgId }).catch(() => null);
  if (!org) redirect("/admin");

  const allOrgs = ctx.kind === "master" ? await listOrganizations({ activeOnly: false }).catch(() => []) : [];

  return (
    <main className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Organization profile</h1>
          <p className="mt-1 text-sm text-slate-600">
            {org.name} · <span className="font-mono text-xs">{org.public_id}</span> · active {org.active ? "true" : "false"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ctx.kind === "master" ? (
            <Link href="/admin/organizations" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
              Organizations
            </Link>
          ) : null}
          <Link href="/admin" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
            Admin home
          </Link>
        </div>
      </div>

      {saved ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Saved.</div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <form action={updateOrgProfileAction} className="grid gap-4">
          <div className="grid gap-1">
            <label className="text-sm font-medium text-slate-700">billing_plan</label>
            <input
              name="billing_plan"
              defaultValue={org.billing_plan || ""}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="pro / enterprise / etc"
            />
          </div>

          {ctx.kind === "master" ? (
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">parent_org_id (master only)</label>
              <select
                name="parent_org_public_id"
                defaultValue={org.parent_org_id == null ? "" : String(allOrgs.find((o) => o.id === org.parent_org_id)?.public_id || "")}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">(none)</option>
                {allOrgs
                  .filter((o) => o.id !== org.id)
                  .map((o) => (
                    <option key={o.public_id} value={String(o.public_id)}>
                      {o.name}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-slate-500">Used to model child orgs for analytics scoping.</p>
            </div>
          ) : null}

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

          <div className="flex items-center justify-end gap-2 pt-2">
            <Link href="/admin" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
              Cancel
            </Link>
            <button className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white">Save</button>
          </div>
        </form>
      </div>
    </main>
  );
}

