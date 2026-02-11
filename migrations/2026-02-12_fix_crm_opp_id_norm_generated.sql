-- Deprecated migration.
--
-- This repo must not embed a definition of upsert_opportunity(jsonb, bigint) or any direct
-- INSERT/UPDATE logic for opportunities ingestion. The contract is:
--   - app/worker code calls the DB function upsert_opportunity(jsonb, integer)
--   - the wrapper delegates to upsert_opportunity(jsonb, bigint) that is owned/managed on the DB
--
-- Intentionally left as a no-op.

