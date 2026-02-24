-- Add health_score_source for provenance: 'baseline' | 'agent'
-- - baseline: set on first scoring (initial ingest / comment ingestion)
-- - agent: set when rep/agent update changes health_score after baseline exists
--
-- Safe to run multiple times (idempotent).

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS health_score_source text;

COMMENT ON COLUMN public.opportunities.health_score_source IS 'Provenance: baseline (first scoring) or agent (rep/agent update)';

-- Default so new rows never get NULL provenance.
ALTER TABLE public.opportunities
  ALTER COLUMN health_score_source SET DEFAULT 'baseline';

-- Backfill: mark obvious agent divergences first (health_score != baseline_health_score).
UPDATE public.opportunities
   SET health_score_source = 'agent'
 WHERE health_score_source IS NULL
   AND baseline_health_score_ts IS NOT NULL
   AND health_score IS NOT NULL
   AND baseline_health_score IS NOT NULL
   AND health_score <> baseline_health_score;

-- Backfill: remaining rows with baseline but NULL source -> 'baseline'.
UPDATE public.opportunities
   SET health_score_source = 'baseline'
 WHERE health_score_source IS NULL
   AND baseline_health_score_ts IS NOT NULL;
