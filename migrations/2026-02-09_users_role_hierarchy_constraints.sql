-- Harden user hierarchy invariants at the database layer.
-- Safe to run multiple times (best-effort).

-- Ensure EXEC_MANAGER rows (if any) are aligned.
UPDATE users
   SET hierarchy_level = 1
 WHERE role = 'EXEC_MANAGER'
   AND hierarchy_level <> 1;

-- Enforce: role <-> hierarchy_level mapping is deterministic.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'users_role_hierarchy_match'
  ) THEN
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
  END IF;
END $$;

-- Enforce: hierarchy_level must exist in hierarchy_levels lookup table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'hierarchy_levels'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conname = 'users_hierarchy_level_fkey'
    ) THEN
      ALTER TABLE users
        ADD CONSTRAINT users_hierarchy_level_fkey
        FOREIGN KEY (hierarchy_level) REFERENCES hierarchy_levels(level);
    END IF;
  END IF;
END $$;

-- Enforce: only hierarchy levels 0/1/2 (and channel executive 6) may have see_all_visibility=true.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'users_see_all_visibility_level_check'
  ) THEN
    UPDATE users
    SET see_all_visibility = false, updated_at = NOW()
    WHERE NOT (
      see_all_visibility IS FALSE
      OR hierarchy_level IN (0, 1, 2)
      OR (role = 'CHANNEL_EXECUTIVE' AND hierarchy_level = 6)
    );
    ALTER TABLE users
      ADD CONSTRAINT users_see_all_visibility_level_check
      CHECK (
        see_all_visibility IS FALSE
        OR hierarchy_level IN (0, 1, 2)
        OR (role = 'CHANNEL_EXECUTIVE' AND hierarchy_level = 6)
      );
  END IF;
END $$;

