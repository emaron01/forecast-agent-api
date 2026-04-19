ALTER TABLE hubspot_connections
  ADD COLUMN IF NOT EXISTS hub_tier text NOT NULL DEFAULT 'starter'
  CHECK (hub_tier IN ('starter', 'professional', 'enterprise'));
