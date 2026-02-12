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
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Organization profile</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            {org.name} · <span className="font-mono text-xs">{org.public_id}</span> · active {org.active ? "true" : "false"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ctx.kind === "master" ? (
            <Link
              href="/admin/organizations"
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
            >
              Organizations
            </Link>
          ) : null}
          <Link
            href="/admin"
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Admin home
          </Link>
        </div>
      </div>

      {saved ? (
        <div className="rounded-md border border-[#2ECC71] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
          Saved.
        </div>
      ) : null}

      <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <form action={updateOrgProfileAction} className="grid gap-4">
          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Billing Plan</label>
            <input
              name="billing_plan"
              defaultValue={org.billing_plan || ""}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              placeholder="Free / Pro / Enterprise"
            />
          </div>

          {ctx.kind === "master" ? (
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">parent_org_id (master only)</label>
              <select
                name="parent_org_public_id"
                defaultValue={org.parent_org_id == null ? "" : String(allOrgs.find((o) => o.id === org.parent_org_id)?.public_id || "")}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
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
              <p className="text-xs text-[color:var(--sf-text-disabled)]">Used to model child orgs for analytics scoping.</p>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Address 1</label>
              <input
                name="hq_address_line1"
                defaultValue={org.hq_address_line1 || ""}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Address 2</label>
              <input
                name="hq_address_line2"
                defaultValue={org.hq_address_line2 || ""}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">City</label>
              <input
                name="hq_city"
                defaultValue={org.hq_city || ""}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">State</label>
              <input
                name="hq_state"
                defaultValue={org.hq_state || ""}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Zip Code</label>
              <input
                name="hq_postal_code"
                defaultValue={org.hq_postal_code || ""}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
            </div>
          </div>

          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Country</label>
            <input
              name="hq_country"
              defaultValue={org.hq_country || ""}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Link
              href="/admin"
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
            >
              Cancel
            </Link>
            <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
              Save
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

