import Link from "next/link";
import { listFieldMappingSets, listIngestionBatchSummaries, listOrganizations, type IngestionBatchSummaryRow } from "../../../lib/db";
import { retryFailedAction, stageJsonRowsAction, triggerProcessAction } from "../actions/ingestion";
import { requireOrgContext } from "../../../lib/auth";
import { redirect } from "next/navigation";
import { setMasterOrgAction } from "../../actions/auth";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function IngestionAdminPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind !== "master") redirect("/admin");
  const orgs = await listOrganizations({ activeOnly: true }).catch(() => []);
  const activeOrgPublicId = orgs.find((o) => o.id === orgId)?.public_id || "";
  const sets = await listFieldMappingSets({ organizationId: orgId });
  const summaries = await listIngestionBatchSummaries({ organizationId: orgId }).catch(
    (): IngestionBatchSummaryRow[] => []
  );
  const bySet = new Map<string, IngestionBatchSummaryRow>(
    summaries.map((s): [string, IngestionBatchSummaryRow] => [s.mapping_set_public_id, s])
  );
  const returnTo = `/admin/ingestion`;

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Ingestion</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            View pending/processed/error rows, retry failures, and trigger `process_ingestion_batch`.
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-end gap-2">
          <form action={setMasterOrgAction} className="flex items-end gap-2">
            <input type="hidden" name="returnTo" value="/admin/ingestion" />
            <div className="grid gap-1">
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Customer</label>
              <select
                name="org_public_id"
                defaultValue={activeOrgPublicId}
                className="w-[260px] rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                {orgs.map((o) => (
                  <option key={o.public_id} value={String(o.public_id)}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="h-[40px] rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
              Set
            </button>
          </form>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Trigger processing</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Runs the database function for a mapping set.</p>

          <div className="mt-4 grid gap-3">
            {sets.length ? (
              sets.map((s) => (
                <div
                  key={s.public_id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--sf-border)] p-3"
                >
                  <div>
                    <div className="text-sm font-medium text-[color:var(--sf-text-primary)]">{s.name}</div>
                    <div className="text-xs font-mono text-[color:var(--sf-text-secondary)]">{s.public_id}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/admin/ingestion/${encodeURIComponent(s.public_id)}?filter=pending`}
                      className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                    >
                      View rows
                    </Link>
                    <form action={triggerProcessAction}>
                      <input type="hidden" name="mapping_set_public_id" value={String(s.public_id)} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-xs font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                        Process
                      </button>
                    </form>
                    <form action={retryFailedAction}>
                      <input type="hidden" name="mapping_set_public_id" value={String(s.public_id)} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button className="rounded-md bg-[#F1C40F] px-3 py-2 text-xs font-medium text-[color:var(--sf-background)]">
                        Retry failed
                      </button>
                    </form>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-[color:var(--sf-text-secondary)]">No mapping sets found for this org.</div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Stage raw rows (JSON)</h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Inserts into `ingestion_staging` (raw_row). Then use “Process” above.
          </p>

          <form action={stageJsonRowsAction} className="mt-4 grid gap-3">
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">mapping_set_public_id</label>
              <select
                name="mapping_set_public_id"
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              >
                <option value="">Select…</option>
                {sets.map((s) => (
                  <option key={s.public_id} value={s.public_id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">rawJson (array)</label>
              <textarea
                name="rawJson"
                placeholder='[{"crm_opp_id":"123","account_name":"Acme","amount":1000}]'
                className="min-h-40 w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 font-mono text-xs text-[color:var(--sf-text-primary)]"
                required
              />
            </div>
            <div className="flex items-center justify-end">
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Stage rows
              </button>
            </div>
          </form>
        </section>
      </div>

      <section className="mt-6 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
        <div className="border-b border-[color:var(--sf-border)] px-5 py-4">
          <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Batch summaries (by mapping set)</h2>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">mapping_set_public_id</th>
              <th className="px-4 py-3">total</th>
              <th className="px-4 py-3">pending</th>
              <th className="px-4 py-3">processed</th>
              <th className="px-4 py-3">error</th>
              <th className="px-4 py-3">last_public_id</th>
              <th className="px-4 py-3 text-right">view</th>
            </tr>
          </thead>
          <tbody>
            {sets.length ? (
              sets.map((s) => {
                const sum = bySet.get(s.public_id);
                return (
                  <tr key={s.public_id} className="border-t border-[color:var(--sf-border)]">
                    <td className="px-4 py-3 font-mono text-xs">{s.public_id}</td>
                    <td className="px-4 py-3">{sum?.total ?? 0}</td>
                    <td className="px-4 py-3">{sum?.pending ?? 0}</td>
                    <td className="px-4 py-3">{sum?.processed ?? 0}</td>
                    <td className="px-4 py-3">{sum?.error ?? 0}</td>
                    <td className="px-4 py-3 font-mono text-xs">{sum?.last_public_id ?? ""}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/ingestion/${encodeURIComponent(s.public_id)}?filter=all`}
                        className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                      >
                        Rows
                      </Link>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                  No mapping sets found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

