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
import { outcomeFromOpportunityRow } from "../lib/opportunityOutcome";
import { markHubSpotDealDeleted, runHubSpotIngest, syncHubSpotDealMetadataOnly } from "../lib/hubspotIngest";
import { getIngestQueue } from "../lib/ingest-queue";

const QUEUE_NAME = "opportunity-ingest";
const BATCH_SIZE = 100;

function getStartOfCurrentQuarterUTC(now: Date): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const q = Math.floor(m / 3);
  const startMonth = q * 3;
  return new Date(Date.UTC(y, startMonth, 1));
}

function inScope(opp: { sales_stage?: string | null; forecast_stage?: string | null; close_date?: string | Date | null }): boolean {
  const rawClose = opp.close_date;
  if (!rawClose) return false;

  const closeDate = new Date(rawClose as any);
  if (!Number.isFinite(closeDate.getTime())) return false;

  const now = new Date();
  const currentQuarterStart = getStartOfCurrentQuarterUTC(now);

  // Exclude anything older than 2 quarters back — no exceptions for Open stage
  const cutoff2q = new Date(
    Date.UTC(currentQuarterStart.getUTCFullYear(), currentQuarterStart.getUTCMonth() - 6, 1)
  );

  return closeDate.getTime() >= cutoff2q.getTime();
}

function getConnection() {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  return { connection: { url } };
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logInfo(event: string, details: Record<string, unknown> = {}): void {
  console.info(
    JSON.stringify({
      worker: "opportunity-ingest",
      level: "info",
      event,
      ...details,
    })
  );
}

function logError(event: string, details: Record<string, unknown> = {}): void {
  console.error(
    JSON.stringify({
      worker: "opportunity-ingest",
      level: "error",
      event,
      ...details,
    })
  );
}

async function enqueueScheduledHubSpotSyncs(): Promise<{ ok: true; orgs_queued: number; orgs_skipped: number }> {
  const queue = getIngestQueue();
  if (!queue) {
    logError("hubspot_scheduled_sync_queue_unavailable");
    return { ok: true, orgs_queued: 0, orgs_skipped: 0 };
  }

  const { rows } = await pool.query<{ org_id: string }>(
    `
    SELECT org_id::text AS org_id
    FROM hubspot_connections
    WHERE access_token_enc IS NOT NULL
      AND token_expires_at > now() - interval '7 days'
    `
  );

  let orgsQueued = 0;
  let orgsSkipped = 0;

  for (const row of rows) {
    const orgId = Number(row.org_id || 0);
    if (!Number.isFinite(orgId) || orgId <= 0) {
      orgsSkipped += 1;
      logInfo("hubspot_scheduled_sync_skipped", {
        orgId: row.org_id,
        reason: "invalid_org_id",
      });
      continue;
    }

    const inFlight = await pool.query(
      `
      SELECT 1
      FROM hubspot_sync_log
      WHERE org_id = $1
        AND status IN ('pending', 'running')
        AND started_at > now() - interval '30 minutes'
      LIMIT 1
      `,
      [orgId]
    );
    if (inFlight.rows.length) {
      orgsSkipped += 1;
      logInfo("hubspot_scheduled_sync_skipped", {
        orgId,
        reason: "sync_in_progress",
      });
      continue;
    }

    let syncLogId = "";
    try {
      const insertResult = await pool.query<{ id: string }>(
        `
        INSERT INTO hubspot_sync_log (org_id, sync_type, status)
        VALUES ($1, 'scheduled', 'pending')
        RETURNING id::text AS id
        `,
        [orgId]
      );
      syncLogId = String(insertResult.rows[0]?.id || "").trim();
      if (!syncLogId) {
        orgsSkipped += 1;
        logError("hubspot_scheduled_sync_log_missing", { orgId });
        continue;
      }

      await queue.add(
        "hubspot-initial-sync",
        { orgId, syncLogId, syncType: "scheduled" },
        {
          jobId: `hubspot-scheduled-sync_${orgId}_${Date.now()}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        }
      );

      orgsQueued += 1;
      logInfo("hubspot_scheduled_sync_queued", {
        orgId,
        syncLogId,
      });
    } catch (error) {
      if (syncLogId) {
        await pool.query(
          `
          UPDATE hubspot_sync_log
          SET status = 'failed',
              error_text = $2,
              completed_at = now()
          WHERE id = $1::uuid
          `,
          [syncLogId, serializeError(error)]
        );
      }
      orgsSkipped += 1;
      logError("hubspot_scheduled_sync_enqueue_failed", {
        orgId,
        syncLogId: syncLogId || null,
        error: serializeError(error),
      });
    }
  }

  return { ok: true, orgs_queued: orgsQueued, orgs_skipped: orgsSkipped };
}

async function cleanupExpiredEmbedSessions(): Promise<{ ok: true; deleted: number }> {
  const result = await pool.query(
    `
    DELETE FROM user_sessions
    WHERE expires_at < now()
      AND user_id IN (
        SELECT user_id FROM hubspot_embed_users
      )
    `
  );
  const deleted = result.rowCount ?? 0;
  logInfo("embed_session_cleanup_completed", { deleted });
  return { ok: true, deleted };
}

async function registerRepeatableJobs(): Promise<void> {
  const queue = getIngestQueue();
  if (!queue) {
    logError("repeatable_jobs_queue_unavailable");
    return;
  }

  try {
    await queue.add(
      "hubspot-scheduled-sync-all",
      {},
      {
        repeat: {
          pattern: process.env.HUBSPOT_SYNC_CRON || "0 */6 * * *",
        },
        jobId: "hubspot-scheduled-sync-all",
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    await queue.add(
      "embed-session-cleanup",
      {},
      {
        repeat: { pattern: "0 3 * * *" },
        jobId: "embed-session-cleanup",
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    logInfo("repeatable_jobs_registered", {
      hubspotSyncCron: process.env.HUBSPOT_SYNC_CRON || "0 */6 * * *",
      embedSessionCleanupCron: "0 3 * * *",
    });
  } catch (error) {
    logError("repeatable_jobs_registration_failed", {
      error: serializeError(error),
    });
  }
}

async function processSingleIngest(job: { data: any; updateProgress: (p: object) => Promise<void> }) {
  const { orgId, opportunityId, rawText, sourceType, sourceRef } = job.data;
  if (!orgId || !opportunityId || !rawText) {
    throw new Error("Invalid single-ingest job: orgId, opportunityId, rawText required");
  }

  const { rows: oppRows } = await pool.query(
    `SELECT id, account_name, opportunity_name, amount, close_date, forecast_stage, sales_stage, baseline_health_score_ts
     FROM opportunities WHERE org_id = $1 AND id = $2 LIMIT 1`,
    [orgId, opportunityId]
  );
  const opp = oppRows?.[0];
  if (!opp) {
    return { processed: 1, ok: 0, skipped_out_of_scope: 0, skipped_baseline_exists: 0, failed: 1 };
  }
  if (!inScope(opp)) {
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
      rawNotes: rawText,
    });
    return {
      processed: 1,
      ok: applyResult.ok ? 1 : 0,
      skipped_out_of_scope: 0,
      skipped_baseline_exists: 0,
      failed: applyResult.ok ? 0 : 1,
    };
  } catch (e: any) {
    logError("single_ingest_failed", {
      orgId,
      opportunityId,
      sourceType: sourceType ?? "manual",
      sourceRef: sourceRef ?? "single",
      error: e?.message || String(e),
    });
    return { processed: 1, ok: 0, skipped_out_of_scope: 0, skipped_baseline_exists: 0, failed: 1 };
  }
}

async function processJob(job: { data: any; id?: string; name?: string; updateProgress: (p: object) => Promise<void> }) {
  if (job.name === "single-ingest") {
    return processSingleIngest(job);
  }

  if (job.name === "hubspot-initial-sync") {
    const { orgId, syncLogId, syncType } = job.data || {};
    if (!orgId || !syncLogId) throw new Error("Invalid hubspot-initial-sync job");
    await runHubSpotIngest({
      orgId: Number(orgId),
      syncLogId: String(syncLogId),
      syncType: syncType === "manual" || syncType === "scheduled" ? syncType : "initial",
    });
    return { ok: true };
  }

  if (job.name === "hubspot-deal-update") {
    const { orgId, dealId } = job.data || {};
    if (!orgId || !dealId) throw new Error("Invalid hubspot-deal-update job");
    await syncHubSpotDealMetadataOnly({ orgId: Number(orgId), dealId: String(dealId) });
    return { ok: true };
  }

  if (job.name === "hubspot-scheduled-sync-all") {
    return enqueueScheduledHubSpotSyncs();
  }

  if (job.name === "embed-session-cleanup") {
    return cleanupExpiredEmbedSessions();
  }

  if (job.name === "hubspot-deal-delete") {
    const { orgId, dealId } = job.data || {};
    if (!orgId || !dealId) throw new Error("Invalid hubspot-deal-delete job");
    await markHubSpotDealDeleted({ orgId: Number(orgId), dealId: String(dealId) });
    return { ok: true };
  }

  const { orgId, fileName, rows } = job.data;
  if (!orgId || !Array.isArray(rows) || !rows.length) {
    throw new Error("Invalid job: orgId and rows required");
  }

  const t0 = Date.now();
  let processedSuccess = 0;
  let skippedTotal = 0;
  let notReadyTotal = 0;

  logInfo("excel_comments_job_start", {
    job_id: job.id,
    attempt: (job as any).attemptsMade + 1,
    rows_total: rows.length,
  });

  const total = rows.length;
  let processed = 0;
  let okCount = 0;
  let skippedOutOfScope = 0;
  let skippedBaselineExists = 0;
  let failedCount = 0;

  try {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    for (const item of batch) {
      const { crmOppId, rawText } = item;
      if (!crmOppId || !rawText) {
        skippedTotal++;
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
          // Let the job retry when the opportunity row is not yet available.
          // Handled as a retryable error in the catch block below.
          throw new Error("OPPORTUNITY_NOT_READY");
        }

        const computedOutcome = outcomeFromOpportunityRow(opp);
        const inScopeResult = inScope(opp);
        if (process.env.DEBUG_INGEST === "true") {
          logInfo("ingest_row_debug", {
            crmOppId,
            opportunity_id: opp.id,
            outcome: computedOutcome,
            inScope: inScopeResult,
          });
        }
        if (!inScopeResult) {
          if (process.env.DEBUG_INGEST === "true" && computedOutcome !== "Open") {
            const rawClose = opp.close_date;
            const skipReason = !rawClose ? "closed_missing_close_date" : "closed_out_of_scope";
            logInfo("comment_row_skipped", {
              opportunity_id: opp.id,
              forecast_stage: opp.forecast_stage ?? null,
              sales_stage: opp.sales_stage ?? null,
              close_date: rawClose ?? null,
              computed_outcome: computedOutcome,
              skip_reason: skipReason,
            });
          }
          skippedTotal++;
          skippedOutOfScope++;
          processed++;
          continue;
        }

        if (opp.baseline_health_score_ts != null) {
          if (process.env.DEBUG_INGEST === "true") {
            logInfo("ingest_row_skipped", {
              reason: "baseline_exists",
              opportunity_id: opp.id,
              crmOppId,
            });
          }
          skippedTotal++;
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
          rawNotes: rawText,
        });
        if (process.env.DEBUG_INGEST === "true") {
          logInfo("ingest_apply_result", {
            opportunity_id: opp.id,
            crmOppId,
            apply_ok: applyResult.ok,
            apply_error: applyResult?.error ?? null,
          });
        }
        if (applyResult.ok) {
          if (process.env.DEBUG_INGEST === "true") {
            logInfo("comment_row_processed", {
              opportunity_id: opp.id,
              computed_outcome: computedOutcome,
              close_date: opp.close_date ?? null,
            });
          }
          processedSuccess++;
          okCount++;
        } else failedCount++;
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg.startsWith("OPPORTUNITY_NOT_READY")) {
          notReadyTotal++;
          logInfo("comments_waiting_for_opportunity", {
            orgId,
            fileName,
            crmOppId,
          });
          skippedTotal++;
          processed++;
          continue;  // skip this row, keep processing the rest of the chunk
        }
        logError("excel_comments_row_failed", {
          orgId,
          fileName,
          crmOppId,
          error: msg,
        });
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

  logInfo("excel_comments_job_done", {
    status: "completed",
    job_id: job.id,
    attempt: (job as any).attemptsMade + 1,
    rows_total: rows.length,
    processed_rows: processedSuccess,
    skipped_rows: skippedTotal,
    not_ready_rows: notReadyTotal,
    duration_ms: Date.now() - t0,
  });

  return {
    processed,
    ok: okCount,
    skipped_out_of_scope: skippedOutOfScope,
    skipped_baseline_exists: skippedBaselineExists,
    failed: failedCount,
  };
  } catch (err: any) {
    logError("excel_comments_job_done", {
      status: "failed",
      job_id: job.id,
      attempt: (job as any).attemptsMade + 1,
      rows_total: rows.length,
      processed_rows: processedSuccess,
      skipped_rows: skippedTotal,
      not_ready_rows: notReadyTotal,
      duration_ms: Date.now() - t0,
      error: String(err?.message || err),
    });
    throw err;
  }
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
// Each ingest row runs 11 parallel LLM calls; default BullMQ lock (30s) is too short.
const lockDurationMs = parseInt(process.env.INGEST_JOB_LOCK_DURATION_MS ?? "900000", 10) || 900000;
const maxStalledCount = parseInt(process.env.INGEST_MAX_STALLED_COUNT ?? "2", 10) || 2;

logInfo("worker_starting", {
  queue: QUEUE_NAME,
  redis: maskRedisHost(redisUrl),
  concurrency: process.env.WORKER_CONCURRENCY ?? "3",
  batch: BATCH_SIZE,
  lockDurationMs,
  maxStalledCount,
});

const worker = new Worker(
  QUEUE_NAME,
  async (job) => processJob(job),
  {
    ...getConnection(),
    concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? "3"),
    lockDuration: lockDurationMs,
    maxStalledCount,
  }
);

worker.on("completed", (job, result) => {
  logInfo("job_completed", {
    jobId: job.id,
    jobName: job.name,
    result,
  });
});

worker.on("failed", (job, err) => {
  logError("job_failed", {
    jobId: job?.id,
    jobName: job?.name,
    error: err?.message || String(err),
  });
});

worker.on("error", (err) => {
  logError("worker_error", {
    error: err?.message || String(err),
  });
});

worker
  .waitUntilReady()
  .then(async () => {
    logInfo("worker_ready", { queue: QUEUE_NAME });
    await registerRepeatableJobs();
  })
  .catch((error) => {
    logError("worker_ready_failed", {
      error: serializeError(error),
    });
  });
