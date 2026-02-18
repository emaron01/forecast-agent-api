import Link from "next/link";
import { redirect } from "next/navigation";
import { Modal } from "../_components/Modal";
import { setMasterOrgAction } from "../../actions/auth";
import { requireAuth } from "../../../lib/auth";
import { getOrganization, listOrganizations } from "../../../lib/db";
import { resolvePublicId } from "../../../lib/publicId";
import { createOrganizationWithFirstAdminAction, deleteOrganizationAction, updateOrganizationAction } from "../actions/organizations";

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
  const orgPublicId = sp(searchParams.id) || "";
  const createdOrgPublicId = sp(searchParams.createdOrgPublicId) || "";
  const createdAdminEmail = sp(searchParams.createdAdminEmail) || "";
  const reset = sp(searchParams.reset) || "";

  const orgs = await listOrganizations({ activeOnly: false }).catch(() => []);
  const orgId = orgPublicId ? await resolvePublicId("organizations", orgPublicId).catch(() => 0) : 0;
  const org = (modal === "edit" || modal === "delete") && orgId ? await getOrganization({ id: orgId }).catch(() => null) : null;

  const activeOrgPublicId = ctx.orgId ? orgs.find((o) => o.id === ctx.orgId)?.public_id || "" : "";

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Organizations</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Create and manage organizations.</p>
        </div>
        <div className="flex items-center gap-2">
          <form action={setMasterOrgAction} className="flex items-end gap-2">
            <input type="hidden" name="returnTo" value="/admin" />
            <div>
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Active org</label>
              <select
                name="org_public_id"
                defaultValue={activeOrgPublicId || ""}
                className="mt-1 w-56 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                <option value="">(none)</option>
                {orgs
                  .filter((o) => o.active)
                  .map((o) => (
                    <option key={o.public_id} value={String(o.public_id)}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </div>
            <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
              Set
            </button>
          </form>
          <Link
            href="/admin/organizations?modal=new"
            className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
          >
            New org
          </Link>
        </div>
      </div>

      {createdOrgPublicId ? (
        <div className="mt-4 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
          <div>
            Created organization <span className="font-mono text-xs">{createdOrgPublicId}</span>
            {createdAdminEmail ? (
              <>
                {" "}
                with first admin <span className="font-mono text-xs">{createdAdminEmail}</span>.
              </>
            ) : (
              "."
            )}
          </div>
          {reset ? (
            <div className="mt-1 text-[color:var(--sf-text-secondary)]">
              {reset === "sent" ? (
                <>Invite link generated.</>
              ) : (
                <>
                  Invite link (dev):{" "}
                  <Link className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline" href={reset}>
                    {reset}
                  </Link>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">public_id</th>
              <th className="px-4 py-3">name</th>
              <th className="px-4 py-3">active</th>
              <th className="px-4 py-3 text-right">actions</th>
            </tr>
          </thead>
          <tbody>
            {orgs.length ? (
              orgs.map((o) => (
                <tr key={o.public_id} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3 font-mono text-xs">{o.public_id}</td>
                  <td className="px-4 py-3">{o.name}</td>
                  <td className="px-4 py-3">{o.active ? "true" : "false"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <form action={setMasterOrgAction}>
                        <input type="hidden" name="org_public_id" value={String(o.public_id)} />
                        <input type="hidden" name="returnTo" value="/admin/users?modal=new" />
                        <button className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]">
                          Users
                        </button>
                      </form>
                      <Link
                        href={`/admin/organizations?modal=edit&id=${encodeURIComponent(String(o.public_id))}`}
                        className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/admin/organizations/health-score-rules?org=${encodeURIComponent(String(o.public_id))}`}
                        className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                      >
                        Health rules
                      </Link>
                      <Link
                        href={`/admin/organizations?modal=delete&id=${encodeURIComponent(String(o.public_id))}`}
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
                <td colSpan={4} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                  No organizations found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal === "new" ? (
        <Modal title="New organization" closeHref="/admin/organizations">
          <form action={createOrganizationWithFirstAdminAction} className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Organization Name</label>
              <input
                name="name"
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Active</label>
              <select
                name="active"
                defaultValue="true"
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Parent Organization (optional)</label>
              <select
                name="parent_org_public_id"
                defaultValue=""
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                <option value="">(none)</option>
                {orgs.map((o) => (
                  <option key={o.public_id} value={String(o.public_id)}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Billing Plan</label>
              <input
                name="billing_plan"
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                placeholder="Free / Pro / Enterprise"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Address 1</label>
                <input name="hq_address_line1" className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]" />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Address 2</label>
                <input name="hq_address_line2" className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]" />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">City</label>
                <input name="hq_city" className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]" />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">State</label>
                <input name="hq_state" className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]" />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Zip Code</label>
                <input name="hq_postal_code" className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]" />
              </div>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Country</label>
              <input name="hq_country" className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]" />
            </div>

            <div className="mt-2 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Organization Administrator Set-Up</div>
              <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                This user will be created in the new organization with the Administrator role.
              </div>

              <div className="mt-3 grid gap-3">
                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Hierarchy level</label>
                  {/* First admin is always role ADMIN (hierarchy level 0). */}
                  <select
                    defaultValue="0"
                    disabled
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-secondary)] opacity-70"
                    aria-label="Hierarchy level (Admin)"
                  >
                    <option value="0">0 (Admin)</option>
                    <option value="1">1 (Executive Manager)</option>
                    <option value="2">2 (Manager)</option>
                    <option value="3">3 (Rep)</option>
                  </select>
                  <input type="hidden" name="admin_hierarchy_level" value="0" />
                </div>

                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Email</label>
                  <input
                    name="admin_email"
                    type="email"
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                    placeholder="admin@company.com"
                    required
                  />
                </div>

                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Password</label>
                  <input
                    name="admin_password"
                    type="password"
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                    placeholder="Leave blank to invite"
                  />
                  <p className="text-xs text-[color:var(--sf-text-disabled)]">
                    If blank, we’ll generate a password-set link (shown in dev; “sent” in prod).
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1">
                    <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">First Name</label>
                    <input
                      name="admin_first_name"
                      className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                      required
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Last Name</label>
                    <input
                      name="admin_last_name"
                      className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                      required
                    />
                  </div>
                </div>

                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Name As It Appears In CRM</label>
                  <input
                    name="admin_account_owner_name"
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  />
                  <p className="text-xs font-medium text-[#E74C3C]">
                    This name is used to exactly match the Account Owner for each Opportunity in CRM used for Forecast Reviews. Please COPY
                    and PASTE the name as it appears in CRM. (Required for Reps only)
                  </p>
                </div>

                <div className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Analytics Access</label>
                  <select
                    name="admin_has_full_analytics_access"
                    defaultValue="false"
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  >
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-end gap-2">
              <Link
                href="/admin/organizations"
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

      {modal === "edit" && org ? (
        <Modal title={`Edit organization`} closeHref="/admin/organizations">
          <form action={updateOrganizationAction} className="grid gap-3">
            <input type="hidden" name="public_id" value={String(org.public_id)} />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">name</label>
              <input
                name="name"
                defaultValue={org.name}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">active</label>
              <select
                name="active"
                defaultValue={org.active ? "true" : "false"}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">parent_org_id (optional)</label>
              <select
                name="parent_org_public_id"
                defaultValue={org.parent_org_id == null ? "" : String(orgs.find((o) => o.id === org.parent_org_id)?.public_id || "")}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                <option value="">(none)</option>
                {orgs
                  .filter((o) => o.id !== org.id)
                  .map((o) => (
                    <option key={o.public_id} value={String(o.public_id)}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">billing_plan</label>
              <input
                name="billing_plan"
                defaultValue={org.billing_plan || ""}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                placeholder="free / pro / enterprise"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">hq_address_line1</label>
                <input
                  name="hq_address_line1"
                  defaultValue={org.hq_address_line1 || ""}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">hq_address_line2</label>
                <input
                  name="hq_address_line2"
                  defaultValue={org.hq_address_line2 || ""}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">hq_city</label>
                <input
                  name="hq_city"
                  defaultValue={org.hq_city || ""}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">hq_state</label>
                <input
                  name="hq_state"
                  defaultValue={org.hq_state || ""}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">hq_postal_code</label>
                <input
                  name="hq_postal_code"
                  defaultValue={org.hq_postal_code || ""}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                />
              </div>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">hq_country</label>
              <input
                name="hq_country"
                defaultValue={org.hq_country || ""}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Link
                href="/admin/organizations"
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

      {modal === "delete" && org ? (
        <Modal title={`Delete organization`} closeHref="/admin/organizations">
          <form action={deleteOrganizationAction} className="grid gap-4">
            <input type="hidden" name="public_id" value={String(org.public_id)} />
            <p className="text-sm text-[color:var(--sf-text-secondary)]">
              This will permanently delete <span className="font-semibold">{org.name}</span> (and all users in the org). This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Link
                href="/admin/organizations"
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Cancel
              </Link>
              <button className="rounded-md bg-[#E74C3C] px-3 py-2 text-sm font-medium text-[color:var(--sf-text-primary)]">Delete</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  );
}

