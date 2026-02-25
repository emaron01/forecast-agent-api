#!/usr/bin/env node
/**
 * BullMQ worker for opportunity comment ingestion.
 * Strict scoring scope, baseline skip gate, CRO-safe closed pinning.
 *
 * Start: npm run worker:ingest (from project root)
 * Requires: REDIS_URL, DATABASE_URL, MODEL_API_* env vars.
 */
import "dotenv/config";
import { Worker } from "bullmq";
import { pool } from "../lib/pool";
import { runCommentIngestionTurn, getPromptVersionHash } from "../lib/commentIngestionTurn";
import { insertCommentIngestion } from "../lib/db";
import { applyCommentIngestionToOpportunity } from "../lib/applyCommentIngestionToOpportunity";
import { outcomeFromStageLike } from "../lib/opportunityOutcome";

const QUEUE_NAME = "opportunity-ingest";
const BATCH_SIZE = 100;

function getStartOfPreviousQuarterUTC(): Date {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const q = Math.floor(m / 3) + 1;
  const prevQ = q === 1 ? 4 : q - 1;
  const prevY = q === 1 ? y - 1 : y;
  const startMonth = (prevQ - 1) * 3;
  return new Date(Date.UTC(prevY, startMonth, 1));
}

function outcomeFromRow(opp: { forecast_stage?: string | null; sales_stage?: string | null }): "Open" | "Won" | "Lost" {
  const f = outcomeFromStageLike(opp.forecast_stage);
  if (f !== "Open") return f;
  return outcomeFromStageLike(opp.sales_stage);
}

function inScope(opp: { sales_stage?: string | null; forecast_stage?: string | null; close_date?: string | Date | null }, _cutoff: Date): boolean {
  const outcome = outcomeFromRow(opp);
  if (outcome !== "Open") return false;
  return true;
}

function getConnection() {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  return { connection: { url } };
}

async function processSingleIngest(job: { data: any; updateProgress: (p: object) => Promise<void> }) {
  const { orgId, opportunityId, rawText, sourceType, sourceRef } = job.data;
  if (!orgId || !opportunityId || !rawText) {
    throw new Error("Invalid single-ingest job: orgId, opportunityId, rawText required");
  }

  const cutoff = getStartOfPreviousQuarterUTC();
  const { rows: oppRows } = await pool.query(
    `SELECT id, account_name, opportunity_name, amount, close_date, forecast_stage, sales_stage, baseline_health_score_ts
     FROM opportunities WHERE org_id = $1 AND id = $2 LIMIT 1`,
    [orgId, opportunityId]
  );
  const opp = oppRows?.[0];
  if (!opp) {
    return { processed: 1, ok: 0, skipped_out_of_scope: 0, skipped_baseline_exists: 0, failed: 1 };
  }
  if (!inScope(opp, cutoff)) {
    return { processed: 1, ok: 0, skipped_out_of_scope: 1, skipped_baseline_exists: 0, failed: 0 };
  }
  if (opp.baseline_health_score_ts != null) {
    return { processed: 1, ok: 0, skipped_out_of_scope: 0, skipped_baseline_exists: 1, failed: 0 };
  }

  try {
    const deal = {
      id: opp.id,
      account_name: opp.account_name,
      opportunity_name: opp.opportunity_name,
      amount: opp.amount,
      close_date: opp.close_date,
      forecast_stage: opp.forecast_stage,
    };
    const { extracted } = await runCommentIngestionTurn({ deal, rawNotes: rawText, orgId });
    const { id: commentIngestionId } = await insertCommentIngestion({
      orgId,
      opportunityId: opp.id,
      sourceType: sourceType ?? "manual",
      sourceRef: sourceRef ?? "single",
      rawText,
      extractedJson: extracted,
      modelMetadata: {
        model: process.env.MODEL_API_NAME || "unknown",
        promptVersionHash: getPromptVersionHash(),
        timestamp: new Date().toISOString(),
      },
    });
    const applyResult = await applyCommentIngestionToOpportunity({
      orgId,
      opportunityId: opp.id,
      extracted,
      commentIngestionId,
      scoreEventSource: "baseline",
      salesStage: opp.sales_stage ?? opp.forecast_stage ?? null,
    });
    return {
      processed: 1,
      ok: applyResult.ok ? 1 : 0,
      skipped_out_of_scope: 0,
      skipped_baseline_exists: 0,
      failed: applyResult.ok ? 0 : 1,
    };
  } catch {
    return { processed: 1, ok: 0, skipped_out_of_scope: 0, skipped_baseline_exists: 0, failed: 1 };
  }
}

async function processJob(job: { data: any; id?: string; name?: string; updateProgress: (p: object) => Promise<void> }) {
  if (job.name === "single-ingest") {
    return processSingleIngest(job);
  }

  const { orgId, fileName, rows } = job.data;
  if (!orgId || !Array.isArray(rows) || !rows.length) {
    throw new Error("Invalid job: orgId and rows required");
  }

  const cutoff = getStartOfPreviousQuarterUTC();
  const total = rows.length;
  let processed = 0;
  let okCount = 0;
  let skippedOutOfScope = 0;
  let skippedBaselineExists = 0;
  let failedCount = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    for (const item of batch) {
      const { crmOppId, rawText } = item;
      if (!crmOppId || !rawText) {
        failedCount++;
        processed++;
        continue;
      }

      try {
        const { rows: oppRows } = await pool.query(
          `SELECT id, account_name, opportunity_name, amount, close_date, forecast_stage, sales_stage, baseline_health_score_ts
           FROM opportunities WHERE org_id = $1 AND NULLIF(btrim(crm_opp_id), '') = $2 LIMIT 1`,
          [orgId, crmOppId]
        );
        const opp = oppRows?.[0];
        if (!opp) {
          failedCount++;
          processed++;
          continue;
        }

        if (!inScope(opp, cutoff)) {
          skippedOutOfScope++;
          processed++;
          continue;
        }

        if (opp.baseline_health_score_ts != null) {
          skippedBaselineExists++;
          processed++;
          continue;
        }

        const deal = {
          id: opp.id,
          account_name: opp.account_name,
          opportunity_name: opp.opportunity_name,
          amount: opp.amount,
          close_date: opp.close_date,
          forecast_stage: opp.forecast_stage,
        };
        const { extracted } = await runCommentIngestionTurn({ deal, rawNotes: rawText, orgId });
        const { id: commentIngestionId } = await insertCommentIngestion({
          orgId,
          opportunityId: opp.id,
          sourceType: "excel",
          sourceRef: fileName || "staged",
          rawText,
          extractedJson: extracted,
          modelMetadata: {
            model: process.env.MODEL_API_NAME || "unknown",
            promptVersionHash: getPromptVersionHash(),
            timestamp: new Date().toISOString(),
          },
        });
        const applyResult = await applyCommentIngestionToOpportunity({
          orgId,
          opportunityId: opp.id,
          extracted,
          commentIngestionId,
          scoreEventSource: "baseline",
          salesStage: opp.sales_stage ?? opp.forecast_stage ?? null,
        });
        if (applyResult.ok) okCount++;
        else failedCount++;
      } catch {
        failedCount++;
      }
      processed++;
    }

    const pct = Math.round((processed / total) * 100);
    await job.updateProgress({
      processed,
      ok: okCount,
      skipped_out_of_scope: skippedOutOfScope,
      skipped_baseline_exists: skippedBaselineExists,
      failed: failedCount,
      percent: pct,
    });
  }

  return {
    processed,
    ok: okCount,
    skipped_out_of_scope: skippedOutOfScope,
    skipped_baseline_exists: skippedBaselineExists,
    failed: failedCount,
  };
}

function maskRedisHost(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname || "?";
    return host.replace(/(.{2}).*(.{2})/, "$1***$2");
  } catch {
    return "?";
  }
}

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
console.log(
  `[ingest] Worker starting | queue=${QUEUE_NAME} | redis=${maskRedisHost(redisUrl)} | concurrency=2 | batch=${BATCH_SIZE}`
);

const worker = new Worker(
  QUEUE_NAME,
  async (job) => processJob(job),
  {
    ...getConnection(),
    concurrency: 2, // hard cap; do not increase without DB headroom
  }
);

worker.on("completed", (job, result) => {
  console.log(`[ingest] Job ${job.id} completed:`, result);
});

worker.on("failed", (job, err) => {
  console.error(`[ingest] Job ${job?.id} failed:`, err?.message || err);
});

worker.on("error", (err) => {
  console.error("[ingest] Worker error:", err);
});

console.log(`[ingest] Worker ready. Queue: ${QUEUE_NAME}`);
