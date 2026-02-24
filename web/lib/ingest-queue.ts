/**
 * BullMQ queue for opportunity comment ingestion.
 * Used by API routes to enqueue large jobs.
 */
import { Queue } from "bullmq";

const QUEUE_NAME = "opportunity-ingest";

function getConnection() {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  return { connection: { url } };
}

let _queue: Queue | null = null;

export function getIngestQueue(): Queue | null {
  if (!process.env.REDIS_URL) return null;
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      ...getConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return _queue;
}

export { QUEUE_NAME };
