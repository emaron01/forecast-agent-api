"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type FieldTab = "forecast_category" | "stage";

type Row = {
  stage_value: string;
  opp_count: number;
  mapped_bucket: string | null;
};

const BUCKET_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "-- Pattern Match (default) --" },
  { value: "won", label: "Won" },
  { value: "commit", label: "Commit" },
  { value: "best_case", label: "Best Case" },
  { value: "pipeline", label: "Pipeline" },
  { value: "lost", label: "Lost" },
  { value: "excluded", label: "Excluded" },
];

export function StageMappingClient() {
  const [tab, setTab] = useState<FieldTab>("forecast_category");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async (field: FieldTab) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/stage-mapping?field=${encodeURIComponent(field)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || "Failed to load");
        setRows([]);
        return;
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e: any) {
      setError(e?.message || String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  const summary = useMemo(() => {
    const total = rows.length;
    const mapped = rows.filter((r) => r.mapped_bucket != null && String(r.mapped_bucket).trim() !== "").length;
    const unmapped = total - mapped;
    return { total, mapped, unmapped };
  }, [rows]);

  const onBucketChange = async (stageValue: string, value: string) => {
    const key = `${tab}:${stageValue}`;
    setSaving(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/stage-mapping", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: tab,
          stage_value: stageValue,
          bucket: value === "" ? null : value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || "Save failed");
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.stage_value === stageValue ? { ...r, mapped_bucket: value === "" ? null : value } : r
        )
      );
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap gap-2 border-b border-[color:var(--sf-border)] pb-1">
        <button
          type="button"
          onClick={() => setTab("forecast_category")}
          className={`rounded-md px-3 py-2 text-sm font-medium ${
            tab === "forecast_category"
              ? "bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]"
              : "text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface-alt)]"
          }`}
        >
          Forecast Category
        </button>
        <button
          type="button"
          onClick={() => setTab("stage")}
          className={`rounded-md px-3 py-2 text-sm font-medium ${
            tab === "stage"
              ? "bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]"
              : "text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface-alt)]"
          }`}
        >
          Stage
        </button>
      </div>

      {tab === "forecast_category" ? (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 mb-4 text-sm text-[color:var(--sf-text-secondary)]">
          <div className="font-semibold text-[color:var(--sf-text-primary)] mb-1">Forecast Stage Mappings</div>
          <p>
            Map your CRM forecast stage values (e.g. "Commit", "Best Case", "Pipeline", "Closed") to SalesForecast.io buckets.
          </p>
          <p className="mt-2">
            <strong className="text-[color:var(--sf-text-primary)]">Recommended for all customers.</strong>{" "}
            These mappings use the rep&apos;s forecast judgment as the primary signal. If your reps set forecast stages in your CRM,
            map them here.
          </p>
          <p className="mt-2">
            <strong className="text-[color:var(--sf-text-primary)]">Important:</strong>{" "}
            Always map your closed-won and closed-lost forecast stages here (e.g. "Closed Won" → Won, "Closed Lost" → Lost) so
            that completed deals are excluded from open pipeline.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4 mb-4 text-sm text-[color:var(--sf-text-secondary)]">
          <div className="font-semibold text-[color:var(--sf-text-primary)] mb-1">Sales Stage Mappings</div>
          <p>
            Map your CRM sales stage values to forecast buckets. Sales stage mappings{" "}
            <strong className="text-[color:var(--sf-text-primary)]">override</strong>{" "}
            forecast stage mappings when both are present for a deal.
          </p>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            <li>
              <strong className="text-[color:var(--sf-text-primary)]">Required:</strong>{" "}
              Map any sales stages that indicate a closed deal (e.g. "Won and Closed" → Won, "Lost and Closed" → Lost). This
              ensures closed deals are removed from open pipeline.
            </li>
            <li className="mt-1">
              <strong className="text-[color:var(--sf-text-primary)]">Optional - Stage Discipline:</strong>{" "}
              Map early sales stages to Pipeline or Best Case to prevent reps from calling Commit on deals that haven&apos;t reached
              the right stage. Example: "2. Gain Access" → Pipeline prevents a rep from marking a stage-2 deal as Commit.
              <span className="block mt-1 text-yellow-500/80">
                ⚠ Use with caution — this overrides rep forecast judgment entirely. Only enable if your sales process strictly
                gates forecast stage by sales stage.
              </span>
            </li>
            <li className="mt-1">
              <strong className="text-[color:var(--sf-text-primary)]">Unassigned stages:</strong>{" "}
              Sales stages without a mapping fall back to the forecast stage mapping. You do not need to map every stage — only
              map stages where you want to override the rep&apos;s forecast judgment or explicitly mark deals as closed.
            </li>
          </ul>
        </div>
      )}

      <p className="text-sm text-[color:var(--sf-text-secondary)]">
        {summary.mapped} of {summary.total} stages mapped — {summary.unmapped} unmapped stages using pattern matching
      </p>

      {error ? (
        <div className="rounded-md border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : null}

      {loading ? (
        <p className="text-sm text-[color:var(--sf-text-secondary)]">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[color:var(--sf-border)]">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-left">
                <th className="px-4 py-3 font-medium text-[color:var(--sf-text-secondary)]">Stage Value</th>
                <th className="px-4 py-3 font-medium text-[color:var(--sf-text-secondary)]">Opps</th>
                <th className="px-4 py-3 font-medium text-[color:var(--sf-text-secondary)]">Mapped Bucket</th>
                <th className="px-4 py-3 font-medium text-[color:var(--sf-text-secondary)]">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const hasMap = r.mapped_bucket != null && String(r.mapped_bucket).trim() !== "";
                const key = `${tab}:${r.stage_value}`;
                return (
                  <tr key={r.stage_value} className="border-b border-[color:var(--sf-border)] last:border-0">
                    <td className="px-4 py-2 font-mono text-[color:var(--sf-text-primary)]">
                      {r.stage_value === "(empty)" ? <span className="text-[color:var(--sf-text-disabled)]">(empty)</span> : r.stage_value}
                    </td>
                    <td className="px-4 py-2 text-[color:var(--sf-text-secondary)]">{r.opp_count}</td>
                    <td className="px-4 py-2">
                      <select
                        className="w-full max-w-xs rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1.5 text-[color:var(--sf-text-primary)]"
                        value={hasMap ? r.mapped_bucket! : ""}
                        disabled={saving === key}
                        onChange={(e) => void onBucketChange(r.stage_value, e.target.value)}
                      >
                        {BUCKET_OPTIONS.map((opt) => (
                          <option key={`${opt.value}:${opt.label}`} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      {hasMap ? (
                        <span className="text-[#2ECC71]">✅ Mapped</span>
                      ) : (
                        <span className="text-amber-400">⚠️ Unmapped</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
