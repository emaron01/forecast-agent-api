-- Normalize all org-related foreign keys to use ON DELETE CASCADE (or SET NULL)
-- so deleting an organization cleans up dependent rows automatically.

DO $$
BEGIN
  -- analytics_saved_reports.org_id -> organizations.id
  IF to_regclass('public.analytics_saved_reports') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.analytics_saved_reports DROP CONSTRAINT IF EXISTS analytics_saved_reports_org_id_fkey;
    EXCEPTION WHEN undefined_object THEN
      -- ignore missing constraint
      NULL;
    END;
    ALTER TABLE public.analytics_saved_reports
      ADD CONSTRAINT analytics_saved_reports_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  -- field_mapping_sets.organization_id -> organizations.id
  IF to_regclass('public.field_mapping_sets') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.field_mapping_sets DROP CONSTRAINT IF EXISTS field_mapping_sets_organization_id_fkey;
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
    ALTER TABLE public.field_mapping_sets
      ADD CONSTRAINT field_mapping_sets_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  -- forecast_probabilities.org_id -> organizations.id
  IF to_regclass('public.forecast_probabilities') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.forecast_probabilities DROP CONSTRAINT IF EXISTS forecast_probabilities_org_id_fkey;
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
    ALTER TABLE public.forecast_probabilities
      ADD CONSTRAINT forecast_probabilities_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  -- forecast_stage_probabilities.org_id -> organizations.id
  IF to_regclass('public.forecast_stage_probabilities') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.forecast_stage_probabilities DROP CONSTRAINT IF EXISTS forecast_stage_probabilities_org_id_fkey;
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
    ALTER TABLE public.forecast_stage_probabilities
      ADD CONSTRAINT forecast_stage_probabilities_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  -- health_score_rules.org_id -> organizations.id
  IF to_regclass('public.health_score_rules') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.health_score_rules DROP CONSTRAINT IF EXISTS health_score_rules_org_id_fkey;
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
    ALTER TABLE public.health_score_rules
      ADD CONSTRAINT health_score_rules_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  -- ingestion_staging.organization_id -> organizations.id
  IF to_regclass('public.ingestion_staging') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.ingestion_staging DROP CONSTRAINT IF EXISTS ingestion_staging_organization_id_fkey;
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
    ALTER TABLE public.ingestion_staging
      ADD CONSTRAINT ingestion_staging_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  -- opportunities.org_id -> organizations.id
  IF to_regclass('public.opportunities') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_org_id_fkey;
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  -- quota_periods.org_id -> organizations.id
  IF to_regclass('public.quota_periods') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.quota_periods DROP CONSTRAINT IF EXISTS quota_periods_org_id_fkey;
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
    ALTER TABLE public.quota_periods
      ADD CONSTRAINT quota_periods_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  -- quotas.org_id -> organizations.id
  IF to_regclass('public.quotas') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.quotas DROP CONSTRAINT IF EXISTS quotas_org_id_fkey;
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
    ALTER TABLE public.quotas
      ADD CONSTRAINT quotas_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  -- reps.organization_id -> organizations.id
  IF to_regclass('public.reps') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.reps DROP CONSTRAINT IF EXISTS reps_org_fk;
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
    ALTER TABLE public.reps
      ADD CONSTRAINT reps_org_fk
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

    -- reps.org_id -> organizations.id (second FK)
    BEGIN
      ALTER TABLE public.reps DROP CONSTRAINT IF EXISTS reps_org_id_fkey;
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
    ALTER TABLE public.reps
      ADD CONSTRAINT reps_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  -- quotas.manager_id -> reps.id (CASCADE)
  IF to_regclass('public.quotas') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.quotas DROP CONSTRAINT IF EXISTS quotas_manager_id_fkey;
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
    ALTER TABLE public.quotas
      ADD CONSTRAINT quotas_manager_id_fkey
      FOREIGN KEY (manager_id) REFERENCES public.reps(id) ON DELETE CASCADE;
  END IF;

  -- organizations.parent_org_id -> organizations.id (SET NULL, not CASCADE)
  IF to_regclass('public.organizations') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_parent_org_id_fkey;
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_parent_org_id_fkey
      FOREIGN KEY (parent_org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;
END;
$$ LANGUAGE plpgsql;

