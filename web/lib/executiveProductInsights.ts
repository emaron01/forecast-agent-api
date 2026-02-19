export type ExecutiveProductPerformanceData = {
  summary: { total_revenue: number; total_orders: number; blended_acv: number };
  products: Array<{ name: string; revenue: number; orders: number; health_score: number | null }>;
};

export type ExecutiveProductComputedRow = {
  name: string;
  revenue: number;
  orders: number;
  health_score: number | null;
  acv: number | null;
  revenue_pct: number | null; // 0..1
  volume_pct: number | null; // 0..1
  spread_pct: number | null; // revenue_pct - volume_pct
};

function n0(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pct01(v: number) {
  if (!Number.isFinite(v)) return null;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function fmtMoney0(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtK(n: number) {
  const v = n0(n);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return `${Math.round(v)}`;
}

function fmtPct(p: number | null) {
  if (p == null) return "—";
  return `${Math.round(p * 100)}%`;
}

function approxEq(a: number, b: number, relTol = 0.015) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const denom = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / denom <= relTol;
}

export function computeExecutiveProductRows(data: ExecutiveProductPerformanceData): ExecutiveProductComputedRow[] {
  const totalRevenue = Math.max(0, n0(data.summary?.total_revenue));
  const totalOrders = Math.max(0, n0(data.summary?.total_orders));

  return (Array.isArray(data.products) ? data.products : [])
    .map((p) => {
      const revenue = Math.max(0, n0(p.revenue));
      const orders = Math.max(0, n0(p.orders));
      const acv = orders > 0 ? revenue / orders : null;
      const revenuePct = totalRevenue > 0 ? revenue / totalRevenue : null;
      const volumePct = totalOrders > 0 ? orders / totalOrders : null;
      const spread = revenuePct != null && volumePct != null ? revenuePct - volumePct : null;
      const hs = p.health_score == null ? null : n0(p.health_score);
      const health_score = hs == null || !Number.isFinite(hs) ? null : Math.max(0, Math.min(100, hs));
      return {
        name: String(p.name || "").trim() || "(Unspecified)",
        revenue,
        orders,
        health_score,
        acv,
        revenue_pct: revenuePct == null ? null : pct01(revenuePct),
        volume_pct: volumePct == null ? null : pct01(volumePct),
        spread_pct: spread == null ? null : Math.max(-1, Math.min(1, spread)),
      } satisfies ExecutiveProductComputedRow;
    })
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
}

export function generateExecutiveProductInsight(data: ExecutiveProductPerformanceData): string {
  const rows = computeExecutiveProductRows(data);
  const totalRevenue = Math.max(0, n0(data.summary?.total_revenue));
  const totalOrders = Math.max(0, n0(data.summary?.total_orders));

  if (!rows.length || totalRevenue <= 0 || totalOrders <= 0) {
    return "Not enough closed-won product data to generate a strategic takeaway yet.";
  }

  const byRevenue = rows.slice().sort((a, b) => b.revenue - a.revenue);
  const byOrders = rows.slice().sort((a, b) => b.orders - a.orders);
  const byAcv = rows.slice().filter((r) => r.acv != null).sort((a, b) => (b.acv || 0) - (a.acv || 0));

  const topRev = byRevenue[0] || null;
  const volLeader = byOrders[0] || null;
  const minAcv = byAcv.length ? byAcv[byAcv.length - 1] : null;

  const bullets: string[] = [];

  // Rule 1: Low volume, high revenue contribution => high-efficiency engine.
  // Use ratio + spread to detect disproportionate revenue contribution.
  const efficiencyCandidates = rows
    .map((r) => {
      const v = r.volume_pct ?? null;
      const rev = r.revenue_pct ?? null;
      const ratio = v != null && v > 0 && rev != null ? rev / v : null;
      return { r, ratio };
    })
    .filter((x) => x.r.spread_pct != null && x.r.volume_pct != null && x.r.revenue_pct != null)
    .filter((x) => (x.r.volume_pct as number) <= 0.5)
    .sort((a, b) => (b.ratio || 0) - (a.ratio || 0));

  // Tuned so "Endpoint" style mix (e.g. ~31% volume, ~41% revenue) is detected,
  // while obvious inefficiencies (high volume, low revenue) are not.
  const highEfficiency = efficiencyCandidates.find((x) => (x.ratio || 0) >= 1.28 && (x.r.spread_pct || 0) >= 0.08) || null;

  if (highEfficiency) {
    const r = highEfficiency.r;
    bullets.push(
      `${r.name} is a High‑Efficiency Revenue Engine, driving ${fmtPct(r.revenue_pct)} of revenue on just ${r.orders} deal(s) (${fmtPct(
        r.volume_pct
      )} of volume; ACV ${fmtMoney0(Math.round(r.acv || 0))}). Recommendation: dissect the sales motion (ICP, packaging, approvals, competition) and replicate it across the rest of the team.`
    );
  }

  // Rule 2: Highest volume AND lowest ACV => high-effort / low-yield risk.
  if (volLeader && minAcv && volLeader.acv != null && minAcv.acv != null) {
    const isLowestAcv = volLeader.name === minAcv.name || approxEq(volLeader.acv, minAcv.acv);
    if (isLowestAcv) {
      bullets.push(
        `${volLeader.name} has the highest transaction volume (${volLeader.orders} deal(s)) but the lowest average deal size (${fmtMoney0(
          Math.round(volLeader.acv)
        )})—a High‑Effort / Low‑Yield Risk. Recommendation: review standalone deals for immediate cross‑sell/bundling plays and tighten “why now” packaging to lift ACV.`
      );
    }
  }

  // Always include a concise mix/shape line.
  if (topRev?.revenue_pct != null && topRev.volume_pct != null && topRev.acv != null) {
    const spreadLabel =
      topRev.spread_pct != null && topRev.spread_pct >= 0.08
        ? "pricing power"
        : topRev.spread_pct != null && topRev.spread_pct <= -0.08
          ? "sales-effort drag"
          : "balanced mix";
    bullets.push(
      `Mix snapshot: ${topRev.name} leads at ${fmtK(topRev.revenue)} revenue (${fmtPct(topRev.revenue_pct)} of mix) across ${topRev.orders} deal(s) (${fmtPct(
        topRev.volume_pct
      )} of volume), signaling ${spreadLabel}.`
    );
  }

  // Health stability note.
  const hs = rows.map((r) => r.health_score).filter((v): v is number => v != null && Number.isFinite(v));
  if (hs.length) {
    const min = Math.min(...hs);
    const max = Math.max(...hs);
    if (max - min <= 3) {
      const avg = hs.reduce((a, b) => a + b, 0) / hs.length;
      bullets.push(`Deal health is stable at ~${Math.round(avg)}% across product lines.`);
    } else {
      const worst = rows
        .filter((r) => r.health_score != null)
        .slice()
        .sort((a, b) => (a.health_score || 0) - (b.health_score || 0))[0];
      if (worst?.health_score != null) bullets.push(`Watch risk concentration: ${worst.name} is the softest line at ${Math.round(worst.health_score)}% health.`);
    }
  }

  // De-duplicate near-identical bullets and cap length.
  const uniq: string[] = [];
  for (const b of bullets) {
    const k = b.replace(/\s+/g, " ").trim().toLowerCase();
    if (uniq.some((u) => u.replace(/\s+/g, " ").trim().toLowerCase() === k)) continue;
    uniq.push(b);
  }

  return uniq.slice(0, 3).join(" ");
}

