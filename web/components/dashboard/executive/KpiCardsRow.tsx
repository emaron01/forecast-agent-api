"use client";

function fmtMoney(n: any) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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

export type CommitAdmissionAggregates = {
  unsupportedCommitAmount: number;
  unsupportedCommitCount: number;
  commitNeedsReviewAmount: number;
  commitNeedsReviewCount: number;
  totalCommitCrmAmount: number;
  aiSupportedCommitAmount: number;
  commitEvidenceCoveragePct?: number;
  verifiedCommitAmount?: number;
  verifiedCommitCount?: number;
};

export function KpiCardsRow(props: {
  quota: number;
  aiForecast: number;
  crmForecast: number;
  gap: number;
  bucketDeltas: { commit: number; best_case: number; pipeline: number };
  dealsAtRisk?: number | null;
  topN: number;
  usingFullRiskSet: boolean;
  productKpis: { total_revenue: number; total_orders: number; blended_acv: number } | null;
  productKpisPrev: { total_revenue: number; total_orders: number; blended_acv: number } | null;
  commitAdmission?: CommitAdmissionAggregates | null;
  variant?: "full" | "product_only" | "forecast_only";
}) {
  const absMax = Math.max(Math.abs(props.bucketDeltas.commit), Math.abs(props.bucketDeltas.best_case), Math.abs(props.bucketDeltas.pipeline), 1);
  const bar = (v: number) => `${Math.round(clamp01(Math.abs(v) / absMax) * 100)}%`;

  const card = "rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm";
  const val = "mt-2 text-kpiValue text-[color:var(--sf-text-primary)]";

  const fmtSignedInt = (n: number) => {
    const v = Number(n || 0);
    if (!Number.isFinite(v)) return "—";
    if (v === 0) return "0";
    const abs = Math.abs(Math.trunc(v));
    return `${v > 0 ? "+" : "-"}${abs.toLocaleString("en-US")}`;
  };

  const ProductTile = (p: {
    label: string;
    curText: string;
    prevText: string;
    deltaText: string;
    delta: number | null;
  }) => {
    const d = p.delta == null ? null : Number(p.delta);
    const up = d != null && d > 0;
    const down = d != null && d < 0;
    const tone = up ? "text-[#16A34A]" : down ? "text-[#E74C3C]" : "text-[color:var(--sf-text-secondary)]";
    const arrow = up ? "↑" : down ? "↓" : "→";
    return (
      <div className={card}>
        <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">{p.label}</div>
        <div className={val}>{p.curText}</div>
        <div className="mt-1 grid grid-cols-[1fr_auto] items-start gap-3 text-meta">
          <div className="min-w-0 truncate">Last Quarter {p.prevText}</div>
          <div className={["grid justify-items-end text-meta font-[500] leading-none num-tabular", tone].join(" ")}>
            <div aria-hidden="true" className="text-sm leading-none">
              {arrow}
            </div>
            <div>{p.deltaText}</div>
          </div>
        </div>
      </div>
    );
  };

  const cur = props.productKpis;
  const prev = props.productKpisPrev;
  const curRev = cur ? Number(cur.total_revenue || 0) || 0 : 0;
  const curOrders = cur ? Number(cur.total_orders || 0) || 0 : 0;
  const curAcv = cur ? Number(cur.blended_acv || 0) || 0 : 0;
  const prevRev = prev ? Number(prev.total_revenue || 0) || 0 : 0;
  const prevOrders = prev ? Number(prev.total_orders || 0) || 0 : 0;
  const prevAcv = prev ? Number(prev.blended_acv || 0) || 0 : 0;

  const variant = props.variant || "full";

  const attributionCardClass = [card, "min-w-0 p-3"].join(" ");
  const ForecastStageGapAttributionCard = (
    <div className={attributionCardClass}>
      <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Gap Attribution</div>
      <div className="mt-2 grid gap-1.5 text-tableValue text-[color:var(--sf-text-primary)]">
        {[
          { label: "Commit", v: props.bucketDeltas.commit },
          { label: "Best Case", v: props.bucketDeltas.best_case },
          { label: "Pipeline", v: props.bucketDeltas.pipeline },
        ].map((x) => (
          <div key={x.label} className="grid grid-cols-[70px_minmax(0,1fr)_68px] items-center gap-2">
            <div className="text-tableLabel text-xs">{x.label}</div>
            <div className="h-1.5 min-w-0 rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
              <div className={`h-full rounded-full ${x.v >= 0 ? "bg-[#2ECC71]" : "bg-[#E74C3C]"}`} style={{ width: bar(x.v) }} aria-hidden="true" />
            </div>
            <div className={`text-right text-xs num-tabular shrink-0 ${deltaTextClass(x.v)}`}>{fmtMoney(x.v)}</div>
          </div>
        ))}
      </div>
    </div>
  );

  if (variant === "product_only") {
    return (
      <section className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          <ProductTile
            label="Closed Won (QTD)"
            curText={fmtMoney(curRev)}
            prevText={prev ? fmtMoney(prevRev) : "—"}
            deltaText={prev ? fmtMoney(curRev - prevRev) : "—"}
            delta={prev ? curRev - prevRev : null}
          />
          <ProductTile
            label="Total Orders"
            curText={curOrders.toLocaleString("en-US")}
            prevText={prev ? prevOrders.toLocaleString("en-US") : "—"}
            deltaText={prev ? fmtSignedInt(curOrders - prevOrders) : "—"}
            delta={prev ? curOrders - prevOrders : null}
          />
          <ProductTile
            label="Blended ACV"
            curText={fmtMoney(curAcv)}
            prevText={prev ? fmtMoney(prevAcv) : "—"}
            deltaText={prev ? fmtMoney(curAcv - prevAcv) : "—"}
            delta={prev ? curAcv - prevAcv : null}
          />
        </div>
      </section>
    );
  }

  const ca = props.commitAdmission;

  if (variant === "forecast_only") {
    return (
      <section className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-9">
          <div className={card}>
            <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Quota</div>
            <div className={val}>{fmtMoney(props.quota)}</div>
          </div>

          <div className={card}>
            <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">AI Forecast Outlook</div>
            <div className={val}>{fmtMoney(props.aiForecast)}</div>
            <div className="mt-1 text-meta">SalesForecast.io AI‑weighted</div>
          </div>

          <div className={card}>
            <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">CRM Forecast Outlook</div>
            <div className={val}>{fmtMoney(props.crmForecast)}</div>
            <div className="mt-1 text-meta">Your organization’s probabilities</div>
          </div>

          <div className={card}>
            <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">AI Adjustment vs CRM</div>
            <div className={`mt-2 text-kpiValue ${deltaTextClass(props.gap)}`}>{fmtMoney(props.gap)}</div>
            <div className="mt-1 text-meta">Outlook delta (AI − CRM)</div>
            {props.dealsAtRisk != null ? <div className="mt-1 text-meta">Deals at risk: {props.dealsAtRisk}</div> : null}
          </div>

          {ca ? (
            <>
              <div className={card}>
                <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Unsupported Commit</div>
                <div className={`mt-2 text-kpiValue ${ca.unsupportedCommitAmount > 0 ? "text-[#E74C3C]" : "text-[color:var(--sf-text-primary)]"}`}>
                  {fmtMoney(ca.unsupportedCommitAmount)}
                </div>
                <div className="mt-1 text-meta"># Deals: {ca.unsupportedCommitCount}</div>
              </div>
              <div className={card}>
                <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Commit Needs Review</div>
                <div className={`mt-2 text-kpiValue ${ca.commitNeedsReviewAmount > 0 ? "text-[#F1C40F]" : "text-[color:var(--sf-text-primary)]"}`}>
                  {fmtMoney(ca.commitNeedsReviewAmount)}
                </div>
                <div className="mt-1 text-meta"># Deals: {ca.commitNeedsReviewCount}</div>
              </div>
              <div className={card} title="% of Commit deals backed by verified evidence (≥2 of Timing, Paper, Decision, Budget).">
                <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Commit Evidence Coverage</div>
                <div className={`mt-2 text-kpiValue ${(ca.commitEvidenceCoveragePct ?? 0) >= 40 ? "text-[#2ECC71]" : (ca.commitEvidenceCoveragePct ?? 0) > 0 ? "text-[#F1C40F]" : "text-[color:var(--sf-text-primary)]"}`}>
                  {ca.commitEvidenceCoveragePct != null ? `${Math.round(ca.commitEvidenceCoveragePct)}%` : "—"}
                </div>
                <div className="mt-1 text-meta">% with ≥2 high-confidence gate categories</div>
                {(ca.verifiedCommitAmount != null && ca.verifiedCommitAmount > 0) ? (
                  <div className="mt-1 text-meta">Verified Commit: {fmtMoney(ca.verifiedCommitAmount)}</div>
                ) : null}
              </div>
            </>
          ) : null}

          {ForecastStageGapAttributionCard}
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <div className={card}>
          <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Quota</div>
          <div className={val}>{fmtMoney(props.quota)}</div>
        </div>

        <div className={card}>
          <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">AI Forecast Outlook</div>
          <div className={val}>{fmtMoney(props.aiForecast)}</div>
          <div className="mt-1 text-meta">SalesForecast.io AI‑weighted</div>
        </div>

        <div className={card}>
          <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">CRM Forecast Outlook</div>
          <div className={val}>{fmtMoney(props.crmForecast)}</div>
          <div className="mt-1 text-meta">Your organization’s probabilities</div>
        </div>

        <div className={card}>
          <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">AI Adjustment vs CRM</div>
          <div className={`mt-2 text-kpiValue ${deltaTextClass(props.gap)}`}>{fmtMoney(props.gap)}</div>
          <div className="mt-1 text-meta">Outlook delta (AI − CRM)</div>
          {props.dealsAtRisk != null ? (
            <div className="mt-1 text-meta">Deals at risk: {props.dealsAtRisk}</div>
          ) : null}
        </div>

        <ProductTile
          label="Closed Won (QTD)"
          curText={fmtMoney(curRev)}
          prevText={prev ? fmtMoney(prevRev) : "—"}
          deltaText={prev ? fmtMoney(curRev - prevRev) : "—"}
          delta={prev ? curRev - prevRev : null}
        />
        <ProductTile
          label="Total Orders"
          curText={curOrders.toLocaleString("en-US")}
          prevText={prev ? prevOrders.toLocaleString("en-US") : "—"}
          deltaText={prev ? fmtSignedInt(curOrders - prevOrders) : "—"}
          delta={prev ? curOrders - prevOrders : null}
        />
        <ProductTile
          label="Blended ACV"
          curText={fmtMoney(curAcv)}
          prevText={prev ? fmtMoney(prevAcv) : "—"}
          deltaText={prev ? fmtMoney(curAcv - prevAcv) : "—"}
          delta={prev ? curAcv - prevAcv : null}
        />
      </div>

      {ForecastStageGapAttributionCard}
    </section>
  );
}

