type ChannelRepHeroCardsProps = {
  closedWon: number | null;
  quota: number | null;
  contributionPct: number | null;
  gapToQuota: number | null;
  landingZone: number | null;
};

function fmtMoney(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

type CardSpec = {
  label: string;
  value: string;
  toneClass?: string;
  hint: string;
};

export function ChannelRepHeroCards({
  closedWon,
  quota,
  contributionPct,
  gapToQuota,
  landingZone,
}: ChannelRepHeroCardsProps) {
  const gapToneClass =
    gapToQuota == null
      ? "text-[color:var(--sf-text-primary)]"
      : gapToQuota > 0
        ? "text-[#E74C3C]"
        : "text-[#16A34A]";

  const cards: CardSpec[] = [
    {
      label: "Closed Won",
      value: fmtMoney(closedWon),
      toneClass: "text-green-400",
      hint: "channel closed won this quarter",
    },
    {
      label: "Quota",
      value: fmtMoney(quota),
      hint: "channel roles only this quarter",
    },
    {
      label: "Contribution",
      value: fmtPercent(contributionPct),
      hint: "channel closed won vs assigned sales team",
    },
    {
      label: "Gap to Quota",
      value: fmtMoney(gapToQuota),
      toneClass: gapToneClass,
      hint: "Remaining to quota",
    },
    {
      label: "Landing Zone",
      value: fmtMoney(landingZone),
      hint: "AI weighted forecast",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.label}
          className="min-w-0 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm"
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
            {card.label}
          </div>
          <div
            className={[
              "mt-1 break-all text-xl font-bold font-[tabular-nums] sm:text-2xl",
              card.toneClass || "text-[color:var(--sf-text-primary)]",
            ].join(" ")}
          >
            {card.value}
          </div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
            {card.hint}
          </div>
        </div>
      ))}
    </div>
  );
}
