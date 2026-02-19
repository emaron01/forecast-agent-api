"use client";

export type RiskDistributionRow = { key: string; label: string; count: number };

function clamp01(n: number) {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function MeddpiccRiskDistribution(props: { rows: RiskDistributionRow[] }) {
  const max = Math.max(...props.rows.map((r) => r.count), 1);
  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">MEDDPICC Risk Distribution</div>
      <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Pattern of weakness across the currently displayed deal set.</div>

      <div className="mt-4 grid gap-2">
        {props.rows.length ? (
          props.rows.map((r) => {
            const w = `${Math.round(clamp01(r.count / max) * 100)}%`;
            return (
              <div key={r.key} className="grid grid-cols-[180px_1fr_80px] items-center gap-3">
                <div className="text-sm text-[color:var(--sf-text-secondary)]">{r.label}</div>
                <div className="h-2 rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                  <div className="h-full rounded-full bg-[color:var(--sf-accent-secondary)]" style={{ width: w }} aria-hidden="true" />
                </div>
                <div className="text-right font-mono text-xs text-[color:var(--sf-text-primary)]">{r.count}</div>
              </div>
            );
          })
        ) : (
          <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 text-sm text-[color:var(--sf-text-secondary)]">
            No MEDDPICC category risks found for the current deal set.
          </div>
        )}
      </div>
    </section>
  );
}

