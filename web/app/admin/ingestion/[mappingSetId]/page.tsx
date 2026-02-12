import Link from "next/link";
import { redirect } from "next/navigation";
import { listIngestionStagingByFilter } from "../../../../lib/db";
import { retryFailedAction, triggerProcessAction } from "../../actions/ingestion";
import { requireOrgContext } from "../../../../lib/auth";
import { resolvePublicTextId } from "../../../../lib/publicId";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function jsonPreview(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export default async function IngestionRowsPage({
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
  const filter = (sp(searchParams.filter) || "all") as "all" | "pending" | "processed" | "error";
  const returnTo = `/admin/ingestion/${encodeURIComponent(mappingSetPublicId)}?filter=${encodeURIComponent(filter)}`;

  const rows = mappingSetId
    ? await listIngestionStagingByFilter({ organizationId: orgId, mappingSetId, filter, limit: 200 }).catch(() => [])
    : [];

  return (
    <main>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs text-[color:var(--sf-text-secondary)]">
            <Link href={`/admin/ingestion`} className="hover:underline">
              Ingestion
            </Link>{" "}
            / <span className="font-mono">{mappingSetPublicId}</span>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Staging rows</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Filter is inferred from `normalized_row` and `error_message` (no status assumptions).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] text-sm">
            {(["all", "pending", "processed", "error"] as const).map((f) => (
              <Link
                key={f}
                href={`/admin/ingestion/${encodeURIComponent(mappingSetPublicId)}?filter=${encodeURIComponent(f)}`}
                className={`px-3 py-2 text-xs ${
                  f === filter
                    ? "bg-[color:var(--sf-accent-primary)] text-[color:var(--sf-button-primary-text)]"
                    : "text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface-alt)]"
                }`}
              >
                {f}
              </Link>
            ))}
          </div>

          <form action={triggerProcessAction}>
            <input type="hidden" name="mapping_set_public_id" value={String(mappingSetPublicId)} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-xs font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
              Process
            </button>
          </form>

          <form action={retryFailedAction}>
            <input type="hidden" name="mapping_set_public_id" value={String(mappingSetPublicId)} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button className="rounded-md bg-[#F1C40F] px-3 py-2 text-xs font-medium text-[color:var(--sf-background)]">
              Retry failed
            </button>
          </form>
        </div>
      </div>

      <div className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">public_id</th>
              <th className="px-4 py-3">status</th>
              <th className="px-4 py-3">error_message</th>
              <th className="px-4 py-3">raw_row</th>
              <th className="px-4 py-3">normalized_row</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((r) => (
                <tr key={r.public_id} className="border-t border-[color:var(--sf-border)] align-top">
                  <td className="px-4 py-3 font-mono">{r.public_id}</td>
                  <td className="px-4 py-3">{r.status || ""}</td>
                  <td className="px-4 py-3 text-[#E74C3C]">{r.error_message || ""}</td>
                  <td className="px-4 py-3">
                    <details>
                      <summary className="cursor-pointer text-[color:var(--sf-accent-primary)]">view</summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-[color:var(--sf-surface-alt)] p-2 text-[11px] text-[color:var(--sf-text-primary)]">
                        {jsonPreview(r.raw_row)}
                      </pre>
                    </details>
                  </td>
                  <td className="px-4 py-3">
                    <details>
                      <summary className="cursor-pointer text-[color:var(--sf-accent-primary)]">view</summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-[color:var(--sf-surface-alt)] p-2 text-[11px] text-[color:var(--sf-text-primary)]">
                        {jsonPreview(r.normalized_row)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                  No rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

