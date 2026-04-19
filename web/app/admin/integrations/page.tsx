import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { pool } from "../../../lib/pool";

export const runtime = "nodejs";

type Row = {
  public_id: string;
  name: string;
  connection: string;
  hub_domain: string | null;
  last_synced_at: string | null;
  deals_synced: number | null;
};

export default async function AdminIntegrationsPage() {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  const { rows } = await pool.query<Row>(
    `
    SELECT
      o.public_id::text AS public_id,
      o.name,
      CASE WHEN hc.id IS NOT NULL THEN 'Connected' ELSE 'Not Connected' END AS connection,
      hc.hub_domain,
      hc.last_synced_at::text AS last_synced_at,
      (
        SELECT h.deals_upserted
          FROM hubspot_sync_log h
         WHERE h.org_id = o.id
           AND h.sync_type = 'initial'
           AND h.status = 'completed'
         ORDER BY h.completed_at DESC NULLS LAST, h.id DESC
         LIMIT 1
      ) AS deals_synced
    FROM organizations o
    LEFT JOIN hubspot_connections hc ON hc.org_id = o.id
    ORDER BY o.name ASC
    `
  );

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Integrations</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">HubSpot connections across all organizations.</p>
        </div>
      </div>

      <div className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">Connection</th>
              <th className="px-4 py-3">Hub domain</th>
              <th className="px-4 py-3">Last synced</th>
              <th className="px-4 py-3 text-right">Deals synced</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).length ? (
              (rows || []).map((r) => (
                <tr key={r.public_id} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3">{r.name}</td>
                  <td className="px-4 py-3">{r.connection}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.hub_domain || "—"}</td>
                  <td className="px-4 py-3">{r.last_synced_at ? new Date(r.last_synced_at).toLocaleString() : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.deals_synced ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/integrations/${encodeURIComponent(r.public_id)}/hubspot`}
                      className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                    >
                      HubSpot
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-[color:var(--sf-text-secondary)]" colSpan={6}>
                  No organizations found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
