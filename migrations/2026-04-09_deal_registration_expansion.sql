-- Expand deal registration to support boolean, date, and ID/text fields.
-- Multi-tenant: customers may map any combination of these three fields.
-- Existing deal_registration boolean mappings are fully preserved.
-- Idempotent: safe to re-run on every deploy.
--
-- NOTE:
-- Some earlier ingestion paths coerced non-boolean CRM values (e.g. "Registered", "Yes",
-- dates, "DR-12345") into deal_registration=false. This migration cannot recover already-lost
-- truthy values without re-ingestion from the source CRM / a fresh upload.
-- After deploying the upsert_opportunity fix, customers should re-upload / re-sync data to
-- correct historical values where needed.

DO $$
BEGIN
  IF to_regclass('public.opportunities') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.opportunities
    ADD COLUMN IF NOT EXISTS deal_reg_date date,
    ADD COLUMN IF NOT EXISTS deal_reg_id text;
END;
$$ LANGUAGE plpgsql;

