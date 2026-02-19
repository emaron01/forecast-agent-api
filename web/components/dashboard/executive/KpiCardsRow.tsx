"use client";

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function deltaTextClass(v: number) {
  if (!Number.isFinite(v) || v === 0) return "text-[color:var(--sf-text-secondary)]";
  return v > 0 ? "text-[#2ECC71]" : "text-[#E74C3C]";
}

export function KpiCardsRow(props: {
  quota: number;
  aiForecast: number;
  crmForecast: number;
  gap: number;
  dealsAtRisk?: number | null;
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Quota</div>
        <div className="mt-2 font-mono text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(props.quota)}</div>
      </div>

      <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">AI Forecast Outlook</div>
        <div className="mt-2 font-mono text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(props.aiForecast)}</div>
        <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">SalesForecast.io AI‑weighted</div>
      </div>

      <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">CRM Forecast Outlook</div>
        <div className="mt-2 font-mono text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(props.crmForecast)}</div>
        <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Your organization’s probabilities</div>
      </div>

      <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">AI vs CRM Gap</div>
        <div className={`mt-2 font-mono text-lg font-semibold ${deltaTextClass(props.gap)}`}>{fmtMoney(props.gap)}</div>
        {props.dealsAtRisk != null ? (
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Deals at risk: {props.dealsAtRisk}</div>
        ) : (
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Outlook delta (AI − CRM)</div>
        )}
      </div>
    </section>
  );
}

