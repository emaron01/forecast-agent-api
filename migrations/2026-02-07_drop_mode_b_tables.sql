-- Drops the now-deprecated Mode B normalized tables.
-- Safe to run multiple times.

DROP TABLE IF EXISTS opportunity_rollups;
DROP TABLE IF EXISTS opportunity_category_assessments;
DROP TABLE IF EXISTS opportunity_category_weights;

