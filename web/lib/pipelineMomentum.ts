export type ForecastMixKey = "commit" | "best_case" | "pipeline";

export type PipelineMomentumData = {
  quota_target: number;
  current_quarter: {
    total_pipeline: number;
    total_opps: number;
    mix: Record<
      ForecastMixKey,
      {
        value: number;
        opps: number;
        qoq_change_pct: number | null; // -8 => -8% QoQ, null => unknown
      }
    >;
  };
  previous_quarter: {
    total_pipeline: number | null;
  };
  predictive?: {
    created_pipeline: {
      current: {
        total_amount: number;
        total_opps: number;
        mix: Record<ForecastMixKey, { value: number; opps: number; health_pct: number | null }>;
      };
      previous: {
        total_amount: number | null;
        total_opps: number | null;
      };
      qoq_total_amount_pct01: number | null;
      qoq_total_opps_pct01: number | null;
    };
    products_created_pipeline_top: Array<{
      product: string;
      amount: number;
      opps: number;
      avg_health_pct: number | null;
      qoq_amount_pct01: number | null;
    }>;
    cycle_mix_created_pipeline: {
      avg_age_days: number | null;
      bands: Array<{ band: "0-30" | "31-60" | "61+"; opps: number; amount: number }>;
    };
    partners_showing_promise: Array<{
      partner_name: string;
      closed_opps: number;
      win_rate: number | null;
      avg_days: number | null;
      aov: number | null;
      won_amount: number;
      delta_days_vs_direct: number | null;
    }>;
    direct_baseline: { avg_days: number | null; win_rate: number | null; aov: number | null };
  };
};

export const MOCK_PIPELINE_MOMENTUM_DATA: PipelineMomentumData = {
  quota_target: 2_000_000,
  current_quarter: {
    total_pipeline: 7_375_569,
    total_opps: 60,
    mix: {
      commit: { value: 1_685_627, opps: 7, qoq_change_pct: 4 },
      best_case: { value: 2_739_365, opps: 15, qoq_change_pct: -2 },
      pipeline: { value: 2_950_577, opps: 38, qoq_change_pct: -15 },
    },
  },
  previous_quarter: { total_pipeline: 8_016_922 },
};

function toNum(n: unknown) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

export function fmtMoney(n: unknown, opts?: { currency?: string; maximumFractionDigits?: number }) {
  const v = toNum(n);
  if (v == null) return "—";
  return v.toLocaleString(undefined, {
    style: "currency",
    currency: opts?.currency || "USD",
    maximumFractionDigits: opts?.maximumFractionDigits ?? 0,
  });
}

export function fmtSignedPct(n: unknown, opts?: { digits?: number }) {
  const v = toNum(n);
  if (v == null) return "—";
  const d = Math.max(0, Math.min(2, opts?.digits ?? 0));
  const abs = Math.abs(v);
  const absText = d ? abs.toFixed(d) : String(Math.round(abs));
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${absText}%`;
}

export function coverageRatio(totalPipeline: unknown, quotaTarget: unknown) {
  const pipe = toNum(totalPipeline);
  const quota = toNum(quotaTarget);
  if (pipe == null || quota == null || quota <= 0) return null;
  return pipe / quota;
}

export function fmtCoverageRatio(r: number | null, opts?: { digits?: number }) {
  if (r == null || !Number.isFinite(r)) return "—";
  const d = Math.max(0, Math.min(2, opts?.digits ?? 1));
  return `${r.toFixed(d)}x`;
}

export type CoverageTone = "good" | "warn" | "bad" | "muted";

export function coverageTone(r: number | null): CoverageTone {
  if (r == null || !Number.isFinite(r)) return "muted";
  if (r < 3.0) return "bad";
  if (r < 3.5) return "warn";
  return "good";
}

export function qoqChangePct01(currentTotal: unknown, prevTotal: unknown) {
  const cur = toNum(currentTotal);
  const prev = toNum(prevTotal);
  if (cur == null || prev == null || prev <= 0) return null;
  return (cur - prev) / prev; // -0.08 = -8% QoQ
}

export function fmtSignedPct01(p01: number | null, opts?: { digits?: number }) {
  if (p01 == null || !Number.isFinite(p01)) return "—";
  return fmtSignedPct(p01 * 100, { digits: opts?.digits ?? 0 });
}

export type TrendTone = "up" | "down" | "flat" | "muted";

export function trendToneFromPct01(p01: number | null): TrendTone {
  if (p01 == null || !Number.isFinite(p01)) return "muted";
  if (p01 > 0) return "up";
  if (p01 < 0) return "down";
  return "flat";
}

export function mixPct01(data: PipelineMomentumData, k: ForecastMixKey) {
  const total = Number(data.current_quarter.total_pipeline || 0) || 0;
  const v = Number(data.current_quarter.mix[k]?.value || 0) || 0;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, v / total));
}

export function generateAiMomentumInsight(data: PipelineMomentumData) {
  const c = Number(data.current_quarter.mix.commit.qoq_change_pct ?? 0) || 0;
  const b = Number(data.current_quarter.mix.best_case.qoq_change_pct ?? 0) || 0;
  const p = Number(data.current_quarter.mix.pipeline.qoq_change_pct ?? 0) || 0;

  const totalQoq = qoqChangePct01(data.current_quarter.total_pipeline, data.previous_quarter.total_pipeline);
  const totalQoqText = fmtSignedPct01(totalQoq, { digits: 0 });

  const r = coverageRatio(data.current_quarter.total_pipeline, data.quota_target);
  const rText = fmtCoverageRatio(r, { digits: 1 });
  const safeZoneRisk = r != null && r < 3.0;

  const pipelineHeavilyNegative = data.current_quarter.mix.pipeline.qoq_change_pct != null && data.current_quarter.mix.pipeline.qoq_change_pct <= -10;
  const commitPositive = data.current_quarter.mix.commit.qoq_change_pct != null && data.current_quarter.mix.commit.qoq_change_pct > 0;

  if (commitPositive && pipelineHeavilyNegative) {
    const down = Math.abs(Math.round(p));
    const addSafe = safeZoneRisk ? " Coverage is already below the 3.0x safe zone." : "";
    return `Top-of-funnel momentum is slowing. While Commit is stable, early-stage Pipeline generation is down ${down}%, threatening next quarter's coverage. Total pipeline is ${totalQoqText} QoQ at ${rText} coverage.${addSafe}`;
  }

  const worstTier =
    data.current_quarter.mix.pipeline.qoq_change_pct != null && (data.current_quarter.mix.pipeline.qoq_change_pct as number) <= (data.current_quarter.mix.best_case.qoq_change_pct ?? 999) && (data.current_quarter.mix.pipeline.qoq_change_pct as number) <= (data.current_quarter.mix.commit.qoq_change_pct ?? 999)
      ? "Pipeline"
      : data.current_quarter.mix.best_case.qoq_change_pct != null && (data.current_quarter.mix.best_case.qoq_change_pct as number) <= (data.current_quarter.mix.pipeline.qoq_change_pct ?? 999) && (data.current_quarter.mix.best_case.qoq_change_pct as number) <= (data.current_quarter.mix.commit.qoq_change_pct ?? 999)
        ? "Best Case"
        : "Commit";
  const worstDelta = worstTier === "Pipeline" ? p : worstTier === "Best Case" ? b : c;

  if (totalQoq != null && totalQoq < 0) {
    return `Total pipeline is ${totalQoqText} QoQ, with the largest slowdown in ${worstTier} (${fmtSignedPct(worstDelta)}). Current coverage is ${rText}${safeZoneRisk ? " (below the 3.0x safe zone)" : ""}.`;
  }

  if (totalQoq != null && totalQoq > 0) {
    return `Total pipeline is ${totalQoqText} QoQ and coverage is ${rText}. Momentum is improving—protect Commit quality and keep Pipeline creation pacing.`;
  }

  return `Pipeline coverage is ${rText}. Mix shifts are: Commit ${fmtSignedPct(c)}, Best Case ${fmtSignedPct(b)}, Pipeline ${fmtSignedPct(p)} QoQ.`;
}
