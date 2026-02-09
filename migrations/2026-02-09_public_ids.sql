-- Add UUID-based public identifiers (public_id) for external references.
-- Keep existing integer primary keys intact.
-- Safe to run multiple times (best-effort).

-- gen_random_uuid() requires pgcrypto.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Helper: add public_id column + backfill + constraints (repeated per table).

-- organizations
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='organizations' AND column_name='public_id') THEN
      ALTER TABLE organizations ADD COLUMN public_id uuid;
    END IF;
    UPDATE organizations SET public_id = gen_random_uuid() WHERE public_id IS NULL;
    ALTER TABLE organizations ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
    ALTER TABLE organizations ALTER COLUMN public_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='organizations_public_id_uq') THEN
      ALTER TABLE organizations ADD CONSTRAINT organizations_public_id_uq UNIQUE (public_id);
    END IF;
  END IF;
END $$;

-- users
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='public_id') THEN
      ALTER TABLE users ADD COLUMN public_id uuid;
    END IF;
    UPDATE users SET public_id = gen_random_uuid() WHERE public_id IS NULL;
    ALTER TABLE users ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
    ALTER TABLE users ALTER COLUMN public_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_public_id_uq') THEN
      ALTER TABLE users ADD CONSTRAINT users_public_id_uq UNIQUE (public_id);
    END IF;
  END IF;
END $$;

-- opportunities
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='opportunities') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='opportunities' AND column_name='public_id') THEN
      ALTER TABLE opportunities ADD COLUMN public_id uuid;
    END IF;
    UPDATE opportunities SET public_id = gen_random_uuid() WHERE public_id IS NULL;
    ALTER TABLE opportunities ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
    ALTER TABLE opportunities ALTER COLUMN public_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='opportunities_public_id_uq') THEN
      ALTER TABLE opportunities ADD CONSTRAINT opportunities_public_id_uq UNIQUE (public_id);
    END IF;
  END IF;
END $$;

-- reps
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='reps') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reps' AND column_name='public_id') THEN
      ALTER TABLE reps ADD COLUMN public_id uuid;
    END IF;
    UPDATE reps SET public_id = gen_random_uuid() WHERE public_id IS NULL;
    ALTER TABLE reps ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
    ALTER TABLE reps ALTER COLUMN public_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reps_public_id_uq') THEN
      ALTER TABLE reps ADD CONSTRAINT reps_public_id_uq UNIQUE (public_id);
    END IF;
  END IF;
END $$;

-- field_mapping_sets (referenced in URLs)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='field_mapping_sets') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='field_mapping_sets' AND column_name='public_id') THEN
      ALTER TABLE field_mapping_sets ADD COLUMN public_id uuid;
    END IF;
    UPDATE field_mapping_sets SET public_id = gen_random_uuid() WHERE public_id IS NULL;
    ALTER TABLE field_mapping_sets ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
    ALTER TABLE field_mapping_sets ALTER COLUMN public_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='field_mapping_sets_public_id_uq') THEN
      ALTER TABLE field_mapping_sets ADD CONSTRAINT field_mapping_sets_public_id_uq UNIQUE (public_id);
    END IF;
  END IF;
END $$;

