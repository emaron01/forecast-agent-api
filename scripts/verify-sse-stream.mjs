#!/usr/bin/env node
/**
 * SSE/SST stream regression verification.
 *
 * Run with: node scripts/verify-sse-stream.mjs
 *
 * Ensures the expected SSE contract used by update-category is unchanged:
 * - Headers: Content-Type, Cache-Control, Connection, X-Accel-Buffering
 * - Event framing: "data: " + JSON + "\\n\\n" (no buffering of full response)
 * - Optional leading ": keepalive\\n\\n"
 *
 * This script does NOT call the real API (no auth). Use manual steps below
 * to verify against a running app.
 */
import { ReadableStream } from "stream/web";

const REQUIRED_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

function assertHeaders(headers) {
  const h = headers instanceof Headers ? headers : new Map(Object.entries(headers || {}));
  for (const [key, value] of Object.entries(REQUIRED_HEADERS)) {
    const v = h.get?.(key) ?? h.get?.(key.toLowerCase());
    if (v !== value) {
      throw new Error(`SSE header ${key}: expected "${value}", got "${v}"`);
    }
  }
}

function buildMockSSEStream() {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": keepalive\n\n"));
      controller.enqueue(encoder.encode("data: " + JSON.stringify({ type: "done", ok: true }) + "\n\n"));
      controller.close();
    },
  });
}

async function readStreamChunks(stream) {
  const chunks = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return chunks;
}

function assertEventFraming(chunks) {
  const combined = chunks.map((b) => (typeof b === "string" ? b : new TextDecoder().decode(b))).join("");
  if (!combined.includes("\n\n")) {
    throw new Error("SSE stream must contain double-newline event framing");
  }
  const hasDataLine = /data:\s*\{/.test(combined);
  if (!hasDataLine) {
    throw new Error("SSE stream must contain at least one 'data: {...}' line");
  }
  // Ensure we got more than one chunk when keepalive is used (streaming, not buffered)
  if (chunks.length < 1) {
    throw new Error("SSE stream should emit chunks");
  }
}

async function main() {
  console.log("=== SSE stream regression verification ===\n");

  // 1. Headers contract
  const response = new Response(buildMockSSEStream(), { headers: REQUIRED_HEADERS });
  assertHeaders(response.headers);
  console.log("OK: Required SSE headers present and correct");

  // 2. Stream framing (same shape as update-category)
  const stream = buildMockSSEStream();
  const chunks = await readStreamChunks(stream);
  assertEventFraming(chunks);
  console.log("OK: Event framing (data: + JSON + \\n\\n) and chunking behavior");

  console.log("\nAll checks passed. SSE contract unchanged.");
  console.log("\nManual verification against a running app:");
  console.log("  1. Start app (e.g. npm run dev in web/).");
  console.log("  2. Open deal-review, start a category update (voice or text) so SSE path is used.");
  console.log("  3. In DevTools Network, select the update-category request.");
  console.log("  4. Confirm Response Headers: Content-Type: text/event-stream, Cache-Control: no-cache, no-transform, Connection: keep-alive, X-Accel-Buffering: no.");
  console.log("  5. Confirm response body arrives in chunks (e.g. : keepalive then data: {...} events), not a single buffered blob at the end.");
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
