-- Add FORECAST_AGENT role to users role constraints + hierarchy mapping.
-- FORECAST_AGENT is treated as REP at hierarchy_level = 3.

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_enum_check;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_enum_check
  CHECK (role IN (
    'ADMIN',
    'EXEC_MANAGER',
    'MANAGER',
    'REP',
    'FORECAST_AGENT',
    'CHANNEL_EXEC',
    'CHANNEL_MANAGER',
    'CHANNEL_REP'
  ));

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_hierarchy_match;

ALTER TABLE users
  ADD CONSTRAINT users_role_hierarchy_match
  CHECK (
    (role = 'ADMIN' AND hierarchy_level = 0)
    OR (role = 'EXEC_MANAGER' AND hierarchy_level = 1)
    OR (role = 'MANAGER' AND hierarchy_level = 2)
    OR (role = 'REP' AND hierarchy_level = 3)
    OR (role = 'FORECAST_AGENT' AND hierarchy_level = 3)
  );

