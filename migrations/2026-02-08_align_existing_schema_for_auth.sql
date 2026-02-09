-- Align existing schema with auth/user-management expectations.
-- Safe to run multiple times (best-effort).

-- ----------------------------
-- organizations: ensure active + updated_at exist
-- ----------------------------
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS active boolean;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone;

-- Backfill active/updated_at from existing columns where possible.
UPDATE organizations
   SET active = COALESCE(active, is_active, true)
 WHERE active IS NULL;

UPDATE organizations
   SET updated_at = COALESCE(updated_at, created_at, NOW())
 WHERE updated_at IS NULL;

-- Default for new orgs.
ALTER TABLE organizations ALTER COLUMN active SET DEFAULT true;
ALTER TABLE organizations ALTER COLUMN updated_at SET DEFAULT now();

-- ----------------------------
-- users: add required auth/user-management columns
-- ----------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_owner_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_user_id integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS active boolean;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone;

-- Backfill display_name/account_owner_name/active/updated_at for existing rows.
UPDATE users
   SET display_name = COALESCE(
         display_name,
         full_name,
         NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), '')
       )
 WHERE display_name IS NULL;

UPDATE users
   SET account_owner_name = COALESCE(
         account_owner_name,
         display_name,
         full_name,
         NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), '')
       )
 WHERE account_owner_name IS NULL;

UPDATE users
   SET active = COALESCE(active, true)
 WHERE active IS NULL;

UPDATE users
   SET updated_at = COALESCE(updated_at, created_at, NOW())
 WHERE updated_at IS NULL;

-- Defaults for new users.
ALTER TABLE users ALTER COLUMN active SET DEFAULT true;
ALTER TABLE users ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

-- Optional: add FK for manager_user_id (allows NULLs).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'users_manager_user_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_manager_user_id_fkey
      FOREIGN KEY (manager_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Optional: add FK for org_id (allows NULLs unless you enforce NOT NULL separately).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'users_org_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

