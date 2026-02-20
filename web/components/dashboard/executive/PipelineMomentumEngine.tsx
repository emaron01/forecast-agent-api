"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  coverageRatio,
  coverageTone,
  fmtCoverageRatio,
  fmtMoney,
  fmtSignedPct,
  fmtSignedPct01,
  mixPct01,
  qoqChangePct01,
  trendToneFromPct01,
  type ForecastMixKey,
  type PipelineMomentumData,
} from "../../../lib/pipelineMomentum";
import { PipelineMomentumAiTakeawayClient } from "./PipelineMomentumAiTakeawayClient";

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
  const glyph = t === "up" ? "↑" : t === "down" ? "↓" : "•";
  return { cls, glyph };
}

function deltaInline(p01: number | null) {
  const { cls, glyph } = trendBadge(p01);
  const txt = fmtSignedPct01(p01, { digits: 0 });
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs font-semibold ${cls}`}>
      <span className="text-sm leading-none" aria-hidden="true">
        {glyph}
      </span>
      <span>{txt}</span>
    </span>
  );
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

function KpiCard(props: { label: string; value: string; sub?: ReactNode; rightPill?: { text: string; tone: "good" | "warn" | "bad" | "muted" } }) {
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
          <div className="mt-2 truncate font-mono text-2xl font-extrabold tracking-tight text-[color:var(--sf-text-primary)] sm:text-3xl">{props.value}</div>
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

function fmtDays(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = Math.round(n);
  return `${v.toLocaleString()} day${v === 1 ? "" : "s"}`;
}

function fmtPct01Plain(p01: number | null) {
  if (p01 == null || !Number.isFinite(p01)) return "—";
  return `${Math.round(p01 * 100)}%`;
}

function healthTone(pct: number | null) {
  const p = pct == null ? null : Number(pct);
  if (p == null || !Number.isFinite(p)) return "muted" as const;
  if (p >= 75) return "good" as const;
  if (p >= 50) return "warn" as const;
  return "bad" as const;
}

function healthPill(pct: number | null) {
  const tone = healthTone(pct);
  const cls =
    tone === "good"
      ? "border-[#2ECC71]/40 bg-[#2ECC71]/10 text-[#2ECC71]"
      : tone === "warn"
        ? "border-[#F1C40F]/50 bg-[#F1C40F]/10 text-[#F1C40F]"
        : tone === "bad"
          ? "border-[#E74C3C]/50 bg-[#E74C3C]/10 text-[#E74C3C]"
          : "border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] text-[color:var(--sf-text-secondary)]";
  const text = pct == null || !Number.isFinite(Number(pct)) ? "Health —" : `Health ${Math.round(Number(pct))}%`;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{text}</span>;
}

export function PipelineMomentumEngine(props: { data: PipelineMomentumData | null; quotaPeriodId?: string; className?: string }) {
  const data = props.data;
  const [showDebug, setShowDebug] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugJson, setDebugJson] = useState<any>(null);
  const [debugError, setDebugError] = useState<string>("");

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      setShowDebug(sp.get("debug") === "1");
    } catch {
      setShowDebug(false);
    }
  }, []);

  async function loadDebug() {
    const qp = String(props.quotaPeriodId || "").trim();
    if (!qp) return;
    setDebugLoading(true);
    setDebugError("");
    try {
      const r = await fetch(`/api/debug/pipeline-momentum?quota_period_id=${encodeURIComponent(qp)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setDebugJson(j || null);
        setDebugError(String(j?.error || `Request failed (${r.status})`));
      } else {
        setDebugJson(j);
      }
    } catch (e: any) {
      setDebugError(String(e?.message || e));
      setDebugJson(null);
    } finally {
      setDebugLoading(false);
    }
  }

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
  const { glyph: velGlyph } = trendBadge(totalQoq);

  const predictive = data.predictive || null;
  const created = predictive?.created_pipeline || null;

  const keys: ForecastMixKey[] = ["commit", "best_case", "pipeline"];
  const pct = {
    commit: mixPct01(data, "commit"),
    best_case: mixPct01(data, "best_case"),
    pipeline: mixPct01(data, "pipeline"),
  };

  const covPill =
    covTone === "bad"
      ? { text: "Danger (below 3x)", tone: "bad" as const }
      : covTone === "warn"
        ? { text: "Covered (3–3.4)", tone: "warn" as const }
        : covTone === "good"
          ? { text: "Solid (≥ 3.5)", tone: "good" as const }
          : null;

  return (
    <section className={["grid gap-4", props.className || ""].join(" ")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Pipeline Momentum</div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Pipeline predicts the future: coverage, velocity, mix, and the next-quarter creation engine.</div>
        </div>
        {showDebug && props.quotaPeriodId ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDebugOpen(true);
                void loadDebug();
              }}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]"
            >
              Debug data
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <KpiCard label="Total Pipeline" value={fmtMoney(totalPipeline)} sub={`${totalOpps} opps · current quarter`} />
        <KpiCard
          label="Coverage Ratio"
          value={covText}
          sub={`Quota Target To GO: ${fmtMoney(data.quota_target)} · (Quota − Closed Won)`}
          rightPill={covPill || undefined}
        />
        <KpiCard
          label="Previous Quarter velocity"
          value={fmtSignedPct01(totalQoq, { digits: 0 })}
          sub={
            data.previous_quarter.total_pipeline == null
              ? "Previous quarter unavailable"
              : `Pipeline (${fmtMoney(data.previous_quarter.total_pipeline)} → ${fmtMoney(data.current_quarter.total_pipeline)})`
          }
          rightPill={{ text: `${velGlyph} momentum`, tone: totalQoq != null && totalQoq < 0 ? "bad" : totalQoq != null && totalQoq > 0 ? "good" : "muted" }}
        />
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

      {created ? (
        <div className="rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Pipeline Created This Quarter (predicts next quarter)</div>
              <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">New opps created in-quarter that are still active (not closed in the quarter).</div>
            </div>
            <div className="text-xs text-[color:var(--sf-text-secondary)]">
              As-of velocity vs <span className="font-semibold text-[color:var(--sf-text-primary)]">Previous Quarter</span>{" "}
              <span className="ml-2">{deltaInline(created.qoq_total_amount_pct01)}</span>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <KpiCard
              label="Created pipeline (value)"
              value={fmtMoney(created.current.total_amount)}
              sub={
                created.previous.total_amount == null
                  ? "Previous quarter unavailable"
                  : (
                      <span className="flex flex-wrap items-center gap-2">
                        <span>Prev {fmtMoney(created.previous.total_amount)}</span>
                        <span className="text-[color:var(--sf-text-secondary)]">·</span>
                        <span className="font-semibold text-[color:var(--sf-text-secondary)]">Previous Quarter</span>
                        {deltaInline(created.qoq_total_amount_pct01)}
                      </span>
                    )
              }
            />
            <KpiCard
              label="Created pipeline (# opps)"
              value={String(created.current.total_opps || 0)}
              sub={
                created.previous.total_opps == null
                  ? "Previous quarter unavailable"
                  : (
                      <span className="flex flex-wrap items-center gap-2">
                        <span>Prev {String(created.previous.total_opps || 0)}</span>
                        <span className="text-[color:var(--sf-text-secondary)]">·</span>
                        <span className="font-semibold text-[color:var(--sf-text-secondary)]">Previous Quarter</span>
                        {deltaInline(created.qoq_total_opps_pct01)}
                      </span>
                    )
              }
            />
            <KpiCard
              label="Avg age of created opps"
              value={fmtDays(predictive?.cycle_mix_created_pipeline?.avg_age_days ?? null)}
              sub="Cycle mix is a leading indicator of future close timing."
            />
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {(["commit", "best_case", "pipeline"] as const).map((k) => {
              const m = created.current.mix[k];
              return (
                <div key={k} className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">{mixLabel(k)}</div>
                  <div className="mt-1 text-sm text-[color:var(--sf-text-primary)]">
                    <span className="font-mono font-semibold">{fmtMoney(m.value)}</span>{" "}
                    <span className="text-[color:var(--sf-text-secondary)]">· {m.opps} opps</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {healthPill(m.health_pct)}
                    <span className="text-xs text-[color:var(--sf-text-secondary)]">
                      Avg health: {m.health_pct == null ? "—" : `${Math.round(m.health_pct)}%`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {predictive?.products_created_pipeline_top?.length ? (
            <div className="mt-5 overflow-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
              <table className="min-w-[920px] w-full table-auto border-collapse text-sm">
                <thead className="bg-[color:var(--sf-surface)] text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="px-4 py-3 text-left">product</th>
                    <th className="px-4 py-3 text-right">created pipeline</th>
                    <th className="px-4 py-3 text-right"># opps</th>
                    <th className="px-4 py-3 text-right">avg health</th>
                    <th className="px-4 py-3 text-right">Previous Quarter</th>
                  </tr>
                </thead>
                <tbody className="text-[color:var(--sf-text-primary)]">
                  {predictive.products_created_pipeline_top.map((r) => (
                    <tr key={r.product} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-4 py-3 font-semibold">{r.product}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(r.amount)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{String(r.opps)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{r.avg_health_pct == null ? "—" : `${r.avg_health_pct}%`}</td>
                      <td className="px-4 py-3 text-right">{deltaInline(r.qoq_amount_pct01)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {predictive?.cycle_mix_created_pipeline?.bands?.length ? (
            <div className="mt-4 grid gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Cycle-length mix (created opps)</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {predictive.cycle_mix_created_pipeline.bands.map((b) => (
                  <div key={b.band} className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4 shadow-sm">
                    <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{b.band} days</div>
                    <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                      <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{String(b.opps)}</span> opps ·{" "}
                      <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney(b.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {predictive?.partners_showing_promise?.length ? (
            <div className="mt-5 grid gap-2">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Partners showing promise to shorten cycles</div>
                  <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
                    Baseline (Direct): {fmtDays(predictive.direct_baseline.avg_days)} · close rate {fmtPct01Plain(predictive.direct_baseline.win_rate)}
                  </div>
                </div>
              </div>
              <div className="overflow-auto rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                <table className="min-w-[980px] w-full table-auto border-collapse text-sm">
                  <thead className="bg-[color:var(--sf-surface)] text-[color:var(--sf-text-secondary)]">
                    <tr>
                      <th className="px-4 py-3 text-left">partner</th>
                      <th className="px-4 py-3 text-right"># closed opps</th>
                      <th className="px-4 py-3 text-right">close rate</th>
                      <th className="px-4 py-3 text-right">avg days</th>
                      <th className="px-4 py-3 text-right">Δ days vs direct</th>
                      <th className="px-4 py-3 text-right">AOV</th>
                      <th className="px-4 py-3 text-right">closed-won</th>
                    </tr>
                  </thead>
                  <tbody className="text-[color:var(--sf-text-primary)]">
                    {predictive.partners_showing_promise.map((p) => (
                      <tr key={p.partner_name} className="border-t border-[color:var(--sf-border)]">
                        <td className="px-4 py-3 font-semibold">{p.partner_name}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{String(p.closed_opps)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtPct01Plain(p.win_rate)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtDays(p.avg_days)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {p.delta_days_vs_direct == null ? "—" : `${p.delta_days_vs_direct > 0 ? "+" : ""}${Math.round(p.delta_days_vs_direct)}`
                          }
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{p.aov == null ? "—" : fmtMoney(p.aov)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtMoney(p.won_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <PipelineMomentumAiTakeawayClient
        payload={{
          quota_period_id: props.quotaPeriodId || null,
          quota_target: data.quota_target,
          open_pipeline: data.current_quarter,
          open_pipeline_previous: data.previous_quarter,
          predictive: data.predictive || null,
        }}
      />

      {debugOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/60 p-4">
          <div className="w-full max-w-4xl rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--sf-border)] px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[color:var(--sf-text-primary)]">Pipeline Momentum Debug</div>
                <div className="mt-0.5 text-xs text-[color:var(--sf-text-secondary)]">quota_period_id: {String(props.quotaPeriodId || "—")}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadDebug()}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]/70"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setDebugOpen(false)}
                  className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-xs font-semibold text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)]"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="px-4 py-3">
              {debugLoading ? <div className="text-sm text-[color:var(--sf-text-secondary)]">Loading…</div> : null}
              {debugError ? <div className="mt-2 text-sm font-semibold text-[#E74C3C]">{debugError}</div> : null}
              <pre className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3 text-xs text-[color:var(--sf-text-primary)]">
                {debugJson ? JSON.stringify(debugJson, null, 2) : "{}"}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
