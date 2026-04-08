"use client";

import type { ReactNode } from "react";

export type PartnerMotionPillar = {
  opps: number;
  won_opps: number;
  lost_opps: number;
  win_rate: number | null;
  aov: number | null;
  avg_days: number | null;
  /** Closed-won only: avg days create → close (motion snapshot). */
  avg_won_days: number | null;
  avg_health_score: number | null;
  won_amount: number;
  lost_amount: number;
  open_pipeline: number;
};

export type PartnerMotionDecisionEngine = {
  direct: PartnerMotionPillar;
  partner_influenced: PartnerMotionPillar;
  partner_sourced: PartnerMotionPillar;
  directMix: number | null;
  partnerInfluencedMix: number | null;
  partnerSourcedMix: number | null;
  cei: {
    direct_raw: number;
    sourced_raw: number;
    partner_sourced_index: number | null;
  };
  cei_prev_partner_sourced_index: number | null;
};

const COLOR_DIRECT = "#378ADD";
const COLOR_INFLUENCED = "#1D9E75";
const COLOR_SOURCED = "#7F77DD";

function fmtPct01(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function clamp01(v: number) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function normalize(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0.5;
  if (max === min) return 0.5;
  return clamp01((value - min) / (max - min));
}

function clampScore100(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 100) return 100;
  return v;
}

function pillToneClass(tone: "good" | "warn" | "bad" | "muted") {
  if (tone === "good") return "border-[#16A34A]/35 bg-[#16A34A]/10 text-[#16A34A]";
  if (tone === "warn") return "border-[#F1C40F]/50 bg-[#F1C40F]/12 text-[#F1C40F]";
  if (tone === "bad") return "border-[#E74C3C]/45 bg-[#E74C3C]/12 text-[#E74C3C]";
  return "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]";
}

function fmtMoneyK(n: number | null) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "—";
  const k = Math.round(v / 1000);
  return `$${k.toLocaleString("en-US")}K`;
}

function fmtCEIDisplay(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000).toLocaleString("en-US")}K`;
  return Math.round(n).toLocaleString("en-US");
}

function fmtAgeDaysCell(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)} days`;
}

/** Max of finite numbers; null if none. */
function maxOf(vals: (number | null)[]): number | null {
  const xs = vals.filter((x): x is number => x != null && Number.isFinite(x));
  if (!xs.length) return null;
  return Math.max(...xs);
}

/** Bar width 0–100; scales each value to the row max (longest bar = largest value). For avg age, larger value = worse — same formula yields shortest bar for best (lowest days). */
function barPctToRowMax(v: number | null, maxVal: number | null): number {
  if (v == null || !Number.isFinite(v) || maxVal == null || maxVal <= 0) return 0;
  return Math.min(100, Math.max(0, (v / maxVal) * 100));
}

function MotionBar(props: { pct: number; fill: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-sm bg-[color:var(--sf-surface-alt)]" aria-hidden>
      <div className="h-2 rounded-sm transition-[width] duration-150" style={{ width: `${props.pct}%`, backgroundColor: props.fill }} />
    </div>
  );
}

function MetricCell(props: { display: string; pct: number; fill: string }) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-1 text-left">
      <div className="font-mono text-[13px] font-semibold leading-snug text-[color:var(--sf-text-primary)]">{props.display}</div>
      <MotionBar pct={props.pct} fill={props.fill} />
    </div>
  );
}

export function PartnerMotionPerformanceSection(props: {
  engine: PartnerMotionDecisionEngine;
  /** Title + snapshot + CEI wrapper */
  outerClass: string;
  /** Row: CEI direct, CEI sourced, ratio/status */
  ceiRowClass: string;
  ceiCardClass: string;
  ratioCardClass: string;
}): ReactNode {
  const { engine: e } = props;
  const direct = e.direct;
  const inf = e.partner_influenced;
  const src = e.partner_sourced;

  const directWin = direct.win_rate == null ? null : Number(direct.win_rate);
  const infWin = inf.win_rate == null ? null : Number(inf.win_rate);
  const srcWin = src.win_rate == null ? null : Number(src.win_rate);

  const directHealth01 = direct.avg_health_score == null ? null : Number(direct.avg_health_score) / 30;
  const infHealth01 = inf.avg_health_score == null ? null : Number(inf.avg_health_score) / 30;
  const srcHealth01 = src.avg_health_score == null ? null : Number(src.avg_health_score) / 30;

  const directRev = Number(direct.won_amount || 0) || 0;
  const infRev = Number(inf.won_amount || 0) || 0;
  const srcRev = Number(src.won_amount || 0) || 0;

  const directAge = direct.avg_won_days == null ? null : Number(direct.avg_won_days);
  const infAge = inf.avg_won_days == null ? null : Number(inf.avg_won_days);
  const srcAge = src.avg_won_days == null ? null : Number(src.avg_won_days);

  const directMix = e.directMix;
  const infMix = e.partnerInfluencedMix;
  const srcMix = e.partnerSourcedMix;

  const wins = [directWin, infWin, srcWin] as const;
  const healths = [directHealth01, infHealth01, srcHealth01] as const;
  const revs = [directRev, infRev, srcRev] as const;
  const mixes = [directMix, infMix, srcMix] as const;
  const ages = [directAge, infAge, srcAge] as const;

  const maxWin = maxOf([...wins]);
  const maxHealth = maxOf([...healths]);
  const maxRev = maxOf([...revs]);
  const maxMix = maxOf(mixes.map((m) => (m == null ? null : Number(m))));
  const maxAge = maxOf([...ages]);

  const ceiCurN = e.cei.partner_sourced_index == null ? null : Number(e.cei.partner_sourced_index);
  const ceiPrevN = e.cei_prev_partner_sourced_index == null ? null : Number(e.cei_prev_partner_sourced_index);
  const delta = ceiCurN != null && ceiPrevN != null ? ceiCurN - ceiPrevN : null;
  const status =
    ceiCurN == null
      ? { label: "—", tone: "muted" as const }
      : ceiCurN >= 120
        ? { label: "HIGH", tone: "good" as const }
        : ceiCurN >= 90
          ? { label: "MEDIUM", tone: "warn" as const }
          : ceiCurN >= 70
            ? { label: "LOW", tone: "bad" as const }
            : { label: "CRITICAL", tone: "bad" as const };

  const sourcedWon = Number(src.won_opps || 0) || 0;
  const directWonDeals = Number(direct.won_opps || 0) || 0;
  const sampleFactor = Math.min(1, sourcedWon / 12);
  const revenueShare = srcMix == null ? 0 : Number(srcMix);
  const revenueFactor = Math.min(1, revenueShare / 0.4);
  const volatilityFactor = delta != null ? 1 - normalize(Math.abs(delta), 0, 100) : 0.6;
  const conf01 = sampleFactor * 0.5 + revenueFactor * 0.3 + volatilityFactor * 0.2;
  const conf = clampScore100(conf01 * 100);
  const confBand = conf >= 75 ? "HIGH CONFIDENCE" : conf >= 50 ? "MODERATE CONFIDENCE" : conf >= 30 ? "LOW CONFIDENCE" : "PRELIMINARY";
  const trend =
    delta == null
      ? { label: "—", arrow: "→", tone: "muted" as const }
      : delta >= 15
        ? { label: "Improving", arrow: "↑", tone: "good" as const }
        : delta <= -15
          ? { label: "Declining", arrow: "↓", tone: "bad" as const }
          : { label: "Stable", arrow: "→", tone: "muted" as const };

  const gridCols = "grid w-full grid-cols-[140px_1fr_1fr_1fr] gap-x-3 gap-y-3";

  return (
    <div className={props.outerClass}>
      <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Motion Performance Snapshot</div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] leading-snug" aria-label="Motion legend">
          <span className="inline-flex items-center gap-2 text-[color:var(--sf-text-secondary)]">
            <span className="h-2 w-4 shrink-0 rounded-sm" style={{ backgroundColor: COLOR_DIRECT }} />
            <span style={{ color: COLOR_DIRECT }}>Direct</span>
          </span>
          <span className="inline-flex items-center gap-2 text-[color:var(--sf-text-secondary)]">
            <span className="h-2 w-4 shrink-0 rounded-sm" style={{ backgroundColor: COLOR_INFLUENCED }} />
            <span style={{ color: COLOR_INFLUENCED }}>Partner influenced</span>
          </span>
          <span className="inline-flex items-center gap-2 text-[color:var(--sf-text-secondary)]">
            <span className="h-2 w-4 shrink-0 rounded-sm" style={{ backgroundColor: COLOR_SOURCED }} />
            <span style={{ color: COLOR_SOURCED }}>Partner sourced</span>
          </span>
        </div>

        <div className="w-full min-w-0" role="table" aria-label="Motion performance by channel">
          <div role="row" className={`${gridCols} border-b border-[color:var(--sf-border)] pb-3`}>
            <div role="columnheader" className="w-[140px] shrink-0" />
            <div role="columnheader" className="min-w-0 text-center text-[13px] font-semibold" style={{ color: COLOR_DIRECT }}>
              Direct
            </div>
            <div role="columnheader" className="min-w-0 text-center text-[13px] font-semibold" style={{ color: COLOR_INFLUENCED }}>
              Partner influenced
            </div>
            <div role="columnheader" className="min-w-0 text-center text-[13px] font-semibold" style={{ color: COLOR_SOURCED }}>
              Partner sourced
            </div>
          </div>

          <div role="row" className={`${gridCols} pt-3`}>
            <div role="rowheader" className="w-[140px] shrink-0 text-left text-[13px] font-medium text-[color:var(--sf-text-secondary)]">
              Win rate
            </div>
            <MetricCell display={directWin == null ? "—" : fmtPct01(directWin)} pct={barPctToRowMax(directWin, maxWin)} fill={COLOR_DIRECT} />
            <MetricCell display={infWin == null ? "—" : fmtPct01(infWin)} pct={barPctToRowMax(infWin, maxWin)} fill={COLOR_INFLUENCED} />
            <MetricCell display={srcWin == null ? "—" : fmtPct01(srcWin)} pct={barPctToRowMax(srcWin, maxWin)} fill={COLOR_SOURCED} />
          </div>

          <div role="row" className={`${gridCols} pt-3`}>
            <div role="rowheader" className="w-[140px] shrink-0 text-left text-[13px] font-medium text-[color:var(--sf-text-secondary)]">
              Avg health
            </div>
            <MetricCell
              display={directHealth01 == null ? "—" : `${Math.round(directHealth01 * 100)}%`}
              pct={barPctToRowMax(directHealth01, maxHealth)}
              fill={COLOR_DIRECT}
            />
            <MetricCell
              display={infHealth01 == null ? "—" : `${Math.round(infHealth01 * 100)}%`}
              pct={barPctToRowMax(infHealth01, maxHealth)}
              fill={COLOR_INFLUENCED}
            />
            <MetricCell
              display={srcHealth01 == null ? "—" : `${Math.round(srcHealth01 * 100)}%`}
              pct={barPctToRowMax(srcHealth01, maxHealth)}
              fill={COLOR_SOURCED}
            />
          </div>

          <div role="row" className={`${gridCols} pt-3`}>
            <div role="rowheader" className="w-[140px] shrink-0 text-left text-[13px] font-medium text-[color:var(--sf-text-secondary)]">
              <div>Avg age</div>
              <div className="mt-0.5 text-[11px] font-normal normal-case leading-snug text-[color:var(--sf-text-disabled)]">Lower is better</div>
            </div>
            <MetricCell display={fmtAgeDaysCell(directAge)} pct={barPctToRowMax(directAge, maxAge)} fill={COLOR_DIRECT} />
            <MetricCell display={fmtAgeDaysCell(infAge)} pct={barPctToRowMax(infAge, maxAge)} fill={COLOR_INFLUENCED} />
            <MetricCell display={fmtAgeDaysCell(srcAge)} pct={barPctToRowMax(srcAge, maxAge)} fill={COLOR_SOURCED} />
          </div>

          <div role="row" className={`${gridCols} pt-3`}>
            <div role="rowheader" className="w-[140px] shrink-0 text-left text-[13px] font-medium text-[color:var(--sf-text-secondary)]">
              Revenue
            </div>
            <MetricCell display={fmtMoneyK(directRev)} pct={barPctToRowMax(directRev, maxRev)} fill={COLOR_DIRECT} />
            <MetricCell display={fmtMoneyK(infRev)} pct={barPctToRowMax(infRev, maxRev)} fill={COLOR_INFLUENCED} />
            <MetricCell display={fmtMoneyK(srcRev)} pct={barPctToRowMax(srcRev, maxRev)} fill={COLOR_SOURCED} />
          </div>

          <div role="row" className={`${gridCols} pt-3`}>
            <div role="rowheader" className="w-[140px] shrink-0 text-left text-[13px] font-medium text-[color:var(--sf-text-secondary)]">
              Mix
            </div>
            <MetricCell display={directMix == null ? "—" : fmtPct01(directMix)} pct={barPctToRowMax(directMix, maxMix)} fill={COLOR_DIRECT} />
            <MetricCell display={infMix == null ? "—" : fmtPct01(infMix)} pct={barPctToRowMax(infMix, maxMix)} fill={COLOR_INFLUENCED} />
            <MetricCell display={srcMix == null ? "—" : fmtPct01(srcMix)} pct={barPctToRowMax(srcMix, maxMix)} fill={COLOR_SOURCED} />
          </div>
        </div>
      </div>

      <div className={props.ceiRowClass}>
        <div className={props.ceiCardClass}>
          <div className="text-[12px] font-semibold uppercase tracking-wide leading-[1.5] text-[color:var(--sf-text-secondary)]">CEI – Direct</div>
          <div className="mt-2 font-mono text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtCEIDisplay(e.cei.direct_raw)}</div>
          <div className="mt-2 text-[12px] leading-[1.5] text-[color:var(--sf-text-secondary)]">
            Based on {directWonDeals.toLocaleString("en-US")} direct closed-won deal(s).
          </div>
        </div>

        <div className={props.ceiCardClass}>
          <div className="text-[12px] font-semibold uppercase tracking-wide leading-[1.5] text-[color:var(--sf-text-secondary)]">CEI – Partner Sourced Only</div>
          <div className="mt-2 font-mono text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtCEIDisplay(e.cei.sourced_raw)}</div>
          <div className="mt-2 text-[12px] leading-[1.5] text-[color:var(--sf-text-secondary)]">
            Based on {sourcedWon.toLocaleString("en-US")} partner sourced closed-won deal(s).
          </div>
        </div>

        <div className={props.ratioCardClass}>
          <div className="text-[12px] font-semibold uppercase tracking-wide leading-[1.5] text-[color:var(--sf-text-secondary)]">Partner Sourced CEI / Direct CEI</div>
          <div className="mt-2 text-[12px] leading-[1.5] text-[color:var(--sf-text-primary)]">
            <div className="font-mono text-base font-semibold leading-[1.5]">
              {ceiCurN == null ? "—" : `${Math.round(ceiCurN).toLocaleString("en-US")}%`}{" "}
              <span className="text-[12px] font-normal leading-[1.5] text-[color:var(--sf-text-secondary)]">(Direct = 100)</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[color:var(--sf-text-secondary)]">CEI Status</span>
              <span className={["inline-flex min-w-[110px] items-center justify-center rounded-full border px-3 py-1 text-[12px] font-semibold leading-[1.5]", pillToneClass(status.tone)].join(" ")}>
                {status.label}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[color:var(--sf-text-secondary)]">Confidence</span>
              <span className="font-mono text-[12px] font-semibold leading-[1.5]">{confBand}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[color:var(--sf-text-secondary)]">Trend</span>
              <span
                className={[
                  "flex items-center gap-1 font-mono text-[12px] font-semibold leading-[1.5]",
                  trend.tone === "good" ? "text-[#16A34A]" : trend.tone === "bad" ? "text-[#E74C3C]" : "text-[color:var(--sf-text-secondary)]",
                ].join(" ")}
              >
                <span aria-hidden="true">{trend.arrow}</span>
                <span>{trend.label}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
