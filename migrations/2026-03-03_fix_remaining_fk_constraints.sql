DO $$ BEGIN

  -- Break circular reps <-> quotas by making reps.quota_id SET NULL
  IF to_regclass('public.reps') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.reps DROP CONSTRAINT IF EXISTS reps_quota_fk;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
    ALTER TABLE public.reps
      ADD CONSTRAINT reps_quota_fk
      FOREIGN KEY (quota_id) REFERENCES public.quotas(id) ON DELETE SET NULL;
  END IF;

  -- quotas.rep_id -> reps (CASCADE: quota is meaningless without rep)
  IF to_regclass('public.quotas') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.quotas DROP CONSTRAINT IF EXISTS quotas_rep_id_fkey;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
    ALTER TABLE public.quotas
      ADD CONSTRAINT quotas_rep_id_fkey
      FOREIGN KEY (rep_id) REFERENCES public.reps(id) ON DELETE CASCADE;
  END IF;

  -- quotas.quota_period_id -> quota_periods (CASCADE)
  IF to_regclass('public.quotas') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.quotas DROP CONSTRAINT IF EXISTS quotas_quota_period_id_fkey;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
    ALTER TABLE public.quotas
      ADD CONSTRAINT quotas_quota_period_id_fkey
      FOREIGN KEY (quota_period_id) REFERENCES public.quota_periods(id) ON DELETE CASCADE;
  END IF;

  -- opportunities.rep_id -> reps (SET NULL: keep opportunity, lose rep ref)
  IF to_regclass('public.opportunities') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_rep_id_fkey;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_rep_id_fkey
      FOREIGN KEY (rep_id) REFERENCES public.reps(id) ON DELETE SET NULL;
  END IF;

  -- opportunity_audit_events.actor_rep_id -> reps (SET NULL: keep audit trail)
  IF to_regclass('public.opportunity_audit_events') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.opportunity_audit_events
        DROP CONSTRAINT IF EXISTS opportunity_audit_events_actor_rep_fk;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
    ALTER TABLE public.opportunity_audit_events
      ADD CONSTRAINT opportunity_audit_events_actor_rep_fk
      FOREIGN KEY (actor_rep_id) REFERENCES public.reps(id) ON DELETE SET NULL;
  END IF;

  -- reps.manager_id -> reps self-ref (SET NULL)
  IF to_regclass('public.reps') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.reps DROP CONSTRAINT IF EXISTS reps_manager_id_fkey;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
    ALTER TABLE public.reps
      ADD CONSTRAINT reps_manager_id_fkey
      FOREIGN KEY (manager_id) REFERENCES public.reps(id) ON DELETE SET NULL;

    BEGIN
      ALTER TABLE public.reps DROP CONSTRAINT IF EXISTS reps_manager_fk;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
    ALTER TABLE public.reps
      ADD CONSTRAINT reps_manager_fk
      FOREIGN KEY (manager_rep_id) REFERENCES public.reps(id) ON DELETE SET NULL;
  END IF;

  -- reps.user_id -> users (SET NULL: keep rep record if user deleted)
  IF to_regclass('public.reps') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.reps DROP CONSTRAINT IF EXISTS reps_user_fk;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
    ALTER TABLE public.reps
      ADD CONSTRAINT reps_user_fk
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

END; $$ LANGUAGE plpgsql;

