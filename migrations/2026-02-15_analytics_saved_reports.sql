DO $$
BEGIN
  -- Guard: skip if base schema is missing.
  IF to_regclass('public.organizations') IS NULL THEN
    RETURN;
  END IF;
  IF to_regclass('public.users') IS NULL THEN
    RETURN;
  END IF;

  -- Ensure uuid generator exists (used widely across schema)
  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pgcrypto';
  EXCEPTION WHEN OTHERS THEN
    -- ignore (managed DB may restrict extensions)
  END;

  IF to_regclass('public.analytics_saved_reports') IS NULL THEN
    EXECUTE $sql$
      CREATE TABLE public.analytics_saved_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id BIGINT NOT NULL REFERENCES public.organizations(id),
        owner_user_id BIGINT NOT NULL REFERENCES public.users(id),
        report_type TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    $sql$;
  END IF;

  -- Helpful indexes
  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS analytics_saved_reports_org_owner_type_idx ON public.analytics_saved_reports (org_id, owner_user_id, report_type)';
  EXCEPTION WHEN OTHERS THEN
    -- ignore
  END;
  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS analytics_saved_reports_org_owner_name_idx ON public.analytics_saved_reports (org_id, owner_user_id, name)';
  EXCEPTION WHEN OTHERS THEN
    -- ignore
  END;
END;
$$ LANGUAGE plpgsql;

