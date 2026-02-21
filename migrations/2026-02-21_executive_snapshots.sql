-- Executive Snapshots: cached board-shareable syntheses of dashboard AI insights.
-- Idempotent migration (safe to run multiple times).

CREATE TABLE IF NOT EXISTS executive_snapshots (
  org_id bigint NOT NULL,
  quota_period_id bigint NOT NULL,
  input_hash text NOT NULL,
  snapshot_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, quota_period_id, input_hash)
);

CREATE INDEX IF NOT EXISTS idx_executive_snapshots_created_at
  ON executive_snapshots (org_id, quota_period_id, created_at DESC);

