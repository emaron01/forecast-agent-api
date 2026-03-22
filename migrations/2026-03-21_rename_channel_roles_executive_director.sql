-- Widen legacy reps.role CHECK (if present) before renaming role text.
ALTER TABLE reps DROP CONSTRAINT IF EXISTS reps_role_check;

-- Rename channel roles to hierarchy-aligned names:
--   CHANNEL_EXEC       -> CHANNEL_EXECUTIVE (level 6)
--   CHANNEL_MANAGER    -> CHANNEL_DIRECTOR (level 7)
--   CHANNEL_REP        -> unchanged (level 8)
--
-- Also normalizes hierarchy_level / see_all / manager for each role.

-- 1) Data backfill (before constraint changes)
UPDATE users
   SET role = 'CHANNEL_EXECUTIVE',
       hierarchy_level = 6,
       see_all_visibility = TRUE,
       manager_user_id = NULL
 WHERE role = 'CHANNEL_EXEC';

UPDATE users
   SET role = 'CHANNEL_DIRECTOR',
       hierarchy_level = 7,
       see_all_visibility = FALSE
 WHERE role = 'CHANNEL_MANAGER';

UPDATE users
   SET hierarchy_level = 8,
       see_all_visibility = FALSE
 WHERE role = 'CHANNEL_REP';

-- 2) Role allow-list on users
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_enum_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_enum_check
  CHECK (role IN (
    'ADMIN',
    'EXEC_MANAGER',
    'MANAGER',
    'REP',
    'CHANNEL_EXECUTIVE',
    'CHANNEL_DIRECTOR',
    'CHANNEL_REP'
  ));

-- 3) Role <-> hierarchy_level (replace legacy 4-role-only constraint)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_hierarchy_match;

ALTER TABLE users
  ADD CONSTRAINT users_role_hierarchy_match
  CHECK (
    (role = 'ADMIN' AND hierarchy_level = 0)
    OR (role = 'EXEC_MANAGER' AND hierarchy_level = 1)
    OR (role = 'MANAGER' AND hierarchy_level = 2)
    OR (role = 'REP' AND hierarchy_level = 3)
    OR (role = 'CHANNEL_EXECUTIVE' AND hierarchy_level = 6)
    OR (role = 'CHANNEL_DIRECTOR' AND hierarchy_level = 7)
    OR (role = 'CHANNEL_REP' AND hierarchy_level = 8)
  );

-- 4) see_all_visibility: allow levels 1–2 (sales leadership) and Channel Executive (6)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_see_all_visibility_level_check;

ALTER TABLE users
  ADD CONSTRAINT users_see_all_visibility_level_check
  CHECK (
    see_all_visibility IS FALSE
    OR hierarchy_level IN (1, 2)
    OR (role = 'CHANNEL_EXECUTIVE' AND hierarchy_level = 6)
  );

-- 5) Channel Executive: no manager link (aligned to org / channel, not a sales rep tree)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_channel_executive_no_manager'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_channel_executive_no_manager
      CHECK (role <> 'CHANNEL_EXECUTIVE' OR manager_user_id IS NULL);
  END IF;
END $$;

-- 6) Mirror role rename on reps (if any rows used old enum text)
UPDATE reps SET role = 'CHANNEL_EXECUTIVE' WHERE role = 'CHANNEL_EXEC';
UPDATE reps SET role = 'CHANNEL_DIRECTOR' WHERE role = 'CHANNEL_MANAGER';

ALTER TABLE reps
  ADD CONSTRAINT reps_role_check
  CHECK (role IN (
    'ADMIN',
    'EXEC_MANAGER',
    'MANAGER',
    'REP',
    'CHANNEL_EXECUTIVE',
    'CHANNEL_DIRECTOR',
    'CHANNEL_REP'
  ));
