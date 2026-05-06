-- Temporary PKCE code verifier storage for Salesforce OAuth flow.
-- Verifiers are short-lived (15 minutes) and deleted after use.
CREATE TABLE IF NOT EXISTS salesforce_pkce_verifiers (
  state         text        PRIMARY KEY,
  code_verifier text        NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salesforce_pkce_verifiers_expires_at
  ON salesforce_pkce_verifiers(expires_at);
