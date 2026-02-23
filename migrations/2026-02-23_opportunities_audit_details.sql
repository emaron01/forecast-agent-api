-- Add audit_details jsonb for scoring metadata (confidence, provenance, evidence).
-- Safe: only adds column if missing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'opportunities') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'opportunities' AND column_name = 'audit_details') THEN
      ALTER TABLE opportunities ADD COLUMN audit_details jsonb DEFAULT NULL;
    END IF;
  END IF;
END $$;
