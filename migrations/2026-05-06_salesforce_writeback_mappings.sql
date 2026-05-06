-- Salesforce writeback mappings. Mirrors hubspot_writeback_mappings.
-- sf_field       : internal SalesForecaster.io canonical field name
-- sfdc_api_name  : Salesforce Opportunity custom field API name (e.g. SF_Health_Score__c)
-- mode           : 'sfdc_field' (standard/custom field) or 'custom' (future use)
CREATE TABLE IF NOT EXISTS salesforce_writeback_mappings (
  org_id          integer     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sf_field        text        NOT NULL,
  mode            text        NOT NULL DEFAULT 'sfdc_field',
  sfdc_api_name   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, sf_field),
  CONSTRAINT salesforce_writeback_mappings_mode_check
    CHECK (mode IN ('sfdc_field', 'custom'))
);

CREATE OR REPLACE FUNCTION salesforce_writeback_mappings_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS salesforce_writeback_mappings_set_updated_at_trg
  ON salesforce_writeback_mappings;

CREATE TRIGGER salesforce_writeback_mappings_set_updated_at_trg
BEFORE UPDATE ON salesforce_writeback_mappings
FOR EACH ROW
EXECUTE FUNCTION salesforce_writeback_mappings_set_updated_at();
