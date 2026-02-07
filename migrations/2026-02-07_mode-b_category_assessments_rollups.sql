-- MODE B: Category Update storage + deterministic rollups
-- Safe to run multiple times (IF NOT EXISTS guards).

BEGIN;

-- 1) Per-opportunity per-category assessments (authoritative stored scores + evidence)
CREATE TABLE IF NOT EXISTS opportunity_category_assessments (
  org_id          INTEGER NOT NULL,
  opportunity_id  INTEGER NOT NULL,
  category        TEXT    NOT NULL,
  score           INTEGER NOT NULL CHECK (score >= 0 AND score <= 3),
  evidence        TEXT    NOT NULL DEFAULT '',
  turns           JSONB   NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, opportunity_id, category)
);

CREATE INDEX IF NOT EXISTS idx_opp_category_assessments_lookup
  ON opportunity_category_assessments (org_id, opportunity_id);

-- 2) Category weights (points_max per category; overall max defaults to 30 when all 10 categories are present)
-- Default: if a weight row is missing, the API falls back to points_max=3 for that category.
CREATE TABLE IF NOT EXISTS opportunity_category_weights (
  org_id      INTEGER NOT NULL,
  category    TEXT    NOT NULL,
  points_max  NUMERIC(6,2) NOT NULL CHECK (points_max > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, category)
);

-- 3) Derived rollups (regeneratable outputs)
CREATE TABLE IF NOT EXISTS opportunity_rollups (
  org_id          INTEGER NOT NULL,
  opportunity_id  INTEGER NOT NULL,
  overall_score   NUMERIC(6,2) NOT NULL DEFAULT 0,
  overall_max     NUMERIC(6,2) NOT NULL DEFAULT 30,
  summary         TEXT NOT NULL DEFAULT '',
  next_steps      TEXT NOT NULL DEFAULT '',
  risks           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_opp_rollups_lookup
  ON opportunity_rollups (org_id, opportunity_id);

COMMIT;

