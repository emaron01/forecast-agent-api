-- Add user_preferences JSONB column to users for storing per-user settings/preferences.
-- Defaults to an empty JSON object for all existing and future rows.

ALTER TABLE users
ADD COLUMN IF NOT EXISTS user_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_users_user_preferences
ON users USING gin (user_preferences);

