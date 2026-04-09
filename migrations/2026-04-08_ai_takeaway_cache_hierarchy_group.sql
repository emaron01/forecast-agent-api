-- Partition ai_takeaway_cache by sales vs channel viewer so identical payload_sha does not cross roles.
-- Idempotent: safe on every deploy / restart (constraint and index may already exist).

ALTER TABLE ai_takeaway_cache
  ADD COLUMN IF NOT EXISTS hierarchy_level_group text NOT NULL DEFAULT 'sales';

UPDATE ai_takeaway_cache
SET hierarchy_level_group = 'sales'
WHERE hierarchy_level_group IS NULL OR btrim(hierarchy_level_group) = '';

-- Legacy index name from initial migration; later 4-column index from first pass of this file.
DROP INDEX IF EXISTS idx_ai_takeaway_cache_lookup;
DROP INDEX IF EXISTS ai_takeaway_cache_org_surface_sha_idx;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'ai_takeaway_cache'
       AND c.conname = 'ai_takeaway_cache_org_surface_sha_group_key'
  ) THEN
    ALTER TABLE ai_takeaway_cache
      DROP CONSTRAINT IF EXISTS ai_takeaway_cache_org_id_surface_payload_sha_key;
    ALTER TABLE ai_takeaway_cache
      ADD CONSTRAINT ai_takeaway_cache_org_surface_sha_group_key
      UNIQUE (org_id, surface, payload_sha, hierarchy_level_group);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_takeaway_cache_org_surface_sha_group_idx
  ON ai_takeaway_cache (org_id, surface, payload_sha, hierarchy_level_group);
