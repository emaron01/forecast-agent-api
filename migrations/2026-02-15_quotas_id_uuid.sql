-- Convert quotas.id from BIGINT/BIGSERIAL to UUID (canonical).
-- Idempotent: only runs if quotas.id is not already UUID.
-- Safe for Render: uses guarded DO $$ block.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF to_regclass('public.quotas') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'quotas'
       AND column_name = 'id'
       AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE public.quotas
      ALTER COLUMN id DROP DEFAULT,
      ALTER COLUMN id TYPE uuid USING gen_random_uuid(),
      ALTER COLUMN id SET DEFAULT gen_random_uuid();
  END IF;
END;
$$ LANGUAGE plpgsql;

