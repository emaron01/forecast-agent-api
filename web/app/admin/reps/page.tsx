import Link from "next/link";
import { redirect } from "next/navigation";
import { Modal } from "../_components/Modal";
import { createRepAction, deleteRepAction, updateRepAction } from "../actions/reps";
import { getRep, listReps } from "../../../lib/db";
import { requireOrgContext } from "../../../lib/auth";
import { resolvePublicId } from "../../../lib/publicId";

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
  const repPublicId = sp(searchParams.repPublicId) || "";
  const repId = repPublicId ? await resolvePublicId("reps", repPublicId).catch(() => 0) : 0;

  const reps = await listReps({ organizationId: orgId, activeOnly: false });
  const rep = modal === "edit" || modal === "delete" ? await getRep({ organizationId: orgId, repId }) : null;

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Reps</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Create, edit, activate/deactivate reps.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/reps?modal=new`}
            className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
          >
            New rep
          </Link>
        </div>
      </div>

      <div className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">public_id</th>
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
                <tr key={r.public_id} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3 font-mono text-xs">{r.public_id}</td>
                  <td className="px-4 py-3">{r.rep_name}</td>
                  <td className="px-4 py-3">{r.display_name || ""}</td>
                  <td className="px-4 py-3">{r.role || ""}</td>
                  <td className="px-4 py-3">{r.active ? "true" : "false"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <Link
                        href={`/admin/reps?modal=edit&repPublicId=${encodeURIComponent(String(r.public_id))}`}
                        className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/admin/reps?modal=delete&repPublicId=${encodeURIComponent(String(r.public_id))}`}
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
                <td colSpan={6} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
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
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">rep_name</label>
              <input
                name="rep_name"
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">display_name</label>
              <input
                name="display_name"
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">role</label>
                <input
                  name="role"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">active</label>
                <select
                  name="active"
                  defaultValue="true"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">crm_owner_id</label>
                <input
                  name="crm_owner_id"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">crm_owner_name</label>
                <input
                  name="crm_owner_name"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">user_public_id</label>
                <input
                  name="user_public_id"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                />
                <p className="text-xs text-[color:var(--sf-text-disabled)]">Optional: link this rep to a user (UUID).</p>
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">manager_rep_public_id</label>
                <select
                  name="manager_rep_public_id"
                  defaultValue=""
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                >
                  <option value="">(none)</option>
                  {reps.map((r) => (
                    <option key={r.public_id} value={String(r.public_id)}>
                      {r.rep_name}
                    </option>
                  ))}
                </select>
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

      {modal === "edit" && rep ? (
        <Modal title={`Edit rep`} closeHref={closeHref()}>
          <form action={updateRepAction} className="grid gap-3">
            <input type="hidden" name="public_id" value={String(rep.public_id)} />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">rep_name</label>
              <input
                name="rep_name"
                defaultValue={rep.rep_name}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">display_name</label>
              <input
                name="display_name"
                defaultValue={rep.display_name || ""}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">role</label>
                <input
                  name="role"
                  defaultValue={rep.role || ""}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">active</label>
                <select
                  name="active"
                  defaultValue={rep.active ? "true" : "false"}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">crm_owner_id</label>
                <input
                  name="crm_owner_id"
                  defaultValue={rep.crm_owner_id || ""}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">crm_owner_name</label>
                <input
                  name="crm_owner_name"
                  defaultValue={rep.crm_owner_name || ""}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">user_public_id</label>
                <input
                  name="user_public_id"
                  defaultValue={rep.user_public_id ?? ""}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">manager_rep_public_id</label>
                <select
                  name="manager_rep_public_id"
                  defaultValue={rep.manager_rep_public_id ?? ""}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                >
                  <option value="">(none)</option>
                  {reps
                    .filter((r) => r.public_id !== rep.public_id)
                    .map((r) => (
                      <option key={r.public_id} value={String(r.public_id)}>
                        {r.rep_name}
                      </option>
                    ))}
                </select>
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

      {modal === "delete" && rep ? (
        <Modal title={`Delete rep`} closeHref={closeHref()}>
          <form action={deleteRepAction} className="grid gap-4">
            <input type="hidden" name="public_id" value={String(rep.public_id)} />
            <p className="text-sm text-[color:var(--sf-text-secondary)]">
              This will permanently delete <span className="font-semibold">{rep.rep_name}</span>. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Link
                href={closeHref()}
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Cancel
              </Link>
              <button className="rounded-md bg-[#E74C3C] px-3 py-2 text-sm font-medium text-[color:var(--sf-text-primary)]">
                Delete
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  );
}

