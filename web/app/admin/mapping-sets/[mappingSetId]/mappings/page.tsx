import Link from "next/link";
import { redirect } from "next/navigation";
import { Modal } from "../../../_components/Modal";
import { createFieldMappingAction, deleteFieldMappingAction, updateFieldMappingAction } from "../../../actions/fieldMappings";
import { getFieldMappingSet, listFieldMappings } from "../../../../../lib/db";
import { requireOrgContext } from "../../../../../lib/auth";
import { resolvePublicTextId } from "../../../../../lib/publicId";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function FieldMappingsPage({
  params,
  searchParams,
}: {
  params: { mappingSetId: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");
  const mappingSetPublicId = params.mappingSetId;
  const mappingSetId = await resolvePublicTextId("field_mapping_sets", mappingSetPublicId).catch(() => "");
  const modal = sp(searchParams.modal) || "";
  const mappingPublicId = sp(searchParams.mappingPublicId) || "";

  const set = mappingSetId ? await getFieldMappingSet({ organizationId: orgId, mappingSetId }) : null;
  if (!set) {
    return (
      <main className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Mapping set not found</h1>
        <p className="mt-2 text-sm text-slate-600">No `field_mapping_sets` row matches this id/org.</p>
        <div className="mt-4">
          <Link href={`/admin/mapping-sets`} className="text-sm text-indigo-700 hover:underline">
            Back to mapping sets
          </Link>
        </div>
      </main>
    );
  }

  const mappings = await listFieldMappings({ mappingSetId });
  const selected = mappingPublicId ? mappings.find((m) => m.public_id === mappingPublicId) || null : null;
  const closeHref = `/admin/mapping-sets/${encodeURIComponent(mappingSetPublicId)}/mappings`;

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs text-slate-600">
            <Link href={`/admin/mapping-sets`} className="hover:underline">
              Mapping Sets
            </Link>{" "}
            / <span className="font-mono">{set.public_id}</span>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">Field Mappings</h1>
          <p className="mt-1 text-sm text-slate-600">
            Mapping set: <span className="font-medium">{set.name}</span>
          </p>
        </div>
        <Link
          href={`${closeHref}?modal=new`}
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white"
        >
          New field mapping
        </Link>
      </div>

      <div className="mt-5 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3">public_id</th>
              <th className="px-4 py-3">source_field</th>
              <th className="px-4 py-3">target_field</th>
              <th className="px-4 py-3 text-right">actions</th>
            </tr>
          </thead>
          <tbody>
            {mappings.length ? (
              mappings.map((m) => (
                <tr key={m.public_id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-mono text-xs">{m.public_id}</td>
                  <td className="px-4 py-3">{m.source_field}</td>
                  <td className="px-4 py-3">{m.target_field}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <Link
                        href={`${closeHref}?modal=edit&mappingPublicId=${encodeURIComponent(m.public_id)}`}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        Edit
                      </Link>
                      <Link
                        href={`${closeHref}?modal=delete&mappingPublicId=${encodeURIComponent(m.public_id)}`}
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
                  No field mappings found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal === "new" ? (
        <Modal title="New field mapping" closeHref={closeHref}>
          <form action={createFieldMappingAction} className="grid gap-3">
            <input type="hidden" name="mapping_set_public_id" value={String(mappingSetPublicId)} />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">source_field</label>
              <input name="source_field" className="rounded-md border border-slate-300 px-3 py-2 text-sm" required />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">target_field</label>
              <input name="target_field" className="rounded-md border border-slate-300 px-3 py-2 text-sm" required />
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Link href={closeHref} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                Cancel
              </Link>
              <button className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white">Create</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "edit" && selected ? (
        <Modal title={`Edit field mapping`} closeHref={closeHref}>
          <form action={updateFieldMappingAction} className="grid gap-3">
            <input type="hidden" name="mapping_set_public_id" value={String(mappingSetPublicId)} />
            <input type="hidden" name="public_id" value={String(selected.public_id)} />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">source_field</label>
              <input
                name="source_field"
                defaultValue={selected.source_field}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">target_field</label>
              <input
                name="target_field"
                defaultValue={selected.target_field}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Link href={closeHref} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                Cancel
              </Link>
              <button className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white">Save</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "delete" && selected ? (
        <Modal title={`Delete field mapping`} closeHref={closeHref}>
          <form action={deleteFieldMappingAction} className="grid gap-4">
            <input type="hidden" name="mapping_set_public_id" value={String(mappingSetPublicId)} />
            <input type="hidden" name="public_id" value={String(selected.public_id)} />
            <p className="text-sm text-slate-700">
              Delete mapping <span className="font-semibold">{selected.source_field}</span> →{" "}
              <span className="font-semibold">{selected.target_field}</span>?
            </p>
            <div className="flex items-center justify-end gap-2">
              <Link href={closeHref} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
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

