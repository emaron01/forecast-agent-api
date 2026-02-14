-- Ensure reps.quota_id UUID exists and references quotas(id).
-- Backfill reps.quota_id from quotas where q.rep_id = r.id.
-- Idempotent and safe to run multiple times.

DO $$
BEGIN
  IF to_regclass('public.reps') IS NULL THEN
    RETURN;
  END IF;
  IF to_regclass('public.quotas') IS NULL THEN
    RETURN;
  END IF;

  -- Add column if missing.
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'reps'
       AND column_name = 'quota_id'
  ) THEN
    ALTER TABLE public.reps
      ADD COLUMN quota_id uuid;
  END IF;

  -- Backfill (leave NULL when no matching quota exists).
  UPDATE reps r
     SET quota_id = q.id
    FROM quotas q
   WHERE q.rep_id = r.id;

  -- Add FK constraint if missing.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reps_quota_fk') THEN
    ALTER TABLE public.reps
      ADD CONSTRAINT reps_quota_fk
      FOREIGN KEY (quota_id) REFERENCES public.quotas(id);
  END IF;
END;
$$ LANGUAGE plpgsql;

