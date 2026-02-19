function clamp01(v: number) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct01(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function deltaTextClass(v: number) {
  if (!Number.isFinite(v) || v === 0) return "text-[color:var(--sf-text-secondary)]";
  return v > 0 ? "text-[#2ECC71]" : "text-[#E74C3C]";
}

function confidenceFromPct(p: number | null) {
  if (p == null || !Number.isFinite(p)) return { label: "Confidence: —", tone: "muted" as const };
  if (p >= 1.0) return { label: "Confidence: High", tone: "good" as const };
  if (p >= 0.9) return { label: "Confidence: Moderate Risk", tone: "warn" as const };
  return { label: "Confidence: High Risk", tone: "bad" as const };
}

export function HeroBand(props: {
  title: string;
  aiPctToGoal: number | null;
  quota: number;
  aiForecast: number;
  leftToGo: number;
  aiAdjustmentVsCrm: number;
  headlineRight?: string | null;
}) {
  const pct = props.aiPctToGoal;
  const conf = confidenceFromPct(pct);
  const progress = pct == null ? 0 : clamp01(pct);
  const confClass =
    conf.tone === "good"
      ? "text-[#2ECC71]"
      : conf.tone === "warn"
        ? "text-[#F1C40F]"
        : conf.tone === "bad"
          ? "text-[#E74C3C]"
          : "text-[color:var(--sf-text-secondary)]";

  return (
    <section className="w-full rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">{props.title}</div>

          <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
            <div className="text-4xl font-extrabold tracking-tight text-[color:var(--sf-text-primary)]">{fmtPct01(pct)}</div>
            <div className="text-sm text-[color:var(--sf-text-secondary)]">
              AI Forecast{" "}
              <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(props.aiForecast)}</span> · Quota{" "}
              <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(props.quota)}</span> · Left To Go{" "}
              <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(props.leftToGo)}</span>
            </div>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-[color:var(--sf-text-secondary)]">
              <span>Projected to Quota</span>
              <span className={`font-mono font-semibold ${deltaTextClass(props.aiAdjustmentVsCrm)}`}>
                AI Adjustment vs CRM {props.aiAdjustmentVsCrm > 0 ? "+" : props.aiAdjustmentVsCrm < 0 ? "−" : ""}
                {fmtMoney(Math.abs(props.aiAdjustmentVsCrm))}
              </span>
            </div>
            <div className="mt-2 h-3 w-full rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
              <div
                className="h-full rounded-full bg-[color:var(--sf-accent-primary)]"
                style={{ width: `${Math.round(progress * 100)}%` }}
                aria-hidden="true"
              />
            </div>
            <div className={`mt-2 text-sm font-semibold ${confClass}`}>{conf.label}</div>
          </div>
        </div>

        {props.headlineRight ? (
          <div className="max-w-[520px] rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 text-sm text-[color:var(--sf-text-primary)]">
            <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Executive headline</div>
            <div className="mt-1 font-semibold">{props.headlineRight}</div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

