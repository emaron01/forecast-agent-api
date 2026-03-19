-- Add channel roles to users role check constraint.
-- Drops the existing constraint and recreates it with 
-- channel roles included.
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
    'CHANNEL_EXEC',
    'CHANNEL_MANAGER',
    'CHANNEL_REP'
  ));
