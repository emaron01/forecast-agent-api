-- Update public.upsert_opportunity to support all deal registration CRM field types:
-- - deal_registration (boolean-ish)
-- - deal_reg_date (date)
-- - deal_reg_id (text / registration number)
--
-- Multi-tenant: customers may map any combination of these three fields.
-- Existing deal_registration boolean mappings are preserved (true/false continue to work).
-- Idempotent: CREATE OR REPLACE FUNCTION.
--
-- NOTE: this cannot recover already-lost historical truthy values if they were previously
-- coerced to false before this function was deployed. Customers should re-upload / re-sync
-- data after deploying this change to correct historical values.

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
  v_deal_reg_date date;
  v_deal_reg_id text;
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

  -- deal_registration (boolean) — smarter normalization
  IF p_row ? 'deal_registration' THEN
    v_deal_registration := CASE
      WHEN lower(btrim(p_row->>'deal_registration')) IN
        ('true','yes','y','1','registered','approved','active','pending') THEN true
      WHEN (p_row->>'deal_registration') ~ '^\d{4}-\d{2}-\d{2}' THEN true
      WHEN p_row->>'deal_registration' IS NOT NULL
        AND btrim(p_row->>'deal_registration') <> ''
        AND lower(btrim(p_row->>'deal_registration')) NOT IN
        ('false','no','n','0','null','none','expired','') THEN true
      ELSE false
    END;
  END IF;

  -- deal_reg_date (date) — customer maps their date field here
  IF p_row ? 'deal_reg_date' THEN
    BEGIN
      v_deal_reg_date := (p_row->>'deal_reg_date')::date;
      -- If date is present, also set boolean to true
      IF v_deal_reg_date IS NOT NULL THEN
        v_deal_registration := true;
      END IF;
    EXCEPTION WHEN others THEN
      v_deal_reg_date := NULL;
    END;
  END IF;

  -- deal_reg_id (text) — customer maps their reg number/ID field here
  IF p_row ? 'deal_reg_id' THEN
    v_deal_reg_id := btrim(COALESCE(p_row->>'deal_reg_id', ''));
    IF v_deal_reg_id = '' THEN
      v_deal_reg_id := NULL;
    ELSE
      -- If ID is present, also set boolean to true
      v_deal_registration := true;
    END IF;
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
      deal_reg_date,
      deal_reg_id,
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
      v_deal_reg_date,
      v_deal_reg_id,
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
           deal_reg_date = v_deal_reg_date,
           deal_reg_id = v_deal_reg_id,
           updated_at = now()
     WHERE o.org_id = v_org_id
       AND o.id = v_id;
  END IF;

  RETURN v_id;
END;
$function$;

