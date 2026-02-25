-- RISK 2: Backfill predictive_eligible for existing opportunities.
-- Idempotent: sets predictive_eligible based on forecast_stage/sales_stage.
-- Closed (won/lost/closed) => false, open => true.
-- Safe to run multiple times.

DO $$
DECLARE
  closed_count bigint;
  open_count bigint;
BEGIN
  -- Set predictive_eligible = false for closed deals
  WITH closed AS (
    UPDATE opportunities
       SET predictive_eligible = false
     WHERE org_id IS NOT NULL
       AND (
         COALESCE(forecast_stage ~* '\y(won|lost|closed)\y', false)
         OR COALESCE(sales_stage ~* '\y(won|lost|closed)\y', false)
       )
       AND (predictive_eligible IS NULL OR predictive_eligible != false)
     RETURNING 1
  )
  SELECT COUNT(*) INTO closed_count FROM closed;

  -- Set predictive_eligible = true for open deals
  WITH open AS (
    UPDATE opportunities
       SET predictive_eligible = true
     WHERE org_id IS NOT NULL
       AND NOT COALESCE(forecast_stage ~* '\y(won|lost|closed)\y', false)
       AND NOT COALESCE(sales_stage ~* '\y(won|lost|closed)\y', false)
       AND (predictive_eligible IS NULL OR predictive_eligible != true)
     RETURNING 1
  )
  SELECT COUNT(*) INTO open_count FROM open;

  RAISE NOTICE 'predictive_eligible backfill: closed=% open=%', closed_count, open_count;
END;
$$ LANGUAGE plpgsql;
