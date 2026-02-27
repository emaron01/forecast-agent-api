/**
 * Performance instrumentation: raw spans written to perf_events.
 * Best-effort only: never throw; never cause request failure if telemetry write fails.
 */

import { pool } from "./pool";

export const runtime = "nodejs";

const BUILD_SHA = (typeof process !== "undefined" && process.env.BUILD_SHA) || null;

export type StartSpanOptions = {
  workflow: string;
  stage: string;
  org_id: number;
  opportunity_id?: number | null;
  run_id?: string | null;
  call_id?: string | null;
  audio_ms?: number | null;
  text_chars?: number | null;
  payload_bytes?: number | null;
  model?: string | null;
  provider?: string | null;
  prompt_version?: string | null;
  logic_version?: string | null;
  schema_version?: number | null;
  is_test?: boolean;
};

export type EndSpanOptions = {
  status?: "ok" | "error";
  http_status?: number | null;
  error_code?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  model?: string | null;
  provider?: string | null;
};

export type SpanHandle = {
  startMs: number;
  opts: StartSpanOptions;
};

export function startSpan(opts: StartSpanOptions): SpanHandle {
  return {
    startMs: Date.now(),
    opts: { ...opts },
  };
}

export function endSpan(handle: SpanHandle, endOpts: EndSpanOptions = {}): void {
  const durationMs = Math.max(0, Math.round(Date.now() - handle.startMs));
  const status = endOpts.status ?? "ok";
  const o = handle.opts;
  const row = {
    org_id: o.org_id,
    opportunity_id: o.opportunity_id ?? null,
    run_id: o.run_id ?? null,
    call_id: o.call_id ?? null,
    workflow: o.workflow,
    stage: o.stage,
    duration_ms: durationMs,
    status,
    http_status: endOpts.http_status ?? null,
    error_code: endOpts.error_code ?? null,
    audio_ms: o.audio_ms ?? null,
    text_chars: o.text_chars ?? null,
    payload_bytes: o.payload_bytes ?? null,
    tokens_in: endOpts.tokens_in ?? null,
    tokens_out: endOpts.tokens_out ?? null,
    model: endOpts.model ?? o.model ?? null,
    provider: endOpts.provider ?? o.provider ?? null,
    prompt_version: o.prompt_version ?? null,
    logic_version: o.logic_version ?? null,
    schema_version: o.schema_version ?? null,
    build_sha: BUILD_SHA,
    is_test: o.is_test ?? false,
  };
  try {
    pool.query(
      `
      INSERT INTO perf_events (
        org_id, opportunity_id, run_id, call_id, workflow, stage,
        duration_ms, status, http_status, error_code,
        audio_ms, text_chars, payload_bytes, tokens_in, tokens_out,
        model, provider, prompt_version, logic_version, schema_version, build_sha, is_test
      ) VALUES (
        $1, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
      )
      `,
      [
        row.org_id,
        row.opportunity_id,
        row.run_id,
        row.call_id,
        row.workflow,
        row.stage,
        row.duration_ms,
        row.status,
        row.http_status,
        row.error_code,
        row.audio_ms,
        row.text_chars,
        row.payload_bytes,
        row.tokens_in,
        row.tokens_out,
        row.model,
        row.provider,
        row.prompt_version,
        row.logic_version,
        row.schema_version,
        row.build_sha,
        row.is_test,
      ]
    ).catch((err) => {
      console.error("perf_events insert failed (non-fatal):", err);
    });
  } catch (_) {
    // no-op: never throw
  }
  const logLine = [
    "PERF",
    `workflow=${row.workflow}`,
    `stage=${row.stage}`,
    `org_id=${row.org_id}`,
    `opp_id=${row.opportunity_id ?? "null"}`,
    `run_id=${row.run_id ?? "null"}`,
    `call_id=${row.call_id ?? "null"}`,
    `duration_ms=${row.duration_ms}`,
    `status=${row.status}`,
    `audio_ms=${row.audio_ms ?? "null"}`,
    `text_chars=${row.text_chars ?? "null"}`,
    `payload_bytes=${row.payload_bytes ?? "null"}`,
    `model=${row.model ?? "null"}`,
    `provider=${row.provider ?? "null"}`,
    `build_sha=${row.build_sha ?? "null"}`,
    `is_test=${row.is_test}`,
  ].join(" ");
  try {
    console.log(logLine);
  } catch (_) {
    // no-op
  }
}

/**
 * Run an async function under a single span; ends with status 'ok' or 'error' based on throw.
 */
export async function withSpan<T>(
  opts: StartSpanOptions,
  fn: () => Promise<T>
): Promise<T> {
  const handle = startSpan(opts);
  try {
    const result = await fn();
    endSpan(handle, { status: "ok" });
    return result;
  } catch (e) {
    endSpan(handle, {
      status: "error",
      error_code: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/** Resolve org_id from auth for perf spans; use 0 when no org (e.g. unauthenticated). */
export function orgIdFromAuth(auth: { kind: "user"; user: { org_id: number } } | { kind: "master"; orgId: number | null } | null): number {
  if (!auth) return 0;
  if (auth.kind === "user") return auth.user.org_id;
  return auth.orgId ?? 0;
}
