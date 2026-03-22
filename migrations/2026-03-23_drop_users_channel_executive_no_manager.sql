-- Allow CHANNEL_EXECUTIVE to set manager_user_id (align to sales leader) like other channel roles.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_channel_executive_no_manager;
