-- 24-hour cache TTL for AI takeaway rows (see web/app/api/ai-takeaway-cache/route.ts).
ALTER TABLE ai_takeaway_cache
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE ai_takeaway_cache
SET expires_at = updated_at + INTERVAL '24 hours'
WHERE expires_at IS NULL;

ALTER TABLE ai_takeaway_cache
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '24 hours');

ALTER TABLE ai_takeaway_cache
  ALTER COLUMN expires_at SET NOT NULL;
