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

function clamp01(n: number) {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function ForecastDeltaCard(props: {
  crmOutlook: number;
  aiOutlook: number;
  gap: number;
  bucketDeltas: { commit: number; best_case: number; pipeline: number };
}) {
  const absMax = Math.max(Math.abs(props.bucketDeltas.commit), Math.abs(props.bucketDeltas.best_case), Math.abs(props.bucketDeltas.pipeline), 1);
  const bar = (v: number) => `${Math.round(clamp01(Math.abs(v) / absMax) * 100)}%`;

  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Forecast Delta</div>
      <div className="mt-2 grid gap-2 text-sm text-[color:var(--sf-text-primary)]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[color:var(--sf-text-secondary)]">CRM Outlook</span>
          <span className="font-mono font-semibold">{fmtMoney(props.crmOutlook)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[color:var(--sf-text-secondary)]">SalesForecast.IO</span>
          <span className="font-mono font-semibold">{fmtMoney(props.aiOutlook)}</span>
        </div>
        <div className="mt-1 border-t border-[color:var(--sf-border)] pt-2 flex items-center justify-between gap-3">
          <span className="text-[color:var(--sf-text-secondary)]">AI Adjustment</span>
          <span className={`font-mono font-semibold ${deltaTextClass(props.gap)}`}>{fmtMoney(props.gap)}</span>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Attribution (AI − CRM)</div>
        <div className="mt-2 grid gap-2 text-xs text-[color:var(--sf-text-primary)]">
          {[
            { label: "Commit impact", v: props.bucketDeltas.commit },
            { label: "Best Case", v: props.bucketDeltas.best_case },
            { label: "Pipeline", v: props.bucketDeltas.pipeline },
          ].map((x) => (
            <div key={x.label} className="grid grid-cols-[140px_1fr_88px] items-center gap-3">
              <div className="text-[color:var(--sf-text-secondary)]">{x.label}</div>
              <div className="h-2 rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                <div className={`h-full rounded-full ${x.v >= 0 ? "bg-[#2ECC71]" : "bg-[#E74C3C]"}`} style={{ width: bar(x.v) }} aria-hidden="true" />
              </div>
              <div className={`text-right font-mono ${deltaTextClass(x.v)}`}>{fmtMoney(x.v)}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

