-- Deal registration: normalize non-boolean CRM values in upsert_opportunity.
--
-- Previously, (p_row->>'deal_registration')::boolean used an EXCEPTION handler that
-- silently coerced any non-castable value (e.g. "Registered", "Yes", dates, "DR-12345")
-- to false, losing real registrations.
--
-- Existing rows with deal_registration = false that were incorrectly set cannot be
-- automatically corrected without re-ingestion from the source CRM or a fresh upload.
-- After deploying this fix, customers should re-upload / re-sync data to correct
-- historical values where needed.
--
-- Safe to re-run: CREATE OR REPLACE FUNCTION only.

CREATE OR REPLACE FUNCTION public.upsert_opportunity(p_row jsonb, p_org_id bigint)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
AS $function$
DECLARE
  v_org_id integer := p_org_id::integer;
  v_crm_opp_id text;
  v_id integer;

  v_account_name text;
  v_opportunity_name text;
  v_rep_name text;
  v_product text;
  v_sales_stage text;
  v_forecast_stage text;
  v_partner_name text;
  v_create_date_raw text;

  v_amount numeric;
  v_close_date date;
  v_deal_registration boolean := false;
BEGIN
  -- Required identifiers.
  v_crm_opp_id := NULLIF(btrim(COALESCE(p_row->>'crm_opp_id', '')), '');
  IF v_crm_opp_id IS NULL THEN
    RAISE EXCEPTION 'crm_opp_id is required';
  END IF;

  -- Strings (trimmed).
  v_account_name := NULLIF(btrim(COALESCE(p_row->>'account_name', '')), '');
  v_opportunity_name := NULLIF(btrim(COALESCE(p_row->>'opportunity_name', '')), '');
  v_rep_name := NULLIF(btrim(COALESCE(p_row->>'rep_name', '')), '');
  v_product := NULLIF(btrim(COALESCE(p_row->>'product', '')), '');
  v_sales_stage := NULLIF(btrim(COALESCE(p_row->>'sales_stage', '')), '');
  v_forecast_stage := NULLIF(btrim(COALESCE(p_row->>'forecast_stage', '')), '');
  v_partner_name := NULLIF(btrim(COALESCE(p_row->>'partner_name', '')), '');
  v_create_date_raw := NULLIF(btrim(COALESCE(p_row->>'create_date_raw', '')), '');

  -- Typed fields.
  v_amount := try_parse_numeric_from_any(p_row->'amount');
  v_close_date := try_parse_date_from_any(p_row->'close_date');

  -- Optional boolean: tolerate CRM strings, dates, registration IDs, etc.
  IF p_row ? 'deal_registration' THEN
    v_deal_registration := CASE
      WHEN lower(btrim(COALESCE(p_row->>'deal_registration', ''))) IN
        ('true', 'yes', 'y', '1', 'registered', 'approved', 'active', 'pending') THEN true
      WHEN (p_row->>'deal_registration') ~ '^\d{4}-\d{2}-\d{2}' THEN true
      WHEN p_row->>'deal_registration' IS NOT NULL
        AND btrim(p_row->>'deal_registration') <> ''
        AND lower(btrim(p_row->>'deal_registration')) NOT IN
          ('false', 'f', 'no', 'n', '0', 'null', 'none', 'expired', '') THEN true
      ELSE false
    END;
  END IF;

  -- Find existing record by (org_id, crm_opp_id). If duplicates exist, update the most recent.
  SELECT o.id
    INTO v_id
    FROM public.opportunities o
   WHERE o.org_id = v_org_id
     AND NULLIF(btrim(COALESCE(o.crm_opp_id, '')), '') = v_crm_opp_id
   ORDER BY o.updated_at DESC NULLS LAST, o.id DESC
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.opportunities (
      org_id,
      crm_opp_id,
      account_name,
      opportunity_name,
      rep_name,
      product,
      amount,
      create_date_raw,
      close_date,
      sales_stage,
      forecast_stage,
      partner_name,
      deal_registration,
      rep_id,
      created_at,
      updated_at
    )
    VALUES (
      v_org_id,
      v_crm_opp_id,
      v_account_name,
      v_opportunity_name,
      v_rep_name,
      v_product,
      v_amount,
      v_create_date_raw,
      v_close_date,
      v_sales_stage,
      v_forecast_stage,
      v_partner_name,
      v_deal_registration,
      NULL,
      now(),
      now()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.opportunities o
       SET account_name = v_account_name,
           opportunity_name = v_opportunity_name,
           rep_name = v_rep_name,
           product = v_product,
           amount = v_amount,
           create_date_raw = v_create_date_raw,
           close_date = v_close_date,
           sales_stage = v_sales_stage,
           forecast_stage = v_forecast_stage,
           partner_name = v_partner_name,
           deal_registration = v_deal_registration,
           updated_at = now()
     WHERE o.org_id = v_org_id
       AND o.id = v_id;
  END IF;

  RETURN v_id;
END;
$function$;
