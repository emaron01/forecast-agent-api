-- Fix role constraints on databases that ran migrations before channel roles were added.
-- Safe to run on any DB; drops and recreates constraints to the current canonical definitions.

BEGIN;

-- 1. Remap any legacy role values that may exist
UPDATE users SET role = 'CHANNEL_EXECUTIVE', hierarchy_level = 6 WHERE role = 'CHANNEL_EXEC';
UPDATE users SET role = 'CHANNEL_DIRECTOR',  hierarchy_level = 7 WHERE role = 'CHANNEL_MANAGER';
UPDATE users SET role = 'CHANNEL_REP',       hierarchy_level = 8 WHERE role = 'FORECAST_AGENT';

UPDATE reps SET role = 'CHANNEL_EXECUTIVE' WHERE role = 'CHANNEL_EXEC';
UPDATE reps SET role = 'CHANNEL_DIRECTOR'  WHERE role = 'CHANNEL_MANAGER';
UPDATE reps SET role = 'CHANNEL_REP'       WHERE role = 'FORECAST_AGENT';

-- 2. Recreate users_role_enum_check
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_enum_check;
ALTER TABLE users ADD CONSTRAINT users_role_enum_check
  CHECK (role IN ('ADMIN','EXEC_MANAGER','MANAGER','REP','CHANNEL_EXECUTIVE','CHANNEL_DIRECTOR','CHANNEL_REP'));

-- 3. Recreate users_role_hierarchy_match
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_hierarchy_match;
ALTER TABLE users ADD CONSTRAINT users_role_hierarchy_match CHECK (
  (role = 'ADMIN'             AND hierarchy_level = 0) OR
  (role = 'EXEC_MANAGER'      AND hierarchy_level = 1) OR
  (role = 'MANAGER'           AND hierarchy_level = 2) OR
  (role = 'REP'               AND hierarchy_level = 3) OR
  (role = 'CHANNEL_EXECUTIVE' AND hierarchy_level = 6) OR
  (role = 'CHANNEL_DIRECTOR'  AND hierarchy_level = 7) OR
  (role = 'CHANNEL_REP'       AND hierarchy_level = 8)
);

-- 4. Recreate reps role check
ALTER TABLE reps DROP CONSTRAINT IF EXISTS reps_role_check;
ALTER TABLE reps ADD CONSTRAINT reps_role_check
  CHECK (role IN ('ADMIN','EXEC_MANAGER','MANAGER','REP','CHANNEL_EXECUTIVE','CHANNEL_DIRECTOR','CHANNEL_REP'));

COMMIT;
