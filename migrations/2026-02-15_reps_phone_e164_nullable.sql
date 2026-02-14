-- Twilio legacy cleanup: reps.phone_e164 is deprecated and must not be required.
-- Make phone_e164 nullable so app logic does not need to populate it.
-- Idempotent: checks column + nullability before altering.

DO $$
BEGIN
  IF to_regclass('public.reps') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'reps'
       AND column_name = 'phone_e164'
       AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.reps
      ALTER COLUMN phone_e164 DROP NOT NULL;
  END IF;
END;
$$ LANGUAGE plpgsql;

