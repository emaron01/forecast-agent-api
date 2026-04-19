CREATE TABLE IF NOT EXISTS hubspot_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sync_type text NOT NULL CHECK (
    sync_type IN ('initial', 'scheduled', 'webhook', 'manual')
  ),
  status text NOT NULL CHECK (
    status IN ('pending', 'running', 'completed', 'failed')
  ),
  deals_fetched integer DEFAULT 0,
  deals_upserted integer DEFAULT 0,
  deals_scored integer DEFAULT 0,
  error_text text,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_hubspot_sync_log_org_id
  ON hubspot_sync_log(org_id);
CREATE INDEX IF NOT EXISTS idx_hubspot_sync_log_started_at
  ON hubspot_sync_log(started_at);
