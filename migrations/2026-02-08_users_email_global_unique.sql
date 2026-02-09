-- Make users.email globally unique (not scoped to org)
-- Safe to run multiple times.

-- Drop old org-scoped uniqueness.
DROP INDEX IF EXISTS users_org_email_uq;

-- Enforce global email uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (email);

