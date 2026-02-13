import type { QuotaRollupRow } from "./QuotaRollupTable";

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function QuotaRollupChart(args: { title: string; rows: QuotaRollupRow[] }) {
  const { title, rows } = args;
  const max = Math.max(1, ...rows.map((r) => Number(r.quota_amount) || 0));
  return (
    <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{title}</div>
      <div className="mt-4 grid gap-2">
        {rows.length ? (
          rows.map((r) => {
            const q = Number(r.quota_amount) || 0;
            const a = Number(r.actual_amount) || 0;
            const qPct = clamp01(q / max) * 100;
            const aPct = clamp01(a / max) * 100;
            return (
              <div key={r.id} className="grid gap-1">
                <div className="flex items-center justify-between text-xs text-[color:var(--sf-text-secondary)]">
                  <span className="truncate">{r.name}</span>
                  <span className="font-mono">
                    {a} / {q}
                  </span>
                </div>
                <div className="relative h-3 w-full rounded-md bg-[color:var(--sf-surface-alt)]">
                  <div className="absolute left-0 top-0 h-3 rounded-md bg-[color:var(--sf-accent-secondary)]" style={{ width: `${qPct}%` }} />
                  <div className="absolute left-0 top-0 h-3 rounded-md bg-[color:var(--sf-accent-primary)]" style={{ width: `${aPct}%` }} />
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-sm text-[color:var(--sf-text-disabled)]">No rows.</div>
        )}
      </div>
    </div>
  );
}

