DO $$
BEGIN
  IF to_regclass('public.opportunities') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE opportunities
    ADD COLUMN IF NOT EXISTS partner_name TEXT;

  ALTER TABLE opportunities
    ADD COLUMN IF NOT EXISTS deal_registration BOOLEAN;

  ALTER TABLE opportunities
    ALTER COLUMN deal_registration SET DEFAULT false;

  UPDATE opportunities
     SET deal_registration = false
   WHERE deal_registration IS NULL;
END;
$$ LANGUAGE plpgsql;

