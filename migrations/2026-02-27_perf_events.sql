-- Performance events (raw spans) for health & monitoring.
-- Safe to run multiple times (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS perf_events (
  id bigserial PRIMARY KEY,
  ts timestamptz DEFAULT now() NOT NULL,
  org_id bigint NOT NULL,
  opportunity_id bigint NULL,
  run_id uuid NULL,
  call_id text NULL,
  workflow text NOT NULL,
  stage text NOT NULL,
  duration_ms int NOT NULL,
  status text NOT NULL DEFAULT 'ok',
  http_status int NULL,
  error_code text NULL,
  audio_ms int NULL,
  text_chars int NULL,
  payload_bytes int NULL,
  tokens_in int NULL,
  tokens_out int NULL,
  model text NULL,
  provider text NULL,
  prompt_version text NULL,
  logic_version text NULL,
  schema_version int NULL,
  build_sha text NULL,
  is_test boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_perf_events_ts ON perf_events (ts);
CREATE INDEX IF NOT EXISTS idx_perf_events_workflow_stage_ts ON perf_events (workflow, stage, ts);
CREATE INDEX IF NOT EXISTS idx_perf_events_org_workflow_ts ON perf_events (org_id, workflow, ts);
CREATE INDEX IF NOT EXISTS idx_perf_events_run_id ON perf_events (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_perf_events_call_id ON perf_events (call_id) WHERE call_id IS NOT NULL;

-- Daily rollups for reporting.
CREATE TABLE IF NOT EXISTS perf_rollups_daily (
  day date NOT NULL,
  org_id bigint NULL,
  workflow text NOT NULL,
  stage text NOT NULL,
  count int NOT NULL,
  error_count int NOT NULL,
  p50_ms int NOT NULL,
  p90_ms int NOT NULL,
  p95_ms int NOT NULL,
  p99_ms int NOT NULL,
  avg_ms int NOT NULL,
  max_ms int NOT NULL,
  PRIMARY KEY (day, org_id, workflow, stage)
);

CREATE INDEX IF NOT EXISTS idx_perf_rollups_daily_day ON perf_rollups_daily (day);
