-- Add 'lost' as a distinct CRM bucket (separate from 'excluded' for junk/duplicates).

ALTER TABLE org_stage_mappings
  DROP CONSTRAINT IF EXISTS org_stage_mappings_bucket_check;

ALTER TABLE org_stage_mappings
  ADD CONSTRAINT org_stage_mappings_bucket_check
  CHECK (bucket IN ('won', 'commit', 'best_case', 'pipeline', 'excluded', 'lost'));
