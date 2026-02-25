"use client";

import { useEffect, useState } from "react";

type ReadinessSummary = {
  gate_set_completeness_pct: number;
  verified_evidence_rate_pct: number;
  training_snapshot_ready_pct: number;
  top_coverage_gaps: Array<{ category: string; gap_pct: number }>;
};

type ApiResponse =
  | { ok: true; readiness_summary: ReadinessSummary }
  | { ok: false; error: string };

const cardClass =
  "rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm";
const labelClass = "text-cardLabel uppercase text-[color:var(--sf-text-secondary)]";
const valClass = "mt-2 text-kpiValue text-[color:var(--sf-text-primary)]";

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

function categoryDisplayName(cat: string): string {
  const map: Record<string, string> = {
    pain: "Pain",
    metrics: "Metrics",
    champion: "Champion",
    eb: "Economic Buyer",
    criteria: "Criteria",
    process: "Process",
    competition: "Competition",
    paper: "Paper",
    timing: "Timing",
    budget: "Budget",
  };
  return map[cat] || cat;
}

export function DataReadinessCard(props: {
  quotaPeriodId: string;
  repIds?: number[] | null;
  snapshotOffsetDays?: number;
  isAdmin?: boolean;
}) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const apiUrl = `/api/analytics/training-readiness?quotaPeriodId=${encodeURIComponent(props.quotaPeriodId || "")}${
    props.repIds?.length ? `&repIds=${props.repIds.join(",")}` : ""
  }${props.snapshotOffsetDays != null ? `&snapshot_offset_days=${props.snapshotOffsetDays}` : ""}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(apiUrl)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setData(j as ApiResponse);
      })
      .catch((e) => {
        if (!cancelled) setData({ ok: false, error: String(e?.message || e) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  if (loading) {
    return (
      <div className={cardClass}>
        <div className={labelClass}>Data Readiness</div>
        <div className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">Loading…</div>
      </div>
    );
  }

  const ok = data && (data as any).ok === true;
  const summary = ok ? (data as any).readiness_summary as ReadinessSummary : null;
  const fullPayload = ok && props.isAdmin ? data as any : null;

  if (!ok || !summary) {
    return (
      <div className={cardClass}>
        <div className={labelClass}>Data Readiness</div>
        <div className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">
          {(data as any)?.error || "Unable to load"}
        </div>
      </div>
    );
  }

  const topGaps = summary.top_coverage_gaps?.slice(0, 3) || [];

  return (
    <div className={cardClass}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className={labelClass}>Data Readiness</div>
          <div
            className="mt-1 cursor-help text-[10px] text-[color:var(--sf-text-secondary)]"
            title="Forecast credibility improves as MEDDPICC evidence coverage increases."
          >
            Forecast credibility improves as MEDDPICC evidence coverage increases.
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
            Gate-set completeness
          </div>
          <div className={valClass}>{fmtPct(summary.gate_set_completeness_pct)}</div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
            Verified evidence rate
          </div>
          <div className={valClass}>{fmtPct(summary.verified_evidence_rate_pct)}</div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
            Training snapshot readiness
          </div>
          <div className={valClass}>{fmtPct(summary.training_snapshot_ready_pct)}</div>
        </div>
      </div>

      {topGaps.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
            Top coverage gaps
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {topGaps.map((g) => (
              <span
                key={g.category}
                className="rounded border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-0.5 text-xs text-[color:var(--sf-text-primary)]"
              >
                {categoryDisplayName(g.category)} ({fmtPct(g.gap_pct)} gap)
              </span>
            ))}
          </div>
        </div>
      )}

      {props.isAdmin && fullPayload && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium text-[color:var(--sf-accent-primary)] hover:underline"
          >
            {expanded ? "Hide diagnostics" : "Show diagnostics"}
          </button>
          {expanded && (
            <div className="mt-3 space-y-4 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3 text-xs">
              {fullPayload.coverage_by_category && (
                <div>
                  <div className="font-semibold text-[color:var(--sf-text-primary)]">Category coverage</div>
                  <div className="mt-2 overflow-x-auto">
                    <table className="min-w-full table-auto border-collapse">
                      <thead>
                        <tr className="border-b border-[color:var(--sf-border)]">
                          <th className="px-2 py-1 text-left">Category</th>
                          <th className="px-2 py-1 text-right">Score %</th>
                          <th className="px-2 py-1 text-right">Confidence %</th>
                          <th className="px-2 py-1 text-right">Evidence %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.values(fullPayload.coverage_by_category).map((c: any) => (
                          <tr key={c.category} className="border-b border-[color:var(--sf-border)]/50">
                            <td className="px-2 py-1">{categoryDisplayName(c.category)}</td>
                            <td className="px-2 py-1 text-right">{fmtPct(c.score_present_pct)}</td>
                            <td className="px-2 py-1 text-right">{fmtPct(c.confidence_present_pct)}</td>
                            <td className="px-2 py-1 text-right">{fmtPct(c.evidence_strength_present_pct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {fullPayload.leakage_diagnostics && (
                <div>
                  <div className="font-semibold text-[color:var(--sf-text-primary)]">Leakage diagnostics</div>
                  <div className="mt-1 text-[color:var(--sf-text-secondary)]">
                    Violations: {fullPayload.leakage_diagnostics.leakage_violations_count ?? 0}
                  </div>
                </div>
              )}
              {fullPayload.training_snapshot_details && (
                <div>
                  <div className="font-semibold text-[color:var(--sf-text-primary)]">Snapshot completeness</div>
                  <div className="mt-1 text-[color:var(--sf-text-secondary)]">
                    Labeled closed: {fullPayload.training_snapshot_details.labeled_closed_total ?? 0} • With
                    usable snapshot: {fullPayload.training_snapshot_details.with_usable_snapshot_count ?? 0} • Anti-leakage
                    OK: {fullPayload.training_snapshot_details.anti_leakage_ok_count ?? 0}
                  </div>
                </div>
              )}
              {fullPayload.missing_feature_breakdown && Object.keys(fullPayload.missing_feature_breakdown).length > 0 && (
                <div>
                  <div className="font-semibold text-[color:var(--sf-text-primary)]">Missing feature breakdown</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(fullPayload.missing_feature_breakdown).map(([cat, m]: [string, any]) => (
                      <span
                        key={cat}
                        className="rounded border border-[color:var(--sf-border)] px-2 py-0.5 text-[color:var(--sf-text-secondary)]"
                      >
                        {categoryDisplayName(cat)}: {m.missing_count}/{m.total} ({fmtPct(m.pct)} missing)
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
