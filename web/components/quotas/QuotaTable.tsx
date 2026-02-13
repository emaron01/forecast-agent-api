import type { QuotaRow } from "../../lib/quotaModels";
import type { ReactNode } from "react";

export function QuotaTable(args: {
  quotas: QuotaRow[];
  actions?: (q: QuotaRow) => ReactNode;
}) {
  const { quotas, actions } = args;
  return (
    <div className="overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
          <tr>
            <th className="px-4 py-3">id</th>
            <th className="px-4 py-3">quota_period_id</th>
            <th className="px-4 py-3">role_level</th>
            <th className="px-4 py-3">rep_id</th>
            <th className="px-4 py-3">manager_id</th>
            <th className="px-4 py-3 text-right">quota_amount</th>
            <th className="px-4 py-3 text-right">annual_target</th>
            <th className="px-4 py-3 text-right">carry_forward</th>
            <th className="px-4 py-3 text-right">adjusted_quarterly_quota</th>
            {actions ? <th className="px-4 py-3 text-right">actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {quotas.length ? (
            quotas.map((q) => (
              <tr key={String(q.id)} className="border-t border-[color:var(--sf-border)]">
                <td className="px-4 py-3 font-mono text-xs">{q.id}</td>
                <td className="px-4 py-3 font-mono text-xs">{q.quota_period_id}</td>
                <td className="px-4 py-3">{q.role_level}</td>
                <td className="px-4 py-3 font-mono text-xs">{q.rep_id || ""}</td>
                <td className="px-4 py-3 font-mono text-xs">{q.manager_id || ""}</td>
                <td className="px-4 py-3 text-right">{q.quota_amount}</td>
                <td className="px-4 py-3 text-right">{q.annual_target ?? ""}</td>
                <td className="px-4 py-3 text-right">{q.carry_forward ?? ""}</td>
                <td className="px-4 py-3 text-right">{q.adjusted_quarterly_quota ?? ""}</td>
                {actions ? <td className="px-4 py-3 text-right">{actions(q)}</td> : null}
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]" colSpan={actions ? 10 : 9}>
                No quotas found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

