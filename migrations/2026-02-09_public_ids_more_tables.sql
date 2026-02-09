-- Add UUID public identifiers to additional externally referenced tables.
-- Safe to run multiple times (best-effort).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- field_mappings (admin mapping UI / APIs)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='field_mappings') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='field_mappings' AND column_name='public_id') THEN
      ALTER TABLE field_mappings ADD COLUMN public_id uuid;
    END IF;
    UPDATE field_mappings SET public_id = gen_random_uuid() WHERE public_id IS NULL;
    ALTER TABLE field_mappings ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
    ALTER TABLE field_mappings ALTER COLUMN public_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='field_mappings_public_id_uq') THEN
      ALTER TABLE field_mappings ADD CONSTRAINT field_mappings_public_id_uq UNIQUE (public_id);
    END IF;
  END IF;
END $$;

-- ingestion_staging (admin ingestion UI / APIs)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ingestion_staging') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ingestion_staging' AND column_name='public_id') THEN
      ALTER TABLE ingestion_staging ADD COLUMN public_id uuid;
    END IF;
    UPDATE ingestion_staging SET public_id = gen_random_uuid() WHERE public_id IS NULL;
    ALTER TABLE ingestion_staging ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
    ALTER TABLE ingestion_staging ALTER COLUMN public_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ingestion_staging_public_id_uq') THEN
      ALTER TABLE ingestion_staging ADD CONSTRAINT ingestion_staging_public_id_uq UNIQUE (public_id);
    END IF;
  END IF;
END $$;

-- opportunity_audit_events (externally referenced in reviews / audit trails)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='opportunity_audit_events') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='opportunity_audit_events' AND column_name='public_id') THEN
      ALTER TABLE opportunity_audit_events ADD COLUMN public_id uuid;
    END IF;
    UPDATE opportunity_audit_events SET public_id = gen_random_uuid() WHERE public_id IS NULL;
    ALTER TABLE opportunity_audit_events ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
    ALTER TABLE opportunity_audit_events ALTER COLUMN public_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='opportunity_audit_events_public_id_uq') THEN
      ALTER TABLE opportunity_audit_events ADD CONSTRAINT opportunity_audit_events_public_id_uq UNIQUE (public_id);
    END IF;
  END IF;
END $$;

-- email_templates (admin UI / public APIs may reference templates)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='email_templates') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='email_templates' AND column_name='public_id') THEN
      ALTER TABLE email_templates ADD COLUMN public_id uuid;
    END IF;
    UPDATE email_templates SET public_id = gen_random_uuid() WHERE public_id IS NULL;
    ALTER TABLE email_templates ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
    ALTER TABLE email_templates ALTER COLUMN public_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='email_templates_public_id_uq') THEN
      ALTER TABLE email_templates ADD CONSTRAINT email_templates_public_id_uq UNIQUE (public_id);
    END IF;
  END IF;
END $$;

-- score_definitions (agent-scoring / global reference)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='score_definitions') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='score_definitions' AND column_name='public_id') THEN
      ALTER TABLE score_definitions ADD COLUMN public_id uuid;
    END IF;
    UPDATE score_definitions SET public_id = gen_random_uuid() WHERE public_id IS NULL;
    ALTER TABLE score_definitions ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
    ALTER TABLE score_definitions ALTER COLUMN public_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='score_definitions_public_id_uq') THEN
      ALTER TABLE score_definitions ADD CONSTRAINT score_definitions_public_id_uq UNIQUE (public_id);
    END IF;
  END IF;
END $$;

