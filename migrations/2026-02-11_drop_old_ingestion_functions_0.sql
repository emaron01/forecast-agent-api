-- Drop legacy ingestion functions/procedures (all common overloads).
-- Safe to run multiple times.

-- Some environments may have a PROCEDURE instead of a FUNCTION.
DO $$
BEGIN
  -- DROP PROCEDURE will error if a FUNCTION exists with same signature.
  BEGIN
    EXECUTE 'DROP PROCEDURE IF EXISTS process_ingestion_batch(integer, bigint)';
  EXCEPTION WHEN wrong_object_type THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'DROP PROCEDURE IF EXISTS process_ingestion_batch(bigint, bigint)';
  EXCEPTION WHEN wrong_object_type THEN
    NULL;
  END;
END $$;

-- Functions
DROP FUNCTION IF EXISTS normalize_row(jsonb, integer);
DROP FUNCTION IF EXISTS normalize_row(jsonb, bigint);

DROP FUNCTION IF EXISTS validate_row(jsonb, integer);
DROP FUNCTION IF EXISTS validate_row(jsonb, bigint);

DROP FUNCTION IF EXISTS upsert_opportunity(jsonb, integer);
DROP FUNCTION IF EXISTS upsert_opportunity(jsonb, bigint);

DROP FUNCTION IF EXISTS process_ingestion_batch(integer, bigint);
DROP FUNCTION IF EXISTS process_ingestion_batch(bigint, bigint);

