-- MODE B: Add label + tip fields to category assessments

BEGIN;

ALTER TABLE opportunity_category_assessments
  ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tip   TEXT NOT NULL DEFAULT '';

COMMIT;

