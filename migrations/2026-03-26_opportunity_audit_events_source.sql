-- Populate opportunity_audit_events.source: 'ingest' (paste/AI notes) vs 'matthew' (conversational review).
-- Application sets source on new inserts (muscle.js); this adds the column and backfills existing rows.

DO $$
BEGIN
  IF to_regclass('public.opportunity_audit_events') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'opportunity_audit_events'
         AND column_name = 'source'
    ) THEN
      ALTER TABLE public.opportunity_audit_events ADD COLUMN source text;
    END IF;
  END IF;
END $$;

UPDATE public.opportunity_audit_events
SET source =
  CASE
    WHEN meta->'scoring'->>'score_source' = 'ai_notes' THEN 'ingest'
    ELSE 'matthew'
  END
WHERE source = 'ingest'
   OR source IS NULL;
