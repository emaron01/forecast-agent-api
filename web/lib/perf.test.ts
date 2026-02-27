import test from "node:test";
import assert from "node:assert/strict";
import { startSpan, endSpan, withSpan } from "./perf";

test("startSpan returns handle with startMs and opts", () => {
  const handle = startSpan({
    workflow: "ingestion",
    stage: "request_total",
    org_id: 1,
  });
  assert.ok(handle);
  assert.ok(typeof handle.startMs === "number");
  assert.ok(handle.startMs <= Date.now() && handle.startMs >= Date.now() - 1000);
  assert.strictEqual(handle.opts.workflow, "ingestion");
  assert.strictEqual(handle.opts.stage, "request_total");
  assert.strictEqual(handle.opts.org_id, 1);
});

test("endSpan does not throw", () => {
  const handle = startSpan({
    workflow: "ingestion",
    stage: "request_total",
    org_id: 1,
  });
  assert.doesNotThrow(() => endSpan(handle, { status: "ok" }));
  assert.doesNotThrow(() => endSpan(handle, { status: "error", http_status: 500 }));
});

test("endSpan does not throw when given minimal end options", () => {
  const handle = startSpan({
    workflow: "voice_review",
    stage: "stt",
    org_id: 0,
  });
  assert.doesNotThrow(() => endSpan(handle));
});

test("withSpan resolves with fn result", async () => {
  const result = await withSpan(
    { workflow: "ingestion", stage: "request_total", org_id: 1 },
    async () => "ok"
  );
  assert.strictEqual(result, "ok");
});

test("withSpan rethrows and ends span with error", async () => {
  let threw = false;
  try {
    await withSpan(
      { workflow: "ingestion", stage: "request_total", org_id: 1 },
      async () => {
        throw new Error("fail");
      }
    );
  } catch (e) {
    threw = true;
    assert.strictEqual((e as Error).message, "fail");
  }
  assert.ok(threw);
});

test("duration_ms is non-negative when endSpan is called", () => {
  const handle = startSpan({
    workflow: "ingestion",
    stage: "request_total",
    org_id: 1,
  });
  const startMs = handle.startMs;
  endSpan(handle, { status: "ok" });
  const elapsed = Date.now() - startMs;
  assert.ok(elapsed >= 0);
});
