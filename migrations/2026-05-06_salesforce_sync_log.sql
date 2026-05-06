-- Salesforce sync log. Mirrors hubspot_sync_log exactly.
-- opportunities_fetched/upserted/scored mirrors deals_ columns in hubspot_sync_log.
CREATE TABLE IF NOT EXISTS salesforce_sync_log (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  bigint      NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sync_type               text        NOT NULL CHECK (
                            sync_type IN ('initial', 'scheduled', 'webhook', 'manual')
                          ),
  status                  text        NOT NULL CHECK (
                            status IN ('pending', 'running', 'completed', 'failed')
                          ),
  opportunities_fetched   integer     DEFAULT 0,
  opportunities_upserted  integer     DEFAULT 0,
  opportunities_scored    integer     DEFAULT 0,
  error_text              text,
  started_at              timestamptz DEFAULT now(),
  completed_at            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_salesforce_sync_log_org_id
  ON salesforce_sync_log(org_id);

CREATE INDEX IF NOT EXISTS idx_salesforce_sync_log_started_at
  ON salesforce_sync_log(started_at);
