-- Add UUID public identifiers to auth/utility tables.
-- Safe to run multiple times (best-effort).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- user_sessions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_sessions') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_sessions' AND column_name='public_id') THEN
      ALTER TABLE user_sessions ADD COLUMN public_id uuid;
    END IF;
    UPDATE user_sessions SET public_id = gen_random_uuid() WHERE public_id IS NULL;
    ALTER TABLE user_sessions ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
    ALTER TABLE user_sessions ALTER COLUMN public_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='user_sessions_public_id_uq') THEN
      ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_public_id_uq UNIQUE (public_id);
    END IF;
  END IF;
END $$;

-- password_reset_tokens
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='password_reset_tokens') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='password_reset_tokens' AND column_name='public_id') THEN
      ALTER TABLE password_reset_tokens ADD COLUMN public_id uuid;
    END IF;
    UPDATE password_reset_tokens SET public_id = gen_random_uuid() WHERE public_id IS NULL;
    ALTER TABLE password_reset_tokens ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
    ALTER TABLE password_reset_tokens ALTER COLUMN public_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='password_reset_tokens_public_id_uq') THEN
      ALTER TABLE password_reset_tokens ADD CONSTRAINT password_reset_tokens_public_id_uq UNIQUE (public_id);
    END IF;
  END IF;
END $$;

