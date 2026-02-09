-- Adds deterministic hierarchy + manager visibility for user management.
-- Safe to run multiple times (best-effort).
--
-- Notes:
-- - This repo currently uses integer IDs for users/orgs. This migration follows that reality.
-- - hierarchy_levels is a read-only lookup table (seeded here).
-- - manager_visibility stores explicit visibility edges (manager -> visible user).

-- ----------------------------
-- hierarchy_levels (lookup)
-- ----------------------------

CREATE TABLE IF NOT EXISTS hierarchy_levels (
  level integer PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL
);

INSERT INTO hierarchy_levels (level, label, description)
VALUES
  (0, 'Admin', 'Full org visibility and override'),
  (1, 'Executive Manager', 'Can see all managers and reps; may be configured to see all'),
  (2, 'Manager', 'Can see assigned reps and assigned managers'),
  (3, 'Rep', 'Sees only their own deals')
ON CONFLICT (level) DO NOTHING;

-- ----------------------------
-- manager_visibility
-- ----------------------------

CREATE TABLE IF NOT EXISTS manager_visibility (
  id SERIAL PRIMARY KEY,
  manager_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visible_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

-- Prevent duplicates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'manager_visibility_manager_visible_uq'
  ) THEN
    ALTER TABLE manager_visibility
      ADD CONSTRAINT manager_visibility_manager_visible_uq
      UNIQUE (manager_user_id, visible_user_id);
  END IF;
END $$;

-- Prevent self-visibility edges.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'manager_visibility_no_self'
  ) THEN
    ALTER TABLE manager_visibility
      ADD CONSTRAINT manager_visibility_no_self
      CHECK (manager_user_id <> visible_user_id);
  END IF;
END $$;

-- ----------------------------
-- users: role, hierarchy, account_owner_name rules, see_all_visibility
-- ----------------------------

-- Add see_all_visibility flag (for managers/exec managers).
ALTER TABLE users ADD COLUMN IF NOT EXISTS see_all_visibility boolean NOT NULL DEFAULT false;

-- Ensure hierarchy_level column exists and is not null.
ALTER TABLE users ADD COLUMN IF NOT EXISTS hierarchy_level integer;
UPDATE users SET hierarchy_level = COALESCE(hierarchy_level, 3) WHERE hierarchy_level IS NULL;
ALTER TABLE users ALTER COLUMN hierarchy_level SET DEFAULT 3;
ALTER TABLE users ALTER COLUMN hierarchy_level SET NOT NULL;

-- Align existing values to the new deterministic mapping where possible:
-- - ADMIN -> 0
-- - MANAGER -> 2
-- - REP -> 3
UPDATE users
   SET hierarchy_level = 0
 WHERE role = 'ADMIN'
   AND hierarchy_level <> 0;

UPDATE users
   SET hierarchy_level = 2
 WHERE role = 'MANAGER'
   AND hierarchy_level <> 2;

UPDATE users
   SET hierarchy_level = 3
 WHERE role = 'REP'
   AND hierarchy_level <> 3;

-- Make account_owner_name nullable; enforce via a check constraint for reps (level 3).
DO $$
BEGIN
  -- Drop NOT NULL if present.
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'account_owner_name'
       AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE users ALTER COLUMN account_owner_name DROP NOT NULL;
  END IF;
END $$;

-- Enforce: Level 3 (Rep) MUST have account_owner_name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'users_rep_account_owner_required'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_rep_account_owner_required
      CHECK (hierarchy_level <> 3 OR (account_owner_name IS NOT NULL AND length(btrim(account_owner_name)) > 0));
  END IF;
END $$;

-- Update role check constraint to include EXEC_MANAGER.
DO $$
DECLARE
  cname text;
BEGIN
  -- Drop any existing CHECK constraint that restricts users.role.
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'users'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%role%'
     AND pg_get_constraintdef(oid) ILIKE '%ADMIN%'
     AND pg_get_constraintdef(oid) ILIKE '%REP%'
   LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', cname);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'users_role_enum_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_enum_check
      CHECK (role IN ('ADMIN','EXEC_MANAGER','MANAGER','REP'));
  END IF;
END $$;

