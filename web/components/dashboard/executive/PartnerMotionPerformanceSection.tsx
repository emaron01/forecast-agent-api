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

function fmtPct01(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function perfColor(value: number | null): string {
  if (value == null) return "text-[color:var(--sf-text-primary)]";
  if (value >= 0.8) return "text-green-400";
  if (value >= 0.5) return "text-yellow-400";
  return "text-red-400";
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

function highlightAmong3(value: number | null, a: number | null, b: number | null, c: number | null) {
  if (value == null) return "";
  const xs = [a, b, c].filter((x): x is number => x != null && Number.isFinite(x));
  if (xs.length < 2) return "";
  const max = Math.max(...xs);
  const min = Math.min(...xs);
  const denom = Math.max(Math.abs(max), Math.abs(min));
  if (denom <= 0) return "";
  if (Math.abs(max - min) / denom <= 0.05) return "";
  if (value === max) return "text-[#16A34A]";
  if (value === min) return "text-[#E74C3C]";
  return "";
}

/** Lower is better (e.g. cycle days): best (min) = green, worst (max) = red. */
function highlightAmong3LowerBetter(value: number | null, a: number | null, b: number | null, c: number | null) {
  return highlightAmong3(value == null ? null : -value, a == null ? null : -a, b == null ? null : -b, c == null ? null : -c);
}

function fmtAgeDaysCell(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)} days`;
}

function fmtAgeDeltaDays(d: number | null) {
  if (d == null || !Number.isFinite(d)) return "—";
  const r = Math.round(Math.abs(d));
  if (d > 0) return `+${r} days`;
  if (d < 0) return `-${r} days`;
  return "0 days";
}

function ComparisonBlock(props: {
  title: string;
  directWin: number | null;
  otherWin: number | null;
  directHealth01: number | null;
  otherHealth01: number | null;
  directAvgAgeDays: number | null;
  otherAvgAgeDays: number | null;
  directRev: number | null;
  otherRev: number | null;
  directMix: number | null;
  otherMix: number | null;
  className?: string;
}) {
  const deltaTone = (d: number | null) =>
    d == null || !Number.isFinite(d)
      ? "text-[color:var(--sf-text-disabled)]"
      : d > 0
        ? "text-[#16A34A]"
        : d < 0
          ? "text-[#E74C3C]"
          : "text-[color:var(--sf-text-primary)]";
  /** other − direct; positive = partner slower (worse) → red */
  const deltaAgeTone = (d: number | null) =>
    d == null || !Number.isFinite(d)
      ? "text-[color:var(--sf-text-disabled)]"
      : d > 0
        ? "text-[#E74C3C]"
        : d < 0
          ? "text-[#16A34A]"
          : "text-[color:var(--sf-text-primary)]";
  const fmtPp = (d01: number | null) => {
    if (d01 == null || !Number.isFinite(d01)) return "—";
    const pp = d01 * 100;
    const abs = Math.abs(pp);
    const txt = `${Math.round(abs)}pp`;
    return `${pp > 0 ? "+" : pp < 0 ? "-" : ""}${txt}`;
  };
  const fmtMoneyKSigned = (d: number | null) => {
    if (d == null || !Number.isFinite(d)) return "—";
    const k = Math.round(Math.abs(d) / 1000);
    const txt = `$${k.toLocaleString("en-US")}K`;
    return `${d > 0 ? "+" : d < 0 ? "-" : ""}${txt}`;
  };
  const dWin = props.directWin == null || props.otherWin == null ? null : props.otherWin - props.directWin;
  const dHealth = props.directHealth01 == null || props.otherHealth01 == null ? null : props.otherHealth01 - props.directHealth01;
  const dAge =
    props.directAvgAgeDays == null || props.otherAvgAgeDays == null ? null : props.otherAvgAgeDays - props.directAvgAgeDays;
  const dRev = props.directRev == null || props.otherRev == null ? null : props.otherRev - props.directRev;
  const dMix = props.directMix == null || props.otherMix == null ? null : props.otherMix - props.directMix;

  const inner = (
    <div className="mt-3 grid gap-2 text-[11px] text-[color:var(--sf-text-secondary)]">
      <div className="grid grid-cols-[1fr_auto] items-center gap-4">
        <span>Win Rate</span>
        <span className={["font-mono text-xs font-semibold", deltaTone(dWin)].join(" ")}>{fmtPp(dWin)}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-4">
        <span>Avg Health</span>
        <span className={["font-mono text-xs font-semibold", deltaTone(dHealth)].join(" ")}>{fmtPp(dHealth)}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-4">
        <span>Avg Age</span>
        <span className={["font-mono text-xs font-semibold", deltaAgeTone(dAge)].join(" ")}>{fmtAgeDeltaDays(dAge)}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-4">
        <span>Revenue</span>
        <span className={["font-mono text-xs font-semibold", deltaTone(dRev)].join(" ")}>{fmtMoneyKSigned(dRev)}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-4">
        <span>Mix</span>
        <span className={["font-mono text-xs font-semibold", deltaTone(dMix)].join(" ")}>{fmtPp(dMix)}</span>
      </div>
    </div>
  );

  return (
    <div className={props.className}>
      <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{props.title}</div>
      {inner}
    </div>
  );
}

export function PartnerMotionPerformanceSection(props: {
  engine: PartnerMotionDecisionEngine;
  /** Card shell for each motion metric column */
  motionCardClass: string;
  /** Title + motion grid wrapper */
  outerClass: string;
  /** Grid for the three motion columns */
  motionGridClass: string;
  /** Row: two comparison blocks */
  comparisonRowClass: string;
  comparisonCardClass: string;
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

  const rows = [
    { k: "Direct", win: directWin, health: directHealth01, ageDays: directAge, rev: directRev, mix: directMix },
    { k: "Partner Influenced", win: infWin, health: infHealth01, ageDays: infAge, rev: infRev, mix: infMix },
    { k: "Partner Sourced", win: srcWin, health: srcHealth01, ageDays: srcAge, rev: srcRev, mix: srcMix },
  ] as const;

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

  return (
    <div className={props.outerClass}>
      <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Motion Performance Snapshot</div>
      <div className={props.motionGridClass}>
        {rows.map((row) => (
          <div key={row.k} className={props.motionCardClass}>
            <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{row.k}</div>
            <div className="mt-3 text-[11px] text-[color:var(--sf-text-secondary)]">
              <div className="flex items-center justify-between gap-2 mt-1">
                <span>Win Rate</span>
                <span
                  className={[
                    "font-mono text-xs font-semibold",
                    perfColor(row.win),
                  ].join(" ")}
                >
                  {row.win == null ? "—" : fmtPct01(row.win)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-1">
                <span>Avg Health</span>
                <span
                  className={[
                    "font-mono text-xs font-semibold",
                    perfColor(row.health),
                  ].join(" ")}
                >
                  {row.health == null ? "—" : `${Math.round(row.health * 100)}%`}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-1">
                <span>Avg Age</span>
                <span
                  className={[
                    "font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]",
                    highlightAmong3LowerBetter(row.ageDays, directAge, infAge, srcAge),
                  ].join(" ")}
                >
                  {fmtAgeDaysCell(row.ageDays)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-1">
                <span>Revenue</span>
                <span
                  className={[
                    "font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]",
                    highlightAmong3(row.rev, directRev, infRev, srcRev),
                  ].join(" ")}
                >
                  {fmtMoneyK(row.rev)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-1">
                <span>Mix</span>
                <span
                  className={[
                    "font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]",
                    highlightAmong3(row.mix, directMix, infMix, srcMix),
                  ].join(" ")}
                >
                  {row.mix == null ? "—" : fmtPct01(row.mix)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className={props.comparisonRowClass}>
        <div className={props.comparisonCardClass}>
          <ComparisonBlock
            title="Partner Sourced vs Direct"
            directWin={directWin}
            otherWin={srcWin}
            directHealth01={directHealth01}
            otherHealth01={srcHealth01}
            directAvgAgeDays={directAge}
            otherAvgAgeDays={srcAge}
            directRev={directRev}
            otherRev={srcRev}
            directMix={directMix}
            otherMix={srcMix}
          />
        </div>
        <div className={props.comparisonCardClass}>
          <ComparisonBlock
            title="Influenced vs Direct"
            directWin={directWin}
            otherWin={infWin}
            directHealth01={directHealth01}
            otherHealth01={infHealth01}
            directAvgAgeDays={directAge}
            otherAvgAgeDays={infAge}
            directRev={directRev}
            otherRev={infRev}
            directMix={directMix}
            otherMix={infMix}
          />
        </div>
      </div>

      <div className={props.ceiRowClass}>
        <div className={props.ceiCardClass}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">CEI – Direct</div>
          <div className="mt-2 font-mono text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtCEIDisplay(e.cei.direct_raw)}</div>
          <div className="mt-2 text-[11px] text-[color:var(--sf-text-secondary)]">
            Based on {directWonDeals.toLocaleString("en-US")} direct closed-won deal(s).
          </div>
        </div>

        <div className={props.ceiCardClass}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">CEI – Partner Sourced Only</div>
          <div className="mt-2 font-mono text-lg font-semibold text-[color:var(--sf-text-primary)]">{fmtCEIDisplay(e.cei.sourced_raw)}</div>
          <div className="mt-2 text-[11px] text-[color:var(--sf-text-secondary)]">
            Based on {sourcedWon.toLocaleString("en-US")} partner sourced closed-won deal(s).
          </div>
        </div>

        <div className={props.ratioCardClass}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Partner Sourced CEI / Direct CEI</div>
          <div className="mt-2 text-sm text-[color:var(--sf-text-primary)]">
            <div className="font-mono text-base font-semibold">
              {ceiCurN == null ? "—" : `${Math.round(ceiCurN).toLocaleString("en-US")}%`}{" "}
              <span className="text-[11px] font-normal text-[color:var(--sf-text-secondary)]">(Direct = 100)</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[color:var(--sf-text-secondary)]">CEI Status</span>
              <span className={["inline-flex min-w-[110px] items-center justify-center rounded-full border px-3 py-1 text-[11px] font-semibold", pillToneClass(status.tone)].join(" ")}>
                {status.label}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[color:var(--sf-text-secondary)]">Confidence</span>
              <span className="font-mono font-semibold">{confBand}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[color:var(--sf-text-secondary)]">Trend</span>
              <span
                className={[
                  "flex items-center gap-1 font-mono font-semibold",
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
