"use client";

export type RiskDriverItem = {
  key: string;
  label: string;
  count: number;
  tone: "bad" | "warn" | "good" | "muted";
};

function toneColor(t: RiskDriverItem["tone"]) {
  if (t === "bad") return "text-[#E74C3C]";
  if (t === "warn") return "text-[#F1C40F]";
  if (t === "good") return "text-[#2ECC71]";
  return "text-[color:var(--sf-text-secondary)]";
}

export function RiskRadar(props: { items: RiskDriverItem[]; subtitle?: string }) {
  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">AI Risk Radar</div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">{props.subtitle || "Top drivers impacting forecast confidence."}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {props.items.length ? (
          props.items.map((it) => (
            <div
              key={it.key}
              className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2"
            >
              <div className="min-w-0">
                <div className={`font-semibold ${toneColor(it.tone)}`}>{it.label}</div>
              </div>
              <div className="shrink-0 font-mono text-sm font-semibold text-[color:var(--sf-text-primary)]">{it.count}</div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 text-sm text-[color:var(--sf-text-secondary)]">
            No risk drivers found for the current deal set.
          </div>
        )}
      </div>
    </section>
  );
}

