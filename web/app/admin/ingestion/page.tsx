import Link from "next/link";
import { listFieldMappingSets, listIngestionBatchSummaries, type IngestionBatchSummaryRow } from "../../../lib/db";
import { retryFailedAction, stageJsonRowsAction, triggerProcessAction } from "../actions/ingestion";
import { requireOrgContext } from "../../../lib/auth";
import { redirect } from "next/navigation";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function IngestionAdminPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");
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
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Ingestion</h1>
          <p className="mt-1 text-sm text-slate-600">
            View pending/processed/error rows, retry failures, and trigger `process_ingestion_batch`.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Trigger processing</h2>
          <p className="mt-1 text-sm text-slate-600">Runs the database function for a mapping set.</p>

          <div className="mt-4 grid gap-3">
            {sets.length ? (
              sets.map((s) => (
                <div key={s.public_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{s.name}</div>
                    <div className="text-xs font-mono text-slate-600">{s.public_id}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/admin/ingestion/${encodeURIComponent(s.public_id)}?filter=pending`}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                    >
                      View rows
                    </Link>
                    <form action={triggerProcessAction}>
                      <input type="hidden" name="mapping_set_public_id" value={String(s.public_id)} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white">Process</button>
                    </form>
                    <form action={retryFailedAction}>
                      <input type="hidden" name="mapping_set_public_id" value={String(s.public_id)} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button className="rounded-md bg-amber-600 px-3 py-2 text-xs font-medium text-white">Retry failed</button>
                    </form>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-600">No mapping sets found for this org.</div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Stage raw rows (JSON)</h2>
          <p className="mt-1 text-sm text-slate-600">
            Inserts into `ingestion_staging` (raw_row). Then use “Process” above.
          </p>

          <form action={stageJsonRowsAction} className="mt-4 grid gap-3">
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">mapping_set_public_id</label>
              <select name="mapping_set_public_id" className="rounded-md border border-slate-300 px-3 py-2 text-sm" required>
                <option value="">Select…</option>
                {sets.map((s) => (
                  <option key={s.public_id} value={s.public_id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">rawJson (array)</label>
              <textarea
                name="rawJson"
                placeholder='[{"crm_opp_id":"123","account_name":"Acme","amount":1000}]'
                className="min-h-40 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
                required
              />
            </div>
            <div className="flex items-center justify-end">
              <button className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white">Stage rows</button>
            </div>
          </form>
        </section>
      </div>

      <section className="mt-6 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Batch summaries (by mapping set)</h2>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
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
                  <tr key={s.public_id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-mono text-xs">{s.public_id}</td>
                    <td className="px-4 py-3">{sum?.total ?? 0}</td>
                    <td className="px-4 py-3">{sum?.pending ?? 0}</td>
                    <td className="px-4 py-3">{sum?.processed ?? 0}</td>
                    <td className="px-4 py-3">{sum?.error ?? 0}</td>
                    <td className="px-4 py-3 font-mono text-xs">{sum?.last_public_id ?? ""}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/ingestion/${encodeURIComponent(s.public_id)}?filter=all`}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        Rows
                      </Link>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
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

