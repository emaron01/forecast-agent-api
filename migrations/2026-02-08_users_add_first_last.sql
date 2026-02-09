-- Add first/last name fields to users.
-- Safe to run multiple times.

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name text;

