"use client";

import {
  coverageRatio,
  coverageTone,
  fmtCoverageRatio,
  fmtMoney,
  fmtSignedPct,
  fmtSignedPct01,
  generateAiMomentumInsight,
  mixPct01,
  qoqChangePct01,
  trendToneFromPct01,
  type ForecastMixKey,
  type PipelineMomentumData,
} from "../../../lib/pipelineMomentum";

function toneClasses(t: "good" | "warn" | "bad" | "muted") {
  if (t === "good") return "text-[#2ECC71]";
  if (t === "warn") return "text-[#F1C40F]";
  if (t === "bad") return "text-[#E74C3C]";
  return "text-[color:var(--sf-text-secondary)]";
}

function trendBadge(p01: number | null) {
  const t = trendToneFromPct01(p01);
  const cls =
    t === "up"
      ? "border-[#2ECC71]/40 bg-[#2ECC71]/10 text-[#2ECC71]"
      : t === "down"
        ? "border-[#E74C3C]/45 bg-[#E74C3C]/10 text-[#E74C3C]"
        : t === "flat"
          ? "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]"
          : "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]";
  const glyph = t === "up" ? "▲" : t === "down" ? "▼" : "•";
  return { cls, glyph };
}

function mixColor(k: ForecastMixKey) {
  if (k === "commit") return "bg-[color:var(--sf-accent-primary)]";
  if (k === "best_case") return "bg-[color:var(--sf-accent-tertiary)]";
  return "bg-[color:var(--sf-border)]";
}

function mixLabel(k: ForecastMixKey) {
  if (k === "commit") return "Commit";
  if (k === "best_case") return "Best Case";
  return "Pipeline";
}

function mixTrendTone(deltaPct: number | null) {
  if (deltaPct == null || !Number.isFinite(deltaPct)) return "muted" as const;
  if (deltaPct > 0) return "good" as const;
  if (deltaPct <= -10) return "bad" as const;
  if (deltaPct < 0) return "warn" as const;
  return "muted" as const;
}

function KpiCard(props: { label: string; value: string; sub?: string; rightPill?: { text: string; tone: "good" | "warn" | "bad" | "muted" } }) {
  const pill =
    props.rightPill?.tone === "good"
      ? "border-[#2ECC71]/40 bg-[#2ECC71]/10 text-[#2ECC71]"
      : props.rightPill?.tone === "warn"
        ? "border-[#F1C40F]/50 bg-[#F1C40F]/10 text-[#F1C40F]"
        : props.rightPill?.tone === "bad"
          ? "border-[#E74C3C]/50 bg-[#E74C3C]/10 text-[#E74C3C]"
          : "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]";

  return (
    <div className="rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">{props.label}</div>
          <div className="mt-2 truncate font-mono text-3xl font-extrabold tracking-tight text-[color:var(--sf-text-primary)] sm:text-4xl">{props.value}</div>
          {props.sub ? <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">{props.sub}</div> : null}
        </div>
        {props.rightPill ? <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${pill}`}>{props.rightPill.text}</span> : null}
      </div>
    </div>
  );
}

function StatCol(props: { k: ForecastMixKey; pct: number; value: number; opps: number; qoq: number | null }) {
  const qoqTone = mixTrendTone(props.qoq);
  return (
    <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full border border-[color:var(--sf-border)] ${mixColor(props.k)}`} aria-hidden="true" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[color:var(--sf-text-primary)]">
              {mixLabel(props.k)} <span className="text-xs font-semibold text-[color:var(--sf-text-secondary)]">({Math.round(props.pct * 100)}%)</span>
            </div>
            <div className="mt-0.5 text-[11px] text-[color:var(--sf-text-secondary)]">
              Value <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(props.value)}</span> · {props.opps} opps
            </div>
          </div>
        </div>

        <div className={`shrink-0 text-right font-mono text-xs font-semibold ${toneClasses(qoqTone)}`}>
          <span className="mr-1" aria-hidden="true">
            {props.qoq != null && props.qoq > 0 ? "▲" : props.qoq != null && props.qoq < 0 ? "▼" : "•"}
          </span>
          {fmtSignedPct(props.qoq == null ? null : props.qoq)}
          <div className="mt-0.5 text-[11px] font-sans font-medium text-[color:var(--sf-text-secondary)]">QoQ</div>
        </div>
      </div>
    </div>
  );
}

export function PipelineMomentumEngine(props: { data: PipelineMomentumData | null; className?: string }) {
  const data = props.data;
  if (!data) {
    return (
      <section className={["rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm", props.className || ""].join(" ")}>
        <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Pipeline Momentum</div>
        <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Not enough data to compute pipeline momentum for this period yet.</div>
      </section>
    );
  }

  const totalPipeline = data.current_quarter.total_pipeline;
  const totalOpps = data.current_quarter.total_opps;

  const cov = coverageRatio(totalPipeline, data.quota_target);
  const covTone = coverageTone(cov);
  const covText = fmtCoverageRatio(cov, { digits: 1 });

  const totalQoq = qoqChangePct01(data.current_quarter.total_pipeline, data.previous_quarter.total_pipeline);
  const { cls: velCls, glyph: velGlyph } = trendBadge(totalQoq);

  const aiText = generateAiMomentumInsight(data);

  const keys: ForecastMixKey[] = ["commit", "best_case", "pipeline"];
  const pct = {
    commit: mixPct01(data, "commit"),
    best_case: mixPct01(data, "best_case"),
    pipeline: mixPct01(data, "pipeline"),
  };

  const covPill =
    covTone === "warn"
      ? { text: "Watch (below 3.0x)", tone: "warn" as const }
      : covTone === "bad"
        ? { text: "Risk (below 3.0x)", tone: "bad" as const }
        : null;

  return (
    <section className={["grid gap-4", props.className || ""].join(" ")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Pipeline Momentum</div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Fast read on coverage, velocity, and mix (no pie charts).</div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <KpiCard label="Total Pipeline" value={fmtMoney(totalPipeline)} sub={`${totalOpps} opps · current quarter`} />
        <KpiCard
          label="Coverage Ratio"
          value={covText}
          sub={`Quota target: ${fmtMoney(data.quota_target)} · safe zone ≥ 3.0x`}
          rightPill={covPill || undefined}
        />
        <KpiCard
          label="QoQ Velocity"
          value={fmtSignedPct01(totalQoq, { digits: 0 })}
          sub={
            data.previous_quarter.total_pipeline == null
              ? "Previous quarter unavailable"
              : `Pipeline (${fmtMoney(data.previous_quarter.total_pipeline)} → ${fmtMoney(data.current_quarter.total_pipeline)})`
          }
          rightPill={{ text: `${velGlyph} momentum`, tone: totalQoq != null && totalQoq < 0 ? "bad" : totalQoq != null && totalQoq > 0 ? "good" : "muted" }}
        />
      </div>

      <div className="rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-5 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">AI Momentum Alert</div>
        <div className="mt-2 text-sm leading-relaxed text-[color:var(--sf-text-primary)]">{aiText}</div>
        <div className="mt-3">
          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${velCls}`}>Velocity {fmtSignedPct01(totalQoq, { digits: 0 })}</span>
        </div>
      </div>

      <div className="rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Forecast Mix</div>
            <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Current-quarter pipeline breakdown across stages.</div>
          </div>
          <div className="text-xs text-[color:var(--sf-text-secondary)]">
            Total <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(totalPipeline)}</span>
          </div>
        </div>

        <div className="mt-4">
          <div className="h-6 w-full overflow-hidden rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
            {keys.map((k) => (
              <div
                key={k}
                className={["h-full float-left", mixColor(k)].join(" ")}
                style={{ width: `${Math.max(0, Math.min(100, pct[k] * 100)).toFixed(2)}%` }}
                title={`${mixLabel(k)}: ${Math.round(pct[k] * 100)}%`}
                aria-label={`${mixLabel(k)} segment`}
              />
            ))}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <StatCol k="commit" pct={pct.commit} value={data.current_quarter.mix.commit.value} opps={data.current_quarter.mix.commit.opps} qoq={data.current_quarter.mix.commit.qoq_change_pct} />
            <StatCol
              k="best_case"
              pct={pct.best_case}
              value={data.current_quarter.mix.best_case.value}
              opps={data.current_quarter.mix.best_case.opps}
              qoq={data.current_quarter.mix.best_case.qoq_change_pct}
            />
            <StatCol
              k="pipeline"
              pct={pct.pipeline}
              value={data.current_quarter.mix.pipeline.value}
              opps={data.current_quarter.mix.pipeline.opps}
              qoq={data.current_quarter.mix.pipeline.qoq_change_pct}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
