export type QuotaRollupRow = {
  id: string;
  name: string;
  quota_amount: number;
  actual_amount: number;
  attainment: number | null;
};

export function QuotaRollupTable(args: { title: string; subtitle?: string; rows: QuotaRollupRow[] }) {
  const { title, subtitle, rows } = args;
  return (
    <div className="overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
      <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
        <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{title}</div>
        {subtitle ? <div className="text-xs text-[color:var(--sf-text-secondary)]">{subtitle}</div> : null}
      </div>
      <table className="w-full text-left text-sm">
        <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
          <tr>
            <th className="px-4 py-3">id</th>
            <th className="px-4 py-3">name</th>
            <th className="px-4 py-3 text-right">quota_amount</th>
            <th className="px-4 py-3 text-right">actual_amount</th>
            <th className="px-4 py-3 text-right">attainment</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r) => (
              <tr key={r.id} className="border-t border-[color:var(--sf-border)]">
                <td className="px-4 py-3 font-mono text-xs">{r.id}</td>
                <td className="px-4 py-3">{r.name}</td>
                <td className="px-4 py-3 text-right">{r.quota_amount}</td>
                <td className="px-4 py-3 text-right">{r.actual_amount}</td>
                <td className="px-4 py-3 text-right">{r.attainment == null ? "" : r.attainment}</td>
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
  );
}

