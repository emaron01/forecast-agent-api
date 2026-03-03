-- Ensure quotas.manager_id FK uses ON DELETE CASCADE so deleting a rep
-- (e.g. when deleting an organization) does not violate quotas_manager_id_fkey.

DO $$
BEGIN
  IF to_regclass('public.quotas') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND table_name = 'quotas'
       AND constraint_name = 'quotas_manager_id_fkey'
  ) THEN
    ALTER TABLE public.quotas DROP CONSTRAINT quotas_manager_id_fkey;
  END IF;

  ALTER TABLE public.quotas
    ADD CONSTRAINT quotas_manager_id_fkey
    FOREIGN KEY (manager_id)
    REFERENCES public.reps(id)
    ON DELETE CASCADE;
END;
$$ LANGUAGE plpgsql;

