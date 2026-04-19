CREATE TABLE IF NOT EXISTS hubspot_field_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sf_field text NOT NULL,
  hubspot_property text,
  confidence text CHECK (confidence IN ('high', 'medium', 'low', 'none')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (org_id, sf_field)
);

CREATE INDEX IF NOT EXISTS idx_hubspot_field_mappings_org_id
  ON hubspot_field_mappings(org_id);
