CREATE TABLE IF NOT EXISTS hubspot_writeback_mappings (
  org_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sf_field text NOT NULL,
  mode text NOT NULL DEFAULT 'sf_property',
  hubspot_property text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, sf_field),
  CONSTRAINT hubspot_writeback_mappings_mode_check
    CHECK (mode IN ('sf_property', 'custom'))
);

CREATE OR REPLACE FUNCTION hubspot_writeback_mappings_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hubspot_writeback_mappings_set_updated_at_trg
  ON hubspot_writeback_mappings;

CREATE TRIGGER hubspot_writeback_mappings_set_updated_at_trg
BEFORE UPDATE ON hubspot_writeback_mappings
FOR EACH ROW
EXECUTE FUNCTION hubspot_writeback_mappings_set_updated_at();
