-- Org-level mapping of CRM forecast stage / sales stage values to forecast buckets.

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS public.org_stage_mappings (
    id              BIGSERIAL PRIMARY KEY,
    org_id          BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    field           TEXT NOT NULL CHECK (field IN ('forecast_category', 'stage')),
    stage_value     TEXT NOT NULL,
    bucket          TEXT NOT NULL CHECK (bucket IN ('won', 'commit', 'best_case', 'pipeline', 'excluded')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, field, stage_value)
  );

  CREATE INDEX IF NOT EXISTS idx_org_stage_mappings_org_id ON public.org_stage_mappings(org_id);
END;
$$ LANGUAGE plpgsql;
