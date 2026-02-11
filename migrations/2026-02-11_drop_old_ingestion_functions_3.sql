-- Drop additional legacy overloads of ingestion functions.
-- Safe to run multiple times.

DROP FUNCTION IF EXISTS normalize_row(jsonb, integer);
DROP FUNCTION IF EXISTS normalize_row(jsonb, bigint);

DROP FUNCTION IF EXISTS validate_row(jsonb, integer);
DROP FUNCTION IF EXISTS validate_row(jsonb, bigint);

DROP FUNCTION IF EXISTS upsert_opportunity(jsonb, integer);
DROP FUNCTION IF EXISTS upsert_opportunity(jsonb, bigint);

DROP FUNCTION IF EXISTS process_ingestion_batch(integer, bigint);
DROP FUNCTION IF EXISTS process_ingestion_batch(bigint, bigint);

