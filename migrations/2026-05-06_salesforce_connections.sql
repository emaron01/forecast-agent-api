-- Salesforce OAuth connections per org.
-- Mirrors hubspot_connections with SFDC-specific additions:
--   instance_url  : dynamic per org (e.g. https://na1.salesforce.com)
--   sandbox       : true if connected to a sandbox org
--   sf_org_id     : Salesforce 18-char org ID (equivalent to hub_id)
--   api_version   : SFDC REST API version in use (default v59.0)
CREATE TABLE IF NOT EXISTS salesforce_connections (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              bigint      NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sf_org_id           text        NOT NULL,
  instance_url        text        NOT NULL,
  sf_domain           text,
  access_token_enc    text        NOT NULL,
  refresh_token_enc   text        NOT NULL,
  token_expires_at    timestamptz NOT NULL,
  scopes              text[],
  writeback_enabled   boolean     NOT NULL DEFAULT false,
  sandbox             boolean     NOT NULL DEFAULT false,
  api_version         text        NOT NULL DEFAULT 'v59.0',
  connected_at        timestamptz DEFAULT now(),
  last_synced_at      timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  UNIQUE (org_id)
);

CREATE INDEX IF NOT EXISTS idx_salesforce_connections_org_id
  ON salesforce_connections(org_id);
