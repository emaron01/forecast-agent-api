import { redirect } from "next/navigation";
import Link from "next/link";
import { requireManagerAdminOrMaster } from "../../../lib/auth";
import { pool } from "../../../lib/pool";

type Row = {
  org_id: number;
  organization_name: string | null;
  total_opportunities: string;
  reviewed_opportunities: string;
  comment_ingestions_count: string;
  audit_events_count: string;
  last_comment_ingestion_at: string | null;
  last_audit_event_at: string | null;
};

function deriveStatus(row: Row): string {
  const total = Number(row.total_opportunities) || 0;
  const reviewed = Number(row.reviewed_opportunities) || 0;
  const comments = Number(row.comment_ingestions_count) || 0;
  const audits = Number(row.audit_events_count) || 0;
  const pct = total > 0 ? (reviewed / total) * 100 : 0;

  if (total === 0) return "No Data";
  if (comments > 0 && audits === 0) return "Ingesting (No Scoring)";
  if (audits > 0 && reviewed === 0) return "Audit Only";
  if (reviewed > 0 && pct < 100) return "Partial";
  if (pct >= 100) return "Complete";
  return "No Data";
}

function statusColor(status: string): string {
  if (status === "Ingesting (No Scoring)") return "text-red-600";
  if (status === "Partial") return "text-yellow-600";
  if (status === "Complete") return "text-green-600";
  return "text-gray-500";
}

export default async function IngestionHealthPage() {
  const ctx = await requireManagerAdminOrMaster();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const { rows } = await pool.query<Row>(
    `
    SELECT
      o.id AS org_id,
      o.name AS organization_name,
      (SELECT COUNT(*)::bigint FROM opportunities WHERE org_id = o.id)::text AS total_opportunities,
      (SELECT COUNT(*)::bigint FROM opportunities WHERE org_id = o.id AND COALESCE(run_count, 0) > 0)::text AS reviewed_opportunities,
      (SELECT COUNT(*)::bigint FROM comment_ingestions WHERE org_id = o.id)::text AS comment_ingestions_count,
      (SELECT COUNT(*)::bigint FROM opportunity_audit_events WHERE org_id = o.id)::text AS audit_events_count,
      (SELECT MAX(created_at)::text FROM comment_ingestions WHERE org_id = o.id) AS last_comment_ingestion_at,
      (SELECT MAX(ts)::text FROM opportunity_audit_events WHERE org_id = o.id) AS last_audit_event_at
    FROM organizations o
    ORDER BY o.id ASC
    `
  ).catch(() => ({ rows: [] as Row[] }));

  const data = rows || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[color:var(--sf-text-primary)]">Ingestion Health</h1>
        <Link
          href="/admin"
          className="text-sm text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)]"
        >
          Admin home
        </Link>
      </div>
      <p className="text-sm text-[color:var(--sf-text-secondary)]">
        Read-only ingestion and scoring status across organizations.
      </p>
      <div className="overflow-x-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
        <table className="w-full min-w-[800px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
              <th className="px-4 py-2 text-left font-medium text-[color:var(--sf-text-primary)]">Org</th>
              <th className="px-4 py-2 text-right font-medium text-[color:var(--sf-text-primary)]">Total Opps</th>
              <th className="px-4 py-2 text-right font-medium text-[color:var(--sf-text-primary)]">Reviewed</th>
              <th className="px-4 py-2 text-right font-medium text-[color:var(--sf-text-primary)]">%</th>
              <th className="px-4 py-2 text-right font-medium text-[color:var(--sf-text-primary)]">Comments</th>
              <th className="px-4 py-2 text-right font-medium text-[color:var(--sf-text-primary)]">Audits</th>
              <th className="px-4 py-2 text-left font-medium text-[color:var(--sf-text-primary)]">Last Comment</th>
              <th className="px-4 py-2 text-left font-medium text-[color:var(--sf-text-primary)]">Last Audit</th>
              <th className="px-4 py-2 text-left font-medium text-[color:var(--sf-text-primary)]">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const total = Number(row.total_opportunities) || 0;
              const reviewed = Number(row.reviewed_opportunities) || 0;
              const pct = total > 0 ? Math.round((reviewed / total) * 100) : 0;
              const status = deriveStatus(row);
              const lastComment = row.last_comment_ingestion_at
                ? new Date(row.last_comment_ingestion_at).toLocaleString()
                : "—";
              const lastAudit = row.last_audit_event_at
                ? new Date(row.last_audit_event_at).toLocaleString()
                : "—";
              return (
                <tr key={row.org_id} className="border-b border-[color:var(--sf-border)]">
                  <td className="px-4 py-2 text-[color:var(--sf-text-primary)]">
                    {row.organization_name ?? `Org ${row.org_id}`}
                  </td>
                  <td className="px-4 py-2 text-right text-[color:var(--sf-text-primary)]">{row.total_opportunities}</td>
                  <td className="px-4 py-2 text-right text-[color:var(--sf-text-primary)]">{row.reviewed_opportunities}</td>
                  <td className="px-4 py-2 text-right text-[color:var(--sf-text-primary)]">{pct}</td>
                  <td className="px-4 py-2 text-right text-[color:var(--sf-text-primary)]">{row.comment_ingestions_count}</td>
                  <td className="px-4 py-2 text-right text-[color:var(--sf-text-primary)]">{row.audit_events_count}</td>
                  <td className="px-4 py-2 text-[color:var(--sf-text-secondary)]">{lastComment}</td>
                  <td className="px-4 py-2 text-[color:var(--sf-text-secondary)]">{lastAudit}</td>
                  <td className={`px-4 py-2 font-medium ${statusColor(status)}`}>{status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-[color:var(--sf-text-secondary)]">No organizations found.</div>
        )}
      </div>
    </div>
  );
}
