-- is_manual: true = entered manually (exec/manager self quota); not overwritten by rollup sync.
DO $$
BEGIN
  IF to_regclass('public.quotas') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'quotas'
       AND column_name = 'is_manual'
  ) THEN
    ALTER TABLE public.quotas
      ADD COLUMN is_manual BOOLEAN NOT NULL DEFAULT false;
  END IF;
END;
$$ LANGUAGE plpgsql;
