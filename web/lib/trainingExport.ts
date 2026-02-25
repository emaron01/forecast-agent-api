/**
 * RISK 4: Training export with point-in-time snapshots.
 * Uses opportunity_audit_events as snapshot source. Never uses opportunity current columns for features.
 */

import "server-only";
import { pool } from "./pool";
import { computeAiForecastFromHealthScore } from "./aiForecast";
import { closedOutcomeFromOpportunityRow } from "./opportunityOutcome";

const CATEGORIES = [
  "pain",
  "metrics",
  "champion",
  "eb",
  "criteria",
  "process",
  "competition",
  "paper",
  "timing",
  "budget",
] as const;

export type TrainingExportRow = {
  org_id: number;
  opportunity_id: number;
  snapshot_time: string;
  selected_event_time: string;
  close_date: string | null;
  outcome_label: "Closed Won" | "Closed Lost";
  ai_forecast_at_snapshot: string | null;
  [key: string]: unknown;
};

export type TrainingExportArgs = {
  orgId: number;
  snapshotTime: string; // ISO datetime
  snapshotOffsetDays?: number; // alternative: days ago from now
  limit?: number;
};

/**
 * Export training data. REQUIRES snapshot_time (or snapshot_offset_days).
 * Features from latest audit event <= snapshot_time. Labels from closed outcome.
 */
export async function exportTrainingData(
  args: TrainingExportArgs
): Promise<{ rows: TrainingExportRow[]; error?: string }> {
  let snapshotTime: Date;
  if (args.snapshotOffsetDays != null && Number.isFinite(args.snapshotOffsetDays)) {
    const d = new Date();
    d.setDate(d.getDate() - args.snapshotOffsetDays);
    snapshotTime = d;
  } else if (args.snapshotTime) {
    snapshotTime = new Date(args.snapshotTime);
    if (!Number.isFinite(snapshotTime.getTime())) {
      return { rows: [], error: "Training export requires snapshot_time to avoid leakage." };
    }
  } else {
    return { rows: [], error: "Training export requires snapshot_time to avoid leakage." };
  }

  const snapshotIso = snapshotTime.toISOString();
  const limit = Math.min(5000, Math.max(1, Number(args.limit ?? 1000) || 1000));

  // Detect timestamp and org columns
  const { rows: colRows } = await pool.query(
    `
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'opportunity_audit_events'
       AND column_name IN ('created_at', 'ts', 'org_id', 'organization_id')
    `
  );
  const colSet = new Set((colRows || []).map((r: { column_name: string }) => r.column_name));
  const eventTimeCol = colSet.has("created_at") ? "created_at" : colSet.has("ts") ? "ts" : null;
  const orgCol = colSet.has("org_id") ? "org_id" : colSet.has("organization_id") ? "organization_id" : null;
  if (!eventTimeCol) {
    return { rows: [], error: "opportunity_audit_events has no created_at or ts column." };
  }
  if (!orgCol) {
    return { rows: [], error: "opportunity_audit_events has no org_id or organization_id column." };
  }

  // Closed opportunities with outcome (won/lost)
  const { rows: closedOpps } = await pool.query(
    `
    SELECT o.id, o.org_id, o.forecast_stage, o.sales_stage, o.close_date::text
      FROM opportunities o
     WHERE o.org_id = $1
       AND (
         COALESCE(o.forecast_stage ~* '\\y(won|lost|closed)\\y', false)
         OR COALESCE(o.sales_stage ~* '\\y(won|lost|closed)\\y', false)
       )
     LIMIT $2
    `,
    [args.orgId, limit * 2]
  );

  const outcomeLabel = (row: { forecast_stage?: string; sales_stage?: string }): "Closed Won" | "Closed Lost" | null => {
    const closed = closedOutcomeFromOpportunityRow(row);
    if (closed === "Won") return "Closed Won";
    if (closed === "Lost") return "Closed Lost";
    return null;
  };

  const result: TrainingExportRow[] = [];
  const seen = new Set<string>();

  for (const opp of closedOpps || []) {
    const label = outcomeLabel(opp);
    if (!label) continue;

    const key = `${opp.org_id}:${opp.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Latest audit event <= snapshot_time for this opportunity (never use post-snapshot events)
    const { rows: events } = await pool.query(
      `
      SELECT id, opportunity_id, delta, meta, total_score, forecast_stage, ai_forecast,
             ${eventTimeCol}::timestamptz AS event_time
        FROM opportunity_audit_events
       WHERE ${orgCol} = $1
         AND opportunity_id = $2
         AND ${eventTimeCol} <= $3::timestamptz
       ORDER BY ${eventTimeCol} DESC, id DESC
       LIMIT 1
      `,
      [args.orgId, opp.id, snapshotIso]
    );

    const event = events?.[0];
    if (!event) continue;

    // Event must be from when deal was open (forecast_stage not won/lost)
    const eventStage = event.forecast_stage ?? "";
    if (/\b(won|lost|closed)\b/i.test(eventStage)) continue;

    const eventTime = event.event_time ? new Date(event.event_time).toISOString() : snapshotIso;

    const delta = (event.delta as Record<string, unknown>) || {};
    const meta = (event.meta as Record<string, unknown>) || {};
    const metaScoring = (meta.scoring as Record<string, unknown>) || {};

    const row: TrainingExportRow = {
      org_id: Number(opp.org_id),
      opportunity_id: Number(opp.id),
      snapshot_time: snapshotIso,
      selected_event_time: eventTime,
      close_date: opp.close_date ?? null,
      outcome_label: label,
      ai_forecast_at_snapshot: computeAiForecastFromHealthScore({
        healthScore: event.total_score ?? (delta.total_score as number),
        forecastStage: event.forecast_stage,
        salesStage: delta.sales_stage as string,
      }),
    };

    for (const cat of CATEGORIES) {
      const prefix = cat === "eb" ? "eb" : cat;
      const score = delta[`${prefix}_score`] ?? metaScoring[`${prefix}_score`];
      const conf = delta[`${prefix}_confidence`] ?? metaScoring[`${prefix}_confidence`];
      const es = delta[`${prefix}_evidence_strength`] ?? metaScoring[`${prefix}_evidence_strength`];
      if (score != null) row[`${prefix}_score`] = score;
      if (conf != null) row[`${prefix}_confidence`] = conf;
      if (es != null) row[`${prefix}_evidence_strength`] = es;
    }

    if (event.total_score != null) row.total_score = event.total_score;

    result.push(row);
    if (result.length >= limit) break;
  }

  return { rows: result };
}
