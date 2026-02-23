-- Comment ingestions: store AI extraction results from CRM notes/comments.
-- Append-only; no deduplication (simplest approach per spec).
-- Safe to run multiple times (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS comment_ingestions (
  id SERIAL PRIMARY KEY,
  org_id bigint NOT NULL,
  opportunity_id bigint NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('excel', 'crm', 'manual')),
  source_ref text,
  raw_text text NOT NULL,
  extracted_json jsonb NOT NULL,
  model_metadata jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comment_ingestions_org_opp
  ON comment_ingestions (org_id, opportunity_id);
