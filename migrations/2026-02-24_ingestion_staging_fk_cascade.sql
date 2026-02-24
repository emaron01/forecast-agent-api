-- ingestion_staging.mapping_set_id FK: allow delete/update of field_mapping_sets by cascading.
-- When a field_mapping_set is deleted, delete its ingestion_staging rows.
-- Safe to run multiple times.

DO $$
DECLARE
  fk_name text;
BEGIN
  -- Find the FK constraint on ingestion_staging that references field_mapping_sets
  SELECT c.conname INTO fk_name
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_class ref ON ref.oid = c.confrelid
   WHERE rel.relname = 'ingestion_staging'
     AND ref.relname = 'field_mapping_sets'
     AND c.contype = 'f'
   LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.ingestion_staging DROP CONSTRAINT %I', fk_name);
    ALTER TABLE public.ingestion_staging
      ADD CONSTRAINT ingestion_staging_mapping_set_id_fkey
      FOREIGN KEY (mapping_set_id)
      REFERENCES public.field_mapping_sets(id)
      ON DELETE CASCADE;
  END IF;
END $$;
