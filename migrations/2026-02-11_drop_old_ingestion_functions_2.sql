-- Follow-up drop for existing function signature in DB.
-- Needed because CREATE OR REPLACE cannot change return type.

DROP FUNCTION IF EXISTS process_ingestion_batch(integer, bigint);

