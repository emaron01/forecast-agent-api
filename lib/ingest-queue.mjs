/**
 * BullMQ queue for opportunity comment ingestion.
 * Used by API routes to enqueue large jobs and by worker to process them.
 */
import { Queue } from "bullmq";

const QUEUE_NAME = "opportunity-ingest";

function getConnection() {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  return { connection: { url } };
}

export function createIngestQueue() {
  return new Queue(QUEUE_NAME, {
    ...getConnection(),
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  });
}

export { QUEUE_NAME };
