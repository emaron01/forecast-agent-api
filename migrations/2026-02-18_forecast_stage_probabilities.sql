DO $$
BEGIN
  -- Guard: skip if base schema is missing.
  IF to_regclass('public.organizations') IS NULL THEN
    RETURN;
  END IF;

  -- Forecast stage probabilities (org-level settings)
  IF to_regclass('public.forecast_stage_probabilities') IS NULL THEN
    EXECUTE $sql$
      CREATE TABLE public.forecast_stage_probabilities (
        id BIGSERIAL PRIMARY KEY,
        org_id BIGINT NOT NULL REFERENCES public.organizations(id),
        stage_key TEXT NOT NULL,
        probability NUMERIC NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (org_id, stage_key)
      );
    $sql$;
  END IF;

  -- Best-effort constraints + indexes
  BEGIN
    EXECUTE 'ALTER TABLE public.forecast_stage_probabilities
      ADD CONSTRAINT forecast_stage_probabilities_probability_ck
      CHECK (probability >= 0 AND probability <= 1)';
  EXCEPTION WHEN OTHERS THEN
    -- ignore if already exists or restricted
  END;

  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS forecast_stage_probabilities_org_idx ON public.forecast_stage_probabilities (org_id)';
  EXCEPTION WHEN OTHERS THEN
    -- ignore
  END;
END;
$$ LANGUAGE plpgsql;

