#!/usr/bin/env node
/**
 * BullMQ worker for opportunity comment ingestion.
 * Processes jobs in batches of 100, concurrency 2.
 * Respects baseline_health_score_ts skip gate.
 *
 * Start: npm run worker:ingest
 * Requires: REDIS_URL, DATABASE_URL, MODEL_API_* env vars.
 */
import "dotenv/config";
import { Worker } from "bullmq";
import { pool } from "../web/lib/pool";
import { runCommentIngestionTurn, getPromptVersionHash } from "../web/lib/commentIngestionTurn";
import { insertCommentIngestion } from "../web/lib/db";
import { applyCommentIngestionToOpportunity } from "../web/lib/applyCommentIngestionToOpportunity";

const QUEUE_NAME = "opportunity-ingest";
const BATCH_SIZE = 100;
const CONCURRENCY = 2;

function getConnection() {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  return { connection: { url } };
}

async function processJob(job: { data: any; id?: string; updateProgress: (p: object) => Promise<void> }) {
  const { orgId, fileName, rows } = job.data;
  if (!orgId || !Array.isArray(rows) || !rows.length) {
    throw new Error("Invalid job: orgId and rows required");
  }

  const total = rows.length;
  let processed = 0;
  let okCount = 0;
  let skippedCount = 0;
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
          `SELECT id, account_name, opportunity_name, amount, close_date, forecast_stage, baseline_health_score_ts
           FROM opportunities WHERE org_id = $1 AND NULLIF(btrim(crm_opp_id), '') = $2 LIMIT 1`,
          [orgId, crmOppId]
        );
        const opp = oppRows?.[0];
        if (!opp) {
          failedCount++;
          processed++;
          continue;
        }
        if (opp.baseline_health_score_ts != null) {
          skippedCount++;
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
      skipped: skippedCount,
      failed: failedCount,
      percent: pct,
    });
  }

  return { processed, ok: okCount, skipped: skippedCount, failed: failedCount };
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => processJob(job),
  {
    ...getConnection(),
    concurrency: CONCURRENCY,
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

console.log(`[ingest] Worker started. Queue: ${QUEUE_NAME}, concurrency: ${CONCURRENCY}, batch: ${BATCH_SIZE}`);
