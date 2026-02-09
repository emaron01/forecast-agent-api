-- score_definitions are global (not org-scoped).
-- Ensure they are NOT deleted when an org is deleted by removing any org FK.
-- This repo doesn't currently define the score_definitions table, but production DBs may have it.
-- Safe to run multiple times (best-effort).

DO $$
BEGIN
  -- Only proceed if the table exists.
  IF EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'score_definitions'
  ) THEN
    -- Only proceed if org_id column exists.
    IF EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'score_definitions'
         AND column_name = 'org_id'
    ) THEN
      -- Drop existing FK if present (may currently be ON DELETE CASCADE).
      IF EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'score_definitions_org_id_fkey'
      ) THEN
        ALTER TABLE score_definitions DROP CONSTRAINT score_definitions_org_id_fkey;
      END IF;

      -- Drop the column entirely: score_definitions are not org-scoped.
      ALTER TABLE score_definitions DROP COLUMN IF EXISTS org_id;
    END IF;
  END IF;
END $$;

