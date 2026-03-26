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

  IF to_regclass('public.revenue_buckets') IS NULL THEN
    EXECUTE $sql$
      CREATE TABLE public.revenue_buckets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        buckets JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, name)
      );
    $sql$;
  END IF;

  -- Helpful indexes
  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS revenue_buckets_org_user_updated_idx ON public.revenue_buckets (org_id, user_id, updated_at DESC)';
  EXCEPTION WHEN OTHERS THEN
    -- ignore
  END;
  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS revenue_buckets_org_user_name_idx ON public.revenue_buckets (org_id, user_id, name)';
  EXCEPTION WHEN OTHERS THEN
    -- ignore
  END;
END;
$$ LANGUAGE plpgsql;

