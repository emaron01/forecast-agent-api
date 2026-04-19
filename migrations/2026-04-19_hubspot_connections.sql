CREATE TABLE IF NOT EXISTS hubspot_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  hub_id text NOT NULL,
  hub_domain text,
  access_token_enc text NOT NULL,
  refresh_token_enc text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  scopes text[],
  writeback_enabled boolean NOT NULL DEFAULT false,
  connected_at timestamptz DEFAULT now(),
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (org_id)
);

CREATE INDEX IF NOT EXISTS idx_hubspot_connections_org_id
  ON hubspot_connections(org_id);
