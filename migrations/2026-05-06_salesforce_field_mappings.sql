-- Salesforce field mappings. Mirrors hubspot_field_mappings.
-- sf_field       : internal SalesForecaster.io canonical field name
-- sfdc_api_name  : Salesforce Opportunity API field name (e.g. Amount, StageName, Custom_Field__c)
CREATE TABLE IF NOT EXISTS salesforce_field_mappings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          bigint      NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sf_field        text        NOT NULL,
  sfdc_api_name   text,
  confidence      text        CHECK (confidence IN ('high', 'medium', 'low', 'none')),
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (org_id, sf_field)
);

CREATE INDEX IF NOT EXISTS idx_salesforce_field_mappings_org_id
  ON salesforce_field_mappings(org_id);
