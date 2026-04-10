-- Allow admin users (hierarchy_level 0) to have see_all_visibility = true.
-- Executive Dashboard admins in small orgs align with EXEC_MANAGER/MANAGER see-all behavior.
--
-- Previous definition (2026-03-21_rename_channel_roles_executive_director.sql):
--   see_all_visibility IS FALSE
--   OR hierarchy_level IN (1, 2)
--   OR (role = 'CHANNEL_EXECUTIVE' AND hierarchy_level = 6)
-- This migration is a strict superset: adds 0 to the IN list; channel exec rule unchanged.
--
-- Idempotent: drop then add so re-running the migration restores the intended constraint.

DO $$
BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_see_all_visibility_level_check;

  ALTER TABLE users
    ADD CONSTRAINT users_see_all_visibility_level_check
    CHECK (
      see_all_visibility IS FALSE
      OR hierarchy_level IN (0, 1, 2)
      OR (role = 'CHANNEL_EXECUTIVE' AND hierarchy_level = 6)
    );
END $$;
