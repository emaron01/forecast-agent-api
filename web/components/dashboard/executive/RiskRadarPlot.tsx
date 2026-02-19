"use client";

import { useMemo } from "react";
import { palette } from "../../../lib/palette";

export type RadarDeal = {
  id: string;
  label: string;
  legendLabel?: string;
  color: string;
  meddpicc_tb: Array<{ key: string; score: number | null }>;
};

type SliceKey =
  | "pain"
  | "metrics"
  | "champion"
  | "economic_buyer"
  | "criteria"
  | "process"
  | "paper"
  | "competition"
  | "timing"
  | "budget";

const slices: Array<{ key: SliceKey; label: string }> = [
  { key: "pain", label: "Pain" },
  { key: "metrics", label: "Metrics" },
  { key: "champion", label: "Champion" },
  { key: "economic_buyer", label: "Economic Buyer" },
  { key: "criteria", label: "Criteria" },
  { key: "process", label: "Decision Process" },
  { key: "paper", label: "Paper Process" },
  { key: "competition", label: "Competition" },
  { key: "timing", label: "Timing" },
  { key: "budget", label: "Budget" },
];

function clamp01(n: number) {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function hash01(s: string) {
  // Deterministic pseudo-random 0..1 for stable jitter.
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // unsigned
  const u = h >>> 0;
  return (u % 10000) / 9999;
}

function textAnchorForAngle(rad: number) {
  const c = Math.cos(rad);
  if (c > 0.35) return "start";
  if (c < -0.35) return "end";
  return "middle";
}

export function RiskRadarPlot(props: { deals: RadarDeal[]; size?: number }) {
  const size = Math.max(320, Math.min(760, Number(props.size || 520)));
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.34;
  const r1 = outerR * 0.36;
  const r2 = outerR * 0.66;
  const r3 = outerR * 0.96;
  const labelR = outerR + 26;

  const dots = useMemo(() => {
    const sliceCount = slices.length;
    const sliceSpan = (Math.PI * 2) / sliceCount;
    const start = -Math.PI / 2; // 12 o'clock
    const margin = sliceSpan * 0.12;

    const keyToSlice = new Map<string, { idx: number }>();
    slices.forEach((s, idx) => keyToSlice.set(s.key, { idx }));

    type Entry = {
      sliceIdx: number;
      ringScore: 0 | 1 | 2; // inner best -> outer worst
      dealId: string;
      dealLabel: string;
      color: string;
      keyLabel: string;
      opacity: number;
    };

    const entries: Entry[] = [];

    for (const d of props.deals) {
      for (const c of d.meddpicc_tb || []) {
        const key = String(c.key || "").trim();
        const map = keyToSlice.get(key);
        if (!map) continue;

        const scoreRaw = c.score == null ? null : Math.max(0, Math.min(3, Math.trunc(Number(c.score))));
        if (scoreRaw != null && scoreRaw > 2) continue; // only 0-2 (risk) + unscored

        // Ring semantics:
        // - inner = best of the plotted set
        // - outer = worst
        // For risk plotting (0-2):
        // - score 2 => inner ring
        // - score 1 => middle ring
        // - score 0/unscored => outer ring
        const ringScore: Entry["ringScore"] =
          scoreRaw == null ? 0 : scoreRaw === 2 ? 2 : scoreRaw === 1 ? 1 : 0;

        entries.push({
          sliceIdx: map.idx,
          ringScore,
          dealId: d.id,
          dealLabel: d.label,
          color: d.color,
          keyLabel: key,
          opacity: scoreRaw == null ? 0.42 : 0.95,
        });
      }
    }

    // Group entries by slice+subSlot+ring, then distribute evenly inside ring band.
    const groups = new Map<string, Entry[]>();
    for (const e of entries) {
      const k = `${e.sliceIdx}|${e.ringScore}`;
      const arr = groups.get(k) || [];
      arr.push(e);
      groups.set(k, arr);
    }

    const out: Array<{ x: number; y: number; color: string; opacity: number; title: string }> = [];

    const ringBounds = (ringScore: 0 | 1 | 2) => {
      // r1/r2/r3 are guide circles; use midpoints as band separators.
      const b12 = (r1 + r2) / 2;
      const b23 = (r2 + r3) / 2;
      if (ringScore === 2) return { min: Math.max(outerR * 0.12, 8), max: Math.max(outerR * 0.12, b12 - 3) };
      if (ringScore === 1) return { min: b12 + 3, max: b23 - 3 };
      return { min: b23 + 3, max: outerR - 3 };
    };

    const angleWindow = (sliceIdx: number) => {
      const base0 = start + sliceIdx * sliceSpan;
      const base1 = base0 + sliceSpan;
      return { a0: base0 + margin, a1: base1 - margin };
    };

    for (const [k, arr] of groups.entries()) {
      // Stable order within group for consistent positioning
      arr.sort((a, b) => (a.dealId + "|" + a.keyLabel).localeCompare(b.dealId + "|" + b.keyLabel));

      const [sliceIdxRaw, ringScoreRaw] = k.split("|");
      const sliceIdx = Number(sliceIdxRaw) || 0;
      const ringScore = (Number(ringScoreRaw) as any) as 0 | 1 | 2;

      const { a0, a1 } = angleWindow(sliceIdx);
      const { min: rMin, max: rMax } = ringBounds(ringScore);
      const n = arr.length;

      for (let i = 0; i < n; i++) {
        const e = arr[i];
        const t = (i + 1) / (n + 1);
        const ang = a0 + (a1 - a0) * t;

        const jr = (hash01(`${e.dealId}|${e.keyLabel}|r`) - 0.5) * 0.6; // +/- 30% within band
        const rr = rMin + (rMax - rMin) * clamp01(0.5 + jr);

        out.push({
          x: cx + Math.cos(ang) * rr,
          y: cy + Math.sin(ang) * rr,
          color: e.color,
          opacity: e.opacity,
          title: `${e.dealLabel} · ${e.keyLabel} · ${e.opacity < 0.8 ? "unscored" : `score ${e.ringScore}`}`,
        });
      }
    }

    return out;
  }, [props.deals, cx, cy, outerR, r1, r2, r3]);

  const sliceLines = useMemo(() => {
    const out: Array<{ x2: number; y2: number }> = [];
    const sliceCount = slices.length;
    const sliceSpan = (Math.PI * 2) / sliceCount;
    const start = -Math.PI / 2;
    for (let i = 0; i < sliceCount; i++) {
      const a = start + i * sliceSpan;
      out.push({ x2: cx + Math.cos(a) * outerR, y2: cy + Math.sin(a) * outerR });
    }
    return out;
  }, [cx, cy, outerR]);

  const labels = useMemo(() => {
    const out: Array<{ x: number; y: number; text: string; anchor: "start" | "middle" | "end" }> = [];
    const sliceCount = slices.length;
    const sliceSpan = (Math.PI * 2) / sliceCount;
    const start = -Math.PI / 2;
    for (let i = 0; i < sliceCount; i++) {
      const mid = start + (i + 0.5) * sliceSpan;
      out.push({
        x: cx + Math.cos(mid) * labelR,
        y: cy + Math.sin(mid) * labelR,
        text: slices[i].label,
        anchor: textAnchorForAngle(mid) as any,
      });
    }
    return out;
  }, [cx, cy, labelR]);

  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">AI Risk Radar</div>
          <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">
            <div>Opportunities with MEDDPICC+TB risk are represented on the radar. Outer ring = lowest score / highest category risk.</div>
            <div>AI Risk Radar coloring: center ring green · middle ring yellow · outer ring red.</div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]">
        <div className="flex items-center justify-center">
          <div className="aspect-square" style={{ width: size, maxWidth: "100%" }}>
            <svg className="h-full w-full" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="MEDDPICC+TB radar">
              <defs>
                <style>{`
                  @keyframes radarPulse {
                    0%, 100% { opacity: 0; }
                    6% { opacity: 0.85; }
                    16% { opacity: 0; }
                  }
                  .radarPulse1 { animation: radarPulse 7s ease-in-out infinite; }
                  .radarPulse2 { animation: radarPulse 7s ease-in-out infinite; animation-delay: 0.55s; }
                  .radarPulse3 { animation: radarPulse 7s ease-in-out infinite; animation-delay: 1.1s; }
                  @media (prefers-reduced-motion: reduce) {
                    .radarPulse1, .radarPulse2, .radarPulse3 { animation: none; opacity: 0; }
                  }
                `}</style>
              </defs>

            <circle cx={cx} cy={cy} r={outerR} fill={palette.surfaceAlt} stroke={palette.border} strokeWidth={2} />
            <circle cx={cx} cy={cy} r={r1} fill="none" stroke="#2ECC71" strokeWidth={1.15} opacity={0.95} />
            <circle cx={cx} cy={cy} r={r2} fill="none" stroke="#F1C40F" strokeWidth={1.15} opacity={0.92} />
            <circle cx={cx} cy={cy} r={r3} fill="none" stroke="#E74C3C" strokeWidth={1.35} opacity={0.95} />

            {/* Aesthetic "radar" pulse overlay (center → out). */}
            <circle cx={cx} cy={cy} r={r1} fill="none" stroke={palette.accentSecondary} strokeWidth={1.8} opacity={0} className="radarPulse1" />
            <circle cx={cx} cy={cy} r={r2} fill="none" stroke={palette.accentSecondary} strokeWidth={1.8} opacity={0} className="radarPulse2" />
            <circle cx={cx} cy={cy} r={r3} fill="none" stroke={palette.accentSecondary} strokeWidth={2.0} opacity={0} className="radarPulse3" />

            {sliceLines.map((l, idx) => (
              <line key={idx} x1={cx} y1={cy} x2={l.x2} y2={l.y2} stroke={palette.border} strokeWidth={1} opacity={0.7} />
            ))}

            {labels.map((t) => (
              <text
                key={t.text}
                x={t.x}
                y={t.y}
                textAnchor={t.anchor}
                dominantBaseline="middle"
                fontSize="12"
                fontWeight="600"
                fill={palette.textPrimary}
                opacity={0.95}
              >
                {t.text}
              </text>
            ))}

            {dots.map((d, idx) => (
              <g key={idx}>
                <title>{d.title}</title>
                <circle cx={d.x} cy={d.y} r={4.2} fill={d.color} opacity={d.opacity} stroke={palette.surface} strokeWidth={1} />
              </g>
            ))}
            </svg>
          </div>
        </div>

        <div className="self-start rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Accounts</div>
          <div className="mt-3 grid grid-cols-1 gap-x-3 gap-y-2 text-sm text-[color:var(--sf-text-primary)] sm:grid-cols-2">
            {props.deals.length ? (
              props.deals.map((d) => (
                <div key={d.id} className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full border border-[color:var(--sf-border)]" style={{ background: d.color }} aria-hidden="true" />
                  <span className="min-w-0 truncate" title={String(d.legendLabel || d.label)}>
                    {String(d.legendLabel || d.label)}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-[color:var(--sf-text-secondary)]">No at-risk deals in the current view.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

