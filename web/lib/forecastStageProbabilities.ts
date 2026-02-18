import { pool } from "./pool";

export type ForecastStageKey = "commit" | "best_case" | "pipeline";

export type ForecastStageProbabilityMap = Record<ForecastStageKey, number>; // fraction 0..1

export const DEFAULT_FORECAST_STAGE_PROBABILITIES: ForecastStageProbabilityMap = {
  commit: 0.8,
  best_case: 0.325,
  pipeline: 0.1,
};

export async function getForecastStageProbabilities(args: { orgId: number }): Promise<ForecastStageProbabilityMap> {
  const orgId = Number(args.orgId);
  const base = { ...DEFAULT_FORECAST_STAGE_PROBABILITIES };
  if (!Number.isFinite(orgId) || orgId <= 0) return base;

  const { rows } = await pool.query<{ stage_key: string; probability: any }>(
    `
    SELECT stage_key, probability
      FROM forecast_stage_probabilities
     WHERE org_id = $1::bigint
    `,
    [orgId]
  );

  for (const r of rows || []) {
    const k = String(r.stage_key || "").trim() as ForecastStageKey;
    if (k !== "commit" && k !== "best_case" && k !== "pipeline") continue;
    const n = Number(r.probability);
    if (!Number.isFinite(n) || n < 0 || n > 1) continue;
    (base as any)[k] = n;
  }
  return base;
}

export async function upsertForecastStageProbabilities(args: { orgId: number; values: ForecastStageProbabilityMap }) {
  const orgId = Number(args.orgId);
  if (!Number.isFinite(orgId) || orgId <= 0) throw new Error("Invalid orgId");

  const v = args.values;
  const rows: Array<{ stage_key: ForecastStageKey; probability: number }> = [
    { stage_key: "commit", probability: Number(v.commit) },
    { stage_key: "best_case", probability: Number(v.best_case) },
    { stage_key: "pipeline", probability: Number(v.pipeline) },
  ];

  for (const r of rows) {
    if (!Number.isFinite(r.probability) || r.probability < 0 || r.probability > 1) {
      throw new Error(`Invalid probability for ${r.stage_key}`);
    }
  }

  await pool.query(
    `
    INSERT INTO forecast_stage_probabilities (org_id, stage_key, probability, created_at, updated_at)
    VALUES
      ($1::bigint, $2::text, $3::numeric, NOW(), NOW()),
      ($1::bigint, $4::text, $5::numeric, NOW(), NOW()),
      ($1::bigint, $6::text, $7::numeric, NOW(), NOW())
    ON CONFLICT (org_id, stage_key)
    DO UPDATE SET probability = EXCLUDED.probability, updated_at = NOW()
    `,
    [orgId, rows[0].stage_key, rows[0].probability, rows[1].stage_key, rows[1].probability, rows[2].stage_key, rows[2].probability]
  );
}

