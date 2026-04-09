-- Partition ai_takeaway_cache by sales vs channel viewer so identical payload_sha does not cross roles.
ALTER TABLE ai_takeaway_cache
  ADD COLUMN IF NOT EXISTS hierarchy_level_group text NOT NULL DEFAULT 'sales';

UPDATE ai_takeaway_cache
SET hierarchy_level_group = 'sales'
WHERE hierarchy_level_group IS NULL OR btrim(hierarchy_level_group) = '';

ALTER TABLE ai_takeaway_cache
  DROP CONSTRAINT IF EXISTS ai_takeaway_cache_org_id_surface_payload_sha_key;

DROP INDEX IF EXISTS idx_ai_takeaway_cache_lookup;

ALTER TABLE ai_takeaway_cache
  ADD CONSTRAINT ai_takeaway_cache_org_surface_sha_group_key
  UNIQUE (org_id, surface, payload_sha, hierarchy_level_group);

CREATE INDEX IF NOT EXISTS idx_ai_takeaway_cache_lookup
  ON ai_takeaway_cache (org_id, surface, payload_sha, hierarchy_level_group);
