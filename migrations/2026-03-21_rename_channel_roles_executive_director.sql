-- Rename channel roles to hierarchy-aligned names and normalize levels / flags.
--
-- Run this diagnostic manually on prod BEFORE applying, if the migration fails on
-- users_role_enum_check — it lists any role values not in the final allow-list:
--
--   SELECT DISTINCT role FROM users
--   WHERE role NOT IN (
--     'ADMIN','EXEC_MANAGER','MANAGER','REP',
--     'CHANNEL_EXECUTIVE','CHANNEL_DIRECTOR','CHANNEL_REP'
--   );
--
-- Same for reps (if present):
--
--   SELECT DISTINCT role FROM reps
--   WHERE role NOT IN (
--     'ADMIN','EXEC_MANAGER','MANAGER','REP',
--     'CHANNEL_EXECUTIVE','CHANNEL_DIRECTOR','CHANNEL_REP'
--   );
--
-- Order: fix data (UPDATE) → DROP old constraints → ADD new constraints.

-- ---------------------------------------------------------------------------
-- 1) users — remap legacy / unexpected role values to supported roles
-- ---------------------------------------------------------------------------

-- Reverted or experimental role name (same product intent as channel rep).
UPDATE users
   SET role = 'CHANNEL_REP',
       hierarchy_level = 8,
       see_all_visibility = FALSE
 WHERE role = 'FORECAST_AGENT';

-- Older channel role strings → new names + levels
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

-- ---------------------------------------------------------------------------
-- 2) reps — same legacy remaps (must run before reps_role_check is recreated)
-- ---------------------------------------------------------------------------

ALTER TABLE reps DROP CONSTRAINT IF EXISTS reps_role_check;

UPDATE reps SET role = 'CHANNEL_REP' WHERE role = 'FORECAST_AGENT';

UPDATE reps SET role = 'CHANNEL_EXECUTIVE' WHERE role = 'CHANNEL_EXEC';
UPDATE reps SET role = 'CHANNEL_DIRECTOR' WHERE role = 'CHANNEL_MANAGER';

-- ---------------------------------------------------------------------------
-- 3) users — drop old CHECKs, then add new allow-list and related rules
-- ---------------------------------------------------------------------------

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

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_see_all_visibility_level_check;

ALTER TABLE users
  ADD CONSTRAINT users_see_all_visibility_level_check
  CHECK (
    see_all_visibility IS FALSE
    OR hierarchy_level IN (1, 2)
    OR (role = 'CHANNEL_EXECUTIVE' AND hierarchy_level = 6)
  );

-- NOTE:
-- The `users_channel_executive_no_manager` constraint was later removed
-- (see 2026-03-23_drop_users_channel_executive_no_manager.sql) to allow
-- CHANNEL_EXECUTIVE users to align to a manager like other channel roles.
-- Keep this migration re-runnable by ensuring that constraint is not present.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_channel_executive_no_manager;

-- ---------------------------------------------------------------------------
-- 4) reps — allow-list (reps_role_check was dropped in step 2)
-- ---------------------------------------------------------------------------

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
