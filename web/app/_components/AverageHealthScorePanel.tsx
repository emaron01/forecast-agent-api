import type { HealthAveragesRow } from "../../lib/analyticsHealth";

function pctFrom30(score: any) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((n / 30) * 100)));
}

function colorClassFromPct(pct: number | null) {
  if (pct == null) return "text-[color:var(--sf-text-disabled)]";
  if (pct >= 80) return "text-[#2ECC71]";
  if (pct >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

function Cell(props: { label: string; score: any }) {
  const pct = pctFrom30(props.score);
  const cls = colorClassFromPct(pct);
  return (
    <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2">
      <div className="text-[color:var(--sf-text-secondary)]">{props.label}</div>
      <div className="font-mono font-semibold">
        <span className={cls}>{pct == null ? "—" : `${pct}%`}</span>{" "}
        <span className="text-[color:var(--sf-text-secondary)]">({pct == null ? "—" : `${Math.round((pct / 100) * 30)}/30`})</span>
      </div>
    </div>
  );
}

export function AverageHealthScorePanel(props: { title?: string; row: HealthAveragesRow | null }) {
  const r = props.row;
  return (
    <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="text-base font-semibold text-[color:var(--sf-text-primary)]">{props.title || "Average Health Score"}</div>
      <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Based on `opportunities.health_score` (0–30) for deals in the selected quarter.</div>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Cell label="Overall" score={r?.avg_health_all} />
        <Cell label="Commit" score={r?.avg_health_commit} />
        <Cell label="Best Case" score={r?.avg_health_best} />
        <Cell label="Pipeline" score={r?.avg_health_pipeline} />
        <Cell label="Won" score={r?.avg_health_won} />
        <Cell label="Closed" score={r?.avg_health_closed} />
      </div>
    </section>
  );
}

