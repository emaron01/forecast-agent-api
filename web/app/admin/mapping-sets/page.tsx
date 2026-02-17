import Link from "next/link";
import { redirect } from "next/navigation";
import { Modal } from "../_components/Modal";
import { createMappingSetAction, deleteMappingSetAction, updateMappingSetAction } from "../actions/mappingSets";
import { getFieldMappingSet, listFieldMappingSets } from "../../../lib/db";
import { requireOrgContext } from "../../../lib/auth";
import { resolvePublicTextId } from "../../../lib/publicId";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function closeHref() {
  return `/admin/mapping-sets`;
}

export default async function MappingSetsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { ctx, orgId } = await requireOrgContext();
  // Mapping Sets control what fields can be imported (free-text target_field in mappings).
  // Customers should manage saved formats from the Import/Excel Upload page, not edit ingestible fields.
  if (ctx.kind !== "master") redirect("/admin");
  const modal = sp(searchParams.modal) || "";
  const mappingSetPublicId = sp(searchParams.mappingSetPublicId) || "";

  const sets = await listFieldMappingSets({ organizationId: orgId });
  const mappingSetId = mappingSetPublicId ? await resolvePublicTextId("field_mapping_sets", mappingSetPublicId).catch(() => "") : "";
  const set =
    mappingSetId && (modal === "edit" || modal === "delete")
      ? await getFieldMappingSet({ organizationId: orgId, mappingSetId })
      : null;

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Mapping Sets</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Manage field mapping sets and their mappings.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/mapping-sets?modal=new`}
            className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
          >
            New mapping set
          </Link>
        </div>
      </div>

      <div className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">public_id</th>
              <th className="px-4 py-3">name</th>
              <th className="px-4 py-3">source_system</th>
              <th className="px-4 py-3 text-right">actions</th>
            </tr>
          </thead>
          <tbody>
            {sets.length ? (
              sets.map((s) => (
                <tr key={s.public_id} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3 font-mono text-xs">{s.public_id}</td>
                  <td className="px-4 py-3">{s.name}</td>
                  <td className="px-4 py-3">{s.source_system || ""}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <Link
                        href={`/admin/mapping-sets/${encodeURIComponent(s.public_id)}/mappings`}
                        className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                      >
                        Mappings
                      </Link>
                      <Link
                        href={`/admin/mapping-sets?modal=edit&mappingSetPublicId=${encodeURIComponent(s.public_id)}`}
                        className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/admin/mapping-sets?modal=delete&mappingSetPublicId=${encodeURIComponent(s.public_id)}`}
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
                  No mapping sets found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal === "new" ? (
        <Modal title="New mapping set" closeHref={closeHref()}>
          <form action={createMappingSetAction} className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">name</label>
              <input
                name="name"
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">source_system</label>
              <input
                name="source_system"
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
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

      {modal === "edit" && set ? (
        <Modal title={`Edit mapping set`} closeHref={closeHref()}>
          <form action={updateMappingSetAction} className="grid gap-3">
            <input type="hidden" name="public_id" value={String(set.public_id)} />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">name</label>
              <input
                name="name"
                defaultValue={set.name}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">source_system</label>
              <input
                name="source_system"
                defaultValue={set.source_system || ""}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
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

      {modal === "delete" && set ? (
        <Modal title={`Delete mapping set`} closeHref={closeHref()}>
          <form action={deleteMappingSetAction} className="grid gap-4">
            <input type="hidden" name="public_id" value={String(set.public_id)} />
            <p className="text-sm text-[color:var(--sf-text-secondary)]">
              This will permanently delete <span className="font-semibold">{set.name}</span>.
            </p>
            <p className="text-xs text-[color:var(--sf-text-secondary)]">
              Note: if there are `field_mappings` referencing this set, the delete may fail due to database constraints.
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

