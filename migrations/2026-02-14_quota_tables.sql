DO $$
BEGIN
  -- Guard: skip if base schema is missing.
  IF to_regclass('public.organizations') IS NULL THEN
    RETURN;
  END IF;

  -- quota_periods
  IF to_regclass('public.quota_periods') IS NULL THEN
    EXECUTE $sql$
      CREATE TABLE public.quota_periods (
        id BIGSERIAL PRIMARY KEY,
        org_id BIGINT NOT NULL REFERENCES public.organizations(id),
        period_name TEXT NOT NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        fiscal_year TEXT NOT NULL,
        fiscal_quarter TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    $sql$;
  END IF;

  -- quotas
  IF to_regclass('public.reps') IS NULL THEN
    RETURN;
  END IF;

  IF to_regclass('public.quotas') IS NULL THEN
    EXECUTE $sql$
      CREATE TABLE public.quotas (
        id BIGSERIAL PRIMARY KEY,
        org_id BIGINT NOT NULL REFERENCES public.organizations(id),
        rep_id BIGINT REFERENCES public.reps(id),
        manager_id BIGINT REFERENCES public.reps(id),
        role_level INTEGER NOT NULL,
        quota_period_id BIGINT NOT NULL REFERENCES public.quota_periods(id),
        quota_amount NUMERIC NOT NULL,
        annual_target NUMERIC,
        carry_forward NUMERIC DEFAULT 0,
        adjusted_quarterly_quota NUMERIC,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    $sql$;
  END IF;
END;
$$ LANGUAGE plpgsql;
