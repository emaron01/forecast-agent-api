-- Forecast Agent Telemetry (Phase 2): evidence_strength, confidence, predictive_eligible
--
-- Per-category: <category>_evidence_strength, <category>_confidence
-- Opportunity-level: predictive_eligible (boolean)
--
-- Safe to run multiple times (idempotent).
-- Additive only; no drops or renames.

DO $$
DECLARE
  cat text;
  cats text[] := ARRAY['pain','metrics','champion','eb','criteria','process','competition','paper','timing','budget'];
BEGIN
  IF to_regclass('public.opportunities') IS NULL THEN
    RETURN;
  END IF;

  -- Per-category: evidence_strength (text), confidence (text)
  FOREACH cat IN ARRAY cats
  LOOP
    EXECUTE format('ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS %I text', cat || '_evidence_strength');
    EXECUTE format('ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS %I text', cat || '_confidence');
  END LOOP;

  -- Opportunity-level: predictive_eligible (boolean)
  ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS predictive_eligible boolean;

  COMMENT ON COLUMN public.opportunities.predictive_eligible IS 'TRUE when opportunity is NOT Closed Won/Lost; FALSE when closed. Used for training data filtering.';
END;
$$ LANGUAGE plpgsql;
